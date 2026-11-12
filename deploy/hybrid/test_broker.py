"""Real ASGI routes, controlled resource readings and synthetic voice work.
Does not load Qwen or claim an LLM throughput measurement.
"""
import asyncio, hashlib, time, unittest, threading
from types import SimpleNamespace
from unittest.mock import patch
try:
    import hybrid_server as broker
    import httpx
    AVAILABLE=True
except ImportError:
    AVAILABLE=False

@unittest.skipUnless(AVAILABLE,'Broker dependencies are installed on the notebook')
class BrokerTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_http_media_validation_and_forwarding(self):
        from work_queue import WorkQueue
        from test_media_training import picture
        transport=httpx.ASGITransport(app=broker.app)
        payload={'model':'panthorium-local','stream':False,'messages':[{'role':'user','content':[{'type':'text','text':'Color?'},{'type':'image_url','image_url':{'url':picture()}}]}]}
        forwarded=[]
        class Upstream:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,url,json):
                forwarded.append(json)
                return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'red'}}]})
        async with httpx.AsyncClient(transport=transport,base_url='http://test') as client:
            with patch.object(broker,'queue',WorkQueue()),patch.object(broker,'snapshot',return_value={'ready':True}),patch.object(broker,'drop_voice'),patch.object(broker,'ensure_model'),patch.object(broker,'vision_verified',False),patch.object(broker.httpx,'AsyncClient',return_value=Upstream()):
                response=await client.post('/v1/chat/completions',json=payload)
                self.assertEqual(response.status_code,200)
                self.assertTrue(broker.vision_verified)
                self.assertTrue(forwarded[0]['messages'][0]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,'))
                payload['messages'][0]['content'][1]['image_url']['url']='http://169.254.169.254/'
                response=await client.post('/v1/chat/completions',json=payload)
                self.assertEqual(response.status_code,400);self.assertEqual(len(forwarded),1)
                response=await client.post('/v1/chat/completions',content=b'x'*(1500*1024+1))
                self.assertEqual(response.status_code,413)

    async def test_background_never_cold_loads_or_queues_behind_users(self):
        from work_queue import WorkQueue
        request=unittest.mock.Mock(headers={'x-panthorium-account':'b'*64})
        request.is_disconnected=unittest.mock.AsyncMock(return_value=False)
        with patch.object(broker,'queue',WorkQueue()),patch.object(broker,'last_use',time.monotonic()-60),patch.object(broker,'engine',None),patch.object(broker,'snapshot',return_value={'ready':True,'modelLoaded':False}),patch.object(broker,'ensure_model') as load:
            with self.assertRaises(broker.HTTPException):
                async with broker.admission(request,background=True):self.fail('cold background work admitted')
            load.assert_not_called();self.assertIsNone(broker.background_cancel)
            broker.queue.active={'owner':'foreground'}
            with self.assertRaises(broker.HTTPException):
                async with broker.admission(request,background=True):self.fail('background work queued')
            self.assertEqual(broker.queue.pending,[])

    async def test_foreground_preempts_background_and_retains_slot_until_stop(self):
        from work_queue import WorkQueue
        entered=asyncio.Event();events=[]
        class Client:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,*args,**kwargs):entered.set();await asyncio.Event().wait()
        bg=unittest.mock.Mock(headers={'x-panthorium-account':'b'*64,'x-panthorium-background':'1'})
        async def stream():yield b'{"model":"panthorium-local","stream":false,"messages":[{"role":"user","content":"test"}]}'
        bg.stream=stream
        bg.is_disconnected=unittest.mock.AsyncMock(return_value=False)
        async def receive():await asyncio.Event().wait()
        bg.receive=receive
        fg=unittest.mock.Mock(headers={'x-panthorium-account':'c'*64})
        fg.is_disconnected=unittest.mock.AsyncMock(return_value=False)
        with patch.object(broker,'queue',WorkQueue(interval=.001)),patch.object(broker,'last_use',time.monotonic()-60),patch.object(broker,'engine',None),patch.object(broker,'snapshot',return_value={'ready':True,'modelLoaded':True}),patch.object(broker.httpx,'AsyncClient',return_value=Client()),patch.object(broker,'drop_voice'),patch.object(broker,'ensure_model') as load,patch.object(broker,'stop_model',side_effect=lambda:events.append('stop')):
            task=asyncio.create_task(broker.chat(bg));await asyncio.wait_for(entered.wait(),1)
            async with broker.admission(fg):events.append('foreground')
            with self.assertRaises(broker.HTTPException):await task
            self.assertEqual(events,['stop','foreground']);load.assert_not_called()
            self.assertIsNone(broker.background_cancel);self.assertIsNone(broker.queue.active)

    async def test_fast_guard_stops_owned_model_on_ram_pressure_or_missing_metrics(self):
        for missing in (False,True):
            stop=unittest.mock.Mock();stop.wait.side_effect=[False,True]
            failed=threading.Event()
            kwargs={'side_effect':RuntimeError('metrics missing')} if missing else {'return_value':SimpleNamespace(total=16*1024**3,available=2*1024**3)}
            with patch.object(broker,'guard_stop',stop),patch.object(broker,'guard_failed',failed),patch.object(broker,'pressure_latched',False),patch.object(broker.psutil,'virtual_memory',**kwargs),patch.object(broker,'stop_model') as unload:
                broker.fast_ram_watch()
                unload.assert_called_once()
                self.assertEqual(failed.is_set(),missing)

    async def test_voice_admission_reclaims_model_before_forecast(self):
        from work_queue import WorkQueue
        events=[]
        request=unittest.mock.Mock(headers={'x-panthorium-account':'a'*64})
        request.is_disconnected=unittest.mock.AsyncMock(return_value=False)
        with patch.object(broker,'queue',WorkQueue()),patch.object(broker,'stop_model',side_effect=lambda:events.append('unload')),patch.object(broker,'snapshot',side_effect=lambda kind:events.append('forecast') or {'ready':True}):
            async with broker.admission(request,'voice'):events.append('work')
        self.assertEqual(events,['unload','forecast','work'])

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
            with patch.object(broker,'queue',WorkQueue(wait_seconds=45)),patch.object(broker,'snapshot',return_value={'ready':False,'reason':'ram_headroom'}),patch.object(broker,'ensure_model') as ensure:
                response=await asyncio.wait_for(client.post('/v1/chat/completions',json={'model':'panthorium-local','stream':False,'messages':[{'role':'user','content':'test'}]},headers=headers('blocked')),timeout=1)
                self.assertEqual(response.status_code,503);self.assertEqual(response.json()['detail'],'local_resource_ram_headroom');ensure.assert_not_called()
                self.assertEqual(response.headers['retry-after'],'10')
                self.assertEqual(broker.queue.status()['waiting'],0)
                self.assertTrue((await client.get('/health')).json()['ok'])
            print(f'ASGI synthetic 20-account burst: admitted={len(good)}, rejected={20-len(good)}, peak_workers={maximum}; resource pause did not start model')

if __name__=='__main__':unittest.main()
