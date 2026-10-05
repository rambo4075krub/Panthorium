import base64
import io
import json
import math
import threading
import unittest
import urllib.error
import urllib.request
import wave
from http.server import ThreadingHTTPServer

from app import decode_audio, handler_class


def sample_audio(frequency=220, amplitude=0.2, seconds=2, leading_silence=0, trailing_silence=0):
    import struct
    pcm = b"".join(struct.pack("<h", int(32767 * amplitude * math.sin(2 * math.pi * frequency * i / 16000))) for i in range(16000 * seconds))
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(bytes(2 * int(16000 * leading_silence)) + pcm + bytes(2 * int(16000 * trailing_silence)))
    return "data:audio/wav;base64," + base64.b64encode(output.getvalue()).decode()


class FakeEncoder:
    def encode(self, samples):
        return [0.1] * 192


class SpeakerServiceTests(unittest.TestCase):
    def test_decode_valid_and_reject_silence(self):
        self.assertEqual(len(decode_audio(sample_audio())), 32000)
        trimmed = decode_audio(sample_audio(seconds=2, leading_silence=1, trailing_silence=1))
        self.assertGreaterEqual(len(trimmed), 32000)
        self.assertLess(len(trimmed), 48000)
        with self.assertRaisesRegex(ValueError, "voice_signal_too_short"):
            decode_audio(sample_audio(seconds=0.5, leading_silence=1, trailing_silence=1))
        with self.assertRaisesRegex(ValueError, "voice_signal_missing"):
            decode_audio(sample_audio(amplitude=0))
        with self.assertRaisesRegex(ValueError, "invalid_audio"):
            decode_audio("not audio")

    def test_endpoint_never_calls_model_for_silence(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_class(FakeEncoder()))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/embed"
            def post(audio):
                return urllib.request.Request(url, json.dumps({"audio": audio}).encode(), {"Content-Type": "application/json"})
            with urllib.request.urlopen(post(sample_audio())) as response:
                result = json.load(response)
                self.assertTrue(result["signalPresent"])
                self.assertEqual(len(result["embedding"]), 192)
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(post(sample_audio(amplitude=0)))
            self.assertEqual(rejected.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
