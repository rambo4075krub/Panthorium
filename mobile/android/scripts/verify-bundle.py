"""Inspect the built AAB and actual merged release manifest, without secrets."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from signing_preflight import signed_certificate_sha256

root = Path(__file__).resolve().parents[1] / "android"
bundle = root / "app/build/outputs/bundle/release/app-release.aab"
receipt = json.loads((root / "panthorium-release-info.json").read_text())
if not bundle.is_file():
    raise SystemExit("Release AAB was not produced")
with zipfile.ZipFile(bundle) as archive:
    names = archive.namelist()
    if not any(n.startswith("META-INF/") and n.endswith(".SF") for n in names) or not any(n.startswith("META-INF/") and n.endswith((".RSA", ".EC", ".DSA")) for n in names):
        raise SystemExit("AAB has no upload-key signature")
    config = json.loads(archive.read("base/assets/capacitor.config.json"))
    if config.get("android", {}).get("webContentsDebuggingEnabled") is not False or config.get("server", {}).get("cleartext") is not False or config.get("android", {}).get("allowMixedContent") is not False or config.get("server", {}).get("url"):
        raise SystemExit("Unsafe configuration inside AAB")
    bootstrap = archive.read("base/assets/public/panthorium-cloud-start.js").decode()
    if bootstrap != "'use strict';\nwindow.location.replace(" + json.dumps(receipt["startUrl"], separators=(",", ":")) + ");\n":
        raise SystemExit("AAB cloud origin differs from release receipt")
verified = subprocess.run(["jarsigner", "-J-Duser.language=en", "-J-Duser.country=US", "-verify", str(bundle)], capture_output=True, text=True, check=True)
if "jar verified." not in verified.stdout:
    raise SystemExit("AAB signature verification did not succeed")
manifests = list((root / "app/build/intermediates/merged_manifests/release").rglob("AndroidManifest.xml"))
if len(manifests) != 1:
    raise SystemExit("Expected exactly one merged release manifest; inspect the Gradle output layout")
manifest = ET.parse(manifests[0]).getroot()
android = "{http://schemas.android.com/apk/res/android}"
app = manifest.find("application")
sdk = manifest.find("uses-sdk")
if app is None or sdk is None or sdk.get(android + "targetSdkVersion") != "36":
    raise SystemExit("Merged release manifest does not target API 36")
if manifest.get("package") != "com.panthorium.browser" or manifest.get(android + "versionCode") != str(receipt["versionCode"]) or manifest.get(android + "versionName") != receipt["versionName"]:
    raise SystemExit("Merged manifest identity/version mismatch")
features = {entry.get(android + "name"): entry.get(android + "required") for entry in manifest.findall("uses-feature")}
for feature in ("android.hardware.camera", "android.hardware.camera.autofocus", "android.hardware.microphone"):
    if features.get(feature) != "false":
        raise SystemExit("Optional Browser hardware became required in the merged manifest: " + feature)
# Android defaults debuggable to false when the merged attribute is absent.
if app.get(android + "debuggable") not in (None, "false"):
    raise SystemExit("Merged release manifest enables debugging")
if any(app.get(android + attr) != "false" for attr in ("usesCleartextTraffic", "allowBackup")):
    raise SystemExit("Merged release manifest is not hardened")
digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
receipt.update({"aabSha256": digest, "uploadCertificateSha256": signed_certificate_sha256(bundle), "signatureVerified": True, "mergedManifestVerified": True})
(bundle.parent / "release-info.json").write_text(json.dumps(receipt, indent=2) + "\n")
(bundle.parent / "SHA256SUMS").write_text(digest + "  app-release.aab\n")
print("Signed release AAB, packaged cloud origin and merged Android manifest verified")
