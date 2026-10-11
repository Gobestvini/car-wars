param(
  [ValidateRange(0,20)][int]$Cycles=20,
  [string]$Output='docs/knowledge/scene-optimization/pooling-stable',
  [string]$BaseUrl='http://127.0.0.1:5180/'
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskOutput=[IO.Path]::GetFullPath((Join-Path $taskRoot $Output))
if (-not $taskOutput.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay in the workspace.' }
[IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskEnvironment=@{SCENE_POOL_CYCLES=[string]$Cycles;SCENE_POOL_OUT=$taskOutput;CARWARS_BASE_URL=$BaseUrl;SCENE_PROFILE_CPU_AFFINITY='1'}
$taskPrevious=@{}
try {
  foreach($taskName in $taskEnvironment.Keys){$taskPrevious[$taskName]=[Environment]::GetEnvironmentVariable($taskName,'Process');[Environment]::SetEnvironmentVariable($taskName,$taskEnvironment[$taskName],'Process')}
  $taskProcess=Start-Process -FilePath (Get-Command node).Source -ArgumentList @('tools/scene-pooling-check.cjs') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskOutput 'stdout.log') -RedirectStandardError (Join-Path $taskOutput 'stderr.log')
  $taskProcess.ProcessorAffinity=[intptr]1
  $taskProcess.WaitForExit()
  Get-Content -LiteralPath (Join-Path $taskOutput 'stdout.log')
  Get-Content -LiteralPath (Join-Path $taskOutput 'stderr.log')
  $taskProcess.Refresh();$taskExit=$taskProcess.ExitCode
}finally{foreach($taskName in $taskPrevious.Keys){[Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process')}}
exit $taskExit
