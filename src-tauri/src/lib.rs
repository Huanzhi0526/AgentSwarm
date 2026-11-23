use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

struct ServerProcessState(Mutex<Option<Child>>);

fn strip_win_unc_prefix(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(raw) = path.to_str() {
            if let Some(stripped) = raw.strip_prefix(r"\\?\") {
                return PathBuf::from(stripped);
            }
        }
    }
    path
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn kill_owned_server(app: &AppHandle) {
    let state = app.state::<ServerProcessState>();
    let child_opt = match state.0.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };
    if let Some(mut child) = child_opt {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn is_port_25880_alive() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], 25880));
    TcpStream::connect_timeout(&addr, Duration::from_millis(220)).is_ok()
}

fn resolve_runtime_and_app(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    let node_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    if let Ok(raw_res) = app.path().resource_dir() {
        let res_dir = strip_win_unc_prefix(raw_res);
        let candidates = [
            (res_dir.join("runtime").join(node_name), res_dir.join("app")),
            (
                res_dir.join("bundle-stage").join("runtime").join(node_name),
                res_dir.join("bundle-stage").join("app"),
            ),
        ];
        for (node_path, app_dir) in candidates {
            if node_path.exists() && app_dir.join("dist-server").join("index.js").exists() {
                return Some((node_path, app_dir));
            }
        }
    }

    // Fallback for local `tauri dev` runs: look for bundled stage or system node + workspace root
    if let Ok(cwd) = std::env::current_dir() {
        let roots = [cwd.clone(), cwd.parent().map(|p| p.to_path_buf()).unwrap_or(cwd)];
        for root in roots {
            if root.join("dist-server").join("index.js").exists() {
                let staged_node = root
                    .join("src-tauri")
                    .join("bundle-stage")
                    .join("runtime")
                    .join(node_name);
                let node_cmd = if staged_node.exists() {
                    staged_node
                } else {
                    PathBuf::from(node_name)
                };
                return Some((node_cmd, root));
            }
        }
    }

    None
}

fn ensure_embedded_server(app: &AppHandle) {
    if is_port_25880_alive() {
        return;
    }

    let Some((node_bin, app_dir)) = resolve_runtime_and_app(app) else {
        return;
    };
    let entry_script = app_dir.join("dist-server").join("index.js");
    if !entry_script.exists() {
        return;
    }

    let mut cmd = Command::new(&node_bin);
    cmd.arg(&entry_script)
        .current_dir(&app_dir)
        .env("NODE_ENV", "production")
        .env("PORT", "25880")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        // 0x08000000 = CREATE_NO_WINDOW (prevent any console flash on Windows)
        cmd.creation_flags(0x0800_0000);
    }

    if let Ok(child) = cmd.spawn() {
        let state = app.state::<ServerProcessState>();
        match state.0.lock() {
            Ok(mut guard) => {
                *guard = Some(child);
            }
            Err(_) => {}
        };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ServerProcessState(Mutex::new(None)))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                ensure_embedded_server(&app_handle);
            });

            if let Some(window) = app.get_webview_window("main") {
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            let show_item = MenuItem::with_id(app, "show", "打开 AgentSwarm", true, None::<&str>)?;
            let browser_item =
                MenuItem::with_id(app, "open_browser", "在浏览器中打开", true, None::<&str>)?;
            let sep_item = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
            let tray_menu =
                Menu::with_items(app, &[&show_item, &browser_item, &sep_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("AgentSwarm · 多智能体协同看板")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "open_browser" => {
                        let _ = app.opener().open_url("http://127.0.0.1:25880", None::<&str>);
                    }
                    "quit" => {
                        kill_owned_server(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building AgentSwarm desktop application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            kill_owned_server(app_handle);
        }
    });
}
