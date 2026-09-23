# Lists node / chrome processes with memory and a trimmed command line (diagnostics only).
Get-CimInstance Win32_Process | Where-Object { $_.Name -match "node|chrome|headless" } |
  Select-Object ProcessId, Name, @{ n = "MB"; e = { [int]($_.WorkingSetSize / 1MB) } }, @{ n = "Cmd"; e = { if ($_.CommandLine) { $_.CommandLine.Substring(0, [Math]::Min(140, $_.CommandLine.Length)) } else { "" } } } |
  Format-Table -AutoSize | Out-String -Width 260
