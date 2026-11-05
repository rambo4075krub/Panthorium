$ErrorActionPreference = 'Stop'
$root = 'D:\PanthoriumAI'
$python = Join-Path $root 'voice\.venv\Scripts\python.exe'
$script = Join-Path $root 'hybrid\hybrid_server.py'
try {
    $health = Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2
    if ($health.service -eq 'panthorium-free-ai-broker') { Write-Output 'Hybrid broker already running'; exit 0 }
    throw 'Port 8765 is owned by another service'
} catch { if ($_.Exception.Message -eq 'Port 8765 is owned by another service') { throw } }
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'),8765)
try { $probe.Start() } catch { throw 'Port 8765 is occupied; refusing duplicate startup' } finally { $probe.Stop() }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$process = Start-Process $python -ArgumentList @($script) -WorkingDirectory (Split-Path $script) -WindowStyle Hidden -RedirectStandardOutput "$root\hybrid\broker-$stamp.out.log" -RedirectStandardError "$root\hybrid\broker-$stamp.err.log" -PassThru
$process.Id | Set-Content "$root\hybrid\broker.pid"
for ($i = 0; $i -lt 30; $i++) {
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { throw 'Hybrid broker exited' }
    try { if ((Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2).service -eq 'panthorium-free-ai-broker') { Write-Output 'Hybrid broker ready'; exit 0 } } catch {}
    Start-Sleep -Milliseconds 500
}
throw 'Hybrid broker readiness timeout'
