$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pidFile = Join-Path (Join-Path (Split-Path $root -Parent) 'panthorium-state') 'server.pid'
if (!(Test-Path $pidFile)) { Write-Output 'No local server PID recorded'; return }
$serverProcessId = [int](Get-Content $pidFile)
$existing = Get-CimInstance Win32_Process -Filter "ProcessId=$serverProcessId" -ErrorAction SilentlyContinue
if ($existing -and $existing.CommandLine.Contains((Join-Path $root 'scripts\local-profile.cjs'))) { Stop-Process -Id $serverProcessId; Write-Output "Stopped Panthorium PID $serverProcessId" }
Remove-Item -LiteralPath $pidFile
