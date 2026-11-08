import hashlib, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import model_profile as model
from work_queue import resource_reason, ram_pressure
from update_host_broker import remove_legacy_weights, remove_previous_weights, LEGACY_WEIGHTS, PREVIOUS_MODEL

class ProfileTests(unittest.TestCase):
    def test_identity_requires_binary_model_and_loopback_port(self):
        root=Path('/fixture'); exe=root/'runtime'/'llama-server.exe'
        args=model.startup_args(root)
        self.assertTrue(model.owns_model(exe,args,root))
        self.assertFalse(model.owns_model('/another/llama-server.exe',args,root))
        for flag,value in [('-m','wrong.gguf'),('--host','0.0.0.0'),('--port','8089')]:
            wrong=args.copy();wrong[wrong.index(flag)+1]=value
            self.assertFalse(model.owns_model(exe,wrong,root))
        self.assertFalse(model.owns_model(exe,['--port'],root))
        self.assertNotIn('--mmproj',args)
        self.assertIn('--jinja',args)
        self.assertEqual(args[args.index('--alias')+1],'panthorium-local')
        self.assertEqual(args[args.index('--load-mode')+1],'none')
        self.assertEqual(args[args.index('-c')+1],'8192')
        self.assertEqual(args[args.index('-ngl')+1],'20')
        self.assertIn('--no-agent',args)

    def test_model_hash_size_and_magic_are_verified(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'model.gguf';data=b'GGUF'+b'0123456789';p.write_bytes(data)
            with patch.dict(model.PROFILE,bytes=len(data),sha256=hashlib.sha256(data).hexdigest()):
                self.assertEqual(model.verify_model(p),model.PROFILE['sha256'])
                p.write_bytes(b'GGUF'+b'9876543210')
                with self.assertRaisesRegex(ValueError,'checksum'):model.verify_model(p)
                p.write_bytes(b'BAD!'+data[4:])
                with self.assertRaisesRegex(ValueError,'GGUF'):model.verify_model(p)
                p.write_bytes(data[:-1])
                with self.assertRaisesRegex(ValueError,'size'):model.verify_model(p)

    def test_9b_forecast_reserves_ram_gpu_and_recovery_headroom(self):
        gib=1024**3
        values=dict(ram_used=.65,total=16*gib,available=5.6*gib,local_ram=.1*gib,
                    vram=0,cpu=15,model_loaded=False,voice_loaded=False,vram_total=4*gib,
                    gpu_temperature=50,limits=model.PROFILE,cold_budget=model.PROFILE['coldRamBudgetGiB'])
        self.assertIsNone(resource_reason(**values))
        self.assertEqual(resource_reason(**dict(values,ram_used=.70)),'ram_headroom')
        self.assertEqual(resource_reason(**dict(values,vram=.1)),'vram_pressure')
        self.assertEqual(resource_reason(**dict(values,vram_total=None)),'gpu_metrics_unavailable')
        self.assertEqual(resource_reason(**dict(values,gpu_temperature=82)),'gpu_temperature')
        self.assertEqual(resource_reason(**dict(values,gpu_temperature=None)),'gpu_metrics_unavailable')
        self.assertEqual(resource_reason(**dict(values,model_loaded=True,ram_used=.78,latched=True)),'ram_pressure')
        self.assertTrue(ram_pressure(.82,4*gib,model.PROFILE))
        self.assertTrue(ram_pressure(.7,2.4*gib,model.PROFILE))
        self.assertFalse(ram_pressure(.79,3.3*gib,model.PROFILE))

    def test_legacy_removal_requires_selected_model_and_preserves_others(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'models').mkdir()
            names=[*LEGACY_WEIGHTS,model.PROFILE['filename'],'Qwen3.5-2B-Q4_K_M.gguf','user-data.txt']
            for name in names:(root/'models'/name).write_text('fixture')
            with self.assertRaises(RuntimeError):remove_legacy_weights(root,{'version':'queue-v1'})
            self.assertTrue(all((root/'models'/name).exists() for name in names))
            removed=remove_legacy_weights(root,{'version':model.PROFILE['brokerVersion'],'model':model.PROFILE['name']})
            self.assertEqual(set(removed),set(LEGACY_WEIGHTS))
            self.assertTrue(all((root/'models'/name).exists() for name in names[2:]))
            self.assertEqual(remove_legacy_weights(root,{'version':model.PROFILE['brokerVersion'],'model':model.PROFILE['name']}),[])

    def test_8b_removal_requires_actual_9b_inference_and_preserves_other_models(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'models'/'candidates').mkdir(parents=True)
            for sub in ('','candidates'):
                (root/'models'/sub/PREVIOUS_MODEL).write_text('old weights')
            retained=[model.PROFILE['filename'],'Llama-3.1-8B-Instruct-Q4_K_M.gguf','user-data.txt']
            for name in retained:(root/'models'/name).write_text('retain')
            health={'version':model.PROFILE['brokerVersion'],'model':model.PROFILE['name'],'ramGuardAlive':True}
            with self.assertRaises(RuntimeError):remove_previous_weights(root,health)
            self.assertTrue((root/'models'/PREVIOUS_MODEL).exists())
            health['inferenceVerified']=True
            self.assertEqual(len(remove_previous_weights(root,health)),2)
            self.assertTrue(all((root/'models'/name).exists() for name in retained))
            self.assertEqual(remove_previous_weights(root,health),[])

if __name__=='__main__':unittest.main()
