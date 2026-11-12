import hashlib, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import model_profile as model
from work_queue import resource_reason, ram_pressure
from update_host_broker import remove_previous_weights, PREVIOUS_WEIGHTS, PREVIOUS_PROJECTOR

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
        self.assertEqual(args[args.index('--mmproj')+1],str(model.projector_path(root)))
        self.assertIn('--no-mmproj-offload',args)
        self.assertIn('--jinja',args)
        self.assertEqual(args[args.index('--alias')+1],'panthorium-local')
        self.assertEqual(args[args.index('--load-mode')+1],'none')
        self.assertEqual(args[args.index('-c')+1],'8192')
        self.assertEqual(args[args.index('-ngl')+1],'31')
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

    def test_4b_forecast_reserves_ram_gpu_and_recovery_headroom(self):
        gib=1024**3
        values=dict(ram_used=.65,total=16*gib,available=5.6*gib,local_ram=.1*gib,
                    vram=0,cpu=15,model_loaded=False,voice_loaded=False,vram_total=4*gib,
                    gpu_temperature=50,limits=model.PROFILE,cold_budget=model.PROFILE['coldRamBudgetGiB'])
        self.assertIsNone(resource_reason(**values))
        self.assertEqual(resource_reason(**dict(values,ram_used=.70)),'ram_headroom')
        self.assertEqual(resource_reason(**dict(values,vram=.15)),'vram_pressure')
        self.assertEqual(resource_reason(**dict(values,vram_total=None)),'gpu_metrics_unavailable')
        self.assertEqual(resource_reason(**dict(values,gpu_temperature=82)),'gpu_temperature')
        self.assertEqual(resource_reason(**dict(values,gpu_temperature=None)),'gpu_metrics_unavailable')
        self.assertEqual(resource_reason(**dict(values,model_loaded=True,ram_used=.78,latched=True)),'ram_pressure')
        self.assertTrue(ram_pressure(.82,4*gib,model.PROFILE))
        self.assertTrue(ram_pressure(.7,2.4*gib,model.PROFILE))
        self.assertFalse(ram_pressure(.79,3.3*gib,model.PROFILE))

    def test_9b_removal_requires_text_tools_vision_and_preserves_other_models(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'models'/'candidates').mkdir(parents=True)
            for sub in ('','candidates'):
                for name in PREVIOUS_WEIGHTS:(root/'models'/sub/name).write_text('old weights')
            retained=[model.PROFILE['filename'],model.PROFILE['projector']['filename'],'Llama-3.1-8B-Instruct-Q4_K_M.gguf','user-data.txt']
            for name in retained:(root/'models'/name).write_text('retain')
            health={'version':model.PROFILE['brokerVersion'],'model':model.PROFILE['name'],'ramGuardAlive':True}
            verified={'text':True,'tools':True,'vision':True}
            with self.assertRaises(RuntimeError):remove_previous_weights(root,health,verified)
            self.assertTrue((root/'models'/PREVIOUS_WEIGHTS[0]).exists())
            health['inferenceVerified']=True
            with self.assertRaises(RuntimeError):remove_previous_weights(root,health,verified)
            health['visionVerified']=True
            with self.assertRaises(RuntimeError):remove_previous_weights(root,health,{**verified,'tools':False})
            self.assertEqual(len(remove_previous_weights(root,health,verified)),4)
            self.assertTrue(all((root/'models'/name).exists() for name in retained))
            self.assertEqual(remove_previous_weights(root,health,verified),[])

    def test_generic_projector_requires_exact_9b_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'models'/'candidates').mkdir(parents=True)
            old=root/'models'/'candidates'/'mmproj-F16.gguf';data=b'GGUF9b-projector-fixture'
            old.write_bytes(data);old.with_suffix('.gguf.source.json').write_text('9b receipt')
            other=root/'models'/'mmproj-F16.gguf';other.write_bytes(b'GGUFanother-projector')
            active=root/'models'/model.PROFILE['projector']['filename'];active.write_bytes(b'GGUF4b-projector')
            health={'version':model.PROFILE['brokerVersion'],'model':model.PROFILE['name'],
                    'ramGuardAlive':True,'inferenceVerified':True,'visionVerified':True}
            verified={'text':True,'tools':True,'vision':True}
            with patch.dict(PREVIOUS_PROJECTOR,bytes=len(data),sha256=hashlib.sha256(data).hexdigest()):
                removed=remove_previous_weights(root,health,verified)
            self.assertEqual(len(removed),2)
            self.assertFalse(old.exists());self.assertTrue(other.exists());self.assertTrue(active.exists())

if __name__=='__main__':unittest.main()
