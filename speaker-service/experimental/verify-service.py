"""Retain package ownership and verify every file of the complete experiment.

This is an integrity check, never a vulnerability finding exemption.
"""
import email.parser
import errno
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

MANIFEST = "usr/local/share/panthorium/service-files.json"
RUNTIME_FILES = {".dockerenv", "etc/hosts", "etc/hostname", "etc/resolv.conf", "etc/mtab"}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inventory(root):
    result = {}
    def inaccessible(error):
        raise error
    for directory, subdirs, names in os.walk(root, followlinks=False, onerror=inaccessible):
        parent = Path(directory)
        if parent == root:
            subdirs[:] = [name for name in subdirs if name not in {"dev", "proc", "sys"}]
        for name in [*subdirs, *names]:
            path = parent / name
            relative = path.relative_to(root).as_posix()
            if relative == MANIFEST or (root == Path("/") and relative in RUNTIME_FILES):
                continue
            mode = path.lstat().st_mode
            require(not mode & (stat.S_ISUID | stat.S_ISGID), "privileged_file: " + relative)
            try:
                require(not os.getxattr(path, "security.capability", follow_symlinks=False), "file_capability: " + relative)
            except OSError as error:
                if error.errno not in (errno.ENODATA, errno.ENOTSUP):
                    raise
            item = {"mode": stat.S_IMODE(mode)}
            if stat.S_ISLNK(mode):
                item["link"] = os.readlink(path)
            elif stat.S_ISREG(mode):
                item["sha256"] = sha256(path)
            else:
                require(stat.S_ISDIR(mode), "unexpected_file_type: " + relative)
                item["directory"] = True
            result[relative] = item
    return result


def prepare(root, control):
    root, control = Path(root).resolve(), Path(control).resolve()
    require(root != Path("/"), "explicit_build_root_required")
    status = root / "var/lib/dpkg/status"
    before = status.read_text()
    records = [email.parser.Parser().parsestr(part) for part in before.strip().split("\n\n")]
    require(not any(item["Package"] == "libsndfile1" for item in records), "duplicate_native_package")
    native = (control / "control").read_text()
    record = email.parser.Parser().parsestr(native)
    require(record["Package"] == "libsndfile1" and record["Architecture"] == "amd64", "unexpected_native_package")
    require(record["Version"] == "1.2.2-2+deb13u1+panthorium1", "unexpected_native_version")
    require(record["Depends"] == "libc6 (>= 2.39)", "unexpected_native_abi")
    status.write_text(before.rstrip() + "\n\nStatus: install ok installed\n" + native.rstrip() + "\n\n")
    (root / "var/lib/dpkg/info/libsndfile1:amd64.md5sums").write_bytes((control / "md5sums").read_bytes())
    # Verify every original Chisel path after adding the application. Nothing
    # from the trusted vendor slice may be overwritten by the overlay.
    entries = [json.loads(line) for line in (root / "var/lib/chisel/manifest.jsonl").read_text().splitlines()]
    for item in entries:
        if item.get("kind") != "path":
            continue
        path = root / item["path"].lstrip("/")
        require(stat.S_IMODE(path.lstat().st_mode) == int(item["mode"], 8), "vendor_mode_changed")
        if "link" in item:
            require(path.is_symlink() and os.readlink(path) == item["link"], "vendor_link_changed")
        elif path.is_file() and item["path"] != "/var/lib/chisel/manifest.wall":
            require(sha256(path) == item.get("final_sha256", item.get("sha256")), "vendor_file_changed")
    manifest = {"schemaVersion": 1, "files": inventory(root)}
    (root / MANIFEST).write_text(json.dumps(manifest, sort_keys=True) + "\n")
    print(json.dumps({"status": "PASS", "inventoriedPaths": len(manifest["files"])}))


def verify(root):
    root = Path(root).resolve()
    manifest_path = root / MANIFEST
    manifest_mode = manifest_path.lstat().st_mode
    require(stat.S_ISREG(manifest_mode) and stat.S_IMODE(manifest_mode) == 0o644, "invalid_inventory_file")
    manifest = json.loads(manifest_path.read_text())
    require(manifest["schemaVersion"] == 1, "unknown_inventory_schema")
    require(inventory(root) == manifest["files"], "service_files_changed")
    for name in ("sh", "bash", "mount", "nsenter", "infocmp", "perl", "getfacl", "setfacl", "chacl"):
        for directory in ("bin", "sbin", "usr/bin", "usr/sbin"):
            require(not os.path.lexists(root / directory / name), "administration_command_present")
    print(json.dumps({"status": "PASS", "inventoriedPaths": len(manifest["files"]), "privilegedFiles": 0}))


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--prepare":
        prepare(sys.argv[2], sys.argv[3])
    elif sys.argv[1:] == ["--verify"]:
        require(os.getuid() == 0, "read_only_root_inspector_required")
        verify("/")
    else:
        raise SystemExit("Use --prepare ROOT CONTROL or --verify")
