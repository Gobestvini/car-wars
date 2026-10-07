param([switch]$Background)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js не найден в PATH.' }
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { throw 'Codex CLI не найден в PATH.' }
$envFile = Join-Path $root '.telegram-bot.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw "Создайте $envFile по примеру .telegram-bot.env.example." }
$content = Get-Content -LiteralPath $envFile -Raw
if ($content -notmatch '(?m)^TELEGRAM_BOT_TOKEN=\S+') { throw 'В .telegram-bot.env не задан TELEGRAM_BOT_TOKEN.' }
$null = node (Join-Path $PSScriptRoot 'bot.js') --check
$pidFile = Join-Path $root '.telegram-bot.pid'
if (Test-Path -LiteralPath $pidFile) {
  $oldPid = [int](Get-Content -LiteralPath $pidFile -Raw)
  if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) { throw "Telegram listener уже работает (PID $oldPid)." }
  Remove-Item -LiteralPath $pidFile -Force
}
$logFile = Join-Path $root 'tools/telegram/telegram.log'
$errorLog = Join-Path $root 'tools/telegram/telegram-error.log'
$nodePath = (Get-Command node).Source
$botArgument = '"' + (Join-Path $PSScriptRoot 'bot.js') + '"'
if ($Background) {
  $process = Start-Process -FilePath $nodePath -ArgumentList $botArgument -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errorLog -PassThru
  Start-Sleep -Milliseconds 800
  if ($process.HasExited) { throw "Listener завершился при запуске. См. $errorLog" }
  Set-Content -LiteralPath $pidFile -Value $process.Id -NoNewline
  Write-Output "Telegram listener запущен в фоне; PID $($process.Id), журнал tools/telegram/telegram.log."
} else {
  $process = Start-Process -FilePath $nodePath -ArgumentList $botArgument -WorkingDirectory $root -NoNewWindow -PassThru
  Set-Content -LiteralPath $pidFile -Value $process.Id -NoNewline
  try { $process.WaitForExit() } finally { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
}
