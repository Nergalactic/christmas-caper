# Cold Case

![Cold Case cover art](promo/cover_art.jpg)

**Play it:** https://nergalactic.github.io/christmas-caper/

A panorama noir mystery for the 2026 tacky website contest (theme: Reindeer Squad). Tiny Hightower, a very short elf detective, investigates the melting of lounge-singing snowman Jimmy Mittens.

See [DESIGN.md](DESIGN.md) for the story, cast, and schedule, and [content/README.md](content/README.md) for the content format.

## Running it

No build step. Serve the folder and open it in a browser:

```
npm run serve
```

Then visit http://localhost:8080. `editor.html` is the hotspot placement tool.

## Checking content

```
npm run check
```

Validates references and simulates a playthrough from the start scene to the ending.

## Dev hooks (browser console)

- `__goto("alley")` jumps to a scene
- `__look(45, 25)` points the camera at a yaw/pitch
- `__showCredits()` previews the credits

## Origins

The panorama viewer, audio, narration, tutorial, editor, and voice pipeline are adapted from The Mystery of Skua Island's panorama build. The story engine (`src/game.js`) is new and strictly linear. Three.js is vendored under its MIT license.
