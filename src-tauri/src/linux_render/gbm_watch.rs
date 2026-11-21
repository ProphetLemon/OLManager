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
//! was and the game starts as it did before. The decision (`should_fall_back`),
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

/// Pure decision: may a match restart the game in Compatibility?
///
/// Only an accelerated start qualifies, the user's own variable is never
/// overridden, the marker means this start already is the fallback, and the
/// match must fall inside the start-up window.
pub fn should_fall_back(
    mode: Option<RenderMode>,
    user_value: Option<&str>,
    fallback_marker: bool,
    in_window: bool,
) -> bool {
    mode == Some(RenderMode::Accelerated) && user_value.is_none() && !fallback_marker && in_window
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
                    self.pending.clear();
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
            Ok(0) | Err(_) => return,
            Ok(read) => read,
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

/// Closes the app: through the hook when set, and for sure after a grace time.
fn exit_soon() {
    std::thread::spawn(|| {
        std::thread::sleep(EXIT_GRACE);
        std::process::exit(0);
    });
    match EXIT_HOOK.get() {
        Some(hook) => hook(),
        None => std::process::exit(0),
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
            "[OLManager] Could not save the compatibility choice: {error}; \
             the restart still uses it once"
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
pub fn install() -> io::Result<()> {
    let installed = Instant::now();
    let settings_path = settings_file_path();
    let (reader, writer) = io::pipe()?;
    let original = io::stderr().as_fd().try_clone_to_owned()?;
    let mut out = File::from(original.try_clone()?);
    let mut log = out.try_clone()?;

    // The thread goes first: if it cannot start, fd 2 is never touched.
    std::thread::Builder::new()
        .name("gbm-watch".into())
        .spawn(move || {
            let mut fired = false;
            tee(reader, &mut out, || {
                let in_window = window_open(
                    installed.elapsed(),
                    WINDOW_CREATED.get().map(Instant::elapsed),
                );
                // Installed only for an accelerated start with no user variable
                // and no marker, so only the window is left to check.
                let qualifies =
                    should_fall_back(Some(RenderMode::Accelerated), None, false, in_window);
                if qualifies && !fired {
                    fired = true;
                    fall_back(settings_path.as_deref(), &original, &mut log);
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
        assert!(scanner.pending.is_empty());
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
    fn only_an_accelerated_start_with_no_variable_or_marker_in_the_window_falls_back() {
        let accelerated = Some(RenderMode::Accelerated);
        assert!(should_fall_back(accelerated, None, false, true));
    }

    #[test]
    fn compatibility_or_a_user_variable_never_fall_back() {
        let accelerated = Some(RenderMode::Accelerated);
        assert!(!should_fall_back(
            Some(RenderMode::Compatibility),
            None,
            false,
            true
        ));
        assert!(!should_fall_back(None, Some("0"), false, true));
        assert!(!should_fall_back(accelerated, Some("0"), false, true));
    }

    #[test]
    fn the_marker_and_a_closed_window_never_fall_back() {
        let accelerated = Some(RenderMode::Accelerated);
        assert!(!should_fall_back(accelerated, None, true, true));
        assert!(!should_fall_back(accelerated, None, false, false));
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
