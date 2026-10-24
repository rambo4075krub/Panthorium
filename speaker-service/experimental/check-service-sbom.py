"""Bind all installed package identities and custom libsndfile bytes to the image."""
import email.parser
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote

root = Path(sys.argv[1])
sbom = json.loads((root / "service-sbom.raw.syft.json").read_text())
image = json.loads((root / "image-inspect.json").read_text())[0]
assert sbom["source"]["metadata"]["imageID"] == image["Id"]
assert image["Os"] == "linux" and image["Architecture"] == "amd64"
assert image["Config"]["User"] == "10001:10001"
assert sbom["distro"]["id"] == "ubuntu" and sbom["distro"]["versionID"] == "24.04"
controls = [email.parser.Parser().parsestr(part) for part in (root / "dpkg-status.txt").read_text().strip().split("\n\n")]
vendor = {p["name"]: (p["version"], p["arch"]) for p in
          (json.loads(line) for line in (root / "chisel/manifest.jsonl").read_text().splitlines())
          if p.get("kind") == "package"}
def identity(p):
    source = re.fullmatch(r"([^ ]+)(?: \(([^)]+)\))?", p["Source"] or p["Package"])
    assert source
    if p["Package"] in vendor:
        assert p["Status"] is None and vendor[p["Package"]] == (p["Version"], p["Architecture"])
    else:
        assert p["Package"] == "libsndfile1" and p["Status"] == "install ok installed"
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
# This is a custom build from Debian sources, not an Ubuntu vendor backport.
# Preserve the dpkg entry AND expose its unchanged upstream version/CPE so
# changing the runtime distribution cannot conceal upstream parser findings.
purl = ("pkg:generic/libsndfile@" + lock["version"] + "?checksum=sha256%3A" + manifest["library"]["sha256"]
        + "&image_id=" + quote(image["Id"], safe=""))
artifact_id = hashlib.sha256(purl.encode()).hexdigest()[:16]
assert not any(item["id"] == artifact_id for item in sbom["artifacts"])
sbom["artifacts"].append({
    "id": artifact_id, "name": "libsndfile", "version": lock["version"], "type": "binary",
    "foundBy": "panthorium-verified-source-manifest",
    "locations": [{"path": manifest["library"]["path"], "accessPath": manifest["library"]["path"]}],
    "licenses": [{"value": lock["license"], "spdxExpression": lock["license"], "type": "declared", "urls": [], "locations": []}],
    "language": "", "purl": purl,
    "cpes": [{"cpe": "cpe:2.3:a:libsndfile_project:libsndfile:" + lock["version"] + ":*:*:*:*:*:*:*", "source": "declared"}],
})
sbom.setdefault("artifactRelationships", []).append({"parent": sbom["source"]["id"], "child": artifact_id, "type": "contains"})
(root / "service-sbom.with-native.syft.json").write_text(json.dumps(sbom, indent=2) + "\n")
print(json.dumps({"status": "PASS", "imageID": image["Id"], "retainedPackages": len(expected), "nativeSourceAndBytesVerified": True}))
