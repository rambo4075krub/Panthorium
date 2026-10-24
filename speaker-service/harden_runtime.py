"""Remove unused administration tools and privileged file attributes in an image.

Package metadata is deliberately retained. Live filesystem verification supplies
separate evidence for removed commands; it does not change scanner findings.
"""

import errno
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

REMOVED_COMMANDS = {
    "/usr/bin/infocmp": "ncurses-bin",
    "/usr/bin/nsenter": "util-linux",
}
UNUSED_ACL_COMMANDS = {"getfacl", "setfacl", "chacl"}
ABSENT_PERL_MODULES = {"Pod/Text.pm", "Pod/Text.pmc", "Archive/Tar.pm", "Archive/Tar.pmc"}
MANIFEST = "/usr/local/share/panthorium/runtime-surface.json"


def files_on_root(root):
    root = Path(root)
    device = root.stat().st_dev
    def inaccessible(error):
        raise error
    for directory, subdirs, names in os.walk(root, followlinks=False, onerror=inaccessible):
        current = Path(directory)
        kept = []
        for name in subdirs:
            path = current / name
            if path.is_symlink() or path.stat().st_dev != device:
                continue
            if path.relative_to(root).as_posix() in {"dev", "proc", "sys"}:
                continue
            kept.append(name)
        subdirs[:] = kept
        for name in names:
            path = current / name
            info = path.lstat()
            if info.st_dev == device and stat.S_ISREG(info.st_mode):
                yield path, info


def file_capability(path):
    try:
        return os.getxattr(path, "security.capability", follow_symlinks=False)
    except OSError as error:
        if error.errno in (errno.ENODATA, errno.ENOTSUP):
            return None
        raise


def package_owner(path):
    result = subprocess.run(["dpkg-query", "-S", path], check=True, capture_output=True, text=True)
    lines = result.stdout.strip().splitlines()
    if len(lines) != 1 or not lines[0].endswith(": " + path):
        raise RuntimeError("unexpected_command_package_owner")
    return lines[0][:-len(": " + path)].split(":")[0]


def harden_tree(root, owner_lookup=package_owner):
    root = Path(root)
    removed = []
    for absolute, owner in REMOVED_COMMANDS.items():
        path = root / absolute.lstrip("/")
        # Reject symlinks and unexpected packaging instead of deleting another file.
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or owner_lookup(absolute) != owner:
            raise RuntimeError("unexpected_command_package_owner")
        removed.append({"path": absolute, "package": owner,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        path.unlink()
    modes = []
    capabilities = []
    for path, info in files_on_root(root):
        absolute = "/" + path.relative_to(root).as_posix()
        if info.st_mode & (stat.S_ISUID | stat.S_ISGID):
            before = stat.S_IMODE(info.st_mode)
            after = before & ~(stat.S_ISUID | stat.S_ISGID)
            path.chmod(after)
            modes.append({"path": absolute, "before": oct(before), "after": oct(after)})
        if file_capability(path):
            os.removexattr(path, "security.capability", follow_symlinks=False)
            capabilities.append(absolute)
    manifest = {"schemaVersion": 1, "removedCommands": removed,
                "privilegedModesRemoved": modes, "fileCapabilitiesRemoved": capabilities}
    target = root / MANIFEST.lstrip("/")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(manifest, indent=2) + "\n")
    target.chmod(0o644)
    return manifest


def verify_tree(root):
    root = Path(root)
    manifest_path = root / MANIFEST.lstrip("/")
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("schemaVersion") != 1:
        raise RuntimeError("invalid_runtime_surface_manifest")
    recorded = manifest.get("removedCommands", [])
    if len(recorded) != len(REMOVED_COMMANDS) or {item.get("path"): item.get("package") for item in recorded} != REMOVED_COMMANDS:
        raise RuntimeError("invalid_runtime_surface_manifest")
    for item in recorded:
        if len(item.get("sha256", "")) != 64 or any(c not in "0123456789abcdef" for c in item["sha256"]):
            raise RuntimeError("invalid_runtime_surface_manifest")
        if os.path.lexists(root / item["path"].lstrip("/")):
            raise RuntimeError("unused_command_present")
    count = 0
    for path, info in files_on_root(root):
        count += 1
        if info.st_mode & (stat.S_ISUID | stat.S_ISGID) or file_capability(path):
            raise RuntimeError("privileged_file_present")
        relative = path.relative_to(root).as_posix()
        if any(relative == module or relative.endswith("/" + module) for module in ABSENT_PERL_MODULES):
            raise RuntimeError("unexpected_optional_perl_module")
        if path.name in UNUSED_ACL_COMMANDS and info.st_mode & 0o111:
            raise RuntimeError("unexpected_acl_command")
    return {"schemaVersion": 1, "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
            "regularFilesChecked": count, "removedCommandsAbsent": sorted(REMOVED_COMMANDS),
            "optionalPerlModulesAbsent": sorted(ABSENT_PERL_MODULES),
            "optionalAclCommandsAbsent": sorted(UNUSED_ACL_COMMANDS),
            "privilegedFileCount": 0}


def main():
    if sys.argv[1:] not in (["--apply-image-root"], ["--verify-image-root"]):
        raise SystemExit("usage: harden_runtime.py --apply-image-root|--verify-image-root")
    # Guard against accidentally applying this image-only tool to a host checkout.
    if not Path("/app/app.py").is_file() or not Path("/usr/local/share/panthorium/ffmpeg-source.json").is_file():
        raise RuntimeError("speaker_image_required")
    if sys.argv[1] == "--apply-image-root":
        if os.geteuid() != 0:
            raise RuntimeError("image_build_requires_root")
        harden_tree("/")
    print(json.dumps(verify_tree("/"), sort_keys=True))


if __name__ == "__main__":
    main()
