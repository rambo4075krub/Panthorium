# Panthorium window appearance

## Social Media product design

The [Social Media design package](social-media/README.md) contains the interactive
six-window proposal and its Thai architecture specification. It is a standalone
design artifact, excluded from the production image; it does not register apps
in the live Start Menu or enable social services.

## Shared application window appearance

`window-reference.html` is the user-approved visual source, preserved verbatim.
`../window-theme-ui.js` owns the shared colors, borders and shadows.
`../workspace-ui.js` and `../workspace-ui.css` own the actual reference structure:
brand/titlebar, visible minimize/maximize/close SVG controls, permission-aware left
navigation, breadcrumb, application region, chat hero/cards and two-row composer.
Both user and admin shells load these files. Existing and future windows use the
same structure; external applications retain their original DOM nodes and handlers.

New applications must use `PanthoriumWindowManager.create` / the existing
`createWindow` factory, or `PanthoriumWindowManager.registerExternal`. Register any
standalone application with `PanthoriumWindow.registerExternal(id, title, root,
{closeButton: selector})` so it receives the common structure and app cleanup hook.
Use `data-pt-titlebar`,
`data-pt-sidebar`, `data-pt-card`, and `data-pt-nav` for additional components.
Do not add per-app window colors, shadows, fonts, border radii or titlebar heights.

The default is now a floating frame (34px top, 38px side gutters, up to 1580px),
with space for the dock. Mobile uses the available viewport above the dock.
`fullscreenOnOpen: true` remains an explicit option; maximize, fullscreen, restore,
and left/right half-screen modes preserve the application's live state. Preference
storage moves to v2 so the former forced-fullscreen default does not override this.

Keep safe-area/dock clearance, minimize behavior, role permissions,
input handlers, native browser controls and semantic warning/error colors.
The reference's demo chat, fake status, microphone engine and decorative orb
are not production behaviors. No orb is added by this theme.

Keyboard commands use physical key codes: **Alt+Shift** plus K (app search),
Left/Right (window switching), M (minimize), X (maximize/restore), W (close),
1/2 (snap left/right), D (desktop/restore), S (Sentinel), / (help).
Mac uses Option+Shift. Window actions ignore editable fields and composition;
search/help remain available with the explicit chord. Browser/OS reserved shortcuts
such as Alt+Tab and Ctrl/Cmd+W are untouched. Palette supports arrows, Enter, Escape,
focus trapping and focus restoration. Launch access is rechecked against the catalog.

Validation before release: render all catalog apps as user/admin on staging,
compare shared surfaces to the reference at matching viewport sizes, check
long forms, tables, mobile scroll, dialog controls and safe-area/dock overlap.
Shared surface values match the reference; different application content/layouts
still require individual visual acceptance. Never claim pixel-identical pages
based on token tests alone.
