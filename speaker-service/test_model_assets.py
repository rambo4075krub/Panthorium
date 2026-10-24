"""No network or model execution: verify immutable download and tamper refusal."""

import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from model_assets import MODEL_FILES, download_model, read_lock, verify_model


class ModelAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.model = self.root / "model"
        self.contents = {name: ("safe fixture: " + name).encode() for name in MODEL_FILES}
        self.lock = self.root / "lock.json"
        self.lock.write_text(json.dumps({
            "repository": "speechbrain/spkrec-ecapa-voxceleb",
            "revision": "a" * 40,
            "files": {name: {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                      for name, data in self.contents.items()},
        }))

    def opener(self, url, timeout):
        self.assertIn("/resolve/" + "a" * 40 + "/", url)
        self.assertEqual(timeout, 60)
        return io.BytesIO(self.contents[url.rsplit("/", 1)[1]])

    def test_download_verifies_every_file_and_uses_fixed_revision(self):
        download_model(self.model, self.lock, opener=self.opener)
        verify_model(self.model, self.lock)
        self.assertEqual({item.name for item in self.model.iterdir()}, MODEL_FILES)

    def test_modified_yaml_and_checkpoint_are_rejected(self):
        download_model(self.model, self.lock, opener=self.opener)
        for name in ("hyperparams.yaml", "embedding_model.ckpt"):
            with self.subTest(name=name):
                path = self.model / name
                original = path.read_bytes()
                path.write_bytes(b"!" * len(original))
                with self.assertRaisesRegex(ValueError, "integrity_failed"):
                    verify_model(self.model, self.lock)
                path.write_bytes(original)

    def test_oversized_or_corrupt_download_never_becomes_model_file(self):
        for content in (b"x" * 1000, b"x"):
            with self.assertRaisesRegex(ValueError, "integrity_failed"):
                download_model(self.model, self.lock,
                               opener=lambda url, timeout: io.BytesIO(content))
            self.assertEqual(list(self.model.iterdir()), [])

    def test_missing_and_symlinked_files_are_rejected(self):
        download_model(self.model, self.lock, opener=self.opener)
        path = self.model / "hyperparams.yaml"
        path.unlink()
        with self.assertRaisesRegex(ValueError, "integrity_failed"):
            verify_model(self.model, self.lock)
        outside = self.root / "outside.yaml"
        outside.write_bytes(self.contents["hyperparams.yaml"])
        path.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "integrity_failed"):
            verify_model(self.model, self.lock)

    def test_floating_revision_rejected(self):
        lock = json.loads(self.lock.read_text())
        lock["revision"] = "main"
        self.lock.write_text(json.dumps(lock))
        with self.assertRaisesRegex(ValueError, "invalid_model_lock"):
            read_lock(self.lock)


if __name__ == "__main__":
    unittest.main()
