import hashlib, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import model_profile as model
from work_queue import resource_reason
from update_host_broker import remove_legacy_weights, LEGACY_WEIGHTS

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

    def test_8b_forecast_refuses_room_that_was_enough_for_4b(self):
        values=dict(ram_used=.30,total=16*1024**3,available=11.2*1024**3,
                    local_ram=.1*1024**3,vram=.1,cpu=15,model_loaded=False,voice_loaded=False)
        self.assertIsNone(resource_reason(**values,cold_budget=4.5))
        self.assertEqual(resource_reason(**values,cold_budget=model.PROFILE['coldRamBudgetGiB']),'ram_headroom')
        values.update(total=32*1024**3,available=22.4*1024**3)
        self.assertIsNone(resource_reason(**values,cold_budget=model.PROFILE['coldRamBudgetGiB']))

    def test_removal_requires_8b_and_preserves_other_models(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'models').mkdir()
            names=[*LEGACY_WEIGHTS,model.PROFILE['filename'],'Qwen3.5-2B-Q4_K_M.gguf','user-data.txt']
            for name in names:(root/'models'/name).write_text('fixture')
            with self.assertRaises(RuntimeError):remove_legacy_weights(root,{'version':'queue-v1'})
            self.assertTrue(all((root/'models'/name).exists() for name in names))
            removed=remove_legacy_weights(root,{'version':'qwen8b-v1','model':model.PROFILE['name']})
            self.assertEqual(set(removed),set(LEGACY_WEIGHTS))
            self.assertTrue(all((root/'models'/name).exists() for name in names[2:]))
            self.assertEqual(remove_legacy_weights(root,{'version':'qwen8b-v1','model':model.PROFILE['name']}),[])

if __name__=='__main__':unittest.main()
