# Panthorium window appearance

`window-reference.html` is the user-approved visual source, preserved verbatim.
`../window-theme-ui.js` owns production window tokens and presentation. It is loaded
by the server for both user and admin shells. Existing `.window` and registered
`.panthorium-managed-window` roots inherit the theme; newly created windows do too.

New applications must use `PanthoriumWindowManager.create` / the existing
`createWindow` factory, or `PanthoriumWindowManager.registerExternal`. Standalone
embedded windows can opt in with `data-panthorium-window` and call
`PanthoriumWindowTheme.apply(root)` after insertion. Use `data-pt-titlebar`,
`data-pt-sidebar`, `data-pt-card`, and `data-pt-nav` for additional components.
Do not add per-app window colors, shadows, fonts, border radii or titlebar heights.

Keep the existing safe-area/fullscreen/minimize contracts, role permissions,
input handlers, native browser controls and semantic warning/error colors.
The reference's demo chat, fake status, microphone engine and decorative orb
are not production behaviors. No orb is added by this theme.

Validation before release: render all catalog apps as user/admin on staging,
compare shared surfaces to the reference at matching viewport sizes, check
long forms, tables, mobile scroll, dialog controls and safe-area/dock overlap.
Shared surface values match the reference; different application content/layouts
still require individual visual acceptance. Never claim pixel-identical pages
based on token tests alone.
