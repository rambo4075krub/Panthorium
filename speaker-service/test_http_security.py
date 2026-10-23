import http.client
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from app import BoundedHTTPServer, bounded_process, handler_class


class Encoder:
    def encode(self, samples):
        return [0.1] * 192


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.server = BoundedHTTPServer(("127.0.0.1", 0), handler_class(Encoder(), read_timeout=0.5), max_requests=1)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def raw(self, request):
        with socket.create_connection(self.server.server_address, timeout=2) as connection:
            connection.sendall(request)
            response = http.client.HTTPResponse(connection)
            response.begin()
            result = response.status, response.read()
        if result[0] != 503:
            # Reading the response can finish before the server thread's finally
            # releases its slot. Sequential framing tests must await that release.
            deadline = time.monotonic() + 1
            while not self.server.request_slots._value and time.monotonic() < deadline:
                time.sleep(0.005)
            self.assertGreater(self.server.request_slots._value, 0, "Completed request retained its worker slot")
        return result

    def test_ambiguous_framing_and_wrong_content_type_rejected_before_decode(self):
        bad_headers = [b"Content-Length: 2\r\nContent-Length: 2", b"Content-Length: +2",
                       b"Content-Length: 2\r\nTransfer-Encoding: chunked", b"Transfer-Encoding: chunked"]
        with patch("app.decode_audio") as decode:
            for headers in bad_headers:
                status, _ = self.raw(b"POST /embed HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\n" + headers + b"\r\n\r\n{}")
                self.assertEqual(status, 400)
            status, _ = self.raw(b"POST /embed HTTP/1.1\r\nHost: test\r\nContent-Length: 2\r\nContent-Type: text/plain\r\n\r\n{}")
            self.assertEqual(status, 415)
            decode.assert_not_called()

    def test_non_object_and_incomplete_json_never_reaches_decoder(self):
        with patch("app.decode_audio") as decode:
            for body in (b"[]", b"null", b"{{"):
                status, _ = self.raw(b"POST /embed HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
                self.assertEqual(status, 400)
            decode.assert_not_called()

    def test_worker_cap_and_absolute_read_deadline_release_capacity(self):
        with socket.create_connection(self.server.server_address, timeout=2) as slow:
            slow.sendall(b"POST /embed HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{")
            deadline = time.monotonic() + 1
            while self.server.request_slots._value and time.monotonic() < deadline:
                time.sleep(0.005)
            status, _ = self.raw(b"GET /health HTTP/1.0\r\n\r\n")
            self.assertEqual(status, 503)
            # Repeated input does not renew the absolute deadline.
            for _ in range(4):
                time.sleep(0.08)
                slow.sendall(b" ")
            time.sleep(0.3)
            slow.settimeout(1)
            self.assertEqual(slow.recv(4096), b"")
        status, body = self.raw(b"GET /health HTTP/1.0\r\n\r\n")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["modelReady"])

    def test_decoder_stdout_stderr_and_wall_clock_are_bounded(self):
        for code, options in [
            ("import sys;sys.stdout.buffer.write(b'x'*100000)", {"stdout_limit": 32}),
            ("import sys;sys.stderr.buffer.write(b'x'*100000)", {"stderr_limit": 32}),
            ("import time;time.sleep(5)", {"timeout": 0.1}),
            ("raise SystemExit(2)", {}),
        ]:
            start = time.monotonic()
            with self.assertRaisesRegex(ValueError, "audio_decode_failed"):
                bounded_process([sys.executable, "-c", code], b"input", **options)
            self.assertLess(time.monotonic() - start, 2)
        data = b"x" * 500000
        result = bounded_process([sys.executable, "-c", "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())"], data)
        self.assertEqual(result, data)

    def test_decoder_timeout_terminates_pipe_owning_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            pid_file = Path(directory) / "child-pid"
            child_code = "import time;time.sleep(30)"
            code = ("import subprocess,sys,pathlib,time;"
                    f"child=subprocess.Popen([sys.executable,'-c',{child_code!r}]);"
                    f"pathlib.Path({str(pid_file)!r}).write_text(str(child.pid));"
                    "time.sleep(30)")
            with self.assertRaisesRegex(ValueError, "audio_decode_failed"):
                bounded_process([sys.executable, "-c", code], b"input", timeout=0.4)
            pid = int(pid_file.read_text())
            status = Path(f"/proc/{pid}/status")

            def child_is_alive():
                try:
                    return "State:\tZ" not in status.read_text()
                except (FileNotFoundError, ProcessLookupError):
                    # A reaped child can disappear before open or during read.
                    return False

            deadline = time.monotonic() + 1
            while child_is_alive() and time.monotonic() < deadline:
                time.sleep(0.01)
            alive = child_is_alive()
            if alive:
                try:
                    os.kill(pid, 9)
                except ProcessLookupError:
                    pass
            self.assertFalse(alive, "Decoder descendants must not survive a timeout")

    def test_decoder_bootstrap_does_not_inherit_application_credentials(self):
        with patch.dict(os.environ, {"SPEAKER_PRIVATE_TEST_SECRET": "never-forward", "PYTHONPATH": "/untrusted"}):
            output = bounded_process([sys.executable, "-c", "import os,json;print(json.dumps(dict(os.environ)))"], b"input")
        environment = json.loads(output)
        self.assertNotIn("SPEAKER_PRIVATE_TEST_SECRET", environment)
        self.assertNotIn("PYTHONPATH", environment)


if __name__ == "__main__":
    unittest.main()
