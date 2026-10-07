$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$watchFile = Join-Path $root '.telegram-watchdog.pid'
if (Test-Path -LiteralPath $watchFile) {
  $watchId = [int](Get-Content -LiteralPath $watchFile -Raw)
  $watchProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $watchId" -ErrorAction SilentlyContinue
  if ($watchProcess) {
    if ($watchProcess.CommandLine -notmatch 'tools[\\/]telegram[\\/]watch\.ps1') { throw 'Watchdog PID указывает на другой процесс.' }
    Stop-Process -Id $watchId -Force
  }
  Remove-Item -LiteralPath $watchFile -Force
}
$pidFile = Join-Path $root '.telegram-bot.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'PID-файл не найден; listener не запущен.'; exit 0 }
$listenerPid = [int](Get-Content -LiteralPath $pidFile -Raw)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerPid" -ErrorAction SilentlyContinue
if (-not $process) { Remove-Item -LiteralPath $pidFile -Force; Write-Output 'Listener уже остановлен.'; exit 0 }
if ($process.CommandLine -notmatch 'tools[\\/]telegram[\\/]bot\.js') { throw 'PID-файл указывает на другой процесс; остановка отменена.' }
& taskkill.exe /PID $listenerPid /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Не удалось остановить дерево процессов listener.' }
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
$lockFile = Join-Path $root '.telegram-bot.lock'
if (Test-Path -LiteralPath $lockFile) {
  if ([int](Get-Content -LiteralPath $lockFile -Raw) -eq $listenerPid) { Remove-Item -LiteralPath $lockFile -Force }
}
Write-Output 'Telegram listener остановлен.'
