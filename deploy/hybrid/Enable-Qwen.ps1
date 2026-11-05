$ErrorActionPreference = 'Stop'
Remove-Item 'D:\PanthoriumAI\qwen.disabled' -ErrorAction SilentlyContinue
& 'D:\PanthoriumAI\hybrid\Start-Hybrid.ps1'
Write-Output 'Qwen enabled on demand under resource admission controls.'
