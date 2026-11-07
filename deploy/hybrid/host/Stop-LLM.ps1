$ErrorActionPreference = 'Stop'
$llmRoot = 'D:\PanthoriumAI'
$llmExe = Join-Path $llmRoot 'runtime\llama-server.exe'
$profile = Get-Content -Raw (Join-Path $llmRoot 'hybrid\model-profile.json') | ConvertFrom-Json
$llmModel = Join-Path (Join-Path $llmRoot 'models') $profile.filename
$llmPidFile = Join-Path $llmRoot 'llm.pid'
if (-not (Test-Path $llmPidFile)) { Write-Output 'No recorded LLM process to stop.'; exit 0 }
$llmProcessId = 0
if (-not [int]::TryParse((Get-Content -Raw $llmPidFile).Trim(), [ref]$llmProcessId) -or $llmProcessId -le 0) { throw 'Invalid llm.pid; no process stopped.' }
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $llmProcessId"
if (-not $processInfo) { Remove-Item $llmPidFile; Write-Output 'Recorded LLM process is already stopped.'; exit 0 }
$actualPath = $processInfo.ExecutablePath
if (-not $actualPath) { $actualPath = (Get-Process -Id $llmProcessId -ErrorAction SilentlyContinue).Path }
$modelPattern = '(?i)(?:^|\s)-m\s+"?' + [regex]::Escape($llmModel) + '"?(?=\s|$)'
$valid = ([string]::Equals($actualPath, $llmExe, [StringComparison]::OrdinalIgnoreCase) -and
    $processInfo.CommandLine -match $modelPattern -and
    $processInfo.CommandLine -match '(?:^|\s)--port\s+8088(?=\s|$)' -and
    $processInfo.CommandLine -match '(?:^|\s)--host\s+127\.0\.0\.1(?=\s|$)')
if (-not $valid) { throw 'PID executable, model or local port does not match; refusing to stop it.' }
Stop-Process -Id $llmProcessId
Wait-Process -Id $llmProcessId -Timeout 15 -ErrorAction SilentlyContinue
Remove-Item $llmPidFile -ErrorAction SilentlyContinue
[pscustomobject]@{ status = 'stopped'; pid = $llmProcessId; model = $profile.name } | ConvertTo-Json -Compress
