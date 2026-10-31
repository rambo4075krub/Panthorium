$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$state = Join-Path (Split-Path $root -Parent) 'panthorium-state'
New-Item -ItemType Directory -Path $state -Force | Out-Null
$pidFile = Join-Path $state 'server.pid'
if (Test-Path $pidFile) {
 $serverProcessId = [int](Get-Content $pidFile)
 $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$serverProcessId" -ErrorAction SilentlyContinue
 if ($existing -and $existing.CommandLine.Contains((Join-Path $root 'scripts\local-profile.cjs'))) { Write-Output "Panthorium already running PID $serverProcessId at http://127.0.0.1:8787/local-ai"; return }
}
$nodePath = 'C:\Program Files\nodejs\node.exe'
$arguments = @('--require', ('"' + (Join-Path $root 'scripts\local-profile.cjs') + '"'), ('"' + (Join-Path $root 'server.js') + '"'))
$process = Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $root -RedirectStandardOutput (Join-Path $state 'server.stdout.log') -RedirectStandardError (Join-Path $state 'server.stderr.log') -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
 try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2; if ($health.ok -and $health.aiMode -eq 'local-only') { $ready = $true; break } } catch {}
 if ($process.HasExited) { throw 'Panthorium stopped during startup; inspect panthorium-state/server.stderr.log' }
 Start-Sleep -Seconds 1
}
if (!$ready) { throw 'Panthorium health check timed out; inspect panthorium-state/server.stderr.log' }
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($name in @('local-profile.json','LOCAL_LOGIN.txt')) { & icacls.exe (Join-Path $state $name) '/inheritance:r' '/grant:r' "${currentIdentity}:(F)" 'SYSTEM:(F)' | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Unable to protect local account file' } }
Write-Output "Panthorium ready PID $($process.Id): http://127.0.0.1:8787/local-ai"
