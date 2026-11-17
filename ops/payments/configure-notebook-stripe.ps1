param(
  [ValidateSet('production','staging')][string]$Stage='production',
  [ValidateSet('live','test')][string]$Mode='test',
  [switch]$EnableLive,
  [string]$HostRoot='D:\Panthorium\Host',
  [Parameter(Mandatory=$true)][ValidatePattern('^acct_[A-Za-z0-9]+$')][string]$ExpectedAccount
)
$ErrorActionPreference='Stop'
if($Mode -eq 'live' -and -not $EnableLive){throw 'Live payments require -EnableLive after sandbox verification.'}
if($Stage -eq 'staging' -and $Mode -eq 'live'){throw 'Staging must use test credentials.'}
$runtimePath=Join-Path $HostRoot "$Stage\runtime-ready.dpapi"
if(-not (Test-Path -LiteralPath $runtimePath)){throw 'The existing notebook runtime configuration was not found.'}
function Reveal([Security.SecureString]$Value){([pscredential]::new('local',$Value)).GetNetworkCredential().Password}
$apiSecret=$null;$signingSecret=$null;$settings=$null
try{
  $apiSecret=Reveal (Read-Host 'Stripe restricted API key (hidden input; never paste it in chat)' -AsSecureString)
  if($apiSecret -notmatch ('^rk_'+$Mode+'_[A-Za-z0-9]+$')){throw 'Expected a restricted Stripe key for the selected mode.'}
  $signingPath=Join-Path $HostRoot "$Stage\stripe-webhook-$Mode.dpapi"
  if(Test-Path -LiteralPath $signingPath){$signingSecret=Reveal (Get-Content -LiteralPath $signingPath | ConvertTo-SecureString)}
  else{$signingSecret=Reveal (Read-Host 'Stripe webhook signing secret (hidden input)' -AsSecureString)}
  if($signingSecret -notmatch '^whsec_[A-Za-z0-9]+$'){throw 'Invalid webhook signing secret format.'}
  $headers=@{Authorization='Bearer '+$apiSecret;'Stripe-Version'='2026-10-28.endive'}
  try{
    $account=Invoke-RestMethod -Uri 'https://api.stripe.com/v1/account' -Headers $headers -TimeoutSec 20
    $probe=Invoke-RestMethod -Uri 'https://api.stripe.com/v1/checkout/sessions?limit=1' -Headers $headers -TimeoutSec 20
  }catch{throw 'Stripe read-only verification failed. Check the account, key mode and key permissions. No configuration was changed.'}
  if($ExpectedAccount -and $account.id -ne $ExpectedAccount){throw 'The key belongs to a different Stripe account. No configuration was changed.'}
  if($probe.object -ne 'list'){throw 'Checkout read permission could not be verified.'}
  $settings=(Reveal (Get-Content -LiteralPath $runtimePath | ConvertTo-SecureString)) | ConvertFrom-Json
  $updates=@{BILLING_PROVIDER='stripe';STRIPE_MODE=$Mode;STRIPE_LIVE_ENABLED=$(if($Mode -eq 'live'){'1'}else{'0'});STRIPE_SECRET_KEY=$apiSecret;STRIPE_WEBHOOK_SECRET=$signingSecret;STRIPE_PUBLIC_ORIGIN=$(if($Stage -eq 'production'){'https://panthorium.net'}else{'https://preview.panthorium.net'})}
  foreach($name in $updates.Keys){$settings | Add-Member -NotePropertyName $name -NotePropertyValue $updates[$name] -Force}
  $backup=$runtimePath+'.before-stripe-'+(Get-Date -Format 'yyyyMMddHHmmss')
  Copy-Item -LiteralPath $runtimePath -Destination $backup
  $temporary=$runtimePath+'.stripe.tmp'
  $encrypted=ConvertTo-SecureString -String ($settings | ConvertTo-Json -Depth 30 -Compress) -AsPlainText -Force | ConvertFrom-SecureString
  [IO.File]::WriteAllText($temporary,$encrypted,[Text.Encoding]::ASCII)
  Move-Item -LiteralPath $temporary -Destination $runtimePath -Force
  @{stage=$Stage;mode=$Mode;account=$account.id;configuredAt=(Get-Date).ToUniversalTime().ToString('o');requiresControlledRestart=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $HostRoot "$Stage\stripe-configured.json") -Encoding UTF8
  Write-Output 'Stripe credentials verified and saved in the existing encrypted notebook configuration. A controlled backend restart is still required.'
}finally{$apiSecret=$null;$signingSecret=$null;$headers=$null;$updates=$null;$settings=$null;$encrypted=$null}
