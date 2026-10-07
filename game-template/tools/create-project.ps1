param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,63}$')][string]$Name
)
$ErrorActionPreference = 'Stop'
$taskSource = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskTarget = [IO.Path]::GetFullPath($Destination)
if ($taskTarget.Equals($taskSource, [StringComparison]::OrdinalIgnoreCase) -or
    $taskTarget.StartsWith($taskSource + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose a destination outside the template folder.'
}
if (Test-Path -LiteralPath $taskTarget) { throw 'Destination already exists. Choose a new folder.' }
# Explicit source allowlist prevents secrets, worktrees, builds and dependencies from being copied.
$taskItems = @('.agents', '.github', '.gitignore', '.telegram-bot.env.example', 'AGENTS.md',
    'README.md', 'VERIFICATION.md', 'docs', 'src', 'tests', 'tools', 'index.html',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'start.ps1', 'vite.config.js')
foreach ($taskItem in $taskItems) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskSource $taskItem))) { throw "Missing template file: $taskItem" }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
New-Item -ItemType Directory -Path $taskTarget | Out-Null
foreach ($taskItem in $taskItems) {
    if ($taskItem -eq 'tools') {
        New-Item -ItemType Directory -Path (Join-Path $taskTarget 'tools/telegram') -Force | Out-Null
        Get-ChildItem -LiteralPath (Join-Path $taskSource 'tools') -File | Where-Object { $_.Extension -in '.cjs', '.ps1' } |
            Copy-Item -Destination (Join-Path $taskTarget 'tools')
        Get-ChildItem -LiteralPath (Join-Path $taskSource 'tools/telegram') -File | Where-Object { $_.Extension -in '.js', '.ps1' } |
            Copy-Item -Destination (Join-Path $taskTarget 'tools/telegram')
    } else {
        Copy-Item -LiteralPath (Join-Path $taskSource $taskItem) -Destination $taskTarget -Recurse
    }
}
$taskUtf8 = [System.Text.UTF8Encoding]::new($false)
$taskPackagePath = Join-Path $taskTarget 'package.json'
$taskPackage = [IO.File]::ReadAllText($taskPackagePath).Replace('"name": "ai-game-template"', '"name": "' + $Name + '"')
[IO.File]::WriteAllText($taskPackagePath, $taskPackage, $taskUtf8)
$taskHtmlPath = Join-Path $taskTarget 'index.html'
[IO.File]::WriteAllText($taskHtmlPath, [IO.File]::ReadAllText($taskHtmlPath).Replace('Game Template', $Name), $taskUtf8)
& git -C $taskTarget init -b main
if ($LASTEXITCODE -ne 0) { throw 'Git initialization failed. Copied files remain in the destination.' }
Write-Output "Created $Name in $taskTarget. Run pnpm install --frozen-lockfile, then pnpm check:full. Configure your own remote."
