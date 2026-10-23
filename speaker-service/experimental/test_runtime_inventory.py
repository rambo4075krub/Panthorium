"""Synthetic integrity fixtures; no vulnerable-library execution is involved."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("runtime_inventory", Path(__file__).with_name("verify-runtime.py"))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class RuntimeInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("var/lib/chisel", "var/lib/dpkg", "usr/lib", "etc"):
            (self.root / name).mkdir(parents=True, exist_ok=True)
        self.packages = [
            {"kind": "package", "name": name, "version": version, "arch": "amd64", "sha256": "a" * 64}
            for name, version in [("libc6", "2.39-0ubuntu8.9"), ("zlib1g", "1:1.3.dfsg-3.1ubuntu2.3")]
        ]
        self.payload = self.root / "usr/lib/example"
        self.payload.write_bytes(b"vendor bytes")
        self.payload.chmod(0o644)
        self.wall = self.root / "var/lib/chisel/manifest.wall"
        self.wall.write_bytes(b"manifest fixture")
        self.wall.chmod(0o644)
        self.paths = [
            {"kind": "path", "path": "/usr/lib/example", "mode": "0644", "size": self.payload.stat().st_size,
             "sha256": inventory.digest(self.payload.read_bytes()), "slices": ["libc6_libs"]},
            {"kind": "path", "path": "/var/lib/chisel/manifest.wall", "mode": "0644"},
        ]
        (self.root / "var/lib/dpkg/status").write_text("\n\n".join(
            f"Package: {p['name']}\nVersion: {p['version']}\nArchitecture: {p['arch']}" for p in self.packages
        ) + "\n")
        self.write_manifest()

    def write_manifest(self):
        rows = [{"jsonwall": "1.0", "schema": "1.0", "count": 1 + len(self.packages) + len(self.paths)},
                *self.packages, *self.paths]
        (self.root / "var/lib/chisel/manifest.jsonl").write_text("\n".join(json.dumps(row) for row in rows) + "\n")

    def generate(self):
        return inventory.verify(self.root, generate_ownership=True)

    def test_roundtrip_preserves_vendor_inventory(self):
        original = (self.root / "var/lib/dpkg/status").read_bytes()
        proof = self.generate()
        self.assertEqual(proof, inventory.verify(self.root))
        self.assertEqual(proof["ownershipFileCount"], 2)
        self.assertEqual(proof["ownedRegularFileCount"], 1)
        self.assertEqual((self.root / "var/lib/dpkg/status").read_bytes(), original)

    def test_changed_vendor_bytes_fail_before_ownership(self):
        self.payload.write_bytes(b"tampered")
        with self.assertRaisesRegex(RuntimeError, "manifest_file_changed"):
            self.generate()
        self.assertFalse((self.root / "var/lib/dpkg/info").exists())

    def test_empty_vendor_file_with_omitted_size(self):
        self.payload.write_bytes(b"")
        self.paths[0].pop("size")
        self.paths[0]["sha256"] = inventory.digest(b"")
        self.write_manifest()
        self.assertEqual(self.generate()["ownedRegularFileCount"], 1)

    def test_omitted_size_does_not_accept_nonempty_file(self):
        self.paths[0].pop("size")
        self.write_manifest()
        with self.assertRaisesRegex(RuntimeError, "manifest_file_size_changed"):
            self.generate()

    def test_unknown_owner_fails(self):
        self.paths[0]["slices"] = ["invented_libs"]
        self.write_manifest()
        with self.assertRaisesRegex(RuntimeError, "unknown_file_owner"):
            self.generate()

    def test_rewritten_vendor_version_fails(self):
        self.packages[0]["version"] = "2.39-0ubuntu8.99"
        self.write_manifest()
        with self.assertRaisesRegex(RuntimeError, "package_inventory_mismatch"):
            self.generate()

    def test_forged_ownership_fails_and_is_not_overwritten(self):
        self.generate()
        target = self.root / "var/lib/dpkg/info/libc6:amd64.md5sums"
        target.write_text("forged\n")
        with self.assertRaisesRegex(RuntimeError, "ownership_metadata_mismatch"):
            self.generate()
        self.assertEqual(target.read_text(), "forged\n")

    def test_ownership_symlink_fails(self):
        self.generate()
        target = self.root / "var/lib/dpkg/info/libc6:amd64.md5sums"
        target.unlink()
        target.symlink_to(self.payload)
        with self.assertRaisesRegex(RuntimeError, "invalid_ownership_metadata_type"):
            self.generate()

    def test_uninventoried_file_fails(self):
        (self.root / "etc/unowned").write_text("extra")
        with self.assertRaisesRegex(RuntimeError, "uninventoried_file_present"):
            self.generate()

    def test_mtab_is_not_a_build_exception(self):
        (self.root / "etc/mtab").symlink_to("/proc/mounts")
        with self.assertRaisesRegex(RuntimeError, "uninventoried_file_present"):
            self.generate()

    def test_generation_never_targets_running_root(self):
        with self.assertRaisesRegex(RuntimeError, "ownership_generation_requires_explicit_build_root"):
            inventory.verify("/", generate_ownership=True)

    def test_image_inspector_never_accepts_a_build_root(self):
        with self.assertRaisesRegex(RuntimeError, "image_inspection_requires_root"):
            inventory.verify(self.root, inspect_image=True)


if __name__ == "__main__":
    unittest.main()
