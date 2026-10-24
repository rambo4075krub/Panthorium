import errno
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

from harden_runtime import harden_tree, verify_tree


class ImageHardeningTests(unittest.TestCase):
    def make_root(self, directory):
        root = Path(directory)
        (root / "usr/bin").mkdir(parents=True)
        for name in ("infocmp", "nsenter", "privileged-helper"):
            path = root / "usr/bin" / name
            path.write_bytes(b"synthetic executable fixture")
            path.chmod(0o6755)
        return root

    def test_removes_commands_and_privileges_preserving_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            inventory = root / "var/lib/dpkg/status"
            inventory.parent.mkdir(parents=True)
            inventory.write_bytes(b"package inventory must remain byte-identical")
            harden_tree(root, lambda p: "ncurses-bin" if p.endswith("infocmp") else "util-linux")
            proof = verify_tree(root)
            self.assertEqual(proof["privilegedFileCount"], 0)
            self.assertFalse((root / "usr/bin/infocmp").exists())
            self.assertFalse((root / "usr/bin/nsenter").exists())
            self.assertEqual(stat.S_IMODE((root / "usr/bin/privileged-helper").stat().st_mode), 0o755)
            self.assertEqual(inventory.read_bytes(), b"package inventory must remain byte-identical")
            (root / "usr/bin/privileged-helper").chmod(0o4755)
            with self.assertRaisesRegex(RuntimeError, "privileged_file_present"):
                verify_tree(root)

    def test_restored_command_and_optional_module_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            harden_tree(root, lambda p: "ncurses-bin" if p.endswith("infocmp") else "util-linux")
            (root / "usr/bin/nsenter").symlink_to("/nonexistent")
            with self.assertRaisesRegex(RuntimeError, "unused_command_present"):
                verify_tree(root)
            (root / "usr/bin/nsenter").unlink()
            module = root / "usr/share/perl5/Pod/Text.pm"
            module.parent.mkdir(parents=True)
            module.write_text("package Pod::Text;")
            with self.assertRaisesRegex(RuntimeError, "unexpected_optional_perl_module"):
                verify_tree(root)

    def test_unexpected_package_does_not_delete_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            with self.assertRaisesRegex(RuntimeError, "unexpected_command_package_owner"):
                harden_tree(root, lambda _p: "unexpected-owner")
            self.assertTrue((root / "usr/bin/infocmp").exists())


@unittest.skipUnless(sys.platform == "linux", "Linux process privilege boundary")
class RuntimeGuardTests(unittest.TestCase):
    def test_no_new_privileges_inherited_by_exec(self):
        # A child process isolates the irreversible flag from the test runner.
        source = str(Path(__file__).resolve().parent)
        script = ("import sys,subprocess,json;sys.path.insert(0," + repr(source) + ");"
                  "from runtime_guard import harden_process;harden_process();"
                  "print(subprocess.check_output([sys.executable,'-c',"
                  "'import pathlib;print(next(x for x in pathlib.Path(\"/proc/self/status\").read_text().splitlines() if x.startswith(\"NoNewPrivs:\")))'],text=True))")
        kwargs = {}
        if os.getuid() == 0:
            kwargs = {"user": 65534, "group": 65534, "extra_groups": []}
        try:
            result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, **kwargs)
        except PermissionError as error:
            if os.getuid() == 0 and error.errno == errno.EPERM:
                self.skipTest("Host root cannot drop identity; actual nonroot CI must verify inheritance")
            raise
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("NoNewPrivs:\t1", result.stdout)

    @unittest.skipUnless(os.getuid() == 0, "Root-only rejection fixture")
    def test_root_launch_rejected(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("runtime_guard.py")), "--check"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("runtime_requires_unprivileged_user", result.stderr)


if __name__ == "__main__":
    unittest.main()
