import unittest
from trial_qwen4 import admission, parse_memory, GIB, MIB

class IsolatedTrialTests(unittest.TestCase):
    def test_unknown_estimator_output_fails_closed(self):
        with self.assertRaises(ValueError): parse_memory('Host 637 4 4')
        self.assertEqual(parse_memory('Host 637 4 4\nCUDA0 2462 302 63'),
                         {'Host':645*MIB,'CUDA0':2827*MIB})

    def test_projector_and_margin_must_fit_without_relaxing_guards(self):
        state={'productionBusy':False,'ramFraction':.65,'available':5.6*GIB,
               'used':10.4*GIB,'total':16*GIB,'gpuUsed':9*MIB,
               'gpuTotal':4*GIB,'gpuTemperature':41}
        estimate={'Host':645*MIB+672423616,'CUDA0':2827*MIB}
        self.assertIsNone(admission(state,estimate))
        self.assertEqual(admission({**state,'used':12*GIB},estimate),'insufficient_ram_headroom')
        self.assertEqual(admission({**state,'gpuUsed':128*MIB},estimate),'insufficient_gpu_headroom')
        for changed,reason in [({'productionBusy':True},'production_busy'),
                               ({'ramFraction':.82},'ram_pressure'),
                               ({'available':2.49*GIB},'ram_pressure'),
                               ({'gpuUsed':3.2*GIB},'gpu_pressure'),
                               ({'gpuTemperature':82},'gpu_pressure')]:
            self.assertEqual(admission({**state,**changed},estimate),reason)

if __name__=='__main__': unittest.main()
