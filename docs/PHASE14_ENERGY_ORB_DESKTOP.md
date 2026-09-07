# Phase 14.3 — Energy Orb Desktop Integration

Phase 14.3 carefully folds the latest Three.js Particle Orb prototype into the real Panthorium desktop shell.

## Source pulled forward

The prior prototype artifact is titled:

```text
PANTHORIUM ENERGY CORE INTERACTIVE PROTOTYPE
เลื่อนเมาส์เพื่อควบคุม · คลิกเพื่อปล่อยพลังงาน
```

The user requirement from the latest Threejs Particle Orb chat is preserved:

- Keep only the Orb and its functions from the prototype.
- Add the three-row text display under the Orb.
- Use a Consolas / Command Prompt-style font.
- No caption background.
- Previous and next rows are slightly blurred.
- Current row is clear.
- Admin/user can move to previous/next text without a visible scrollbar.
- Replace only the old desktop sphere; keep all other desktop, windows, taskbar, apps, auth and voice functions.

## Safe integration strategy

Instead of rewriting the large `sentinel.html` kernel, this phase adds a contained overlay:

```text
energy-orb-ui.js
```

The script:

- visually suppresses the legacy `#bg-canvas` sphere with `panthorium-energy-orb-replaced`;
- creates `#panthorium-energy-orb-root` inside `#desktop`;
- uses the existing Three.js runtime already loaded by the shell;
- renders a procedural electric energy sphere with particles, halo, core mesh and energy rings;
- keeps desktop icons, windows, taskbar and Start Menu above the Orb;
- avoids whole-document `MutationObserver` loops;
- respects `prefers-reduced-motion`.

## Three-row caption behavior

The caption is a transparent three-line live display under the Orb:

```text
row 1 = previous line, blurred
row 2 = current line, clear
row 3 = next line, blurred
```

Navigation:

- Mouse wheel over caption: previous/next
- ArrowUp / ArrowDown: previous/next
- Home / End: first/latest
- No scrollbar is rendered

The caption receives text from:

- `panthorium:ai-status`
- `panthorium:ai-stream`
- `panthorium:ai-done`
- `panthorium:voice-start`
- `panthorium:voice-boundary`
- `panthorium:voice-end`
- `panthorium:voice-user-start`
- `panthorium:voice-user-result`

## Interaction

- Move mouse: subtly controls Orb orientation.
- Click desktop Orb area: releases an energy pulse.
- AI/voice activity: increases wave amplitude and glow.
- Voice boundary events: create small pulse ripples synced with Thai speech.

## Runtime API

```js
window.PanthoriumEnergyOrb.install()
window.PanthoriumEnergyOrb.tryInstall()
window.PanthoriumEnergyOrb.destroy()
window.PanthoriumEnergyOrb.pushText(text)
window.PanthoriumEnergyOrb.previous()
window.PanthoriumEnergyOrb.next()
window.PanthoriumEnergyOrb.release()
window.PanthoriumEnergyOrb.status()
```

## Loading path

`boot-recovery.js` safely injects:

```text
/energy-orb-ui.js?v=phase14-orb-v1
```

This keeps the integration isolated and cache-busted without expanding the monolithic desktop kernel.

## Safety boundaries

- No auth logic changes.
- No RBAC changes.
- No provider key exposure.
- No automatic merge/deploy behavior.
- No removal of windows, taskbar, Start Menu or admin modules.
- Only the old visual sphere is replaced.

## Version

```text
14.3.0-energy-orb-desktop
```
