# Application updates

Merging to `main` starts the existing guarded production deployment. Once the
new revision is serving traffic, ordinary browsers, PWAs and native Browser
shells check `/app-release.json` every 15 seconds while visible and immediately
on focus, reconnect or returning from a hidden tab. The baseline is embedded
in the HTML actually displayed. Discovering a revision never advances that
baseline without loading the new page. Failed checks do not claim success.

HTML, scripts and update metadata use `no-store`. Reloads preserve account
storage. Edits in focused form controls defer automatic reload and expose an
update notice; manual reload requires confirmation if those edits remain.
Editors may call `PanthoriumUpdates.markSaved(element)` when a save completes.
A one-minute guard prevents repeated automatic reloads during a mixed rollout.
The service worker hands reload decisions to modern clients and migrates older
clients once. Both shell and push registration use the same `/sw.js` URL.

Installed Browser shells show a permanent **อัพเดท** label in the Start Menu,
with status in the same button. Desktop binaries use their signed manifest
status; current binaries display **เป็นเวอร์ชั่นล่าสุดแล้ว**. Available binaries
can be downloaded and installed through that button, with a download-page
fallback on failure. Android opens the official Play listing for
`com.panthorium.browser`. Older APKs lack a native version/Play-update bridge,
so their binary status is explicitly checked in Play, never falsely declared
current by comparing only the web version.

Native desktop releases now build from `main` when native/build inputs change.
A shared workflow-derived version is assigned to every installer and signed
manifest, within Windows numeric version limits. The legacy `staging` release
asset URL is retained so existing installed updaters can discover the migration.
New installers open `https://panthorium.net`; existing installations pointing
at staging need this wrapper update once. No credentials are migrated between
the isolated staging and production origins.

New desktop wrappers check for native releases at startup and every minute.
Downloads are size-bounded and signature/checksum verified, including cached
installers. Postponing a version suppresses repeat automatic downloads/dialogs;
the menu can retry it. Windows/Linux restart confirmation and the macOS DMG
installation flow remain. Android binary releases still use Play's review,
distribution and device update controls. A source merge cannot silently replace
every Android/macOS binary; normal cloud interface updates do not require a new
APK or desktop installer.
