# Desktop build dependency overrides

The release audit includes development and build dependencies. Do not omit them or suppress the audit to publish a release.

`node-gyp@12.4.0` brings in `picomatch` through `tinyglobby`. The published picomatch versions are affected by [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), with no published fix available when this change was prepared.

For this exact node-gyp version, the override resolves its `tinyglobby` dependency to the maintained `glob@14.0.2` package. The existing compiler and node-gyp version remain unchanged. Its only calls to this dependency are the named async `glob` function for `build/*.sln` and `build/*.mk`, both with directory expansion disabled. The replacement supports those discovery operations. This is a scoped compatibility override, not a general replacement for every tinyglobby API; review it when updating node-gyp.

The newer minimatch dependency lines are pinned to `11.0.1` for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Legacy minimatch 3/5 consumers retain their existing API. Glob 14.0.2 also includes the fix for [GHSA-3g3m-2fjr-6pw4](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4). The project continues to use Node 24.22.3.

`node test/desktop-build-dependencies.js` exercises the resolved matching APIs against temporary files. On Windows it additionally runs node-gyp's actual solution discovery, Makefile fallback and missing-file handling, substituting only the compiler process. The native security workflow then builds and inspects the real Windows application. All desktop release targets must build before installers are published.

Run `npm audit --audit-level=high --ignore-scripts` against the committed lockfile. Restore the normal transitive dependency when a reviewed upstream release removes the affected dependency or provides the fix.
