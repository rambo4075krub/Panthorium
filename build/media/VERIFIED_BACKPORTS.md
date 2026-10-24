# Verified FFmpeg backport policy

`ffmpeg-backport-policy.json` records the independently reviewed source patch and
the actual `ffmpeg` and `ffprobe` executable hashes from the linked CI run. The
policy covers **only CVE-2026-107696**, for the recorded Linux amd64 backend and
speaker builds. It does not assert that FFmpeg or the surrounding image has no
other vulnerabilities.

The upstream version and CPE remain in the complete image inventory. Grype can
therefore discover every advisory, including this patched advisory. No package
is removed, no severity is changed, and no broad ignore rule is added.

## Required verification sequence

1. Inspect the built Docker image, inventory the complete image with Syft, and
   extract its source manifest and both actual executables.
2. `verify-container-sbom.js` verifies the manifest and actual executable bytes,
   preserves all inventory entries, and adds the explicit source-built package.
3. Run Grype 0.118.0 without VEX or ignores and retain the complete JSON result
   as `container-vulnerabilities.raw.json`. Configure `ignore: []` and
   `match-upstream-kernel-headers: true`; the latter disables Grype's implicit
   kernel-header ignore rules. Source-package CPE matching must remain enabled.
4. Run `node scripts/verified-ffmpeg-backport.js create "$EVIDENCE_DIR"`. This
   additionally requires the committed reviewed source/configuration lock,
   patch bytes, patched-source hash, operating system, architecture, and both
   independently reviewed executable hashes. It rejects mismatched evidence.
5. Scan the same inventory with the generated `ffmpeg-backport.vex.json`, the
   same scanner and database, and the existing High/Critical failure threshold.
   Retain the JSON result as `container-vulnerabilities.json`.
6. Always run `node scripts/verified-ffmpeg-backport.js verify "$EVIDENCE_DIR"`
   after that second scan, including when its vulnerability gate fails. This
   regenerates the proof from actual bytes, compares every complete finding
   across reports, and rejects missing, changed, or unrelated ignored matches.
   It requires a valid database with hash and age checks, rejects distribution
   overrides or disabled source-package matching, and compares scanner
   configuration across runs. It also exits unsuccessfully if any High/Critical
   finding remains.

All JSON evidence is retained even on failure. The verification record and
`scan-policy-audit.json` contain image identity and content digests. They are
unsigned CI verification records, not release signatures or independent build
attestations.

## Exact artifact scope

The synthetic package PURL includes both the actual executable SHA-256 and the
inspected Docker image ID:

```text
pkg:generic/ffmpeg@9.0.2?checksum=sha256%3A<executable-sha256>&image_id=sha256%3A<image-sha256>
```

The generated OpenVEX document contains exactly one `fixed` statement for that
complete PURL and the reviewed CVE. Grype's native package-product matching
checks the PURL qualifiers. This is necessary because a locally built image
does not necessarily have a repository digest; Grype's OCI product matching
does not use Docker's local image ID as a repository digest.

A real Grype 0.118.0 test against the complete speaker inventory confirmed that
the exact PURL suppressed one reviewed match, while changing either image ID
or executable hash suppressed none. The unrelated High findings continued to
fail the scanner. Unit tests also reject altered source/configuration, patch
bytes, executables, architecture, inventory, proof, database, severity, and
unrelated suppressed findings.

## Updating the policy

An executable rebuilt with different source, configuration, compiler, or build
inputs may have a different hash. Such a build fails closed until its actual
CI evidence and source changes receive independent review. Never update these
pins solely to make a failing scan pass, and never trust a manifest's claim of
a fix without validating the actual bytes. Image IDs are captured per build;
they are not fixed to an older image. Other architectures and other CVEs need
their own reviewed evidence and cannot reuse this policy.

The scanner version is also fixed because its matching and report behavior
are part of the verification. Revalidate positive and negative qualifier
matching before changing it.

## Primary references

- [Grype vulnerability filtering](https://oss.anchore.com/docs/guides/vulnerability/filter-results/)
- [Grype configuration reference](https://oss.anchore.com/docs/reference/grype/configuration/)
- [Grype 0.118.0 OpenVEX implementation](https://github.com/anchore/grype/blob/v0.118.0/grype/vex/openvex/implementation.go)
- [Pinned scan-action inputs](https://github.com/anchore/scan-action/blob/27805bf3b4e84b4a5c980df22ed233c00390a439/action.yml)
