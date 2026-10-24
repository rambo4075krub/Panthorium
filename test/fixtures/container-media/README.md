# Synthetic media fixtures

These eleven small files were generated locally from FFmpeg `testsrc2` at
128×96 pixels and a 440Hz sine wave. They contain no downloaded content or user
data. `manifest.json` records each byte count and SHA256; the container smoke
test checks every fixture before using it.

Video fixtures are one second long. Source generation used Ubuntu FFmpeg
6.1.1 with one encoder thread, `testsrc2=size=128x96:rate=8:duration=1` and
`sine=frequency=440:sample_rate=48000:duration=1`. The formats cover:

- MP4 and MKV: H264/libx264 and AAC.
- WebM: separate VP8/libvpx and VP9/libvpx-vp9 fixtures with Opus.
- MOV: ProRes/prores_ks profile 0 and PCM16.
- MPEG: MPEG2 video at 25fps and MP2 audio.
- OGV: Theora at 25fps and Vorbis audio.
- 3GP: H264 and AAC at 16kHz.

PNG, JPEG and WebP each contain a single `testsrc2` frame. No input-device or
fixture-encoding libraries are required in the production image; it decodes
these committed bytes through the real application paths.
