//! Start-up watch for WebKitGTK's "Failed to create GBM buffer" line.
//!
//! On some NVIDIA setups the accelerated backing store cannot allocate its
//! buffers: the web process prints that line and the window stays grey, with
//! no way to reach Settings. WebKit does not recover from it (it picks the
//! buffer type once), so the line is a reliable sign that this start will
//! never draw.
//!
//! The web process inherits the UI process' fd 2. So, before the first web
//! view exists, fd 2 is replaced by a pipe whose reader thread copies every
//! byte to the original stderr and looks for the line. The first match inside
//! the start-up window saves Compatibility and restarts the game once, with a
//! marker that forces Compatibility for that start.
//!
//! Everything here is best effort: if any step fails, stderr is left as it
//! was and the game starts as it did before. The decisions (`watch_applies`, `handle_match`),
//! the window (`window_open`), the line matcher and the tee are plain
//! functions that need no display.

use super::{save_choice, settings_file_path, RenderMode, FALLBACK_ENV};
use std::ffi::OsString;
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::{AsFd, AsRawFd, BorrowedFd, OwnedFd};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Fixed English prefix of the WebKit line. The text after it is the errno
/// message, which follows the system locale ("Argumento inválido"), so only
/// the prefix is matched.
const GBM_PREFIX: &[u8] = b"Failed to create GBM buffer of size ";

/// A match counts for this long after the game window is created. WebKit
/// allocates its first two buffers when the first frame is drawn, a second or
/// two after the page starts loading; 15 s leaves room for a slow machine,
/// while a later line (the same message can repeat on a resize) must never
/// restart the game in the middle of play.
const WINDOW: Duration = Duration::from_secs(15);

/// Upper bound counted from the moment the watch is installed, in case the
/// window-created mark never arrives.
const HARD_LIMIT: Duration = Duration::from_secs(60);

/// Longest line kept while waiting for its newline.
const MAX_LINE: usize = 8 * 1024;

/// After asking the app to exit, how long before the process is ended anyway.
const EXIT_GRACE: Duration = Duration::from_secs(3);

/// When the game window was created; unset until `setup` runs.
static WINDOW_CREATED: OnceLock<Instant> = OnceLock::new();

/// Clean way to close the app (`AppHandle::exit`), set once `setup` runs.
type ExitHook = Box<dyn Fn() + Send + Sync>;
static EXIT_HOOK: OnceLock<ExitHook> = OnceLock::new();

/// True when `line` holds the WebKit GBM failure message.
pub fn line_matches(line: &[u8]) -> bool {
    line.windows(GBM_PREFIX.len())
        .any(|part| part == GBM_PREFIX)
}

/// Pure decision: does this start need the watch at all?
///
/// Only an accelerated start qualifies, the user's own variable is never
/// overridden, and the marker means this start already is the fallback.
pub fn watch_applies(
    mode: Option<RenderMode>,
    user_value: Option<&str>,
    fallback_marker: bool,
) -> bool {
    mode == Some(RenderMode::Accelerated) && user_value.is_none() && !fallback_marker
}

/// Pure window rule from the time since the watch was installed and, when
/// known, since the window was created.
fn window_open(since_install: Duration, since_window: Option<Duration>) -> bool {
    since_install < HARD_LIMIT && since_window.is_none_or(|elapsed| elapsed < WINDOW)
}

/// Records that the game window is being created; opens the 15 s window.
pub fn mark_window_created() {
    let _ = WINDOW_CREATED.set(Instant::now());
}

/// Registers how to close the app cleanly. Without it the process just exits.
pub fn set_exit_hook(hook: impl Fn() + Send + Sync + 'static) {
    let _ = EXIT_HOOK.set(Box::new(hook));
}

/// Finds matching lines in a byte stream that arrives in arbitrary chunks.
#[derive(Default)]
struct LineScanner {
    pending: Vec<u8>,
}

impl LineScanner {
    /// Feeds a chunk and returns how many matching lines it completed.
    fn feed(&mut self, chunk: &[u8]) -> usize {
        let mut hits = 0;
        for part in chunk.split_inclusive(|byte| *byte == b'\n') {
            if part.ends_with(b"\n") {
                let whole = if self.pending.is_empty() {
                    part
                } else {
                    self.pending.extend_from_slice(part);
                    self.pending.as_slice()
                };
                hits += usize::from(line_matches(whole));
                self.pending.clear();
            } else {
                self.pending.extend_from_slice(part);
                if self.pending.len() > MAX_LINE {
                    hits += usize::from(line_matches(&self.pending));
                    // Keep the tail that could still be the start of the prefix, so a
                    // prefix cut in two by this drop is found once the rest arrives.
                    // The tail is shorter than the prefix: nothing is counted twice.
                    let cut = self.pending.len() - (GBM_PREFIX.len() - 1);
                    self.pending.drain(..cut);
                }
            }
        }
        hits
    }
}

/// Copies `reader` to `out` until it ends and calls `on_match` once per
/// matching line, after that line has been passed through. A failing `out`
/// never stops the copy: the pipe must be drained for the life of the
/// process, or WebKit's child processes would block on a full pipe.
fn tee<R: Read, W: Write>(mut reader: R, mut out: W, mut on_match: impl FnMut()) {
    let mut buffer = [0u8; 8192];
    let mut scanner = LineScanner::default();
    loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) => return,
            Ok(read) => read,
            // A signal arriving during the read is not the end of the stream.
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        };
        let chunk = &buffer[..read];
        let _ = out.write_all(chunk).and_then(|()| out.flush());
        for _ in 0..scanner.feed(chunk) {
            on_match();
        }
    }
}

/// Program to start again: the AppImage file when `$APPIMAGE` names one (the
/// running binary lives inside its temporary mount), else the current binary
/// (deb and plain binary).
fn restart_target(appimage: Option<OsString>, current: io::Result<PathBuf>) -> io::Result<PathBuf> {
    appimage
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .map_or(current, Ok)
}

/// Starts the game again with the fallback marker and the original stderr.
fn restart(original_stderr: &OwnedFd) -> io::Result<()> {
    let program = restart_target(std::env::var_os("APPIMAGE"), std::env::current_exe())?;
    Command::new(program)
        .args(std::env::args_os().skip(1))
        .env(FALLBACK_ENV, "1")
        .stderr(Stdio::from(original_stderr.try_clone()?))
        .spawn()
        .map(|_child| ())
}

/// Ends the process without running exit handlers: GTK and WebKit are still
/// live at this point, and their handlers could hang the exit. Rust's own
/// stdout is flushed first so the last log lines are kept.
fn hard_exit() -> ! {
    let _ = io::stdout().flush();
    // SAFETY: `_exit` takes no pointers and never returns; skipping the exit
    // handlers is the point.
    unsafe { libc::_exit(0) }
}

/// Closes the app: through the hook when set, and for sure after a grace time.
fn exit_soon() {
    std::thread::spawn(|| {
        std::thread::sleep(EXIT_GRACE);
        hard_exit();
    });
    match EXIT_HOOK.get() {
        Some(hook) => hook(),
        None => hard_exit(),
    }
}

/// Runs `act` for the first match inside the window, and never again. A panic
/// in `act` is caught, so the tee keeps draining the pipe. Returns `None` when
/// `act` was not run, else whether it ran to the end without panicking.
fn handle_match(fired: &mut bool, in_window: bool, act: impl FnOnce()) -> Option<bool> {
    if *fired || !in_window {
        return None;
    }
    *fired = true;
    Some(std::panic::catch_unwind(std::panic::AssertUnwindSafe(act)).is_ok())
}

/// Puts the original stderr back on fd 2 when the reader thread ends, for any
/// reason (including a panic), so the app's own later writes never go into a
/// pipe that nobody reads. Child processes that already hold the pipe keep it;
/// the tee only ends on a read error, which a blocking pipe does not produce
/// short of a bug.
struct RestoreStderr(OwnedFd);

impl Drop for RestoreStderr {
    fn drop(&mut self) {
        let _ = redirect_stderr(self.0.as_fd());
    }
}

/// Saves Compatibility, restarts once and closes this process.
fn fall_back(settings_path: Option<&Path>, original_stderr: &OwnedFd, log: &mut impl Write) {
    let _ = writeln!(
        log,
        "[OLManager] Linux rendering: accelerated could not draw (GBM buffer failure); \
         switching to compatibility and restarting"
    );
    let saved = match settings_path {
        Some(path) => save_choice(path, RenderMode::Compatibility).map_err(|e| e.to_string()),
        None => Err("settings directory unknown".to_string()),
    };
    if let Err(error) = saved {
        let _ = writeln!(
            log,
            "[OLManager] Could not save the compatibility choice: {error}. \
             This restart still uses compatibility, but the next start will try \
             accelerated again; choose Compatibility in Settings to keep it"
        );
    }
    match restart(original_stderr) {
        Ok(()) => exit_soon(),
        Err(error) => {
            let _ = writeln!(
                log,
                "[OLManager] Could not restart in compatibility: {error}"
            );
        }
    }
}

fn redirect_stderr(to: BorrowedFd<'_>) -> io::Result<()> {
    // SAFETY: both descriptors are open for the duration of the call; dup2
    // only replaces what fd 2 refers to.
    if unsafe { libc::dup2(to.as_raw_fd(), libc::STDERR_FILENO) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Puts the tee in place of fd 2. On any error stderr is left untouched.
/// Must run on the main thread before the first web view is created.
///
/// While the watch runs, fd 2 is a pipe: GLib and other libraries no longer see
/// a terminal (so no colours) or the journal, but every byte still reaches the
/// original stderr. Bytes written just before a crash can be lost, because the
/// copy is asynchronous.
pub fn install() -> io::Result<()> {
    let installed = Instant::now();
    let settings_path = settings_file_path();
    let (reader, writer) = io::pipe()?;
    let original = io::stderr().as_fd().try_clone_to_owned()?;
    let restore = RestoreStderr(original.try_clone()?);
    let mut out = File::from(original.try_clone()?);
    let mut log = out.try_clone()?;

    // The thread goes first: if it cannot start, fd 2 is never touched.
    std::thread::Builder::new()
        .name("gbm-watch".into())
        .spawn(move || {
            let _restore = restore;
            let mut fired = false;
            tee(reader, &mut out, || {
                let in_window = window_open(
                    installed.elapsed(),
                    WINDOW_CREATED.get().map(Instant::elapsed),
                );
                // Installed only when `watch_applies`, so only the window and
                // the one-shot rule are left to check here.
                let outcome = handle_match(&mut fired, in_window, || {
                    fall_back(settings_path.as_deref(), &original, &mut log);
                });
                if outcome == Some(false) {
                    let _ = writeln!(
                        log,
                        "[OLManager] The switch to compatibility rendering failed unexpectedly"
                    );
                }
            });
        })?;
    // If this fails the writer drops, the thread sees the end and stops.
    redirect_stderr(writer.as_fd())
    // `writer` drops here: fd 2 is now the only write end.
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENGLISH: &[u8] = b"Failed to create GBM buffer of size 1280x800: Invalid argument\n";
    const SPANISH: &[u8] =
        b"Failed to create GBM buffer of size 1280x800: Argumento inv\xc3\xa1lido\n";

    #[test]
    fn matcher_accepts_the_prefix_with_any_errno_text() {
        assert!(line_matches(ENGLISH));
        assert!(line_matches(SPANISH));
        assert!(line_matches(b"Failed to create GBM buffer of size 1x1: "));
    }

    #[test]
    fn matcher_accepts_the_prefix_after_a_log_prefix() {
        assert!(line_matches(
            b"(WebKitWebProcess:42): Failed to create GBM buffer of size 8x8: x"
        ));
    }

    #[test]
    fn matcher_rejects_other_lines() {
        assert!(!line_matches(b""));
        assert!(!line_matches(b"Failed to create GBM buffer\n"));
        assert!(!line_matches(
            b"Failed to create EGL image of size 1280x800\n"
        ));
        assert!(!line_matches(
            b"[OLManager] Linux rendering: accelerated (saved choice)\n"
        ));
    }

    #[test]
    fn scanner_counts_a_line_split_across_chunks_once() {
        let mut scanner = LineScanner::default();
        assert_eq!(scanner.feed(b"noise\nFailed to create GBM "), 0);
        assert_eq!(scanner.feed(b"buffer of size 1x1: Invalid"), 0);
        assert_eq!(scanner.feed(b" argument\nmore noise\n"), 1);
    }

    #[test]
    fn scanner_counts_every_matching_line_of_a_chunk() {
        let mut scanner = LineScanner::default();
        assert_eq!(scanner.feed(&[ENGLISH, ENGLISH, b"other\n"].concat()), 2);
    }

    #[test]
    fn scanner_drops_an_endless_line_without_growing() {
        let mut scanner = LineScanner::default();
        scanner.feed(&vec![b'x'; MAX_LINE + 1]);
        assert!(scanner.pending.len() < GBM_PREFIX.len());
    }

    #[test]
    fn scanner_finds_a_prefix_cut_in_two_by_the_overflow_drop() {
        let mut scanner = LineScanner::default();
        let (head, rest) = GBM_PREFIX.split_at(10);
        let long = [vec![b'x'; MAX_LINE - 5].as_slice(), head].concat();
        assert_eq!(scanner.feed(&long), 0);
        assert_eq!(scanner.feed(&[rest, b"1x1: e\n".as_slice()].concat()), 1);
    }

    #[test]
    fn tee_retries_a_read_interrupted_by_a_signal() {
        struct InterruptedOnce {
            interrupted: bool,
            data: &'static [u8],
        }
        impl Read for InterruptedOnce {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                if !self.interrupted {
                    self.interrupted = true;
                    return Err(io::ErrorKind::Interrupted.into());
                }
                let n = self.data.len().min(buf.len());
                buf[..n].copy_from_slice(&self.data[..n]);
                self.data = &self.data[n..];
                Ok(n)
            }
        }
        let reader = InterruptedOnce {
            interrupted: false,
            data: ENGLISH,
        };
        let mut out = Vec::new();
        let mut matches = 0;
        tee(reader, &mut out, || matches += 1);
        assert_eq!(out, ENGLISH);
        assert_eq!(matches, 1);
    }

    #[test]
    fn a_match_acts_once_and_only_inside_the_window() {
        let mut fired = false;
        let mut runs = 0;
        assert_eq!(handle_match(&mut fired, false, || runs += 1), None);
        assert_eq!(handle_match(&mut fired, true, || runs += 1), Some(true));
        assert_eq!(handle_match(&mut fired, true, || runs += 1), None);
        assert_eq!(runs, 1);
    }

    #[test]
    fn a_panicking_fallback_is_caught_and_never_retried() {
        let mut fired = false;
        let outcome = handle_match(&mut fired, true, || panic!("save exploded"));
        assert_eq!(outcome, Some(false));
        assert_eq!(handle_match(&mut fired, true, || ()), None);
    }

    #[test]
    fn the_watch_applies_only_to_an_accelerated_start_with_no_variable_or_marker() {
        let accelerated = Some(RenderMode::Accelerated);
        assert!(watch_applies(accelerated, None, false));
        assert!(!watch_applies(accelerated, Some("1"), false));
        assert!(!watch_applies(accelerated, None, true));
        assert!(!watch_applies(Some(RenderMode::Compatibility), None, false));
        assert!(!watch_applies(None, None, false));
    }

    #[test]
    fn tee_passes_every_byte_through_and_reports_each_match() {
        let (reader, mut writer) = io::pipe().unwrap();
        let input = [b"start\n".as_slice(), ENGLISH, b"middle\n", SPANISH, b"end"].concat();
        writer.write_all(&input).unwrap();
        drop(writer);
        let mut out = Vec::new();
        let mut matches = 0;
        tee(reader, &mut out, || matches += 1);
        assert_eq!(out, input);
        assert_eq!(matches, 2);
    }

    #[test]
    fn tee_keeps_draining_when_the_output_fails() {
        struct Broken;
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let (reader, mut writer) = io::pipe().unwrap();
        writer.write_all(ENGLISH).unwrap();
        drop(writer);
        let mut matches = 0;
        tee(reader, Broken, || matches += 1);
        assert_eq!(matches, 1);
    }

    #[test]
    fn a_user_variable_that_keeps_acceleration_still_disables_the_watch() {
        // "0" leaves WebKit accelerated, but the user chose it: never override.
        assert!(!watch_applies(
            Some(RenderMode::Accelerated),
            Some("0"),
            false
        ));
        assert!(!watch_applies(None, Some("0"), false));
    }

    #[test]
    fn window_is_open_until_fifteen_seconds_after_the_window_was_created() {
        let second = Duration::from_secs(1);
        assert!(window_open(second, None));
        assert!(window_open(second * 20, Some(second * 14)));
        assert!(!window_open(second * 20, Some(second * 15)));
    }

    #[test]
    fn window_closes_at_the_hard_limit_even_without_a_window_mark() {
        assert!(!window_open(HARD_LIMIT, None));
    }

    #[test]
    fn restart_prefers_an_existing_appimage_file() {
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("OLManager.AppImage");
        std::fs::write(&image, b"").unwrap();
        let target = restart_target(
            Some(image.clone().into_os_string()),
            Ok("/tmp/.mount_x/olmanager".into()),
        );
        assert_eq!(target.unwrap(), image);
    }

    #[test]
    fn restart_uses_the_current_binary_without_a_usable_appimage() {
        let current = || Ok(PathBuf::from("/usr/bin/olmanager"));
        assert_eq!(
            restart_target(None, current()).unwrap(),
            Path::new("/usr/bin/olmanager")
        );
        assert_eq!(
            restart_target(Some(OsString::new()), current()).unwrap(),
            Path::new("/usr/bin/olmanager")
        );
        assert_eq!(
            restart_target(Some("/no/such/file.AppImage".into()), current()).unwrap(),
            Path::new("/usr/bin/olmanager")
        );
    }
}
