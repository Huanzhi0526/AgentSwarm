[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[错误] 未检测到 Node.js，请先安装 Node.js 24 或以上版本后再试。"
  exit 1
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "[错误] 未检测到 pnpm，请先安装 pnpm（例如 npm install -g pnpm）后再试。"
  exit 1
}

if (-not (Test-Path "node_modules")) {
  Write-Host "正在首次安装依赖，请稍候..."
  & pnpm install
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:25880/api/health" -TimeoutSec 2 -UseBasicParsing
  if ($r.StatusCode -eq 200) {
    Start-Process "http://127.0.0.1:25880"
    exit 0
  }
} catch {}

if (-not (Test-Path "dist\index.html") -or -not (Test-Path "dist-server\index.js")) {
  Write-Host "首次启动，正在构建前端与 MCP 服务产物..."
  & pnpm build
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

if (-not (Test-Path "data")) {
  New-Item -ItemType Directory -Path "data" | Out-Null
}

Write-Host "正在后台静默启动 AgentSwarm 服务，就绪后自动打开浏览器..."
$nodeCmd = (Get-Command node -ErrorAction Stop).Source
$bootJs = "const {spawn}=require('node:child_process'),fs=require('node:fs');const o=fs.openSync('data/server.out.log','a'),e=fs.openSync('data/server.err.log','a');spawn(process.execPath,['dist-server/index.js'],{env:{...process.env,NODE_ENV:'production'},windowsHide:true,stdio:['ignore',o,e]}).unref();"
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $nodeCmd
$psi.Arguments = "-e `"$($bootJs.Replace('"', '\"'))`""
$psi.WorkingDirectory = (Get-Location).Path
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
if ($proc) { $proc.WaitForExit(3000) | Out-Null }

for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Milliseconds 400
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:25880/api/health" -TimeoutSec 1 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
      Start-Process "http://127.0.0.1:25880"
      exit 0
    }
  } catch {}
}

Write-Host "[提示] 后台启动超时，请检查 data\server.err.log 或确认 25880 端口未被占用。"
exit 1
