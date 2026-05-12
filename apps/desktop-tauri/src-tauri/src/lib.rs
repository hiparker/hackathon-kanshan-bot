#![allow(unexpected_cfgs)]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;

const DESKTOP_STAGE_SIZE: f64 = 300.0;
const DESKTOP_WINDOW_WIDTH: f64 = 540.0;
const DESKTOP_WINDOW_HEIGHT: f64 = 430.0;
const SNAP_MARGIN: f64 = 0.0;
const PASSTHROUGH_POLL_MS: u64 = 32;
const DRAG_FOLLOW_POLL_MS: u64 = 4;
const DRAG_MONITOR_REFRESH_MS: u64 = 500;

struct DragState(Mutex<DragInner>);

struct AuthCallbackState(Mutex<Option<String>>);

struct DragInner {
    snap_edge: &'static str,
    stage_x_logical: f64,
    stage_y_logical: f64,
    interactive_regions: Vec<InteractiveRegion>,
    /// When true, never ignore cursor events (e.g. during window drag).
    passthrough_suppressed: bool,
    follow: DragFollow,
}

#[derive(Default, Clone, Copy)]
struct DragFollow {
    active: bool,
    cursor_offset_x: f64,
    cursor_offset_y: f64,
}

#[derive(Clone, Deserialize)]
struct InteractiveRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Copy)]
struct StageBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Copy)]
struct StageScreenRect {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

impl Default for DragInner {
    fn default() -> Self {
        Self {
            snap_edge: "right",
            stage_x_logical: DESKTOP_WINDOW_WIDTH - DESKTOP_STAGE_SIZE,
            stage_y_logical: (DESKTOP_WINDOW_HEIGHT - DESKTOP_STAGE_SIZE) / 2.0,
            interactive_regions: Vec::new(),
            passthrough_suppressed: false,
            follow: DragFollow::default(),
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for arg in args {
                handle_auth_callback_url(app, &arg);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(DragState(Mutex::new(DragInner::default())))
        .manage(AuthCallbackState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            kanshan_set_snap_edge,
            kanshan_set_stage_position,
            kanshan_set_interactive_regions,
            kanshan_set_passthrough_suppressed,
            kanshan_begin_window_drag,
            kanshan_end_window_drag,
            kanshan_clamp_window_into_view,
            kanshan_open_external_url,
            kanshan_take_auth_callback_url
        ])
        .setup(|app| {
            configure_macos_app(app.handle());
            configure_deep_links(app.handle());

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
                spawn_drag_follow_loop(window.clone());
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

fn configure_deep_links(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        log_auth_callback("deep-link on_open_url");
        for url in event.urls() {
            handle_auth_callback_url(&app_handle, &url.to_string());
        }
    });
}

fn handle_auth_callback_url(app: &tauri::AppHandle, url: &str) {
    log_auth_callback(&format!("callback candidate: {url}"));

    if !url.starts_with("kanshan://auth") {
        log_auth_callback("ignored non-auth url");
        return;
    }

    if let Some(state) = app.try_state::<AuthCallbackState>() {
        *state.0.lock().unwrap() = Some(url.to_string());
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("kanshan://auth-callback", url.to_string());
        log_auth_callback("emitted auth callback to main window");
    } else {
        log_auth_callback("main window not found; cached auth callback only");
    }
}

fn log_auth_callback(message: &str) {
    let Some(home) = std::env::var_os("HOME") else {
        return;
    };

    let mut path = PathBuf::from(home);
    path.push("Library");
    path.push("Logs");
    path.push("kanshan-desktop-auth.log");

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

#[tauri::command]
fn kanshan_take_auth_callback_url(app: tauri::AppHandle) -> Option<String> {
    app.try_state::<AuthCallbackState>()
        .and_then(|state| state.0.lock().unwrap().take())
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
        inner.stage_x_logical = x;
        inner.stage_y_logical = y;
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

#[tauri::command]
fn kanshan_begin_window_drag(window: WebviewWindow) -> Result<(), String> {
    let cursor = window
        .cursor_position()
        .map_err(|error| error.to_string())?;
    let window_position = window.outer_position().map_err(|error| error.to_string())?;

    if let Some(state) = window.try_state::<DragState>() {
        let mut inner = state.0.lock().unwrap();
        inner.passthrough_suppressed = true;
        inner.follow = DragFollow {
            active: true,
            cursor_offset_x: cursor.x - window_position.x as f64,
            cursor_offset_y: cursor.y - window_position.y as f64,
        };
    }
    Ok(())
}

#[tauri::command]
fn kanshan_end_window_drag(window: WebviewWindow) {
    if let Some(state) = window.try_state::<DragState>() {
        let mut inner = state.0.lock().unwrap();
        inner.follow.active = false;
        inner.passthrough_suppressed = false;
    }
}

#[tauri::command]
fn kanshan_clamp_window_into_view(window: WebviewWindow) {
    clamp_window_into_screen(&window);
}

#[tauri::command]
fn kanshan_open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("unsupported external url".into());
    }

    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(&url).spawn()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", &url]).spawn()
    } else {
        Command::new("xdg-open").arg(&url).spawn()
    };

    result.map(|_| ()).map_err(|error| error.to_string())
}

fn is_allowed_external_url(url: &str) -> bool {
    url == "https://zhida.ai/"
        || ((url.starts_with("http://localhost:") || url.starts_with("http://127.0.0.1:"))
            && url.contains("/api/auth/zhihu/login"))
        || (url.starts_with("https://") && url.contains("/api/auth/zhihu/login"))
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
    Image::from_bytes(include_bytes!("../icons/menubar-icon.png"))
        .expect("failed to load bundled menu bar icon")
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

            let (stage_x_logical, stage_y_logical, interactive_regions, passthrough_suppressed) =
                window
                    .try_state::<DragState>()
                    .map(|state| {
                        let inner = state.0.lock().unwrap();
                        (
                            inner.stage_x_logical,
                            inner.stage_y_logical,
                            inner.interactive_regions.clone(),
                            inner.passthrough_suppressed,
                        )
                    })
                    .unwrap_or((
                        width / scale - DESKTOP_STAGE_SIZE,
                        (height / scale - DESKTOP_STAGE_SIZE) / 2.0,
                        Vec::new(),
                        false,
                    ));
            let stage_size = DESKTOP_STAGE_SIZE * scale;
            let stage_bounds = resolve_stage_bounds(
                &interactive_regions,
                stage_x_logical * scale,
                stage_y_logical * scale,
                stage_size,
            );
            let in_stage = local_x >= stage_bounds.x
                && local_x <= stage_bounds.x + stage_bounds.width
                && local_y >= stage_bounds.y
                && local_y <= stage_bounds.y + stage_bounds.height;
            let in_dom_region = interactive_regions.iter().any(|region| {
                local_x >= region.x
                    && local_x <= region.x + region.width
                    && local_y >= region.y
                    && local_y <= region.y + region.height
            });

            let interactive = passthrough_suppressed || (in_window && (in_stage || in_dom_region));
            let should_ignore = !interactive;

            if last_ignore != Some(should_ignore) {
                let _ = window.set_ignore_cursor_events(should_ignore);
                last_ignore = Some(should_ignore);
            }
        }
    });
}

fn spawn_drag_follow_loop(window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let mut drag_monitors: Vec<tauri::Monitor> = Vec::new();
        let mut was_following = false;
        let mut last_target: Option<(i32, i32)> = None;
        let mut last_monitor_refresh: Option<Instant> = None;

        loop {
            tokio::time::sleep(Duration::from_millis(DRAG_FOLLOW_POLL_MS)).await;

            let Some(state) = window.try_state::<DragState>() else {
                continue;
            };
            let (follow, snap_edge, stage_x_logical, stage_y_logical) = {
                let inner = state.0.lock().unwrap();
                (
                    inner.follow,
                    inner.snap_edge,
                    inner.stage_x_logical,
                    inner.stage_y_logical,
                )
            };
            if !follow.active {
                if was_following {
                    drag_monitors.clear();
                    last_target = None;
                    last_monitor_refresh = None;
                    was_following = false;
                }
                continue;
            }
            if !was_following {
                drag_monitors = window.available_monitors().unwrap_or_default();
                last_monitor_refresh = Some(Instant::now());
                was_following = true;
            }
            if !is_primary_mouse_down() {
                if let Some(state) = window.try_state::<DragState>() {
                    let mut inner = state.0.lock().unwrap();
                    inner.follow.active = false;
                    inner.passthrough_suppressed = false;
                }
                drag_monitors.clear();
                last_target = None;
                last_monitor_refresh = None;
                was_following = false;
                continue;
            }

            let Ok(cursor) = window.cursor_position() else {
                continue;
            };
            let scale = window.scale_factor().unwrap_or(1.0);
            let stage_bounds = StageBounds {
                x: stage_x_logical * scale,
                y: stage_y_logical * scale,
                width: DESKTOP_STAGE_SIZE * scale,
                height: DESKTOP_STAGE_SIZE * scale,
            };

            let should_refresh_monitors = drag_monitors.is_empty()
                || last_monitor_refresh
                    .map(|last| last.elapsed() >= Duration::from_millis(DRAG_MONITOR_REFRESH_MS))
                    .unwrap_or(true);
            if should_refresh_monitors {
                let refreshed = window.available_monitors().unwrap_or_default();
                if !refreshed.is_empty() {
                    drag_monitors = refreshed;
                    last_monitor_refresh = Some(Instant::now());
                }
            }

            if let Some(work) = pick_work_area(&drag_monitors, cursor.x, cursor.y) {
                let (wl, wt, wr, wb) = work_area_bounds(&work);
                let mut target_x = cursor.x - follow.cursor_offset_x;
                let mut target_y = cursor.y - follow.cursor_offset_y;
                let target_stage = stage_rect_at(target_x, target_y, stage_bounds);
                let next_edge = horizontal_edge_for_stage_center(target_stage, wl, wr);
                if next_edge != snap_edge {
                    set_snap_edge_only(&window, next_edge);
                }

                let min_x = wl - stage_bounds.x;
                let max_x = wr - stage_bounds.width - stage_bounds.x;
                let min_y = wt - stage_bounds.y;
                let max_y = wb - stage_bounds.height - stage_bounds.y;
                target_x = target_x.clamp(min_x, max_x.max(min_x));
                target_y = target_y.clamp(min_y, max_y.max(min_y));

                let target = (target_x.round() as i32, target_y.round() as i32);
                if last_target != Some(target) {
                    last_target = Some(target);
                    let _ = window.set_position(PhysicalPosition::new(target.0, target.1));
                }
            }
        }
    });
}

fn pick_work_area(monitors: &[tauri::Monitor], x: f64, y: f64) -> Option<MonitorWorkArea> {
    let containing = monitors.iter().find(|m| {
        let (l, t, r, b) = work_area_bounds(&monitor_work_area(m));
        x >= l && x <= r && y >= t && y <= b
    });
    if let Some(m) = containing {
        return Some(monitor_work_area(m));
    }

    monitors
        .iter()
        .map(|m| {
            let work = monitor_work_area(m);
            let (l, t, r, b) = work_area_bounds(&work);
            let cx = x.clamp(l, r);
            let cy = y.clamp(t, b);
            let dist = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
            (dist, work)
        })
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(_, work)| work)
}

fn resolve_stage_bounds(
    interactive_regions: &[InteractiveRegion],
    fallback_x: f64,
    fallback_y: f64,
    fallback_size: f64,
) -> StageBounds {
    interactive_regions
        .iter()
        .find(|region| region.width >= fallback_size * 0.8 && region.height >= fallback_size * 0.8)
        .map(|region| StageBounds {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
        })
        .unwrap_or(StageBounds {
            x: fallback_x,
            y: fallback_y,
            width: fallback_size,
            height: fallback_size,
        })
}

fn stage_bounds_for_edge(edge: &str, scale: f64) -> StageBounds {
    let stage_size = DESKTOP_STAGE_SIZE * scale;
    let window_width = DESKTOP_WINDOW_WIDTH * scale;
    let window_height = DESKTOP_WINDOW_HEIGHT * scale;
    let x = if edge == "left" {
        0.0
    } else if edge == "right" {
        window_width - stage_size
    } else {
        (window_width - stage_size) / 2.0
    };
    let y = if edge == "top" {
        0.0
    } else if edge == "bottom" {
        window_height - stage_size
    } else {
        (window_height - stage_size) / 2.0
    };

    StageBounds {
        x,
        y,
        width: stage_size,
        height: stage_size,
    }
}

fn stage_rect_at(window_x: f64, window_y: f64, stage_bounds: StageBounds) -> StageScreenRect {
    StageScreenRect {
        left: window_x + stage_bounds.x,
        top: window_y + stage_bounds.y,
        right: window_x + stage_bounds.x + stage_bounds.width,
        bottom: window_y + stage_bounds.y + stage_bounds.height,
    }
}

fn nearest_edge(stage: StageScreenRect, wl: f64, wt: f64, wr: f64, wb: f64) -> &'static str {
    let candidates: [(&'static str, f64); 4] = [
        ("left", (stage.left - wl).abs()),
        ("right", (wr - stage.right).abs()),
        ("top", (stage.top - wt).abs()),
        ("bottom", (wb - stage.bottom).abs()),
    ];
    candidates
        .iter()
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|item| item.0)
        .unwrap_or("right")
}

fn horizontal_edge_for_stage_center(stage: StageScreenRect, wl: f64, wr: f64) -> &'static str {
    let center_x = (stage.left + stage.right) / 2.0;
    if center_x <= (wl + wr) / 2.0 {
        "left"
    } else {
        "right"
    }
}

fn snap_window_position(
    edge: &str,
    stage: StageScreenRect,
    work: MonitorWorkArea,
    scale: f64,
) -> (f64, f64, StageBounds) {
    let (wl, wt, wr, wb) = work_area_bounds(&work);
    let stage_bounds = stage_bounds_for_edge(edge, scale);
    let snap_margin = SNAP_MARGIN * scale;

    let mut x = stage.left - stage_bounds.x;
    let mut y = stage.top - stage_bounds.y;

    match edge {
        "left" => x = wl - stage_bounds.x + snap_margin,
        "right" => x = wr - stage_bounds.width - stage_bounds.x - snap_margin,
        "top" => y = wt - stage_bounds.y + snap_margin,
        "bottom" => y = wb - stage_bounds.height - stage_bounds.y - snap_margin,
        _ => {}
    }

    if edge == "left" || edge == "right" {
        y = (stage.top - stage_bounds.y).clamp(
            wt - stage_bounds.y,
            (wb - stage_bounds.height - stage_bounds.y).max(wt - stage_bounds.y),
        );
    }
    if edge == "top" || edge == "bottom" {
        x = (stage.left - stage_bounds.x).clamp(
            wl - stage_bounds.x,
            (wr - stage_bounds.width - stage_bounds.x).max(wl - stage_bounds.x),
        );
    }

    let min_x = wl - stage_bounds.x;
    let max_x = wr - stage_bounds.width - stage_bounds.x;
    let min_y = wt - stage_bounds.y;
    let max_y = wb - stage_bounds.height - stage_bounds.y;
    x = x.clamp(min_x, max_x.max(min_x));
    y = y.clamp(min_y, max_y.max(min_y));

    (x, y, stage_bounds)
}

fn set_snap_edge_only(window: &WebviewWindow, edge: &'static str) {
    if let Some(state) = window.try_state::<DragState>() {
        state.0.lock().unwrap().snap_edge = edge;
    }

    let _ = window.emit("kanshan://snap-edge", edge);
}

fn set_snap_edge_state(
    window: &WebviewWindow,
    edge: &'static str,
    stage_bounds: StageBounds,
    scale: f64,
) {
    if let Some(state) = window.try_state::<DragState>() {
        let mut inner = state.0.lock().unwrap();
        inner.snap_edge = edge;
        inner.stage_x_logical = stage_bounds.x / scale;
        inner.stage_y_logical = stage_bounds.y / scale;
    }

    let _ = window.emit("kanshan://snap-edge", edge);
}

#[derive(Clone, Copy)]
struct MonitorWorkArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn monitor_work_area(monitor: &tauri::Monitor) -> MonitorWorkArea {
    let pos = monitor.position();
    let size = monitor.size();
    MonitorWorkArea {
        x: pos.x as f64,
        y: pos.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    }
}

fn work_area_bounds(work: &MonitorWorkArea) -> (f64, f64, f64, f64) {
    (work.x, work.y, work.x + work.width, work.y + work.height)
}

fn clamp_window_into_screen(window: &WebviewWindow) {
    let Ok(monitors) = window.available_monitors() else {
        return;
    };
    let Ok(position) = window.outer_position() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (stage_x_logical, stage_y_logical, interactive_regions) = window
        .try_state::<DragState>()
        .map(|state| {
            let inner = state.0.lock().unwrap();
            (
                inner.stage_x_logical,
                inner.stage_y_logical,
                inner.interactive_regions.clone(),
            )
        })
        .unwrap_or((0.0, 0.0, Vec::new()));
    let stage_size = DESKTOP_STAGE_SIZE * scale;
    let stage_bounds = resolve_stage_bounds(
        &interactive_regions,
        stage_x_logical * scale,
        stage_y_logical * scale,
        stage_size,
    );

    let mut x = position.x as f64;
    let mut y = position.y as f64;
    let center_x = x + stage_bounds.x + stage_bounds.width / 2.0;
    let center_y = y + stage_bounds.y + stage_bounds.height / 2.0;

    let Some(work) = pick_work_area(&monitors, center_x, center_y) else {
        return;
    };
    let (wl, wt, wr, wb) = work_area_bounds(&work);
    let min_x = wl - stage_bounds.x;
    let max_x = wr - stage_bounds.width - stage_bounds.x;
    let min_y = wt - stage_bounds.y;
    let max_y = wb - stage_bounds.height - stage_bounds.y;
    x = x.clamp(min_x, max_x.max(min_x));
    y = y.clamp(min_y, max_y.max(min_y));

    let target = PhysicalPosition::new(x.round() as i32, y.round() as i32);
    if target.x != position.x || target.y != position.y {
        let _ = window.set_position(target);
    }
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

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn is_primary_mouse_down() -> bool {
    use cocoa::appkit::NSEvent;
    use cocoa::base::nil;
    unsafe { NSEvent::pressedMouseButtons(nil) & 1 == 1 }
}

#[cfg(target_os = "windows")]
fn is_primary_mouse_down() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { GetAsyncKeyState(VK_LBUTTON as i32) < 0 }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn is_primary_mouse_down() -> bool {
    true
}

fn snap_window_to_edge(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let Ok(window_pos) = window.outer_position() else {
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
    let snap_edge = window
        .try_state::<DragState>()
        .map(|state| {
            let inner = state.0.lock().unwrap();
            inner.snap_edge
        })
        .unwrap_or("right");
    let stage_bounds = stage_bounds_for_edge(snap_edge, scale);
    let stage = stage_rect_at(win_left, win_top, stage_bounds);

    let work = MonitorWorkArea {
        x: monitor_left,
        y: monitor_top,
        width: monitor_right - monitor_left,
        height: monitor_bottom - monitor_top,
    };
    let (wl, wt, wr, wb) = work_area_bounds(&work);
    let edge = nearest_edge(stage, wl, wt, wr, wb);
    let (new_x, new_y, next_stage_bounds) = snap_window_position(edge, stage, work, scale);

    let target = PhysicalPosition::new(new_x.round() as i32, new_y.round() as i32);
    if target.x != window_pos.x || target.y != window_pos.y {
        let _ = window.set_position(target);
    }

    if let Some(state) = window.try_state::<DragState>() {
        drop(state);
        set_snap_edge_state(window, edge, next_stage_bounds, scale);
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
#[allow(deprecated, unexpected_cfgs)]
fn make_window_clear(window: &WebviewWindow) {
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil, NO};
    use objc::{msg_send, sel, sel_impl};

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

        // Keep the desktop companion visible when users swipe between macOS Spaces.
        let current_behavior: u64 = msg_send![ns_window, collectionBehavior];
        let can_join_all_spaces = 1_u64 << 0;
        let stationary = 1_u64 << 4;
        let full_screen_auxiliary = 1_u64 << 8;
        let behavior = current_behavior | can_join_all_spaces | stationary | full_screen_auxiliary;
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
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
