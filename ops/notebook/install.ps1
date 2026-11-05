param([switch]$EnableTask)
$ErrorActionPreference='Stop'
$root='D:\Panthorium\Deploy'
$hostRoot='D:\Panthorium\Host'
$ops=$PSScriptRoot
$target=Join-Path $hostRoot 'deploy'
New-Item -ItemType Directory -Force -Path $target | Out-Null
$stamp=Get-Date -Format yyyyMMdd-HHmmss
$backup=Join-Path $root "controller-backups\$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
foreach($name in @('runtime.py','agent.py','edge.cjs','smoke.cjs','bootstrap.py','start-database.py')){
    if(Test-Path "$target\$name"){Copy-Item "$target\$name" "$backup\$name"}
    Copy-Item "$ops\$name" "$target\$name"
}
foreach($stage in @('production','staging')){
    $file="$hostRoot\$stage\deploy-control.dpapi"
    if(!(Test-Path $file)){
        $bytes=New-Object byte[] 32
        $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes);$rng.Dispose()
        $secret=[Convert]::ToBase64String($bytes)
        $secret | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $file
        Remove-Variable secret,bytes
    }
}
if(!(Test-Path "$hostRoot\Start-Host.Legacy.ps1")){
    Copy-Item "$hostRoot\Start-Host.ps1" "$hostRoot\Start-Host.Legacy.ps1"
}
Copy-Item "$hostRoot\Start-Host.ps1" "$backup\Start-Host.ps1"
$launcher=@'
param([ValidateSet('production','staging')][string]$Stage='production')
$ErrorActionPreference='Stop'
if(Test-Path "D:\Panthorium\Host\$Stage\active.json"){
    & 'C:\Python314\python.exe' 'D:\Panthorium\Host\deploy\runtime.py' start $Stage
    exit $LASTEXITCODE
}
& 'D:\Panthorium\Host\Start-Host.Legacy.ps1' -Stage $Stage
'@
[IO.File]::WriteAllText("$hostRoot\Start-Host.ps1",$launcher,[Text.UTF8Encoding]::new($false))
$taskScript=@'
$ErrorActionPreference='Stop'
$log='D:\Panthorium\Deploy\agent.log'
if((Test-Path $log) -and (Get-Item $log).Length -gt 5MB){
    Move-Item $log ($log+'.previous') -Force
}
& 'C:\Python314\python.exe' 'D:\Panthorium\Host\deploy\agent.py' once >> $log 2>&1
exit $LASTEXITCODE
'@
[IO.File]::WriteAllText("$target\Invoke-AutoDeploy.ps1",$taskScript,[Text.UTF8Encoding]::new($false))
# Start PostgreSQL without attaching it to a visible console.
$startup=[Environment]::GetFolderPath('Startup')
$databaseShortcut=Join-Path $startup 'Panthorium PostgreSQL.lnk'
if(Test-Path $databaseShortcut){
    Copy-Item $databaseShortcut (Join-Path $backup 'PostgreSQL-startup.lnk')
    if(!(Test-Path 'C:\Python314\pythonw.exe')){throw 'Windowless Python launcher is missing'}
    $shell=New-Object -ComObject WScript.Shell
    $link=$shell.CreateShortcut($databaseShortcut)
    $link.TargetPath='C:\Python314\pythonw.exe'
    $link.Arguments='"D:\Panthorium\Host\deploy\start-database.py"'
    $link.WorkingDirectory=$target
    $link.WindowStyle=7
    $link.Save()
}
if($EnableTask){
    foreach($stage in @('production','staging')){
        $state=Get-Content "$hostRoot\$stage\active.json" -Raw | ConvertFrom-Json
        if($state.maintenance){throw "$stage is in maintenance"}
    }
    if(!(Test-Path "$target\compatibility.json")){throw 'Verified host compatibility contract is missing'}
    $name='Panthorium Automatic Deploy'
    if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){throw 'Existing deployment task requires review'}
    $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action=New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument '-NoProfile -WindowStyle Hidden -File "D:\Panthorium\Host\deploy\Invoke-AutoDeploy.ps1"'
    $logon=New-ScheduledTaskTrigger -AtLogOn -User $user
    $timer=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    Register-ScheduledTask -TaskName $name -Action $action -Trigger @($logon,$timer) -Principal $principal -Settings $settings -Description 'Receive tested main/staging releases for the local Panthorium server.' | Out-Null
    Start-ScheduledTask -TaskName $name
    'Automatic deployment task enabled.'
}else{'Controller installed. The deployment task remains disabled until bootstrap verification.'}
