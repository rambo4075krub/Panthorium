"""Bind all installed package identities and custom libsndfile bytes to the image."""
import email.parser
import hashlib
import json
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
sbom = json.loads((root / "service-sbom.raw.syft.json").read_text())
image = json.loads((root / "image-inspect.json").read_text())[0]
assert sbom["source"]["metadata"]["imageID"] == image["Id"]
assert image["Os"] == "linux" and image["Architecture"] == "amd64"
assert image["Config"]["User"] == "10001:10001"
assert sbom["distro"]["id"] == "ubuntu" and sbom["distro"]["versionID"] == "24.04"
controls = [email.parser.Parser().parsestr(part) for part in (root / "dpkg-status.txt").read_text().strip().split("\n\n")]
def identity(p):
    source = re.fullmatch(r"([^ ]+)(?: \(([^)]+)\))?", p["Source"] or p["Package"])
    assert source and p["Status"] == "install ok installed"
    return (p["Package"], p["Version"], p["Architecture"], source[1], source[2] or p["Version"])
expected = {identity(p) for p in controls}
assert expected and all(all(row) for row in expected)
actual = {(p["name"], p["version"], p["metadata"]["architecture"], p["metadata"].get("source") or p["name"], p["metadata"].get("sourceVersion") or p["version"]) for p in sbom["artifacts"] if p["type"] == "deb"}
assert expected == actual, "Scanner inventory differs from retained package metadata"
lock = json.loads(Path("build/libsndfile/source.lock.json").read_text())
manifest = json.loads((root / "libsndfile-source.json").read_text())
assert all(manifest[key] == value for key, value in lock.items())
library = (root / "libsndfile.so.1.0.37").read_bytes()
assert library[:4] == b"\x7fELF"
assert hashlib.sha256(library).hexdigest() == manifest["library"]["sha256"]
assert ("libsndfile1", lock["debianPackageVersion"], "amd64", "libsndfile", lock["debianPackageVersion"]) in actual
print(json.dumps({"status": "PASS", "imageID": image["Id"], "retainedPackages": len(expected), "nativeSourceAndBytesVerified": True}))
