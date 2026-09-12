$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Normalize-Text([object]$Value) {
  if ($null -eq $Value) { return '' }
  return ([string]$Value).Trim().ToLowerInvariant()
}

function Compact-Text([object]$Value) {
  return (Normalize-Text $Value) -replace '[^a-z0-9]', ''
}

function Safe-Text([object]$Value, [int]$MaxLength) {
  if ($null -eq $Value) { return '' }
  $text = ([string]$Value).Trim()
  if ($text.Length -le $MaxLength) { return $text }
  return $text.Substring(0, $MaxLength)
}

function Find-AppWindow([string]$App) {
  $normalized = Normalize-Text $App
  $compact = Compact-Text $App
  if (-not $normalized) { throw 'app is required' }

  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $best = $null
  $bestScore = -1
  $bestProcess = $null

  foreach ($window in $windows) {
    try {
      $current = $window.Current
      if ($current.IsOffscreen) { continue }
      $title = Normalize-Text $current.Name
      $titleCompact = Compact-Text $current.Name
      $process = Get-Process -Id $current.ProcessId -ErrorAction SilentlyContinue
      $processName = if ($process) { Normalize-Text $process.ProcessName } else { '' }
      $processCompact = Compact-Text $processName
      $score = -1
      if ($processName -eq $normalized -or ($compact -and $processCompact -eq $compact)) { $score = 100 }
      elseif ($title -eq $normalized -or ($compact -and $titleCompact -eq $compact)) { $score = 95 }
      elseif ($processName -and ($processName.Contains($normalized) -or $normalized.Contains($processName))) { $score = 85 }
      elseif ($compact -and $processCompact -and ($processCompact.Contains($compact) -or $compact.Contains($processCompact))) { $score = 82 }
      elseif ($title -and ($title.Contains($normalized) -or $normalized.Contains($title))) { $score = 75 }
      elseif ($compact -and $titleCompact -and ($titleCompact.Contains($compact) -or $compact.Contains($titleCompact))) { $score = 72 }
      if ($score -gt $bestScore) {
        $best = $window
        $bestScore = $score
        $bestProcess = $process
      }
    } catch {}
  }

  if ($null -eq $best -or $bestScore -lt 0) { return $null }
  return [pscustomobject]@{ Element = $best; Process = $bestProcess; Score = $bestScore }
}

function Screen-Geometry([System.Windows.Rect]$Rect) {
  $centerX = [int][Math]::Round($Rect.Left + ($Rect.Width / 2))
  $centerY = [int][Math]::Round($Rect.Top + ($Rect.Height / 2))
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $screen = $null
  foreach ($candidate in $screens) {
    if ($candidate.Bounds.Contains($centerX, $centerY)) { $screen = $candidate; break }
  }
  if ($null -eq $screen) {
    foreach ($candidate in $screens) {
      if ($candidate.Bounds.IntersectsWith([System.Drawing.Rectangle]::FromLTRB(
        [int][Math]::Floor($Rect.Left),
        [int][Math]::Floor($Rect.Top),
        [int][Math]::Ceiling($Rect.Right),
        [int][Math]::Ceiling($Rect.Bottom)
      ))) { $screen = $candidate; break }
    }
  }
  if ($null -eq $screen) { return $null }

  $left = [int][Math]::Round($Rect.Left - $screen.Bounds.Left)
  $top = [int][Math]::Round($Rect.Top - $screen.Bounds.Top)
  $width = [Math]::Max(1, [int][Math]::Round($Rect.Width))
  $height = [Math]::Max(1, [int][Math]::Round($Rect.Height))
  return [pscustomobject]@{
    displayId = $screen.DeviceName
    x = $left
    y = $top
    width = $width
    height = $height
    centerX = [Math]::Max(0, [Math]::Min($screen.Bounds.Width - 1, $left + [int][Math]::Floor($width / 2)))
    centerY = [Math]::Max(0, [Math]::Min($screen.Bounds.Height - 1, $top + [int][Math]::Floor($height / 2)))
  }
}

function Observe-App([string]$App, [int]$MaxElements) {
  $match = Find-AppWindow $App
  if ($null -eq $match) {
    return [pscustomobject]@{ supported = $true; available = $false; reason = 'No matching visible application window was found.' }
  }

  $window = $match.Element
  $currentWindow = $window.Current
  $windowGeometry = Screen-Geometry $currentWindow.BoundingRectangle
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = [System.Collections.Generic.Queue[System.Windows.Automation.AutomationElement]]::new()
  $queue.Enqueue($window)
  $elements = [System.Collections.Generic.List[object]]::new()
  $visited = 0
  $visitLimit = [Math]::Max($MaxElements * 8, 256)

  while ($queue.Count -gt 0 -and $elements.Count -lt $MaxElements -and $visited -lt $visitLimit) {
    $parent = $queue.Dequeue()
    $child = $null
    try { $child = $walker.GetFirstChild($parent) } catch {}
    while ($null -ne $child -and $elements.Count -lt $MaxElements -and $visited -lt $visitLimit) {
      $visited += 1
      try {
        $queue.Enqueue($child)
        $current = $child.Current
        $rect = $current.BoundingRectangle
        if (-not $current.IsOffscreen -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
          $name = Safe-Text $current.Name 500
          $automationId = Safe-Text $current.AutomationId 300
          $className = Safe-Text $current.ClassName 300
          $role = Safe-Text ($current.ControlType.ProgrammaticName -replace '^ControlType\.', '') 100
          if ($name -or $automationId) {
            $geometry = Screen-Geometry $rect
            if ($null -ne $geometry) {
              $targetId = 'e' + ($elements.Count + 1)
              $elements.Add([pscustomobject]@{
                targetId = $targetId
                role = $role
                name = $name
                automationId = $automationId
                className = $className
                enabled = [bool]$current.IsEnabled
                displayId = $geometry.displayId
                x = $geometry.x
                y = $geometry.y
                width = $geometry.width
                height = $geometry.height
                centerX = $geometry.centerX
                centerY = $geometry.centerY
              })
            }
          }
        }
      } catch {}
      $next = $null
      try { $next = $walker.GetNextSibling($child) } catch {}
      $child = $next
    }
  }

  $processName = if ($match.Process) { Safe-Text $match.Process.ProcessName 200 } else { '' }
  $windowResult = [pscustomobject]@{
    title = Safe-Text $currentWindow.Name 500
    processName = $processName
    processId = [int]$currentWindow.ProcessId
    className = Safe-Text $currentWindow.ClassName 300
    displayId = if ($windowGeometry) { $windowGeometry.displayId } else { $null }
  }
  return [pscustomobject]@{
    supported = $true
    available = $true
    window = $windowResult
    elements = $elements
    count = $elements.Count
    truncated = ($queue.Count -gt 0 -or $visited -ge $visitLimit)
  }
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
  if (-not $line.Trim()) { continue }
  $requestId = $null
  try {
    $request = $line | ConvertFrom-Json
    $requestId = [string]$request.id
    if ($request.action -ne 'observe') { throw "Unsupported UIA helper action '$($request.action)'." }
    $maxElements = [Math]::Max(1, [Math]::Min(300, [int]$request.maxElements))
    $result = Observe-App ([string]$request.app) $maxElements
    [pscustomobject]@{ id = $requestId; ok = $true; result = $result } | ConvertTo-Json -Compress -Depth 8
  } catch {
    [pscustomobject]@{ id = $requestId; ok = $false; error = (Safe-Text $_.Exception.Message 1000) } | ConvertTo-Json -Compress -Depth 4
  }
}
