[CmdletBinding()]
param(
  [string]$ProcessName = 'OrbitStart',
  [int[]]$ProcessId = @(),
  [ValidateRange(1, 3600)]
  [int]$SampleSeconds = 1,
  [ValidateRange(100, 60000)]
  [int]$IntervalMilliseconds = 1000,
  [switch]$IncludeAllWebView2,
  [string]$Scenario = '',
  [string]$BuildLabel = '',
  [string]$OutputPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$normalizedProcessName = ($ProcessName.Trim() -replace '\.exe$', '')
if ([string]::IsNullOrWhiteSpace($normalizedProcessName)) {
  throw 'ProcessName 不能为空。'
}

$rootExecutableName = "$normalizedProcessName.exe"
$requestedRootIds = [System.Collections.Generic.HashSet[int]]::new()
foreach ($id in $ProcessId) {
  [void]$requestedRootIds.Add($id)
}

function Test-IsNamedProcess {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [string]$ExpectedBaseName
  )

  return (($Name -replace '\.exe$', '') -ieq $ExpectedBaseName)
}

function Test-IsDescendantOf {
  param(
    [Parameter(Mandatory)] [int]$CandidateProcessId,
    [Parameter(Mandatory)] [hashtable]$ParentByProcessId,
    [Parameter(Mandatory)] [System.Collections.Generic.HashSet[int]]$RootProcessIds
  )

  $currentId = $CandidateProcessId
  $visited = [System.Collections.Generic.HashSet[int]]::new()
  while ($visited.Add($currentId) -and $ParentByProcessId.ContainsKey($currentId)) {
    if ($RootProcessIds.Contains($currentId)) {
      return $true
    }
    $currentId = $ParentByProcessId[$currentId]
  }

  return $RootProcessIds.Contains($currentId)
}

function ConvertTo-MiB {
  param([AllowNull()] [object]$Bytes)

  if ($null -eq $Bytes) {
    return $null
  }

  return [math]::Round(([double]$Bytes / 1MB), 2)
}

function Get-ProcessInventory {
  try {
    $cimProcesses = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    return [pscustomobject]@{
      Source         = 'Win32_Process'
      HasParentInfo  = $true
      Warning        = $null
      Processes      = @(
        foreach ($process in $cimProcesses) {
          [pscustomobject]@{
            Name            = [string]$process.Name
            ProcessId       = [int]$process.ProcessId
            ParentProcessId = [int]$process.ParentProcessId
            WorkingSetBytes = [double]$process.WorkingSetSize
            PrivateBytes    = [double]$process.PrivatePageCount
          }
        }
      )
    }
  } catch {
    # Sandboxed or locked-down Windows sessions can deny Win32_Process.  Keep
    # the root-process figures useful, but never guess which WebView2 helpers
    # belong to OrbitStart without parent-process metadata.
    $fallbackProcesses = @()
    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
      try {
        $fallbackProcesses += [pscustomobject]@{
          Name            = "$($process.ProcessName).exe"
          ProcessId       = [int]$process.Id
          ParentProcessId = $null
          WorkingSetBytes = [double]$process.WorkingSet64
          PrivateBytes    = [double]$process.PrivateMemorySize64
        }
      } catch {
        # A process can terminate or deny an individual metric while the list
        # is being read; omit only that process from this sample.
      }
    }

    return [pscustomobject]@{
      Source        = 'Get-Process fallback'
      HasParentInfo = $false
      Warning       = '无法读取 Win32_Process 的父进程信息；默认仅统计 OrbitStart 根进程，不会自动归因 WebView2 子进程。'
      Processes     = $fallbackProcesses
    }
  }
}

function Get-ProcessMetricsById {
  param([Parameter(Mandatory)] [AllowEmptyCollection()] [int[]]$TargetProcessIds)

  $metricsById = @{}
  foreach ($targetProcessId in $TargetProcessIds | Select-Object -Unique) {
    try {
      $process = Get-Process -Id $targetProcessId -ErrorAction Stop
      $cpuSeconds = $null
      $startTimeUtc = $null
      try { $cpuSeconds = [double]$process.CPU } catch { }
      try { $startTimeUtc = $process.StartTime.ToUniversalTime() } catch { }

      $metricsById[$targetProcessId] = [pscustomobject]@{
        WorkingSetBytes = [double]$process.WorkingSet64
        PrivateBytes    = [double]$process.PrivateMemorySize64
        CpuSeconds      = $cpuSeconds
        StartTimeUtc    = $startTimeUtc
      }
    } catch {
      # The process ended between inventory collection and metric collection.
    }
  }

  return $metricsById
}

function Get-OrbitStartProcessSnapshot {
  param(
    [Parameter(Mandatory)] [int]$SampleIndex,
    [Parameter(Mandatory)] [hashtable]$PreviousCpuByProcessId,
    [AllowNull()] [object]$PreviousSampleAt
  )

  $capturedAt = Get-Date
  $inventory = Get-ProcessInventory
  $allProcesses = @($inventory.Processes)
  $parentByProcessId = @{}
  foreach ($process in $allProcesses) {
    if ($null -ne $process.ParentProcessId) {
      $parentByProcessId[[int]$process.ProcessId] = [int]$process.ParentProcessId
    }
  }

  $roots = @(
    $allProcesses | Where-Object {
      (Test-IsNamedProcess -Name $_.Name -ExpectedBaseName $normalizedProcessName) -and
      ($requestedRootIds.Count -eq 0 -or $requestedRootIds.Contains([int]$_.ProcessId))
    }
  )
  $rootIds = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($root in $roots) {
    [void]$rootIds.Add([int]$root.ProcessId)
  }

  $targets = @(
    foreach ($process in $allProcesses) {
      $isRoot = $rootIds.Contains([int]$process.ProcessId)
      $isWebView = Test-IsNamedProcess -Name $process.Name -ExpectedBaseName 'msedgewebview2'
      $isRelatedWebView = $isWebView -and $rootIds.Count -gt 0 -and (
        $IncludeAllWebView2 -or
        ($inventory.HasParentInfo -and (Test-IsDescendantOf -CandidateProcessId ([int]$process.ProcessId) -ParentByProcessId $parentByProcessId -RootProcessIds $rootIds))
      )

      if ($isRoot -or $isRelatedWebView) {
        $association = if ($isRoot) {
          'OrbitStartRoot'
        } elseif ($inventory.HasParentInfo -and (Test-IsDescendantOf -CandidateProcessId ([int]$process.ProcessId) -ParentByProcessId $parentByProcessId -RootProcessIds $rootIds)) {
          'RelatedWebView2'
        } else {
          'UnattributedWebView2'
        }

        [pscustomobject]@{
          Process     = $process
          Association = $association
        }
      }
    }
  )

  $metricsById = Get-ProcessMetricsById -TargetProcessIds @($targets | ForEach-Object { [int]$_.Process.ProcessId })
  $elapsedSeconds = if ($null -eq $PreviousSampleAt) { $null } else { ($capturedAt - [datetime]$PreviousSampleAt).TotalSeconds }
  $rows = @()

  foreach ($target in $targets) {
    $process = $target.Process
    $processId = [int]$process.ProcessId
    $metric = $metricsById[$processId]
    $workingSetBytes = if ($null -eq $metric) { $process.WorkingSetBytes } else { $metric.WorkingSetBytes }
    $privateBytes = if ($null -eq $metric) { $process.PrivateBytes } else { $metric.PrivateBytes }
    $cpuPercent = $null

    if (
      $null -ne $metric -and
      $null -ne $metric.CpuSeconds -and
      $null -ne $elapsedSeconds -and
      $elapsedSeconds -gt 0 -and
      $PreviousCpuByProcessId.ContainsKey($processId)
    ) {
      $previous = $PreviousCpuByProcessId[$processId]
      if ($previous.StartTimeUtc -eq $metric.StartTimeUtc -and $metric.CpuSeconds -ge $previous.CpuSeconds) {
        $cpuPercent = [math]::Round((($metric.CpuSeconds - $previous.CpuSeconds) / $elapsedSeconds) * 100, 2)
      }
    }

    if ($null -ne $metric -and $null -ne $metric.CpuSeconds) {
      $PreviousCpuByProcessId[$processId] = [pscustomobject]@{
        CpuSeconds   = $metric.CpuSeconds
        StartTimeUtc = $metric.StartTimeUtc
      }
    }

    $rows += [pscustomobject]@{
      Timestamp        = $capturedAt.ToString('o')
      SampleIndex      = $SampleIndex
      Source           = $inventory.Source
      Association      = $target.Association
      Process          = $process.Name
      ProcessId        = $processId
      ParentProcessId  = $process.ParentProcessId
      WorkingSetMiB    = ConvertTo-MiB $workingSetBytes
      PrivateMemoryMiB = ConvertTo-MiB $privateBytes
      CpuPercent       = $cpuPercent
      CpuTotalSeconds  = if ($null -eq $metric) { $null } else { $metric.CpuSeconds }
    }
  }

  return [pscustomobject]@{
    CapturedAt        = $capturedAt
    Source            = $inventory.Source
    HasParentInfo     = $inventory.HasParentInfo
    Warning           = $inventory.Warning
    Roots             = $roots
    Rows              = $rows
  }
}

function Get-SampleSummary {
  param(
    [Parameter(Mandatory)] [object[]]$Rows,
    [Parameter(Mandatory)] [int]$SampleIndex,
    [Parameter(Mandatory)] [datetime]$CapturedAt,
    [Parameter(Mandatory)] [string]$Source
  )

  $cpuValues = @($Rows | ForEach-Object { $_.CpuPercent } | Where-Object { $null -ne $_ })
  [pscustomobject]@{
    Timestamp           = $CapturedAt.ToString('o')
    SampleIndex         = $SampleIndex
    Source              = $Source
    OrbitStartProcesses = @($Rows | Where-Object { $_.Association -eq 'OrbitStartRoot' }).Count
    WebView2Processes   = @($Rows | Where-Object { $_.Process -ieq 'msedgewebview2.exe' }).Count
    TrackedProcesses    = $Rows.Count
    WorkingSetMiB       = [math]::Round((($Rows | Measure-Object WorkingSetMiB -Sum).Sum), 2)
    PrivateMemoryMiB    = [math]::Round((($Rows | Measure-Object PrivateMemoryMiB -Sum).Sum), 2)
    CpuPercent          = if ($cpuValues.Count -eq 0) { $null } else { [math]::Round((($cpuValues | Measure-Object -Sum).Sum), 2) }
  }
}

if ($IncludeAllWebView2) {
  Write-Warning 'IncludeAllWebView2 会纳入所有 WebView2 进程，其中可能包含其他应用；该模式不能用于 OrbitStart 专属内存结论。'
}

$sampleCount = [math]::Max(1, [math]::Ceiling(($SampleSeconds * 1000) / $IntervalMilliseconds))
$allRows = @()
$sampleSummaries = @()
$previousCpuByProcessId = @{}
$previousSampleAt = $null
$reportedInventoryWarning = $false
$observedRoot = $false

for ($index = 1; $index -le $sampleCount; $index++) {
  $snapshot = Get-OrbitStartProcessSnapshot -SampleIndex $index -PreviousCpuByProcessId $previousCpuByProcessId -PreviousSampleAt $previousSampleAt
  $previousSampleAt = $snapshot.CapturedAt

  if (-not $reportedInventoryWarning -and -not [string]::IsNullOrWhiteSpace($snapshot.Warning)) {
    Write-Warning $snapshot.Warning
    $reportedInventoryWarning = $true
  }

  if ($snapshot.Roots.Count -eq 0) {
    $selector = if ($requestedRootIds.Count -gt 0) { "指定 PID: $($requestedRootIds -join ', ')" } else { "$rootExecutableName" }
    Write-Warning "未找到 OrbitStart 根进程（$selector）；此样本未记录。"
  } else {
    $observedRoot = $true
    $snapshot.Rows |
      Select-Object Timestamp, SampleIndex, Source, Association, Process, ProcessId, ParentProcessId, WorkingSetMiB, PrivateMemoryMiB, CpuPercent |
      Format-Table -AutoSize
    $summary = Get-SampleSummary -Rows @($snapshot.Rows) -SampleIndex $index -CapturedAt $snapshot.CapturedAt -Source $snapshot.Source
    $sampleSummaries += $summary
    $allRows += $snapshot.Rows
  }

  if ($index -lt $sampleCount) {
    Start-Sleep -Milliseconds $IntervalMilliseconds
  }
}

if (-not $observedRoot) {
  throw "未在采样期间找到 $rootExecutableName。请启动目标应用，或使用 -ProcessId 指定受控实例。"
}

$workingSetValues = @($sampleSummaries | ForEach-Object { $_.WorkingSetMiB })
$privateMemoryValues = @($sampleSummaries | ForEach-Object { $_.PrivateMemoryMiB })
$cpuValues = @($sampleSummaries | ForEach-Object { $_.CpuPercent } | Where-Object { $null -ne $_ })
$latest = $sampleSummaries | Select-Object -Last 1
$aggregate = [pscustomobject]@{
  SampleCount             = $sampleSummaries.Count
  Latest                  = $latest
  WorkingSetMiBMin         = [math]::Round((($workingSetValues | Measure-Object -Minimum).Minimum), 2)
  WorkingSetMiBAverage     = [math]::Round((($workingSetValues | Measure-Object -Average).Average), 2)
  WorkingSetMiBMax         = [math]::Round((($workingSetValues | Measure-Object -Maximum).Maximum), 2)
  PrivateMemoryMiBMin      = [math]::Round((($privateMemoryValues | Measure-Object -Minimum).Minimum), 2)
  PrivateMemoryMiBAverage  = [math]::Round((($privateMemoryValues | Measure-Object -Average).Average), 2)
  PrivateMemoryMiBMax      = [math]::Round((($privateMemoryValues | Measure-Object -Maximum).Maximum), 2)
  CpuPercentAverage        = if ($cpuValues.Count -eq 0) { $null } else { [math]::Round((($cpuValues | Measure-Object -Average).Average), 2) }
  CpuPercentMax            = if ($cpuValues.Count -eq 0) { $null } else { [math]::Round((($cpuValues | Measure-Object -Maximum).Maximum), 2) }
  HasParentProcessInfo     = @($allRows | Where-Object { $_.Source -eq 'Win32_Process' }).Count -gt 0
  IncludesUnattributedWebView2 = @($allRows | Where-Object { $_.Association -eq 'UnattributedWebView2' }).Count -gt 0
}

Write-Host ''
Write-Host '聚合结果（CPU 为相邻样本的累计 CPU 时间差；首个样本没有 CPU 百分比）：'
$aggregate | Format-List

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
  $outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
  if (Test-Path -LiteralPath $outputFullPath) {
    throw "输出文件已存在，为避免覆盖而停止：$outputFullPath"
  }

  $outputDirectory = Split-Path -Parent $outputFullPath
  if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  }

  [pscustomobject]@{
    SchemaVersion = 1
    CapturedAt    = (Get-Date).ToString('o')
    Scenario      = $Scenario
    BuildLabel    = $BuildLabel
    ProcessName   = $rootExecutableName
    RequestedPids = @($requestedRootIds)
    Host          = [pscustomobject]@{
      MachineName    = $env:COMPUTERNAME
      OsVersion      = [Environment]::OSVersion.VersionString
      ProcessorCount = [Environment]::ProcessorCount
    }
    Configuration = [pscustomobject]@{
      SampleSeconds       = $SampleSeconds
      IntervalMilliseconds = $IntervalMilliseconds
      IncludeAllWebView2  = [bool]$IncludeAllWebView2
    }
    Summary         = $aggregate
    SampleSummaries = $sampleSummaries
    Samples         = $allRows
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputFullPath -Encoding utf8

  Write-Host "原始样本已写入：$outputFullPath"
}
