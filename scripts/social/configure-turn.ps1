$ErrorActionPreference = 'Stop'
$project = 'project-0f6aa7d0-6055-420f-842'
$zone = 'asia-southeast1-b'
function Cloud { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args) & gcloud @Args; if ($LASTEXITCODE -ne 0) { throw 'Google Cloud operation failed' } }
$secretPath = Join-Path $env:TEMP 'panthorium-turn-secret.tmp'
$configPath = Join-Path $env:TEMP 'panthorium-turn-config.tmp'
try {
  $existing = & gcloud secrets list --project $project --filter='name:panthorium-social-turn' --format='value(name)'
  if (!$existing) {
    $buffer = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($buffer); $rng.Dispose()
    [IO.File]::WriteAllText($secretPath,[Convert]::ToBase64String($buffer),[Text.UTF8Encoding]::new($false))
    Cloud secrets create panthorium-social-turn --project $project --replication-policy=automatic --data-file=$secretPath
  }
  $secret = & gcloud secrets versions access latest --secret=panthorium-social-turn --project $project
  if ($LASTEXITCODE -ne 0 -or !$secret) { throw 'TURN secret unavailable' }
  $vm = & gcloud compute instances describe panthorium-social-turn --project $project --zone $zone --format=json | ConvertFrom-Json
  if ($vm.serviceAccounts) { throw 'Relay must have no service account' }
  $private = $vm.networkInterfaces[0].networkIP
  $public = $vm.networkInterfaces[0].accessConfigs[0].natIP
  $lines = @('listening-port=3478',"listening-ip=$private","relay-ip=$private","external-ip=$public/$private",'min-port=49160','max-port=49300','fingerprint','use-auth-secret',"static-auth-secret=$secret",'realm=panthorium.net','server-name=panthorium-social-turn','no-cli','no-tls','no-dtls','no-tcp-relay','no-multicast-peers','no-software-attribute','user-quota=12','total-quota=100','max-bps=500000','bps-capacity=10000000','stale-nonce=600','log-file=syslog','simple-log')
  foreach ($range in @('0.0.0.0-0.255.255.255','10.0.0.0-10.255.255.255','100.64.0.0-100.127.255.255','127.0.0.0-127.255.255.255','169.254.0.0-169.254.255.255','172.16.0.0-172.31.255.255','192.168.0.0-192.168.255.255','224.0.0.0-255.255.255.255','::1','fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff','fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff')) { $lines += "denied-peer-ip=$range" }
  [IO.File]::WriteAllText($configPath,($lines -join "`n")+"`n",[Text.UTF8Encoding]::new($false))
  Cloud compute scp $configPath 'panthorium-social-turn:/tmp/panthorium-turn-config' --project $project --zone $zone --tunnel-through-iap --quiet
  Cloud compute ssh panthorium-social-turn --project $project --zone $zone --tunnel-through-iap --quiet --command='sudo install -o root -g turnserver -m 640 /tmp/panthorium-turn-config /etc/turnserver.conf && rm /tmp/panthorium-turn-config && sudo touch /etc/panthorium-turn-ready && sudo systemctl unmask coturn && sudo systemctl enable --now coturn && sudo systemctl restart coturn && sudo systemctl is-active coturn'
  Write-Output "Authenticated TURN configured at $public; no VM cloud identity."
} finally {
  $secret = $null; $lines = $null
  foreach ($file in @($secretPath,$configPath)) { if (Test-Path $file) { Remove-Item $file -Force } }
}
