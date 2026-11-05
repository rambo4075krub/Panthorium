$ErrorActionPreference = 'Stop'
# Reversible: no model weights, account data or Gemini configuration is deleted.
New-Item -ItemType File -Force 'D:\PanthoriumAI\qwen.disabled' | Out-Null
& 'D:\PanthoriumAI\Stop-LLM.ps1'
Write-Output 'Qwen disabled. Broker unloads speech models. Gemini Live remains available within its credit allowance.'
