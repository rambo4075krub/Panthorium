# Reviewed libsndfile build

This builds libsndfile from the exact Debian `1.2.2-2+deb13u1` source archives.
Every existing Debian patch is applied in its original order before either
additional parser patch. The source archive and Debian patch archive hashes
match the official `.dsc`; recording that signed descriptor does not claim an
independent OpenPGP signature verification.

The isolated Debian builder requires `build-essential`, `cmake`, `patch`,
`python3`, and `ca-certificates`. Upstream uses Python to generate the shared
library export list; no Python packages or optional codec headers are needed.

Additional fixes are pinned to their exact reviewed source commits:

- IMA ADPCM frame arithmetic: upstream PR 1123 head
  `cdadf9a65fdc1f28da9d235eb443d5f5e57010d2`. The Debian advisory's linked merge
  commit has different source changes; this build uses the actual two casts
  in the reviewed PR, never the unrelated SDS change.
- MAT4 dimension validation and bounded size arithmetic: proposed upstream
  PR 1167 head `c45de8ed8b1d98ca532e94a00dbfb0e49eb9bb8a`. This PR was not yet
  merged when reviewed. It is a reviewed backport, not a new upstream release.

The build applies patches with zero fuzz and verifies the resulting complete
source file hashes. Bounded synthetic regression tests exercise the patched
parser arithmetic and valid MAT4 audio with and without UndefinedBehaviorSanitizer.
They use in-memory virtual streams, never allocate the claimed large file size,
and do not make network requests. Sanitizer libraries do not enter the package.
The ordinary upstream CTest suite is also run in a separate static test build.

The output is an ordinary Debian package with an honest local build revision,
`1.2.2-2+deb13u1+panthorium1`, for both the package and its modified source.
The original Debian source name and baseline version remain in the manifest. Install
it instead of the distribution package, so the old vulnerable library is not
left alongside the replacement. Only the shared library, license information,
source provenance, and reviewed patches are packaged. External codecs and
command-line programs are disabled because the endpoint decodes audio with its
separately hardened FFmpeg executable.

`/usr/local/share/panthorium/libsndfile-source.json` records all source pins,
the patch baseline, the exact installed ELF path/hash, and the build's tests.
The package remains visible to normal Debian vulnerability matching; neither
the version nor scanner rules claim these backports are an upstream release.
Any reviewed applicability exception must bind the actual installed ELF and
image identity, and must preserve the unfiltered scan result.

References:

- https://packages.debian.org/trixie/libsndfile1
- https://github.com/libsndfile/libsndfile/pull/1123
- https://github.com/libsndfile/libsndfile/pull/1167
- https://security-tracker.debian.org/tracker/CVE-2026-37555
- https://security-tracker.debian.org/tracker/CVE-2026-88372
