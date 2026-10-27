$ErrorActionPreference = 'Stop'
$project = 'project-0f6aa7d0-6055-420f-842'
$region = 'asia-southeast1'
$zone = 'asia-southeast1-b'
function Cloud { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args) & gcloud @Args; if ($LASTEXITCODE -ne 0) { throw 'Google Cloud operation failed' } }
Cloud services enable compute.googleapis.com iap.googleapis.com secretmanager.googleapis.com --project $project --quiet
$network = & gcloud compute networks list --project $project --filter='name=panthorium-social-turn' --format='value(name)'
if (!$network) { Cloud compute networks create panthorium-social-turn --project $project --subnet-mode=custom }
$subnet = & gcloud compute networks subnets list --project $project --filter='name=panthorium-social-turn' --format='value(name)'
if (!$subnet) { Cloud compute networks subnets create panthorium-social-turn --project $project --network=panthorium-social-turn --region $region --range=10.77.0.0/28 }
$address = & gcloud compute addresses list --project $project --filter='name=panthorium-social-turn' --format='value(address)'
if (!$address) { Cloud compute addresses create panthorium-social-turn --region $region --project $project; $address = & gcloud compute addresses describe panthorium-social-turn --region $region --project $project --format='value(address)' }
$firewall = & gcloud compute firewall-rules list --project $project --filter='name=panthorium-social-turn' --format='value(name)'
if (!$firewall) { Cloud compute firewall-rules create panthorium-social-turn --project $project --network=panthorium-social-turn --direction=INGRESS --action=ALLOW --rules='udp:3478,tcp:3478,udp:49160-49300' --source-ranges=0.0.0.0/0 --target-tags=panthorium-social-turn --description='Authenticated WebRTC relay only; isolated network, no cloud identity' }
$iap = & gcloud compute firewall-rules list --project $project --filter='name=panthorium-social-turn-iap' --format='value(name)'
if (!$iap) { Cloud compute firewall-rules create panthorium-social-turn-iap --project $project --network=panthorium-social-turn --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=panthorium-social-turn --description='SSH exclusively through authenticated Google IAP' }
$vm = & gcloud compute instances list --project $project --filter='name=panthorium-social-turn' --format='value(name)'
if (!$vm) { Cloud compute instances create panthorium-social-turn --project $project --zone $zone --machine-type=e2-micro --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=10GB --boot-disk-type=pd-standard --no-service-account --no-scopes --network=panthorium-social-turn --subnet=panthorium-social-turn --tags=panthorium-social-turn --address=$address --metadata-from-file="startup-script=$PSScriptRoot\turn-startup.sh" --metadata=block-project-ssh-keys=TRUE --shielded-secure-boot '--labels=app=panthorium,component=social-turn' }
Write-Output "TURN VM created without a service account or scopes: $address. Disabled until authenticated configuration is installed."
