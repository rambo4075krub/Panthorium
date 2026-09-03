const { SecurityResponseService } = require('../services/securityResponseService');

(async () => {
  const events = [];
  const audit = {
    record(event, fields) { events.push({ event, ...fields }); },
    async listRecent() { return []; }
  };
  const service = new SecurityResponseService({ audit });
  await service.init();

  let block = await service.blockIp('203.0.113.10', { durationMinutes: 5, reason: 'test', source: 'manual', actorUserId: 'admin' });
  if (!block || block.ip !== '203.0.113.10') throw new Error('blockIp failed');
  if (!(await service.getActiveBlock('::ffff:203.0.113.10'))) throw new Error('mapped IPv4 normalization failed');
  if ((await service.listBlocks()).length !== 1) throw new Error('listBlocks failed');
  if (!(await service.unblockIp('203.0.113.10', 'admin'))) throw new Error('unblockIp failed');
  if (await service.getActiveBlock('203.0.113.10')) throw new Error('block should be removed');

  let invalidRejected = false;
  try { await service.blockIp('not-an-ip', { durationMinutes: 5 }); } catch (error) { invalidRejected = error.message === 'invalid_ip'; }
  if (!invalidRejected) throw new Error('invalid IP should be rejected');
  if (service.normalizeIp('999.999.1.1') !== '') throw new Error('invalid IPv4 normalization failed');

  if (!events.some((event) => event.event === 'security.ip_blocked')) throw new Error('block audit missing');
  if (!events.some((event) => event.event === 'security.ip_unblocked')) throw new Error('unblock audit missing');

  console.log('Security response tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
