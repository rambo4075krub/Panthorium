# Native security backports

The source locks retain the actual FFmpeg 9.0.2 release, upstream CPE and package
URL. The November 2026 patches are taken from the official FFmpeg repository.
Each patch records its upstream commit and any adaptation to the release branch.
Builds reject a changed archive, changed patch, fuzzy application or unexpected
patched source file. The encoder geometry and ProRes bounds patches adapt newer
upstream context to 9.0.2; the VVC patch changes only its surrounding context.

The build verifies that VAAPI, VDPAU, DXVA2/D3D11/D3D12, Vulkan and external LCEVC
are disabled. It retains the generated configuration and codec archive inventory
and rejects the corresponding vulnerable object files. These are reported as
`not_affected / vulnerable_code_not_present`, separately from patched code.
The supported CPU media paths remain available. Actual encoder regression tests,
the final image media matrix and speaker offline inference must pass.

`ffmpeg-backport-policy.json` pins independently inspected executable and
configuration hashes. A pending or changed build cannot generate a release VEX
until its bytes have been reviewed. The unused legacy Debian speaker profile
remains unreviewed; production uses the complete Noble speaker profile.

OpenSSL is built separately from its pinned 3.5.9 release with official 3.5 branch
backports, a local APK revision and the full upstream test suite. Its upstream
version is not relabelled as an unreleased 3.5.10. The release timestamp is fixed
for reproducible library hashes. The installed APK database, file ownership and
checksums are retained and checked against the actual ELF bytes.

Both scanners use the complete image inventory and the same vulnerability
database. The first report is unfiltered. VEX statements identify exact reviewed
packages, executables and image IDs. The independent comparison rejects missing
findings, severity changes, additional ignore rules or any unrelated exemption.
High and Critical findings still block the release. This mechanism is evidence
of repaired or absent code, not acceptance of an unresolved vulnerability.
