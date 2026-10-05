$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($taskNpm) {
    if (-not (Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) {
        & $taskNpm.Source install
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & $taskNpm.Source run dev
} else {
    $taskRuntime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node'
    $taskNode = Join-Path $taskRuntime 'bin/node.exe'
    $taskPnpm = Join-Path $taskRuntime 'node_modules/pnpm/bin/pnpm.cjs'
    if (-not (Test-Path -LiteralPath $taskNode) -or -not (Test-Path -LiteralPath $taskPnpm)) {
        throw 'Install Node.js 22.12+ with npm, then run this script again.'
    }
    $env:PATH = (Join-Path $taskRuntime 'bin') + ';' + $env:PATH
    if (-not (Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) {
        & $taskNode $taskPnpm install
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & $taskNode 'node_modules/vite/bin/vite.js' --host 0.0.0.0
}
