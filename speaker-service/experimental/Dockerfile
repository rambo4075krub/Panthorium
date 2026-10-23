# Experimental dependency-only candidate. This file is not used by deployment.
# Every Ubuntu package record is retained, including copyright-only slices.
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac AS candidate-builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git file python3 zstd && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl --fail --location --retry 3 --max-time 120 https://github.com/canonical/chisel/releases/download/v1.5.1/chisel_v1.5.1_linux_amd64.tar.gz -o chisel.tar.gz \
 && echo 'caa1f84ef144c3311d95ee464c1b72dd237e99055a8c58b791a5591abd42d9a1  chisel.tar.gz' | sha256sum --check --strict \
 && tar --no-same-owner -xzf chisel.tar.gz -C /usr/local/bin chisel
RUN curl --fail --location --retry 3 --max-time 120 https://raw.githubusercontent.com/canonical/rocks-toolbox/756bea37166f5ae224e5b3f6bfbfb00ad367c865/chisel-wrapper -o /usr/local/bin/chisel-wrapper \
 && echo '6186db1e6a9cfb157e3a256a1eff26ba144096b02d4249eba9ac5d6681a646b9  /usr/local/bin/chisel-wrapper' | sha256sum --check --strict \
 && chmod 0755 /usr/local/bin/chisel-wrapper
RUN git init /build/chisel-release \
 && git -C /build/chisel-release remote add origin https://github.com/canonical/chisel-releases.git \
 && git -C /build/chisel-release fetch --depth 1 origin f2600d3aa90123db6d44bb1441a99afc8b5847d9 \
 && git -C /build/chisel-release checkout --detach f2600d3aa90123db6d44bb1441a99afc8b5847d9 \
 && test "$(git -C /build/chisel-release rev-parse HEAD)" = f2600d3aa90123db6d44bb1441a99afc8b5847d9
RUN mkdir -p /rootfs/var/lib/dpkg \
 && chisel-wrapper --generate-dpkg-status /rootfs/var/lib/dpkg/status -- \
      --arch amd64 --release /build/chisel-release --root /rootfs \
      base-files_base base-files_release-info base-files_chisel ca-certificates_data \
      libc6_libs libgcc-s1_libs libstdc++6_libs libgomp1_libs openssl_config python3.12_standard \
 && zstd --decompress --stdout /rootfs/var/lib/chisel/manifest.wall > /rootfs/var/lib/chisel/manifest.jsonl
COPY speaker-service/experimental/verify-runtime.py /rootfs/usr/local/share/panthorium/experimental/verify-runtime.py
RUN python3 /rootfs/usr/local/share/panthorium/experimental/verify-runtime.py --generate-ownership /rootfs \
 && mkdir -p /rootfs/tmp \
 && chmod 1777 /rootfs/tmp

FROM scratch AS runtime-base
COPY --from=candidate-builder /rootfs/ /
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENTRYPOINT ["/usr/bin/python3.12"]
CMD ["/usr/local/share/panthorium/experimental/verify-runtime.py"]
