[CmdletBinding()]
param(
  [string]$ProcessName = 'OrbitStart',
  [ValidateRange(1, 3600)]
  [int]$SampleSeconds = 1,
  [ValidateRange(100, 60000)]
  [int]$IntervalMilliseconds = 1000,
  [switch]$IncludeAllWebView2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-IsDescendantOf {
  param(
    [Parameter(Mandatory)] [int]$ProcessId,
    [Parameter(Mandatory)] [hashtable]$ParentByProcessId,
    [Parameter(Mandatory)] [System.Collections.Generic.HashSet[int]]$RootProcessIds
  )

  $currentId = $ProcessId
  $visited = [System.Collections.Generic.HashSet[int]]::new()
  while ($visited.Add($currentId) -and $ParentByProcessId.ContainsKey($currentId)) {
    if ($RootProcessIds.Contains($currentId)) {
      return $true
    }
    $currentId = $ParentByProcessId[$currentId]
  }

  return $RootProcessIds.Contains($currentId)
}

function Get-OrbitStartProcessSnapshot {
  $allProcesses = @(Get-CimInstance Win32_Process)
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
  $rootName = "$ProcessName.exe"
  $roots = @($allProcesses | Where-Object { $_.Name -ieq $rootName })
  $rootIds = [System.Collections.Generic.HashSet[int]]::new()
  $parentByProcessId = @{}

  foreach ($process in $allProcesses) {
    $parentByProcessId[[int]$process.ProcessId] = [int]$process.ParentProcessId
  }
  foreach ($process in $roots) {
    [void]$rootIds.Add([int]$process.ProcessId)
  }

  $performanceByProcessId = @{}
  foreach ($counter in @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process)) {
    $performanceByProcessId[[int]$counter.IDProcess] = $counter
  }

  $targets = foreach ($process in $allProcesses) {
    $isRoot = $process.Name -ieq $rootName
    $isWebView = $process.Name -ieq 'msedgewebview2.exe'
    $isRelatedWebView = $isWebView -and (
      $IncludeAllWebView2 -or
      ($rootIds.Count -gt 0 -and (Test-IsDescendantOf -ProcessId ([int]$process.ProcessId) -ParentByProcessId $parentByProcessId -RootProcessIds $rootIds))
    )

    if (-not ($isRoot -or $isRelatedWebView)) {
      continue
    }

    $counter = $performanceByProcessId[[int]$process.ProcessId]
    [pscustomobject]@{
      Timestamp        = $timestamp
      Process          = $process.Name
      ProcessId        = [int]$process.ProcessId
      ParentProcessId  = [int]$process.ParentProcessId
      WorkingSetMiB    = [math]::Round(([double]$process.WorkingSetSize / 1MB), 2)
      PrivateMemoryMiB = [math]::Round(([double]$process.PrivatePageCount / 1MB), 2)
      CpuPercent       = if ($null -eq $counter) { $null } else { [int]$counter.PercentProcessorTime }
    }
  }

  return @($targets | Sort-Object Process, ProcessId)
}

$sampleCount = [math]::Max(1, [math]::Ceiling(($SampleSeconds * 1000) / $IntervalMilliseconds))
$allSamples = @()
for ($index = 0; $index -lt $sampleCount; $index++) {
  $snapshot = Get-OrbitStartProcessSnapshot
  if ($snapshot.Count -eq 0) {
    Write-Warning "No $ProcessName.exe process was found. Start OrbitStart first, or pass -ProcessName with the executable name."
  } else {
    $snapshot | Format-Table Timestamp, Process, ProcessId, ParentProcessId, WorkingSetMiB, PrivateMemoryMiB, CpuPercent -AutoSize
    $allSamples += $snapshot
  }

  if ($index -lt ($sampleCount - 1)) {
    Start-Sleep -Milliseconds $IntervalMilliseconds
  }
}

if ($allSamples.Count -gt 0) {
  $latest = @($allSamples | Where-Object { $_.Timestamp -eq ($allSamples | Select-Object -Last 1).Timestamp })
  [pscustomobject]@{
    OrbitStartProcesses = @($latest | Where-Object { $_.Process -ieq "$ProcessName.exe" }).Count
    WebView2Processes   = @($latest | Where-Object { $_.Process -ieq 'msedgewebview2.exe' }).Count
    WorkingSetMiB       = [math]::Round((($latest | Measure-Object WorkingSetMiB -Sum).Sum), 2)
    PrivateMemoryMiB    = [math]::Round((($latest | Measure-Object PrivateMemoryMiB -Sum).Sum), 2)
    CpuPercent          = [math]::Round((($latest | Measure-Object CpuPercent -Average).Average), 2)
  } | Format-List
}
