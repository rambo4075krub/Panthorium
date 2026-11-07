import tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from prepare_qwen8b import admission, benchmark, prepare, profile, GIB

class CandidateTests(unittest.TestCase):
    def test_observed_host_cannot_start(self):
        p=profile()
        state={'totalRam':15.41*GIB,'usedRam':11.41*GIB,'ramFraction':.74,'vramFraction':0}
        self.assertEqual(admission(state,p),'ram_pressure')
        with patch('prepare_qwen8b.readings',return_value=state),patch('subprocess.Popen') as spawn:
            result=benchmark(Path('unused'),p)
            self.assertEqual(result['casesRun'],0);self.assertFalse(result['ok']);spawn.assert_not_called()

    def test_cold_forecast_before_launch(self):
        p=profile();state={'totalRam':16*GIB,'usedRam':8*GIB,'ramFraction':.5,'vramFraction':0}
        self.assertEqual(admission(state,p),'insufficient_cold_load_headroom')
        state.update(totalRam=32*GIB,usedRam=11.41*GIB,ramFraction=11.41/32)
        self.assertIsNone(admission(state,p))
        state['vramFraction']=.61;self.assertEqual(admission(state,p),'vram_pressure')

    def test_existing_invalid_candidate_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);folder=root/'models'/'candidates';folder.mkdir(parents=True)
            p=profile();target=folder/p['filename'];target.write_bytes(b'not a model')
            with patch('urllib.request.urlopen') as net:
                with self.assertRaisesRegex(RuntimeError,'refusing overwrite'):prepare(root,p)
                net.assert_not_called();self.assertEqual(target.read_bytes(),b'not a model')

if __name__=='__main__':unittest.main()
