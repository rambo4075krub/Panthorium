# Backend native security packages

Build GLib 2.90.1 and Expat 2.10.0 from pinned upstream release archives.
GLib 2.90 includes the upstream D-Bus XML fix for CVE-2026-58016; Expat 2.10
fixes CVE-2026-113351, CVE-2026-115506, CVE-2026-117610 and CVE-2026-118370.
The GLib archive SHA-256 is published by GNOME; Expat's matches its GitHub
release asset digest. APKBUILD verifies pinned SHA-512 before extraction.

Install the locally signed packages with their real upstream versions and
dependency metadata. Keep every package in the ordinary full-image SBOM;
no vulnerability exception or scanner filter is added. The transient private
APK key stays in the build stage. Expat runs its upstream test suite; the final
backend image runs the existing offline media/caption test and strict scanner.

These are native runtime changes. Install and verify the rebuilt media image
on the notebook before updating its runtime compatibility fingerprint.
