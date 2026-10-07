$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$mutexName = 'Local\CarWarsTelegramWatch-' + ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($root)) -replace '[^a-zA-Z0-9]', '')
$created = $false
$mutex = New-Object Threading.Mutex($true, $mutexName, [ref]$created)
if (-not $created) { $mutex.Dispose(); exit 0 }
try {
  while ($true) {
    try {
      $alive = $false
      $pidFile = Join-Path $root '.telegram-bot.pid'
      if (Test-Path -LiteralPath $pidFile) {
        $listenerId = [int](Get-Content -LiteralPath $pidFile -Raw)
        $listener = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerId" -ErrorAction SilentlyContinue
        $alive = $listener -and $listener.CommandLine -match 'tools[\\/]telegram[\\/]bot\.js'
      }
      if (-not $alive) { & (Join-Path $PSScriptRoot 'start.ps1') -Background -NoWatchdog | Out-Null }
    } catch {
      Add-Content -LiteralPath (Join-Path $root 'tools/telegram/watchdog.log') -Value "$(Get-Date -Format o) restart failed: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 20
  }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
