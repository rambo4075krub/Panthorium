"""Offline Thai CPU speech engine. Models are downloaded separately."""
from pathlib import Path
import io, json, os, threading, time, wave
BASE=Path(__file__).resolve().parent
os.environ.setdefault('HF_HOME', str(BASE/'cache'/'huggingface'))
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ.setdefault('PYTHAINLP_DATA_DIR',str(BASE/'cache'/'pythainlp'))
os.environ.setdefault('OMP_NUM_THREADS','4')
import onnxruntime as ort
from faster_whisper import WhisperModel
from vachanatts.voice import Voice
from vachanatts.config import Config, SpeechConfig

class ThaiVoiceEngine:
    def __init__(self, threads=4):
        self.threads=threads
        self.lock=threading.Lock()
        self.asr=None
        self.voices={}
    def load_asr(self):
        if self.asr is None:
            self.asr=WhisperModel(str(BASE/'models'/'faster-whisper-small'), device='cpu',compute_type='int8',cpu_threads=2,num_workers=1,local_files_only=True)
    def load_voice(self, name='th_f_1'):
        if name not in ('th_f_1','th_m_1'): raise ValueError('Unsupported voice')
        if name not in self.voices:
            folder=BASE/'models'/'vachana'
            config=Config.from_dict(json.loads((folder/'speaker_config.json').read_text(encoding='utf-8')))
            options=ort.SessionOptions(); options.intra_op_num_threads=self.threads; options.inter_op_num_threads=1
            options.execution_mode=ort.ExecutionMode.ORT_SEQUENTIAL
            session=ort.InferenceSession(str(folder/(name+'.onnx')),sess_options=options,providers=['CPUExecutionProvider'])
            self.voices[name]=Voice(session=session,config=config)
        return self.voices[name]
    def speech(self,text,voice='th_f_1',speed=1.0):
        if not text.strip() or len(text)>4000:raise ValueError('Text must contain 1-4000 characters')
        if not 0.6<=speed<=1.5:raise ValueError('Speed must be between 0.6 and 1.5')
        with self.lock:
            t=time.perf_counter();model=self.load_voice(voice);load=time.perf_counter()-t
            t=time.perf_counter();buf=io.BytesIO()
            with wave.open(buf,'wb') as wav:
                model.synthesize_wav(text,wav,SpeechConfig(length_scale=1/speed,volume=0.9))
            seconds=time.perf_counter()-t;data=buf.getvalue()
            with wave.open(io.BytesIO(data),'rb') as wav:
                duration=wav.getnframes()/wav.getframerate();rate=wav.getframerate()
            return data,{'voice':voice,'load_seconds':load,'synthesis_seconds':seconds,'audio_seconds':duration,'sample_rate':rate,'rtf':seconds/duration if duration else None}
    def transcribe(self,audio):
        with self.lock:
            t=time.perf_counter();self.load_asr();load=time.perf_counter()-t
            t=time.perf_counter()
            segments,info=self.asr.transcribe(audio,language='th',task='transcribe',beam_size=3,best_of=1,temperature=0,condition_on_previous_text=False,initial_prompt='แพนธอเรียม Panthorium โน้ตบุ๊ก เซิร์ฟเวอร์ โมเดล เอไอ',vad_filter=True,vad_parameters={'min_silence_duration_ms':500})
            out=[{'start':s.start,'end':s.end,'text':s.text} for s in segments]
            elapsed=time.perf_counter()-t
            return {'text':''.join(s['text'] for s in out).strip(),'language':info.language,'audio_seconds':info.duration,'load_seconds':load,'transcription_seconds':elapsed,'rtf':elapsed/info.duration if info.duration else None,'segments':out}
