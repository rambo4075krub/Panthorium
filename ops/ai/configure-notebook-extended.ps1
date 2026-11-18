param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z][a-z0-9-]{4,61}[a-z0-9]$')][string]$Project,
  [ValidateSet('production','staging')][string]$Stage='production',
  [string]$HostRoot='D:\Panthorium\Host',
  [string]$Gcloud='gcloud.cmd'
)
$ErrorActionPreference='Stop'
$runtimePath=Join-Path $HostRoot "$Stage\runtime-ready.dpapi"
if(-not(Test-Path -LiteralPath $runtimePath)){throw 'Notebook configuration is required.'}
function Invoke-Gcloud([string[]]$Arguments) {
  $preference=$ErrorActionPreference
  try {$ErrorActionPreference='Continue';$result=& $Gcloud @Arguments 2>$null;$code=$LASTEXITCODE}
  finally {$ErrorActionPreference=$preference}
  if($code -ne 0){throw 'Google Cloud operation failed; no credential is printed.'}
  return $result
}
$keyId=$null;$saved=$false;$apiKey=$null;$settings=$null
try {
  $billing=Invoke-Gcloud -Arguments @('billing','projects','describe',$Project,'--format=value(billingEnabled)')
  if(($billing -join '').Trim() -ne 'True'){throw 'Verify enabled project billing before configuring the model.'}
  $secure=Get-Content -LiteralPath $runtimePath | ConvertTo-SecureString
  $settings=([pscredential]::new('local',$secure)).GetNetworkCredential().Password | ConvertFrom-Json
  if($settings.PANTHORIUM_GEMINI_API_KEY){throw 'Extended credentials already exist; verify the existing configuration instead of rotating automatically.'}
  $keyId='sentinel-extended-'+[guid]::NewGuid().ToString('N').Substring(0,16)
  $raw=Invoke-Gcloud -Arguments @('services','api-keys','create',"--key-id=$keyId",'--display-name=Panthorium Sentinel server','--api-target=service=generativelanguage.googleapis.com',"--project=$Project",'--quiet','--format=json')
  $created=($raw -join "`n") | ConvertFrom-Json
  $apiKey=$created.keyString
  if(-not $apiKey -and $created.response){$apiKey=$created.response.keyString}
  if(-not $apiKey){
    $raw=Invoke-Gcloud -Arguments @('services','api-keys','get-key-string',$keyId,'--location=global',"--project=$Project",'--format=json')
    $apiKey=(($raw -join "`n") | ConvertFrom-Json).keyString
  }
  if(-not $apiKey){throw 'New key is empty.'}
  $updates=@{PANTHORIUM_GEMINI_EXTENDED='1';PANTHORIUM_GEMINI_API_KEY=$apiKey;PANTHORIUM_AI_MODE='gemini-live-only';GEMINI_LIVE_ENABLED='1';PANTHORIUM_HYBRID_AI='0';PANTHORIUM_LOCAL_QWEN='0';PANTHORIUM_QWEN_DISABLED='1';SENTINEL_AUTO_TRAINING='0';SENTINEL_AUTO_CAPTURE='0'}
  foreach($name in $updates.Keys){$settings | Add-Member -NotePropertyName $name -NotePropertyValue $updates[$name] -Force}
  Copy-Item -LiteralPath $runtimePath -Destination ($runtimePath+'.before-extended-'+(Get-Date -Format 'yyyyMMddHHmmss'))
  $encrypted=ConvertTo-SecureString -String ($settings | ConvertTo-Json -Depth 30 -Compress) -AsPlainText -Force | ConvertFrom-SecureString
  $temporary=$runtimePath+'.extended.tmp'
  [IO.File]::WriteAllText($temporary,$encrypted,[Text.Encoding]::ASCII)
  Move-Item -LiteralPath $temporary -Destination $runtimePath -Force
  $saved=$true
  @{stage=$Stage;project=$Project;keyId=$keyId;configuredAt=(Get-Date).ToUniversalTime().ToString('o');requiresDeployment=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $HostRoot "$Stage\extended-configured.json") -Encoding UTF8
  Write-Output 'Restricted server credential saved in encrypted configuration. A verified application deployment is still required.'
} finally {
  if($keyId -and -not $saved){$null=Invoke-Gcloud -Arguments @('services','api-keys','delete',$keyId,'--location=global',"--project=$Project",'--quiet')}
  $apiKey=$null;$settings=$null;$updates=$null;$encrypted=$null;$raw=$null;$created=$null;$secure=$null
}
