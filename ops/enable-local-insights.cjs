'use strict';
// Run from the approved active release with the notebook's existing runtime environment.
// No tokens, subscriptions or connection strings are written to output.
const {closeDatabasePools}=require('../services/databasePool');
(async()=>{
  if(process.argv[2]!=='--enable')throw new Error('Use --enable from the deployed release');
  const {localInsights,authService,notifications}=require('../server');
  await localInsights.init();await notifications.init();
  const owner=await authService.repository.findUserByEmail('rambo4075krub@gmail.com');
  if(!owner?.emailVerifiedAt)throw new Error('Verified owner required');
  const recipients=await localInsights.recipients();
  if(recipients.length!==2 || !recipients.includes(owner.id))throw new Error('Both configured recipients must be verified');
  await localInsights.setEnabled(owner.id,true);
  // The owner explicitly requested immediate alerts to these two accounts.
  // Preserve all other categories/events, previews, sound and voice preferences.
  for(const userId of recipients)await notifications.repository.patchSettings(userId,{enabled:true,channels:{inApp:true,browser:true},categories:{security:true},events:{security_incident:true}},require('../services/notificationService').DEFAULT_SETTINGS);
  console.log(JSON.stringify({ok:true,enabled:true,recipients:recipients.length,trainingEnabled:process.env.SENTINEL_AUTO_TRAINING==='1',autoCapture:process.env.SENTINEL_AUTO_CAPTURE==='1'}));
  await notifications.close();localInsights.stop();
})().catch(e=>{console.error('Local insights activation failed:',e.message);process.exitCode=1;}).finally(()=>closeDatabasePools());
