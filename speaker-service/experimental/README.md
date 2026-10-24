# Speaker runtime base experiment

The `runtime-base` Ubuntu 24.04 target contains no application, model, or
custom media libraries. The separate `runtime-service` target adds the complete
application, verified model snapshot, and native media builds compiled on Noble.
Neither target replaces the production Dockerfile or its release gates.

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

The complete service uses Python 3.12, the same pinned CPU model dependencies,
the original hash-verified libsndfile sources/backports, and Ubuntu's patched
zlib package. Every vendor file remains unchanged. The libsndfile package keeps
its custom source identity, version, copyright, and ownership records. The final
SBOM also adds libsndfile's unchanged upstream version and CPE alongside its
package record, so the distro change cannot hide upstream parser advisories. The
native artifact is bound to the inspected image and its actual ELF hash. The final
service additionally records every file, link, and mode and checks them with a
read-only root inspector. No administration shell or package manager is shipped.

The complete-service workflow runs the nine-format decoder matrix and offline
192-dimension model inference, retains all package identities and native bytes,
and performs a strict scan with no exclusions or VEX exemptions. A successful
build or base-only scan is insufficient for release. Full-image findings, ABI
compatibility, model behavior, and staging validation must all be reviewed before
the production Dockerfile can change.
