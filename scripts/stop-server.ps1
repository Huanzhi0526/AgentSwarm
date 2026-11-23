[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "正在停止 AgentCoWorkBoard 后台服务 (端口 25880)..."
$stopped = $false

$pidFile = Join-Path (Get-Location) "data\server.pid.json"
if (Test-Path $pidFile) {
  try {
    $rec = Get-Content $pidFile -Raw | ConvertFrom-Json
    if ($rec.pid) {
      $proc = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$rec.pid) -ErrorAction SilentlyContinue
      if ($proc -and ($proc.CommandLine -match "dist-server|server[\\/]index\.ts")) {
        Stop-Process -Id ([int]$rec.pid) -Force -ErrorAction SilentlyContinue
        $stopped = $true
      }
    }
  } catch {}
}

$conns = Get-NetTCPConnection -LocalPort 25880 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($p in $pids) {
    $proc = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$p) -ErrorAction SilentlyContinue
    if ($proc -and ($proc.CommandLine -match "dist-server|server[\\/]index\.ts")) {
      Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue
      $stopped = $true
    }
  }
}

if ($stopped) {
  Write-Host "已停止 AgentCoWorkBoard 后台服务。"
} else {
  Write-Host "当前未检测到运行中的协同看板服务。"
}
