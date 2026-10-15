# Panthorium sapphire branding

The approved artwork is `panthorium-logo-sapphire.png` (1254 × 1254 RGBA).
It is the original approved image, with smooth light/dark sapphire faces and an edge glow.
Do not redraw it or approximate it with a different vector mark.

```html
<img class="panthorium-logo" src="/panthorium-logo-sapphire.png"
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

`panthorium-logo.svg` and `panthorium-logo-mark.svg` are self-contained SVG
containers with the exact PNG embedded as a data URI. They are not vector
tracings. Their 68% safe inset preserves the existing circular avatar and boot
frame spacing. Keep them generated from the same PNG when artwork changes.

`workspace-ui.js` uses `PanthoriumBranding.logoUrl` for every shared window
header, including newly created and externally registered windows. Application
icons in the launcher still identify their respective tools. The shared avatar,
Start, boot, download, security, chat, favicon, PWA and Android fallback surfaces
use the same artwork. `design/logo-usage.html` is a working usage example.

Android native resources include the same approved image with safe spacing for
launcher masks. Desktop installers render the self-contained SVG. Changes to
installed native launcher icons require installing a newly built application;
the hosted application pages receive the new branding on reload.

For a new branded circular frame, use `data-panthorium-logo-frame` and load
`branding.js`. For new application windows, use `PanthoriumWindow.create()` or
the existing external-window registration API; the shared workspace supplies
the brand automatically.
