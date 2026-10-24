import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("service_inventory", Path(__file__).with_name("verify-service.py"))
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class ServiceInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.file = self.root / "app/example.py"
        self.file.parent.mkdir()
        self.file.write_text("original")
        self.manifest = self.root / service.MANIFEST
        self.manifest.parent.mkdir(parents=True)
        self.manifest.write_text(json.dumps({"schemaVersion": 1, "files": service.inventory(self.root)}))

    def test_unchanged_tree(self):
        service.verify(self.root)

    def test_modified_file(self):
        self.file.write_text("tampered")
        with self.assertRaisesRegex(RuntimeError, "service_files_changed"):
            service.verify(self.root)

    def test_extra_file(self):
        (self.root / "unexpected").write_text("payload")
        with self.assertRaisesRegex(RuntimeError, "service_files_changed"):
            service.verify(self.root)

    def test_removed_file(self):
        self.file.unlink()
        with self.assertRaisesRegex(RuntimeError, "service_files_changed"):
            service.verify(self.root)

    def test_symlink_replacement(self):
        self.file.unlink()
        self.file.symlink_to("/etc/passwd")
        with self.assertRaisesRegex(RuntimeError, "service_files_changed"):
            service.verify(self.root)

    def test_privileged_mode(self):
        os.chmod(self.file, 0o4755)
        with self.assertRaisesRegex(RuntimeError, "privileged_file"):
            service.verify(self.root)

    def test_privileged_inventory_mode(self):
        os.chmod(self.manifest, 0o4755)
        with self.assertRaisesRegex(RuntimeError, "invalid_inventory_file"):
            service.verify(self.root)


if __name__ == "__main__":
    unittest.main()
