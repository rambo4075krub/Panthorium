# Reviewed FFmpeg build

The backend builds FFmpeg 9.0.2 from the upstream release commit, plus the
upstream fix for CVE-2026-107696. The source archive, patch and patched source
file have SHA256 pins in `ffmpeg-source.lock.json`. The release's signed tag
object is recorded there; its official GitHub tag API reported a valid signature
when the pin was reviewed on 2026-10-23. The release commit is
`946fcce07b6dcd0331c8cc609192aeff5e1924f8`.

`build-ffmpeg.mjs` checks source and patch bytes before executing configure or
make, applies the patch with zero fuzz, and checks the resulting RTSP source
hash. It records the real upstream version **9.0.2**, configuration and final
executable hashes in `/usr/local/share/panthorium/ffmpeg-source.json`. Source
identity, the patch and its license are retained in the image. Syft's binary
classifier can identify FFmpeg directly; CI also merges the independently
verified source identity into the complete image SBOM. No version inflation,
scanner exclusion or vulnerability exception is part of this build.

The runtime uses native CPU codecs and filters, with only libx264, libopus,
libass and zlib enabled as external media libraries. Network protocols, capture
devices and hardware accelerators are disabled. File and pipe are the only
protocols. Internal FFmpeg libraries are linked into the executables; external
libraries remain distro packages visible to the image scanner. English/Thai
caption fonts are installed. cJSON, librist and ALSA are not needed.

The final image must pass:

```sh
docker build --pull -t panthorium-media-check .
docker run --rm --network none --cap-drop ALL \
  --security-opt no-new-privileges --entrypoint node \
  panthorium-media-check test/container-media-smoke.js
```

The smoke test verifies provenance, binary hashes, native links, nonroot runtime,
protocol restrictions and actual application rendering/transcription/image edit
methods. Its small fixtures are synthetic and contain no user data. Host-only
functional preflight is `node test/container-media-smoke.js --allow-host-ffmpeg`;
that mode cannot pass in CI and does not validate the target image.

Any future source/patch/configuration change must refresh reviewed pins and run
the image tests and full image scan again. If a generic CPE match still flags the
backported RTSP fix, preserve the finding and prepare image-digest-specific
evidence for review; do not change the version or suppress other findings.

Upstream evidence:

- https://api.github.com/repos/FFmpeg/FFmpeg/git/tags/ce8f11b9fac4cd7ccfb41ca7c01bc17f5cda8cc3
- https://code.ffmpeg.org/FFmpeg/FFmpeg/pulls/24902
- https://code.ffmpeg.org/FFmpeg/FFmpeg/commit/f5d4fd186c68913240c4f6e9cda98443e1518b34
