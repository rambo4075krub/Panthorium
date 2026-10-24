# Reviewed zlib backport

This builds the exact Debian `1:1.3.dfsg+really1.3.1-1` source baseline with
the input-state reset from upstream commit
`df84af25dc1942490e1d1c899a07619152a46148` for CVE-2026-85091.
The local patch retains the older `gz_comp` failure test and return value;
it adds the same `avail_in = 0` and `next_in = state->in` assignments.
The unmodified upstream patch is included for comparison.

The Debian source descriptor, both archives, both patch files, and the complete
writer source before and after patching are hash-pinned. The original Debian
quilt series is preserved and checked (empty in this baseline). Recording the
signed descriptor's hash does not claim independent OpenPGP verification.
Patch application allows no fuzz. Ordinary upstream `make check` must pass for
both the static and shared library. The exact versioned export list and SONAME
must match the reviewed Debian amd64 library. The error-recovery change was
reviewed statically; no custom vulnerability reproducer or fixture is run.

Run `node build/zlib/build.mjs` inside the Debian amd64 build stage with
`gcc`, `make`, `binutils`, `patch`, `dpkg-dev`, and Node available. Output is
`/opt/zlib/zlib1g-panthorium.deb` and `/opt/zlib/zlib-source.json`.

The package uses the explicit local revision
`1:1.3.dfsg+really1.3.1-1+panthorium1` and an equally explicit modified source
version. The original source baseline is separately recorded in the manifest.
It replaces the distribution package at the same shared-library path, retaining
the runtime SONAME and dependency metadata. Headers, static archives, test
programs, and additional binaries are not included in the runtime package.
The manifest binds the resulting ELF hash to its source and patch pins.

The package remains visible to normal Debian vulnerability matching. The local
revision does not claim that this is a later upstream release, and this builder
does not suppress scanner results. Any separate verification must bind the
actual installed ELF to the image identity and preserve the unfiltered scan.

References:

- https://security-tracker.debian.org/tracker/CVE-2026-85091
- https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148
- https://sources.debian.org/src/zlib/1%3A1.3.dfsg%2Breally1.3.1-1/
