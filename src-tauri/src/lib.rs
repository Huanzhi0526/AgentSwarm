use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_PORT: u16 = 25880;
const MAX_PORT_SCAN: u16 = 25895;

#[derive(Clone, PartialEq, Eq)]
enum BootPhase {
    Starting,
    Ready,
    Error,
}

struct HostRuntime {
    child: Option<Child>,
    active_port: u16,
    expected_data_dir: Option<PathBuf>,
    conflict_existing_url: Option<String>,
    port_reassigned_from: Option<u16>,
    phase: BootPhase,
    error_title: Option<String>,
    error_detail: Option<String>,
    log_tail: Option<String>,
}

impl Default for HostRuntime {
    fn default() -> Self {
        Self {
            child: None,
            active_port: DEFAULT_PORT,
            expected_data_dir: None,
            conflict_existing_url: None,
            port_reassigned_from: None,
            phase: BootPhase::Starting,
            error_title: None,
            error_detail: None,
            log_tail: None,
        }
    }
}

struct ServerProcessState(Mutex<HostRuntime>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BootStatusPayload {
    state: String,
    target_url: String,
    active_port: u16,
    data_dir_display: String,
    conflict_existing_url: Option<String>,
    port_reassigned_from: Option<u16>,
    error_title: Option<String>,
    error_detail: Option<String>,
    diagnostics_text: String,
}

enum HealthProbe {
    Unreachable,
    AgentSwarm {
        data_dir: Option<String>,
    },
    OtherService,
}

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

fn normalize_path_cmp(raw: &str) -> String {
    let trimmed = raw.strip_prefix(r"\\?\").unwrap_or(raw).trim();
    if cfg!(target_os = "windows") {
        trimmed
            .replace('/', r"\")
            .trim_end_matches('\\')
            .to_lowercase()
    } else {
        trimmed.trim_end_matches('/').to_string()
    }
}

fn sanitize_diagnostics(raw: &str) -> String {
    let mut out = raw.to_string();
    if let Ok(profile) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        if !profile.trim().is_empty() {
            let escaped = profile.replace('\\', r"\\");
            out = out.replace(&escaped, "%USERPROFILE%");
            out = out.replace(&profile, "%USERPROFILE%");
        }
    }
    if let Ok(user) = std::env::var("USERNAME").or_else(|_| std::env::var("USER")) {
        let trimmed = user.trim();
        if trimmed.len() >= 2 {
            out = out.replace(&format!(r"Users\{}", trimmed), r"Users\<user>");
            out = out.replace(&format!("/Users/{}", trimmed), "/Users/<user>");
            out = out.replace(&format!("/home/{}", trimmed), "/home/<user>");
        }
    }
    out
}

fn extract_json_string(body: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\":", key);
    let idx = body.find(&needle)?;
    let mut rest = body[idx + needle.len()..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    rest = &rest[1..];
    let mut result = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(next_ch) = chars.next() {
                    match next_ch {
                        '"' => result.push('"'),
                        '\\' => result.push('\\'),
                        '/' => result.push('/'),
                        'n' => result.push('\n'),
                        'r' => result.push('\r'),
                        't' => result.push('\t'),
                        other => result.push(other),
                    }
                }
            }
            '"' => return Some(result),
            other => result.push(other),
        }
    }
    None
}

fn probe_local_health(port: u16) -> HealthProbe {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(260)) else {
        return HealthProbe::Unreachable;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));

    let req = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return HealthProbe::OtherService;
    }

    let mut raw = String::new();
    let _ = stream.read_to_string(&mut raw);
    let Some(header_end) = raw.find("\r\n\r\n") else {
        return HealthProbe::OtherService;
    };
    let head = &raw[..header_end];
    if !head.contains("200") {
        return HealthProbe::OtherService;
    }
    let body = &raw[header_end + 4..];
    if extract_json_string(body, "service").as_deref() == Some("agent-swarm") {
        HealthProbe::AgentSwarm {
            data_dir: extract_json_string(body, "dataDir"),
        }
    } else if body.contains("\"ok\":true") && body.contains("\"port\"") {
        // Legacy v1.4.0 AgentSwarm server without `service` field
        HealthProbe::AgentSwarm {
            data_dir: None,
        }
    } else {
        HealthProbe::OtherService
    }
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

    if let Ok(cwd) = std::env::current_dir() {
        let roots = [
            cwd.clone(),
            cwd.parent().map(|p| p.to_path_buf()).unwrap_or(cwd),
        ];
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

fn resolve_expected_data_dir(app_dir: &Path) -> PathBuf {
    if let Ok(env_dir) = std::env::var("AGENT_COWORK_DATA_DIR") {
        let trimmed = env_dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    if app_dir.join("tsconfig.json").exists() || app_dir.join("data").join("cowork-board.db").exists() {
        return app_dir.join("data");
    }
    if cfg!(target_os = "windows") {
        let base = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("APPDATA"))
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(base).join("AgentSwarm").join("data");
    }
    let home = std::env::var("XDG_DATA_HOME")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join("AgentSwarm").join("data")
}

fn read_log_tail(log_path: &Path, max_lines: usize) -> Option<String> {
    let raw = fs::read_to_string(log_path).ok()?;
    let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return None;
    }
    let start = lines.len().saturating_sub(max_lines);
    Some(lines[start..].join("\n"))
}

fn open_log_file_for_spawn(path: &Path) -> Option<fs::File> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > 512 * 1024 {
            let _ = fs::remove_file(path);
        }
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn kill_owned_server(app: &AppHandle) {
    let child_opt = {
        let state = app.state::<ServerProcessState>();
        let opt = match state.0.lock() {
            Ok(mut guard) => guard.child.take(),
            Err(_) => None,
        };
        opt
    };
    if let Some(mut child) = child_opt {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn set_host_error(app: &AppHandle, title: &str, detail: &str, data_dir: Option<PathBuf>, log_tail: Option<String>) {
    let state = app.state::<ServerProcessState>();
    if let Ok(mut guard) = state.0.lock() {
        guard.phase = BootPhase::Error;
        guard.error_title = Some(title.to_string());
        guard.error_detail = Some(detail.to_string());
        if data_dir.is_some() {
            guard.expected_data_dir = data_dir;
        }
        if log_tail.is_some() {
            guard.log_tail = log_tail;
        }
    };
}

fn find_free_port(start_port: u16) -> Option<(u16, Option<u16>, Option<String>)> {
    for port in start_port..=MAX_PORT_SCAN {
        if let HealthProbe::Unreachable = probe_local_health(port) {
            let conflict_url = if port != DEFAULT_PORT {
                match probe_local_health(DEFAULT_PORT) {
                    HealthProbe::AgentSwarm { .. } => Some(format!("http://127.0.0.1:{}", DEFAULT_PORT)),
                    _ => None,
                }
            } else {
                None
            };
            let reassigned = if port != DEFAULT_PORT {
                Some(DEFAULT_PORT)
            } else {
                None
            };
            return Some((port, reassigned, conflict_url));
        }
    }
    None
}

fn ensure_embedded_server(app: &AppHandle) {
    let Some((node_bin, app_dir)) = resolve_runtime_and_app(app) else {
        set_host_error(
            app,
            "缺少桌面端内置运行组件",
            "未在安装目录中找到内置 Node 24 运行时或 dist-server/index.js。请尝试重新安装 AgentSwarm，或检查安全软件是否误删了 runtime/node.exe。",
            None,
            None,
        );
        return;
    };

    let expected_data_dir = resolve_expected_data_dir(&app_dir);
    let expected_cmp = normalize_path_cmp(&expected_data_dir.to_string_lossy());

    {
        let state = app.state::<ServerProcessState>();
        if let Ok(mut guard) = state.0.lock() {
            guard.expected_data_dir = Some(expected_data_dir.clone());
            guard.phase = BootPhase::Starting;
            guard.error_title = None;
            guard.error_detail = None;
            guard.log_tail = None;
        };
    }

    if let Err(err) = fs::create_dir_all(&expected_data_dir) {
        set_host_error(
            app,
            "无法创建数据目录",
            &format!("无法在目标位置初始化数据目录（{}）。请检查磁盘权限或通过 AGENT_COWORK_DATA_DIR 指定可写路径。", err),
            Some(expected_data_dir),
            None,
        );
        return;
    }

    let write_probe = expected_data_dir.join(".write-probe.tmp");
    match OpenOptions::new().create(true).write(true).open(&write_probe) {
        Ok(mut f) => {
            let _ = f.write_all(b"ok");
            drop(f);
            let _ = fs::remove_file(&write_probe);
        }
        Err(err) => {
            set_host_error(
                app,
                "数据目录不可写",
                &format!("当前数据目录无法写入文件（{}）。请检查文件夹权限后重试。", err),
                Some(expected_data_dir),
                None,
            );
            return;
        }
    }

    // Inspect default port 25880 first to avoid silently attaching to a different instance DB
    match probe_local_health(DEFAULT_PORT) {
        HealthProbe::AgentSwarm { data_dir } => {
            if let Some(dir_str) = data_dir {
                if normalize_path_cmp(&dir_str) == expected_cmp {
                    let state = app.state::<ServerProcessState>();
                    if let Ok(mut guard) = state.0.lock() {
                        guard.active_port = DEFAULT_PORT;
                        guard.conflict_existing_url = None;
                        guard.port_reassigned_from = None;
                        guard.phase = BootPhase::Ready;
                    };
                    return;
                }
            }
        }
        HealthProbe::Unreachable => {}
        HealthProbe::OtherService => {}
    }

    let Some((chosen_port, reassigned_from, conflict_url)) = find_free_port(DEFAULT_PORT) else {
        set_host_error(
            app,
            "本地可用端口全部被占用",
            &format!("端口 {} 到 {} 均已被其他程序占用，请释放其中一个本地端口后再点「重启本地服务」。", DEFAULT_PORT, MAX_PORT_SCAN),
            Some(expected_data_dir),
            None,
        );
        return;
    };

    let entry_script = app_dir.join("dist-server").join("index.js");
    let out_log_path = expected_data_dir.join("desktop-server.out.log");
    let err_log_path = expected_data_dir.join("desktop-server.err.log");

    let stdout_stdio = open_log_file_for_spawn(&out_log_path)
        .map(Stdio::from)
        .unwrap_or_else(Stdio::null);
    let stderr_stdio = open_log_file_for_spawn(&err_log_path)
        .map(Stdio::from)
        .unwrap_or_else(Stdio::null);

    let mut cmd = Command::new(&node_bin);
    cmd.arg(&entry_script)
        .current_dir(&app_dir)
        .env("NODE_ENV", "production")
        .env("PORT", chosen_port.to_string())
        .env("AGENT_COWORK_DATA_DIR", &expected_data_dir)
        .env("AGENT_SWARM_HOST", "tauri")
        .stdin(Stdio::null())
        .stdout(stdout_stdio)
        .stderr(stderr_stdio);

    #[cfg(target_os = "windows")]
    {
        // 0x08000000 = CREATE_NO_WINDOW (prevent any console flash on Windows)
        cmd.creation_flags(0x0800_0000);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            set_host_error(
                app,
                "内置服务进程启动失败",
                &format!("无法启动本地协同服务进程：{}", err),
                Some(expected_data_dir),
                read_log_tail(&err_log_path, 16),
            );
            return;
        }
    };

    {
        let state = app.state::<ServerProcessState>();
        if let Ok(mut guard) = state.0.lock() {
            guard.child = Some(child);
            guard.active_port = chosen_port;
            guard.conflict_existing_url = conflict_url.clone();
            guard.port_reassigned_from = reassigned_from;
        };
    }

    // Monitor spawned server readiness or premature crash up to 18s
    for _ in 0..75 {
        if let HealthProbe::AgentSwarm { .. } = probe_local_health(chosen_port) {
            let state = app.state::<ServerProcessState>();
            if let Ok(mut guard) = state.0.lock() {
                guard.phase = BootPhase::Ready;
            };
            return;
        }

        let exited_status = {
            let state = app.state::<ServerProcessState>();
            let opt = match state.0.lock() {
                Ok(mut guard) => match guard.child.as_mut() {
                    Some(c) => c.try_wait().ok().flatten(),
                    None => None,
                },
                Err(_) => None,
            };
            opt
        };

        if let Some(status) = exited_status {
            let tail = read_log_tail(&err_log_path, 20);
            set_host_error(
                app,
                "本地协同服务意外退出",
                &format!(
                    "后台服务启动后提前退出（退出码：{}）。可点击下方「查看诊断」查看脱敏错误摘要，或点击「重启本地服务」重试。",
                    status
                ),
                Some(expected_data_dir),
                tail,
            );
            return;
        }

        std::thread::sleep(Duration::from_millis(240));
    }

    let tail = read_log_tail(&err_log_path, 20);
    set_host_error(
        app,
        "本地协同服务响应超时",
        &format!(
            "后台服务在端口 {} 未能在 18 秒内就绪。请检查安全软件拦截或查看脱敏诊断日志后点击「重启本地服务」。",
            chosen_port
        ),
        Some(expected_data_dir),
        tail,
    );
}

fn build_boot_status_payload(app: &AppHandle) -> BootStatusPayload {
    let state = app.state::<ServerProcessState>();
    let guard = state.0.lock().ok();
    let (
        active_port,
        expected_dir,
        conflict_url,
        reassigned,
        phase,
        err_title,
        err_detail,
        log_tail,
    ) = if let Some(ref g) = guard {
        (
            g.active_port,
            g.expected_data_dir.clone(),
            g.conflict_existing_url.clone(),
            g.port_reassigned_from,
            g.phase.clone(),
            g.error_title.clone(),
            g.error_detail.clone(),
            g.log_tail.clone(),
        )
    } else {
        (
            DEFAULT_PORT,
            None,
            None,
            None,
            BootPhase::Starting,
            None,
            None,
            None,
        )
    };
    drop(guard);

    let data_dir_raw = expected_dir
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "%LOCALAPPDATA%\\AgentSwarm\\data".to_string());
    let data_dir_display = sanitize_diagnostics(&data_dir_raw);

    let state_str = match phase {
        BootPhase::Starting => "starting",
        BootPhase::Ready => "ready",
        BootPhase::Error => "error",
    };

    let mut diag_lines = vec![
        format!("AgentSwarm Desktop v{}", env!("CARGO_PKG_VERSION")),
        format!("OS: {} ({})", std::env::consts::OS, std::env::consts::ARCH),
        format!("Status: {}", state_str),
        format!("TargetPort: {}", active_port),
        format!("DataDir: {}", data_dir_display),
    ];
    if let Some(from) = reassigned {
        diag_lines.push(format!("PortReassignedFrom: {}", from));
    }
    if let Some(ref conflict) = conflict_url {
        diag_lines.push(format!("OtherInstanceDetected: {}", conflict));
    }
    if let Some(ref t) = err_title {
        diag_lines.push(format!("ErrorTitle: {}", sanitize_diagnostics(t)));
    }
    if let Some(ref d) = err_detail {
        diag_lines.push(format!("ErrorDetail: {}", sanitize_diagnostics(d)));
    }
    if let Some(ref tail) = log_tail {
        diag_lines.push("--- Server stderr tail (sanitized) ---".to_string());
        diag_lines.push(sanitize_diagnostics(tail));
    }

    BootStatusPayload {
        state: state_str.to_string(),
        target_url: format!("http://127.0.0.1:{}/", active_port),
        active_port,
        data_dir_display,
        conflict_existing_url: conflict_url,
        port_reassigned_from: reassigned,
        error_title: err_title,
        error_detail: err_detail.map(|s| sanitize_diagnostics(&s)),
        diagnostics_text: diag_lines.join("\n"),
    }
}

#[tauri::command]
fn get_boot_status(app: AppHandle) -> BootStatusPayload {
    build_boot_status_payload(&app)
}

#[tauri::command]
fn restart_embedded_server(app: AppHandle) -> BootStatusPayload {
    kill_owned_server(&app);
    {
        let state = app.state::<ServerProcessState>();
        if let Ok(mut guard) = state.0.lock() {
            guard.phase = BootPhase::Starting;
            guard.error_title = None;
            guard.error_detail = None;
            guard.log_tail = None;
        };
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        ensure_embedded_server(&handle);
    });
    build_boot_status_payload(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ServerProcessState(Mutex::new(HostRuntime::default())))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_boot_status,
            restart_embedded_server
        ])
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
                .tooltip("AgentSwarm · 关闭窗口时将在后台托盘运行，右键可彻底退出")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "open_browser" => {
                        let port = {
                            let state = app.state::<ServerProcessState>();
                            let p = state.0.lock().map(|g| g.active_port).unwrap_or(DEFAULT_PORT);
                            p
                        };
                        let _ = app
                            .opener()
                            .open_url(format!("http://127.0.0.1:{}", port), None::<&str>);
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
