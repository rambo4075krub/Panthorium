"""Real ASGI routes, controlled resource readings and synthetic voice work.
Does not load Qwen or claim an LLM throughput measurement.
"""
import asyncio, hashlib, time, unittest
from unittest.mock import patch
try:
    import hybrid_server as broker
    import httpx
    AVAILABLE=True
except ImportError:
    AVAILABLE=False

@unittest.skipUnless(AVAILABLE,'Broker dependencies are installed on the notebook')
class BrokerTests(unittest.IsolatedAsyncioTestCase):
    async def test_healthy_port_must_belong_to_selected_model(self):
        class Client:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def get(self,url):return httpx.Response(200)
        with patch.object(broker.httpx,'AsyncClient',return_value=Client()),patch.object(broker,'model_process',return_value=None):
            with self.assertRaises(broker.HTTPException) as result:await broker.ensure_model()
            self.assertEqual(result.exception.detail,'local_model_identity_mismatch')

    async def test_twenty_accounts_and_resource_pause(self):
        from work_queue import WorkQueue
        active=0;maximum=0;started=0
        class Voice:
            def speech(self,text,*args):
                nonlocal active,maximum,started
                active+=1;maximum=max(maximum,active);started+=1
                time.sleep(.025);active-=1
                return text.encode(),{'audio_seconds':.1}
        headers=lambda name:{'X-Panthorium-Account':hashlib.sha256(name.encode()).hexdigest()}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=broker.app),base_url='http://test') as client:
            with patch.object(broker,'queue',WorkQueue(interval=.001)),patch.object(broker,'snapshot',return_value={'ready':True}),patch.object(broker,'voice_engine',return_value=Voice()):
                responses=await asyncio.gather(*[client.post('/speech',json={'text':str(i)},headers=headers(str(i))) for i in range(20)])
                good=[r for r in responses if r.status_code==200]
                self.assertGreaterEqual(len(good),1);self.assertLessEqual(len(good),5)
                self.assertEqual(len(good)+sum(r.status_code==429 for r in responses),20)
                for i,r in enumerate(responses):
                    if r.status_code==200:self.assertEqual(r.content,str(i).encode())
                self.assertEqual(maximum,1);self.assertFalse(broker.queue.status()['running'])
                self.assertEqual(broker.queue.status()['waiting'],0)
            with patch.object(broker,'queue',WorkQueue(wait_seconds=.025,interval=.001)),patch.object(broker,'snapshot',return_value={'ready':False,'reason':'ram_headroom'}),patch.object(broker,'ensure_model') as ensure:
                response=await client.post('/v1/chat/completions',json={'model':'panthorium-local','stream':False},headers=headers('blocked'))
                self.assertEqual(response.status_code,503);self.assertEqual(response.json()['detail'],'local_queue_timeout');ensure.assert_not_called()
                self.assertTrue((await client.get('/health')).json()['ok'])
            print(f'ASGI synthetic 20-account burst: admitted={len(good)}, rejected={20-len(good)}, peak_workers={maximum}; resource pause did not start model')

if __name__=='__main__':unittest.main()
