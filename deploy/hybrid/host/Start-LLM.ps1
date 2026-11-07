if (Test-Path 'D:\PanthoriumAI\qwen.disabled') { Write-Output 'Qwen disabled'; exit 0 }
$ErrorActionPreference = 'Stop'
$llmRoot = 'D:\PanthoriumAI'
$llmExe = Join-Path $llmRoot 'runtime\llama-server.exe'
$profile = Get-Content -Raw (Join-Path $llmRoot 'hybrid\model-profile.json') | ConvertFrom-Json
$llmModel = Join-Path (Join-Path $llmRoot 'models') $profile.filename
$llmPidFile = Join-Path $llmRoot 'llm.pid'
$llmHealth = 'http://127.0.0.1:8088/health'
$brokerHealth = Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 3
if ($brokerHealth.version -ne 'qwen8b-v1' -or $brokerHealth.model -ne $profile.name) { throw 'The matching resource-monitoring broker must be running first.' }
function Test-LlmIdentity($ProcessInfo) {
    if (-not $ProcessInfo) { return $false }
    $actualPath = $ProcessInfo.ExecutablePath
    if (-not $actualPath) {
        $actualPath = (Get-Process -Id $ProcessInfo.ProcessId -ErrorAction SilentlyContinue).Path
    }
    $modelPattern = '(?i)(?:^|\s)-m\s+"?' + [regex]::Escape($llmModel) + '"?(?=\s|$)'
    return ([string]::Equals($actualPath, $llmExe, [StringComparison]::OrdinalIgnoreCase) -and
        $ProcessInfo.CommandLine -match $modelPattern -and
        $ProcessInfo.CommandLine -match '(?:^|\s)--port\s+8088(?=\s|$)' -and
        $ProcessInfo.CommandLine -match '(?:^|\s)--host\s+127\.0\.0\.1(?=\s|$)')
}
function Test-LlmHealth {
    try { return ((Invoke-RestMethod -Uri $llmHealth -TimeoutSec 2).status -eq 'ok') }
    catch { return $false }
}
function Wait-LlmHealth([int]$ProcessIdToCheck) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (-not (Get-Process -Id $ProcessIdToCheck -ErrorAction SilentlyContinue)) { throw 'LLM process exited before readiness; inspect logs.' }
        if (Test-LlmHealth) { return }
        Start-Sleep -Milliseconds 1000
    }
    throw 'LLM health did not become ready within the startup deadline.'
}
$existing = $null
if (Test-Path $llmPidFile) {
    $recordedId = 0
    if ([int]::TryParse((Get-Content -Raw $llmPidFile).Trim(), [ref]$recordedId) -and $recordedId -gt 0) {
        $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $recordedId"
        if ($existing -and -not (Test-LlmIdentity $existing)) { throw 'Recorded PID belongs to a different process; refusing to reuse or stop it.' }
    } else { throw 'Invalid llm.pid; inspect it before startup.' }
}
if (-not $existing) {
    $matches = @(Get-CimInstance Win32_Process -Filter "Name = 'llama-server.exe'" | Where-Object { Test-LlmIdentity $_ })
    if ($matches.Count -gt 1) { throw 'Multiple matching LLM processes found; inspect them before startup.' }
    if ($matches.Count -eq 1) { $existing = $matches[0] }
}
if ($existing) {
    Wait-LlmHealth ([int]$existing.ProcessId)
    $existing.ProcessId | Set-Content -Encoding Ascii $llmPidFile
    [pscustomobject]@{ status = 'reused'; pid = $existing.ProcessId; model = $profile.name; endpoint = $llmHealth } | ConvertTo-Json -Compress
    exit 0
}
if (-not (Test-Path $llmExe) -or -not (Test-Path $llmModel)) { throw 'Required llama.cpp runtime or selected model is missing.' }
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 8088)
$probe.Server.ExclusiveAddressUse = $true
try { $probe.Start() } catch { throw 'Local port8088 is occupied or unavailable; no new LLM process started.' } finally { $probe.Stop() }
$preflightJson = & (Join-Path $llmRoot 'voice\.venv\Scripts\python.exe') (Join-Path $llmRoot 'hybrid\model_profile.py')
if ($LASTEXITCODE -ne 0) { Write-Output $preflightJson; exit 2 }
$preflight = $preflightJson | ConvertFrom-Json
if (-not $preflight.ready) { throw 'Local model resource admission failed' }
$llmArgs = @($preflight.args)
$env:TEMP = 'D:\Panthorium\Host\media-temp'
$env:TMP = $env:TEMP
$logStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $llmRoot "logs\llm-$logStamp.stdout.log"
$stderrPath = Join-Path $llmRoot "logs\llm-$logStamp.stderr.log"
$started = Start-Process -FilePath $llmExe -ArgumentList $llmArgs -WorkingDirectory (Split-Path $llmExe) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
$started.Id | Set-Content -Encoding Ascii $llmPidFile
$started.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
try { Wait-LlmHealth $started.Id }
catch {
    $failed = Get-CimInstance Win32_Process -Filter "ProcessId = $($started.Id)"
    if (Test-LlmIdentity $failed) { Stop-Process -Id $started.Id -ErrorAction SilentlyContinue }
    throw
}
[pscustomobject]@{ status = 'started'; pid = $started.Id; model = $profile.name; endpoint = $llmHealth; stdout = $stdoutPath; stderr = $stderrPath } | ConvertTo-Json -Compress
