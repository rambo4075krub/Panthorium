from pathlib import Path
import shutil,json,hashlib
root=Path(r'D:\PanthoriumAI');backup=root/'hybrid'/'backup';backup.mkdir(exist_ok=True)
p=Path(r'D:\Panthorium\Host\Start-Notebook.ps1')
if not (backup/p.name).exists():shutil.copy2(p,backup/p.name)
s=p.read_text(encoding='utf-8-sig')
s=s.replace("'D:\\PanthoriumAI\\Start-LLM.ps1'", "'D:\\PanthoriumAI\\hybrid\\Start-Hybrid.ps1'")
p.write_text(s,encoding='utf-8-sig')
for name in ['start_llm.cmd','start_llm_4b.cmd']:
 p=root/name
 if not (backup/name).exists():shutil.copy2(p,backup/name)
 p.write_text('@echo off\r\npowershell.exe -NoProfile -File "D:\\PanthoriumAI\\hybrid\\Start-Hybrid.ps1"\r\n',encoding='ascii')
receipt={'startup':'broker on demand','legacy4BLaunchers':'broker','llmGpuLayers':20,'llmCpuThreads':4,'asrCpuThreads':2,'vramHighWater':0.60,'localRamHighWater':0.60,'reserveMiB':1536,'disable':'D:\\PanthoriumAI\\hybrid\\Disable-Qwen.ps1','enable':'D:\\PanthoriumAI\\hybrid\\Enable-Qwen.ps1','githubSynced':False}
(root/'hybrid'/'host-installed.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps(receipt))
