if (Test-Path 'D:\PanthoriumAI\qwen.disabled') { Write-Output 'Qwen disabled'; exit 0 }
$ErrorActionPreference = 'Stop'
$llmRoot = 'D:\PanthoriumAI'
$llmExe = Join-Path $llmRoot 'runtime\llama-server.exe'
$llmModel = Join-Path $llmRoot 'models\Qwen3.5-4B-Q4_K_M.gguf'
$llmPidFile = Join-Path $llmRoot 'llm.pid'
$llmHealth = 'http://127.0.0.1:8088/health'
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
    [pscustomobject]@{ status = 'reused'; pid = $existing.ProcessId; model = 'Qwen3.5-4B-Q4_K_M'; endpoint = $llmHealth } | ConvertTo-Json -Compress
    exit 0
}
if (-not (Test-Path $llmExe) -or -not (Test-Path $llmModel)) { throw 'Required llama.cpp runtime or selected model is missing.' }
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 8088)
$probe.Server.ExclusiveAddressUse = $true
try { $probe.Start() } catch { throw 'Local port8088 is occupied or unavailable; no new LLM process started.' } finally { $probe.Stop() }
$llmArgs = @('-m', $llmModel, '--host', '127.0.0.1', '--port', '8088', '-c', '8192', '-np', '1', '-ngl', '20', '-t', '4', '-b', '256', '-ub', '128', '-fa', 'on', '--reasoning', 'on', '--reasoning-budget', '2048', '--reasoning-format', 'deepseek', '--cache-ram', '256', '--mmproj', 'D:\PanthoriumAI\models\Qwen3.5-4B-mmproj-F16.gguf', '--no-mmproj-offload', '--image-max-tokens', '512', '--video-fps', '1', '--video-ffmpeg-dir', 'D:\PanthoriumAI\runtime\media', '--alias', 'panthorium-local')
$env:TEMP = 'D:\Panthorium\Host\media-temp'
$env:TMP = $env:TEMP
$logStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $llmRoot "logs\llm-$logStamp.stdout.log"
$stderrPath = Join-Path $llmRoot "logs\llm-$logStamp.stderr.log"
$started = Start-Process -FilePath $llmExe -ArgumentList $llmArgs -WorkingDirectory (Split-Path $llmExe) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
$started.Id | Set-Content -Encoding Ascii $llmPidFile
try { Wait-LlmHealth $started.Id }
catch {
    $failed = Get-CimInstance Win32_Process -Filter "ProcessId = $($started.Id)"
    if (Test-LlmIdentity $failed) { Stop-Process -Id $started.Id -ErrorAction SilentlyContinue }
    throw
}
[pscustomobject]@{ status = 'started'; pid = $started.Id; model = 'Qwen3.5-4B-Q4_K_M'; endpoint = $llmHealth; stdout = $stdoutPath; stderr = $stderrPath } | ConvertTo-Json -Compress
