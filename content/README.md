# Content format

`game.json` holds the title, the start scene, display names for every speaker, and the chapter list. Each chapter file (`intro.json` and so on) holds `scenes` and `beats`.

## Scenes

```json
"alley": {
  "name": "The Alley Behind the Mistletoe Lounge",
  "panorama": "content/panoramas/alley.jpg",
  "startYaw": 0,
  "startPitch": -15,
  "ambience": "alley",
  "on_enter": "alley_enter",
  "hotspots": [ ... ]
}
```

- `panorama`: equirectangular image. Leave `null` (or point at a missing file) to get the gray grid placeholder.
- `crossfade`: milliseconds. For a panorama that matches the previous one (same place, something new in it): the new image fades in over the old one while the view eases to `startYaw`/`startPitch`, instead of a hard cut.
- `startYaw` / `startPitch`: where the camera faces on entry. Yaw 0 is straight ahead, positive yaw turns right, negative pitch looks down (toward the floor, where Tiny lives).
- `ambience`: audio id, played from `content/audio/<id>.mp3` with an optional `<id>_detail.mp3` layer. Defaults to the scene id.
- `ambience_volume`: multiplies the ambience volume for this scene (default 1).
- `ambience_continue`: `true` picks the new track up at the previous track's playback position, for scenes that hear the same song.
- `on_enter`: beat played the first time the scene is entered.

## Hotspots

| Field | Meaning |
|---|---|
| `id`, `yaw`, `pitch` | Required. Place them with `editor.html`. |
| `label` | Text on the marker. |
| `beat` | Beat played on click. |
| `go` | Scene to move to after the beat. |
| `end` | `true` ends the game after the beat (credits follow). |
| `requires` | Flags that must all be set before the hotspot appears. |
| `unless` | Any one of these flags hides it. |
| `sets` | Flags set on click. |
| `once` | Hide after clicking. Defaults to `true`, or `false` for `go` hotspots. |
| `goggles` | `true` = only visible with the tinsel goggles on. |
| `grants` | `"goggles"` gives Tiny the goggles (sets `has_goggles`). |
| `boost` | `{ "by": "granny", "beat": "alley_boost" }` = too high to reach. The boost beat plays first, then the hotspot's own beat. |

The design calls for exactly one way forward at any moment. `npm run check` warns when a scene offers more than one hotspot at once and fails on dead ends or broken references.

## Beats

```json
"office_granny": {
  "lines": [
    { "speaker": "granny", "text": "My Jimmy is missing." },
    { "speaker": "tiny", "text": "I weighed my options." }
  ]
}
```

Each line is one subtitle and one voice clip. An optional `spoken` field holds the version to paste into ElevenLabs, with dashes as pauses (`-` short through `----` long); subtitles always show `text`. Line *i* plays clip *i* of that beat's entry in `content/audio/narration/manifest.json`.

## Voicing

1. `node scripts/scaffold-narration.mjs content/<chapter>.json` writes the chapter's beats into `narration-script/script.md` (add `--force` to regenerate a chapter).
2. Fill in voice ids in `narration-script/voices.json`.
3. `npm run narration:dry-run` shows what would be generated and the character count.
4. `node scripts/generate-narration.mjs narration-script/script.md --generate` spends ElevenLabs credits and writes clips plus the manifest. Needs `ELEVENLABS_API_KEY` in `.env`.
