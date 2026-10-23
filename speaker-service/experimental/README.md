# Speaker runtime base experiment

This dependency-only Ubuntu 24.04 candidate contains no application, model, or
custom media libraries. It is not a deployment image and does not replace the
production Dockerfile or its release gates.

Chisel resolves security packages through signed Ubuntu archive metadata. The
image retains its unchanged manifest and every original package control record.
After checking retained files against the manifest's SHA-256, permissions, size,
and links, the build generates dpkg ownership records from the package-to-slice
mapping. MD5 is only the dpkg record format; SHA-256 remains the integrity check.
Runtime verification reconstructs and compares all ownership records exactly.

Complete ownership associates vendor-managed binaries with their original
packages and vendor security feed. No package versions or severities are changed
and no scanner exclusions are added. A vendor-feed scan without High or Critical
findings does not establish that every upstream advisory is fixed: priorities
and evaluation status can differ. Unresolved findings still require review.

CI retains the complete SBOM, raw report, manifest, package records, ownership
records, and immutable image identity. Python and native-library smoke checks run
as UID/GID 10001 with no network, capabilities, or new privileges and a read-only
filesystem. A separate read-only root inspector checks all filesystem paths,
including protected directories; it does not start the application. Ownership
records are archived intact so their standard colon-containing names can be
retained by the artifact service.

A full migration still requires coherent native media builds, all
application dependencies, exact-image scans, decoder/model tests, and staging
validation before production release.
