use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};

const DESKTOP_STAGE_SIZE: f64 = 300.0;
const DESKTOP_WINDOW_WIDTH: f64 = 540.0;
const DESKTOP_WINDOW_HEIGHT: f64 = 430.0;
const SNAP_MARGIN: f64 = 0.0;
const PASSTHROUGH_POLL_MS: u64 = 32;

struct DragState(Mutex<DragInner>);

struct DragInner {
    snap_edge: &'static str,
    stage_x: f64,
    stage_y: f64,
    interactive_regions: Vec<InteractiveRegion>,
    /// When true, never ignore cursor events (e.g. during window drag).
    passthrough_suppressed: bool,
}

#[derive(Clone, Deserialize)]
struct InteractiveRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Default for DragInner {
    fn default() -> Self {
        Self {
            snap_edge: "right",
            stage_x: DESKTOP_WINDOW_WIDTH - DESKTOP_STAGE_SIZE,
            stage_y: (DESKTOP_WINDOW_HEIGHT - DESKTOP_STAGE_SIZE) / 2.0,
            interactive_regions: Vec::new(),
            passthrough_suppressed: false,
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(DragState(Mutex::new(DragInner::default())))
        .invoke_handler(tauri::generate_handler![
            kanshan_set_snap_edge,
            kanshan_set_stage_position,
            kanshan_set_interactive_regions,
            kanshan_set_passthrough_suppressed
        ])
        .setup(|app| {
            configure_macos_app(app.handle());

            let show_hide = MenuItem::with_id(app, "show_hide", "显示/隐藏", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_hide, &quit])?;

            let _tray = TrayIconBuilder::with_id("kanshan-tray")
                .tooltip("刘看山")
                .icon(create_tray_icon())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_hide" => toggle_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                configure_main_window(&window);
                make_window_clear(&window);
                spawn_cursor_passthrough_loop(window.clone());
                snap_window_to_edge(&window);
                spawn_snap_edge_announce_loop(window.clone());
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running kanshan desktop");
}

#[tauri::command]
fn kanshan_set_snap_edge(window: WebviewWindow, edge: String) {
    let Some(edge) = normalize_snap_edge(&edge) else {
        return;
    };

    if let Some(state) = window.try_state::<DragState>() {
        state.0.lock().unwrap().snap_edge = edge;
    }

    let _ = window.emit("kanshan://snap-edge", edge);
}

#[tauri::command]
fn kanshan_set_stage_position(window: WebviewWindow, x: f64, y: f64) {
    if let Some(state) = window.try_state::<DragState>() {
        let mut inner = state.0.lock().unwrap();
        inner.stage_x = x;
        inner.stage_y = y;
    }
}

#[tauri::command]
fn kanshan_set_interactive_regions(window: WebviewWindow, regions: Vec<InteractiveRegion>) {
    if let Some(state) = window.try_state::<DragState>() {
        state.0.lock().unwrap().interactive_regions = regions;
    }
}

#[tauri::command]
fn kanshan_set_passthrough_suppressed(window: WebviewWindow, suppress: bool) {
    if let Some(state) = window.try_state::<DragState>() {
        state.0.lock().unwrap().passthrough_suppressed = suppress;
    }
}

fn normalize_snap_edge(edge: &str) -> Option<&'static str> {
    match edge {
        "left" => Some("left"),
        "right" => Some("right"),
        "top" => Some("top"),
        "bottom" => Some("bottom"),
        "top-left" => Some("top-left"),
        "top-right" => Some("top-right"),
        "bottom-left" => Some("bottom-left"),
        "bottom-right" => Some("bottom-right"),
        _ => None,
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    let _ = window.show();
    let _ = window.set_focus();
}

fn configure_main_window(window: &WebviewWindow) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    configure_windows_taskbar(window);
}

fn create_tray_icon() -> Image<'static> {
    const SIZE: u32 = 18;
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    let center = (SIZE as f32 - 1.0) / 2.0;

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let distance = (dx * dx + dy * dy).sqrt();
            let alpha = if distance <= 8.0 { 255 } else { 0 };
            rgba.extend_from_slice(&[247, 210, 145, alpha]);
        }
    }

    Image::new_owned(rgba, SIZE, SIZE)
}

fn spawn_cursor_passthrough_loop(window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let mut last_ignore: Option<bool> = None;
        loop {
            tokio::time::sleep(Duration::from_millis(PASSTHROUGH_POLL_MS)).await;

            if !window.is_visible().unwrap_or(false) {
                continue;
            }

            let cursor = match window.cursor_position() {
                Ok(pos) => pos,
                Err(_) => continue,
            };
            let win_pos = match window.outer_position() {
                Ok(pos) => pos,
                Err(_) => continue,
            };
            let win_size = match window.outer_size() {
                Ok(size) => size,
                Err(_) => continue,
            };
            let scale = window.scale_factor().unwrap_or(1.0);

            let local_x = cursor.x - win_pos.x as f64;
            let local_y = cursor.y - win_pos.y as f64;
            let width = win_size.width as f64;
            let height = win_size.height as f64;

            let in_window =
                local_x >= 0.0 && local_x <= width && local_y >= 0.0 && local_y <= height;

            let (stage_x, stage_y, interactive_regions, passthrough_suppressed) = window
                .try_state::<DragState>()
                .map(|state| {
                    let inner = state.0.lock().unwrap();
                    (
                        inner.stage_x,
                        inner.stage_y,
                        inner.interactive_regions.clone(),
                        inner.passthrough_suppressed,
                    )
                })
                .unwrap_or((
                    width - DESKTOP_STAGE_SIZE * scale,
                    (height - DESKTOP_STAGE_SIZE * scale) / 2.0,
                    Vec::new(),
                    false,
                ));
            let stage_size = DESKTOP_STAGE_SIZE * scale;
            let in_stage = local_x >= stage_x
                && local_x <= stage_x + stage_size
                && local_y >= stage_y
                && local_y <= stage_y + stage_size;
            let in_dom_region = interactive_regions.iter().any(|region| {
                local_x >= region.x
                    && local_x <= region.x + region.width
                    && local_y >= region.y
                    && local_y <= region.y + region.height
            });

            let interactive =
                passthrough_suppressed || (in_window && (in_stage || in_dom_region));
            let should_ignore = !interactive;

            if last_ignore != Some(should_ignore) {
                let _ = window.set_ignore_cursor_events(should_ignore);
                last_ignore = Some(should_ignore);
            }
        }
    });
}

fn spawn_snap_edge_announce_loop(window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        for _ in 0..12 {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let edge = window
                .try_state::<DragState>()
                .map(|state| state.0.lock().unwrap().snap_edge)
                .unwrap_or("right");
            let _ = window.emit("kanshan://snap-edge", edge);
        }
    });
}

fn snap_window_to_edge(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let Ok(window_pos) = window.outer_position() else {
        return;
    };
    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();
    let scale = monitor.scale_factor();

    let monitor_left = monitor_pos.x as f64;
    let monitor_top = monitor_pos.y as f64;
    let monitor_right = monitor_left + monitor_size.width as f64;
    let monitor_bottom = monitor_top + monitor_size.height as f64;

    let win_left = window_pos.x as f64;
    let win_top = window_pos.y as f64;
    let win_width = window_size.width as f64;
    let win_height = window_size.height as f64;

    let snap_margin = (SNAP_MARGIN * scale).round();

    let dist_left = win_left - monitor_left;
    let dist_right = monitor_right - (win_left + win_width);
    let dist_top = win_top - monitor_top;
    let dist_bottom = monitor_bottom - (win_top + win_height);

    let candidates: [(&'static str, f64); 4] = [
        ("left", dist_left.max(0.0)),
        ("right", dist_right.max(0.0)),
        ("top", dist_top.max(0.0)),
        ("bottom", dist_bottom.max(0.0)),
    ];

    let edge = candidates
        .iter()
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|item| item.0)
        .unwrap_or("right");

    let mut new_x = win_left;
    let mut new_y = win_top;

    match edge {
        "left" => new_x = monitor_left + snap_margin,
        "right" => new_x = monitor_right - win_width - snap_margin,
        "top" => new_y = monitor_top + snap_margin,
        "bottom" => new_y = monitor_bottom - win_height - snap_margin,
        _ => {}
    }

    // Keep the model stage itself on the selected desktop edge even though the
    // transparent window has extra room for dialogue and menus.
    if edge == "left" || edge == "right" {
        new_y = (monitor_top + (monitor_bottom - monitor_top - win_height) / 2.0)
            .clamp(monitor_top, (monitor_bottom - win_height).max(monitor_top));
    }
    if edge == "top" || edge == "bottom" {
        new_x = (monitor_left + (monitor_right - monitor_left - win_width) / 2.0)
            .clamp(monitor_left, (monitor_right - win_width).max(monitor_left));
    }
    if edge == "right" {
        new_x = monitor_right - win_width - snap_margin;
    }
    if edge == "bottom" {
        new_y = monitor_bottom - win_height - snap_margin;
    }
    if edge == "left" {
        new_x = monitor_left + snap_margin;
    }
    if edge == "top" {
        new_y = monitor_top + snap_margin;
    }

    let max_x = monitor_right - win_width;
    let max_y = monitor_bottom - win_height;
    new_x = new_x.clamp(monitor_left, max_x.max(monitor_left));
    new_y = new_y.clamp(monitor_top, max_y.max(monitor_top));

    let target = PhysicalPosition::new(new_x.round() as i32, new_y.round() as i32);
    if target.x != window_pos.x || target.y != window_pos.y {
        let _ = window.set_position(target);
    }

    if let Some(state) = window.try_state::<DragState>() {
        let mut inner = state.0.lock().unwrap();
        inner.snap_edge = edge;
        drop(inner);
        let _ = window.emit("kanshan://snap-edge", edge);
    } else {
        let _ = window.emit("kanshan://snap-edge", edge);
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_app(app: &tauri::AppHandle) {
    use tauri::ActivationPolicy;

    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_app(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn make_window_clear(window: &WebviewWindow) {
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil, NO};

    let Ok(ns_window_ptr) = window.ns_window() else {
        return;
    };
    let ns_window = ns_window_ptr as id;
    if ns_window.is_null() {
        return;
    }

    unsafe {
        NSWindow::setOpaque_(ns_window, NO);
        let clear: id = NSColor::clearColor(nil);
        NSWindow::setBackgroundColor_(ns_window, clear);
        NSWindow::setHasShadow_(ns_window, NO);
    }
}

#[cfg(not(target_os = "macos"))]
fn make_window_clear(_window: &WebviewWindow) {}

#[cfg(target_os = "windows")]
fn configure_windows_taskbar(window: &WebviewWindow) {
    let _ = window.set_skip_taskbar(true);
}

#[cfg(not(target_os = "windows"))]
fn configure_windows_taskbar(_window: &WebviewWindow) {}
