//! The native GTK window that asks which rendering mode to use.
//!
//! It runs before `tauri::Builder`, so it initialises GTK itself. tao (under
//! Tauri) calls `gtk::init()` later on the same thread; gtk-rs makes that call
//! a no-op once GTK is initialised on the calling thread. The window is
//! destroyed and its events drained before returning.

use super::texts::DialogTexts;
use super::{Answer, RenderMode};
use gtk::prelude::*;
use std::cell::RefCell;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::rc::Rc;

/// Shows the question and blocks until it is answered or closed. Never panics
/// and never fails the start: any problem comes back as `Unavailable`.
pub fn ask(texts: &DialogTexts) -> Answer {
    catch_unwind(AssertUnwindSafe(|| show(texts)))
        .unwrap_or_else(|_| Answer::Unavailable("the dialog panicked".to_string()))
}

fn hint_label(text: &str, indent: i32) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.set_xalign(0.0);
    label.set_line_wrap(true);
    label.set_max_width_chars(56);
    label.set_margin_start(indent);
    label.style_context().add_class("dim-label");
    label
}

fn show(texts: &DialogTexts) -> Answer {
    if let Err(error) = gtk::init() {
        return Answer::Unavailable(format!("GTK could not start: {error}"));
    }

    let answer: Rc<RefCell<Option<Answer>>> = Rc::new(RefCell::new(None));

    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title(&texts.title);
    window.set_position(gtk::WindowPosition::Center);
    window.set_resizable(false);
    window.set_border_width(20);
    window.set_default_size(480, -1);

    let column = gtk::Box::new(gtk::Orientation::Vertical, 8);

    let intro = gtk::Label::new(Some(&texts.intro));
    intro.set_xalign(0.0);
    intro.set_line_wrap(true);
    intro.set_max_width_chars(60);
    intro.set_margin_bottom(6);
    column.pack_start(&intro, false, false, 0);

    let fast = gtk::RadioButton::with_label(&texts.fast);
    let compat = gtk::RadioButton::with_label_from_widget(&fast, &texts.compat);
    fast.set_active(true);
    column.pack_start(&fast, false, false, 0);
    column.pack_start(&hint_label(&texts.fast_hint, 26), false, false, 0);
    column.pack_start(&compat, false, false, 6);
    column.pack_start(&hint_label(&texts.compat_hint, 26), false, false, 0);

    let remember = gtk::CheckButton::with_label(&texts.remember);
    remember.set_margin_top(10);
    column.pack_start(&remember, false, false, 0);
    column.pack_start(&hint_label(&texts.remember_hint, 26), false, false, 0);

    let button = gtk::Button::with_label(&texts.button);
    button.set_halign(gtk::Align::End);
    button.set_margin_top(12);
    column.pack_start(&button, false, false, 0);

    window.add(&column);

    {
        let answer = Rc::clone(&answer);
        let window = window.clone();
        let fast = fast.clone();
        let remember = remember.clone();
        button.connect_clicked(move |_| {
            let mode = if fast.is_active() {
                RenderMode::Accelerated
            } else {
                RenderMode::Compatibility
            };
            *answer.borrow_mut() = Some(Answer::Chosen {
                mode,
                remember: remember.is_active(),
            });
            window.close();
        });
    }
    window.connect_destroy(|_| gtk::main_quit());

    window.show_all();
    button.grab_default();
    gtk::main();
    // Let GTK finish tearing the window down before tao takes over.
    while gtk::events_pending() {
        gtk::main_iteration_do(false);
    }

    answer.take().unwrap_or(Answer::Dismissed)
}
