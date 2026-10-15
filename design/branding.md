# Panthorium original system branding

`panthorium-logo.svg` and `panthorium-logo-mark.svg` are the original orange
vector assets restored byte-for-byte from commit `72f5ffa`, before the sapphire
branding change. Use these system assets; do not redraw the uploaded source
image or substitute the rejected sapphire artwork. The original colors and
68% inset are part of these SVGs.

```html
<img class="panthorium-logo"
     src="/panthorium-logo.svg?v=original-orange-20261015"
     alt="Panthorium" draggable="false">
```

```css
.panthorium-logo {
  display: block;
  width: 40px;
  height: 40px;
  object-fit: contain;
  flex-shrink: 0;
}
```

`panthorium-logo.png` is a 512 × 512 transparent rendering of the original SVG
for PNG-only consumers. The old `panthorium-logo-sapphire.png` URLs at the root
and in the Android fallback intentionally serve the same orange PNG so older
clients cannot fetch the rejected artwork at those paths.

`workspace-ui.js` uses `PanthoriumBranding.logoUrl` for every shared window
header, including newly created and externally registered windows. The avatar,
Start, boot, download, security, chat, favicon, PWA and Android fallback surfaces
use the original artwork. `design/logo-usage.html` is a working usage example.

Android native vector resources are also restored from `72f5ffa`. Desktop
installers render the original SVG. Changes to installed native launcher icons
require installing a newly built application; hosted pages receive the new
branding on reload. Asset versions and the service-worker cache are updated
with this restoration.

For a new branded circular frame, use `data-panthorium-logo-frame` and load
`branding.js`. For new application windows, use `PanthoriumWindow.create()` or
the existing external-window registration API; the shared workspace supplies
the brand automatically.
