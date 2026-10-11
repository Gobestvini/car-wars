param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{7,40}$')][string]$Reference,
  [ValidateRange(1,10)][int]$Pairs = 3,
  [ValidateSet(1,16)][int]$CpuAffinity = 1,
  [string]$Cases = 'desktop-low-empty',
  [string]$BaseUrl = 'http://127.0.0.1:5180/',
  [string]$Output = 'docs/knowledge/scene-optimization/pooling-paired-control'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskOutput = [IO.Path]::GetFullPath((Join-Path $taskRoot $Output))
if (-not $taskOutput.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Comparison output must stay inside this workspace.'
}
[IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskEvents = @()
for ($taskPair = 1; $taskPair -le $Pairs; $taskPair++) {
  # Alternate ordering rather than attributing a changing host to the candidate.
  $taskOrder = if ($taskPair % 2) { @('reference','current') } else { @('current','reference') }
  foreach ($taskVersion in $taskOrder) {
    $taskDirectory = Join-Path $Output "$taskVersion-$taskPair"
    $taskArgs = @{ CpuAffinity=$CpuAffinity; Repeats=1; Cases=$Cases; BaseUrl=$BaseUrl; Output=$taskDirectory }
    if ($taskVersion -eq 'reference') { $taskArgs.Reference = $Reference }
    $taskCpu = Get-CimInstance Win32_Processor | Select-Object Name,CurrentClockSpeed,MaxClockSpeed,LoadPercentage
    $taskCores = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Select-Object Name,PercentProcessorTime,PercentUserTime,PercentPrivilegedTime
    $taskEvent = @{ pair=$taskPair; version=$taskVersion; start=[DateTime]::UtcNow.ToString('o'); hostCpu=$taskCpu; hostCores=$taskCores; affinity=$CpuAffinity; output=$taskDirectory }
    $taskEvents += $taskEvent
    $taskEvents | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskOutput 'sequence.json') -Encoding utf8
    Write-Output "Pair $taskPair/$Pairs $taskVersion"
    & (Join-Path $PSScriptRoot 'run-scene-profile.ps1') @taskArgs
    $taskEvent.end = [DateTime]::UtcNow.ToString('o')
    $taskEvent.exitCode = $LASTEXITCODE
    $taskEvents | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskOutput 'sequence.json') -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "Comparison failed: $taskVersion pair $taskPair" }
  }
}
