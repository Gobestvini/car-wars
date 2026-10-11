param(
  [ValidateSet(0, 1, 16)][int]$CpuAffinity = 0,
  [ValidateRange(1, 10)][int]$Repeats = 3,
  [string]$BaseUrl = 'http://127.0.0.1:5173/',
  [string]$Output = 'docs/knowledge/scene-optimization/baseline',
  [string]$Cases = '',
  [switch]$Quick,
  [switch]$Resume,
  [switch]$Allocation,
  [switch]$DrivingOnly,
  [string]$Reference = '',
  [ValidateRange(0, 300000)][int]$DurationMs = 0
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskOutput = [IO.Path]::GetFullPath((Join-Path $taskRoot $Output))
if (-not $taskOutput.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Profile output must stay inside this workspace.'
}
[IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskEnvironment = @{
  CARWARS_BASE_URL = $BaseUrl
  SCENE_PROFILE_OUT = $taskOutput
  SCENE_PROFILE_REPEATS = [string]$Repeats
  SCENE_PROFILE_CASES = $(if ($Cases) { $Cases } else { $null })
  SCENE_PROFILE_QUICK = $(if ($Quick) { '1' } else { $null })
  SCENE_PROFILE_RESUME = $(if ($Resume) { '1' } else { $null })
  SCENE_PROFILE_ALLOCATION = $(if ($Allocation) { '1' } else { $null })
  SCENE_PROFILE_DRIVING_ONLY = $(if ($DrivingOnly) { '1' } else { $null })
  SCENE_PROFILE_REFERENCE = $(if ($Reference) { $Reference } else { $null })
  SCENE_PROFILE_CPU_AFFINITY = $(if ($CpuAffinity) { [string]$CpuAffinity } else { $null })
  SCENE_PROFILE_DURATION_MS = $(if ($DurationMs) { [string]$DurationMs } else { $null })
}
$taskPrevious = @{}
try {
  foreach ($taskName in $taskEnvironment.Keys) {
    $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process')
    [Environment]::SetEnvironmentVariable($taskName, $taskEnvironment[$taskName], 'Process')
  }
  $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('tools/scene-performance.cjs') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskOutput 'launcher-stdout.log') -RedirectStandardError (Join-Path $taskOutput 'launcher-stderr.log')
  if ($CpuAffinity) { $taskProcess.ProcessorAffinity = [intptr]$CpuAffinity }
  $taskProcess.WaitForExit()
  Get-Content -LiteralPath (Join-Path $taskOutput 'launcher-stdout.log')
  Get-Content -LiteralPath (Join-Path $taskOutput 'launcher-stderr.log')
  $taskExit = $taskProcess.ExitCode
} finally {
  foreach ($taskName in $taskPrevious.Keys) {
    [Environment]::SetEnvironmentVariable($taskName, $taskPrevious[$taskName], 'Process')
  }
}
exit $taskExit
