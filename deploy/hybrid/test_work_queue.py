import asyncio
import unittest
from work_queue import WorkQueue, QueueError, resource_reason

async def yes(): return True
async def no(): return False

class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_fifo_isolation_bounds_and_cleanup(self):
        q=WorkQueue(interval=.001)
        release=asyncio.Event(); entered=asyncio.Event(); order=[]
        async def work(owner):
            async with q.lease(owner,yes,no):
                order.append(owner)
                if owner=='first': entered.set(); await release.wait()
        first=asyncio.create_task(work('first')); await entered.wait()
        rest=[]
        for i in range(4):
            rest.append(asyncio.create_task(work(str(i)))); await asyncio.sleep(.003)
        self.assertEqual(q.status('2')['yourPosition'],3)
        self.assertNotIn('first',str(q.status('outsider')))
        self.assertIsNone(q.status('outsider')['yourPosition'])
        for owner,code in [('first','local_account_busy'),('2','local_account_busy'),('overflow','local_queue_full')]:
            with self.assertRaises(QueueError) as e: await work(owner)
            self.assertEqual(e.exception.code,code)
        release.set(); await asyncio.gather(first,*rest)
        self.assertEqual(order,['first','0','1','2','3'])
        self.assertEqual(q.status()['waiting'],0); self.assertFalse(q.status()['running'])

    async def test_timeout_disconnect_cancel_exception_and_recovery(self):
        q=WorkQueue(wait_seconds=.02,interval=.001)
        with self.assertRaises(QueueError) as e:
            async with q.lease('a',no,no): self.fail('resource-blocked work started')
        self.assertEqual(e.exception.code,'local_queue_timeout')
        with self.assertRaises(QueueError) as e:
            async with q.lease('a',yes,yes): self.fail('disconnected work started')
        self.assertEqual(e.exception.status,499)
        async def blocked():
            async with q.lease('a',no,no): pass
        task=asyncio.create_task(blocked()); await asyncio.sleep(.003); task.cancel()
        with self.assertRaises(asyncio.CancelledError): await task
        with self.assertRaises(ValueError):
            async with q.lease('a',yes,no): raise ValueError('worker failed')
        async with q.lease('a',yes,no): self.assertTrue(q.status('a')['yourRunning'])
        self.assertFalse(q.status()['running']); self.assertEqual(q.status()['waiting'],0)

    async def test_resources_recover_without_reordering(self):
        q=WorkQueue(wait_seconds=1,interval=.001); free=False; order=[]
        async def ready(): return free
        async def work(owner):
            async with q.lease(owner,ready,no): order.append(owner)
        tasks=[]
        for owner in ['a','b']:
            tasks.append(asyncio.create_task(work(owner))); await asyncio.sleep(.003)
        self.assertEqual(order,[]); free=True; await asyncio.gather(*tasks)
        self.assertEqual(order,['a','b'])

class ResourceTests(unittest.TestCase):
    def reason(self,**kw):
        values=dict(ram_used=.20,total=16*1024**3,available=11.2*1024**3,local_ram=.3*1024**3,vram=.1,cpu=20,model_loaded=False,voice_loaded=False)
        values.update(kw); return resource_reason(**values)
    def test_preflight_and_pressure(self):
        self.assertIsNone(self.reason())
        self.assertEqual(self.reason(ram_used=.60),'ram_headroom')
        self.assertEqual(self.reason(ram_used=.65),'ram_pressure')
        self.assertEqual(self.reason(ram_used=.61,latched=True,model_loaded=True),'ram_pressure')
        self.assertEqual(self.reason(vram=None),'gpu_metrics_unavailable')
        self.assertEqual(self.reason(vram=.60),'vram_pressure')
        self.assertEqual(self.reason(vram=.56,latched=True),'vram_pressure')
        self.assertEqual(self.reason(cpu=65),'cpu_pressure')
        self.assertEqual(self.reason(available=1024**3),'ram_pressure')
        self.assertIsNone(self.reason(ram_used=.60,model_loaded=True))
        self.assertIsNone(self.reason(ram_used=.50,kind='voice'))

if __name__=='__main__': unittest.main()
