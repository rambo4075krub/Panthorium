import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import textwrap
import unittest
import wave
from pathlib import Path

import numpy as np
from services import command_speech


def microphone_wav(rate=16000):
    with io.BytesIO() as buffer:
        with wave.open(buffer, "wb") as recording:
            recording.setparams((1, 2, rate, 0, "NONE", ""))
            recording.writeframes(struct.pack("<3h", -32768, 0, 16384) * 600)
        return buffer.getvalue()


class CommandSpeechTests(unittest.TestCase):
    def test_microphone_pcm_matches_the_models_native_input(self):
        samples = command_speech.microphone_samples(microphone_wav())
        self.assertEqual(samples.dtype, np.float32)
        np.testing.assert_array_equal(samples, np.tile([-1.0, 0.0, 0.5], 600))
        with self.assertRaises(ValueError):
            command_speech.microphone_samples(microphone_wav(44100))

    def test_native_diagnostics_cannot_replace_the_transcript(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "psutil.py").write_text(textwrap.dedent("""
                from types import SimpleNamespace
                def virtual_memory(): return SimpleNamespace(available=4 * 1024**3)
                BELOW_NORMAL_PRIORITY_CLASS = 0
                class Process:
                    def nice(self, priority): pass
            """), encoding="utf-8")
            (root / "faster_whisper.py").write_text(textwrap.dedent("""
                import os
                from types import SimpleNamespace
                import numpy as np

                class WhisperModel:
                    def __init__(self, *args, **kwargs):
                        os.write(1, b"speech runtime initialized\\n")

                    def transcribe(self, samples, **kwargs):
                        assert isinstance(samples, np.ndarray)
                        assert samples.shape == (1800,)
                        return [SimpleNamespace(text="เปิดผลที่สอง")], None
            """), encoding="utf-8")
            env = dict(os.environ, PYTHONPATH=str(root))
            completed = subprocess.run(
                [sys.executable, str(Path(command_speech.__file__)), str(root), "th", "search"],
                input=microphone_wav(), capture_output=True, timeout=15, check=True, env=env,
            )
            self.assertEqual(json.loads(completed.stdout), "เปิดผลที่สอง")
            self.assertIn(b"speech runtime initialized", completed.stderr)
