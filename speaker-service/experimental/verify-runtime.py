"""Check the candidate's unchanged Chisel files and complete package records.

This verifies an experimental dependency-only rootfs. It does not claim that
scanner findings are fixed, modify severity, filter packages or launch the app.
"""
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package_records(text):
    packages = {}
    for paragraph in text.strip().split("\n\n"):
        fields = {}
        for line in paragraph.splitlines():
            if line[:1].isspace():
                continue
            name, value = line.split(":", 1)
            require(name not in fields, "duplicate_package_field")
            fields[name] = value.strip()
        name = fields["Package"]
        require(name not in packages, "duplicate_package_record")
        packages[name] = (fields["Version"], fields["Architecture"])
    return packages


def verify(root):
    root = Path(root).resolve()
    wall_path = root / "var/lib/chisel/manifest.wall"
    jsonl_path = root / "var/lib/chisel/manifest.jsonl"
    status_path = root / "var/lib/dpkg/status"
    records = [json.loads(line) for line in jsonl_path.read_text().splitlines()]
    header = records[0]
    require(header.get("jsonwall") == "1.0" and header.get("schema") == "1.0", "unknown_manifest_schema")
    require(header.get("count") == len(records), "manifest_record_count_mismatch")
    package_entries = [entry for entry in records[1:] if entry.get("kind") == "package"]
    packages = {}
    for entry in package_entries:
        require(entry["name"] not in packages, "duplicate_manifest_package")
        require(re.fullmatch(r"[a-f0-9]{64}", entry["sha256"]), "invalid_archive_digest")
        packages[entry["name"]] = (entry["version"], entry["arch"])
    require(packages and packages == package_records(status_path.read_text()), "package_inventory_mismatch")
    forbidden_packages = {"acl", "libacl1", "libmount1", "mount", "util-linux", "bsdutils", "login", "perl-base", "bash", "dash", "apt", "dpkg", "coreutils"}
    require(not forbidden_packages.intersection(packages), "unexpected_administration_package")

    # Official Noble updates fix the two reviewed libc records and the zlib
    # record. Unknown version shapes require a reviewed policy update.
    libc = re.fullmatch(r"2\.39-0ubuntu8\.(\d+)", packages["libc6"][0])
    zlib = re.fullmatch(r"1:1\.3\.dfsg-3\.1ubuntu2\.(\d+)", packages["zlib1g"][0])
    require(libc and int(libc[1]) >= 9, "vendor_libc_update_required")
    require(zlib and int(zlib[1]) >= 3, "vendor_zlib_update_required")
    paths = set()
    regular_files = 0
    for entry in records[1:]:
        if entry.get("kind") != "path":
            continue
        name = entry["path"]
        require(name.startswith("/") and ".." not in Path(name).parts and name not in paths, "invalid_manifest_path")
        paths.add(name)
        target = root / name.lstrip("/")
        mode = target.lstat().st_mode
        require(stat.S_IMODE(mode) == int(entry["mode"], 8), "manifest_file_mode_changed: " + name)
        require(not mode & (stat.S_ISUID | stat.S_ISGID), "privileged_file_present: " + name)
        if "link" in entry:
            require(stat.S_ISLNK(mode) and os.readlink(target) == entry["link"], "manifest_link_changed: " + name)
        elif stat.S_ISREG(mode):
            regular_files += 1
            if name == "/var/lib/chisel/manifest.wall":
                continue  # The manifest intentionally has no self-hash.
            expected = entry.get("final_sha256", entry.get("sha256"))
            require(expected and digest(target.read_bytes()) == expected, "manifest_file_changed: " + name)
            require(target.stat().st_size == entry["size"], "manifest_file_size_changed: " + name)
        else:
            require(stat.S_ISDIR(mode), "unexpected_manifest_file_type: " + name)
        try:
            capability = os.getxattr(target, "security.capability", follow_symlinks=False)
            require(not capability, "file_capability_present: " + name)
        except OSError as error:
            if error.errno not in (errno.ENODATA, errno.ENOTSUP):
                raise
    for command in ("sh", "bash", "mount", "nsenter", "infocmp", "perl", "getfacl", "setfacl", "chacl"):
        for directory in ("bin", "sbin", "usr/bin", "usr/sbin"):
            require(not os.path.lexists(root / directory / command), "unexpected_command_present: " + command)
    if root == Path("/"):
        require(os.getuid() == 10001 and os.getgid() == 10001, "unexpected_runtime_identity")
        import ctypes
        import ssl
        import sqlite3
        import zlib as zlib_module
        require(zlib_module.decompress(zlib_module.compress(b"standard roundtrip")) == b"standard roundtrip", "zlib_roundtrip_failed")
        require(ssl.create_default_context().get_ca_certs(), "missing_ca_certificates")
        require(sqlite3.connect(":memory:").execute("select 1").fetchone() == (1,), "sqlite_roundtrip_failed")
        require(ctypes.CDLL("libgomp.so.1") and ctypes.CDLL("libstdc++.so.6"), "missing_numerical_runtime")
    return {"status": "PASS", "scope": "experimental dependency-only candidate", "packageCount": len(packages),
            "regularFilesVerified": regular_files, "libcVersion": packages["libc6"][0], "zlibVersion": packages["zlib1g"][0],
            "manifestSha256": digest(wall_path.read_bytes()), "decodedManifestSha256": digest(jsonl_path.read_bytes()),
            "dpkgStatusSha256": digest(status_path.read_bytes()), "packages": sorted(packages),
            "limitations": ["No application, model or custom native media libraries are included.", "Complete vulnerability scan is required; no findings are suppressed."]}


if __name__ == "__main__":
    require(len(sys.argv) in (1, 2), "usage: verify-runtime.py [ROOT]")
    print(json.dumps(verify(sys.argv[1] if len(sys.argv) == 2 else "/"), sort_keys=True))
