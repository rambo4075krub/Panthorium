import base64, hashlib, io, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from media_input import normalize_messages
from training.train_qwen4 import read_bundle, hardware_check, BASE_MODEL, BASE_REVISION

def picture(size=(16,16)):
    raw=io.BytesIO();Image.new('RGB',size,'red').save(raw,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(raw.getvalue()).decode()

def messages(url):return [{'role':'user','content':[{'type':'text','text':'Describe'},{'type':'image_url','image_url':{'url':url}}]}]

class MediaTests(unittest.TestCase):
    def test_normalizes_image_preserves_tool_turn(self):
        source=messages(picture())+[{'role':'assistant','content':None,'tool_calls':[{'id':'c'}]},{'role':'tool','tool_call_id':'c','content':'{}'}]
        output,count=normalize_messages(source)
        self.assertEqual(count,1);self.assertTrue(output[0]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(output[-1],source[-1])
    def test_external_url_corrupt_pixels_and_count_fail_closed(self):
        for url in ('http://127.0.0.1:8765/health','file:///secrets','data:image/svg+xml;base64,AAAA',picture((1025,1025)),'data:image/png;base64,'+base64.b64encode(b'x'*100).decode()):
            with self.assertRaises(ValueError):normalize_messages(messages(url))
        with self.assertRaises(ValueError):normalize_messages(messages(picture())*5)
        with self.assertRaises(ValueError):normalize_messages([{'role':'assistant','content':messages(picture())[0]['content']}])
    def test_malformed_json_structures(self):
        for value in (None,[],[None],[{'role':'user','content':[None]}],[{'role':'user','content':3}]):
            with self.assertRaises(ValueError):normalize_messages(value)

class TrainingTests(unittest.TestCase):
    def bundle(self,directory):
        manifest={'schema':1,'model':BASE_MODEL,'revision':BASE_REVISION,'method':'bf16-lora','scope':'approved-global-training','mode':'text','automaticProductionPromotion':False}
        for split,indices in [('train',range(18)),('validation',range(18,20))]:
            rows=[{'messages':[{'role':'user','content':f'Question {i}'},{'role':'assistant','content':f'Answer {i}'}]} for i in indices]
            raw=('\n'.join(json.dumps(row) for row in rows)+'\n').encode()
            (directory/(split+'.jsonl')).write_bytes(raw)
            manifest[split]={'file':split+'.jsonl','count':len(rows),'sha256':hashlib.sha256(raw).hexdigest()}
        (directory/'manifest.json').write_text(json.dumps(manifest))
        return manifest
    def test_tamper_and_split_leakage_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            directory=Path(folder);manifest=self.bundle(directory)
            self.assertEqual(len(read_bundle(directory)[1]['train']),18)
            p=directory/'validation.jsonl';p.write_text(p.read_text().replace('Question 18','Question 0'))
            with self.assertRaisesRegex(ValueError,'checksum'):read_bundle(directory)
            manifest['validation']['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();(directory/'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'leakage'):read_bundle(directory)
    def test_4g_gpu_blocks_before_any_training_import(self):
        class Result:stdout='4096,4096'
        with tempfile.TemporaryDirectory() as folder,patch('training.train_qwen4.subprocess.run',return_value=Result()):
            result=hardware_check(Path(folder));self.assertFalse(result['ready'])

if __name__=='__main__':unittest.main()
