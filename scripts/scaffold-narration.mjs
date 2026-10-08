#!/usr/bin/env node
// Copies every beat in a content/<chapter>.json into the shared
// narration-script/script.md, one "## <beatId>" section per beat and one
// [SPEAKER] line per beat line, ready for review before
// generate-narration.mjs voices it. Pure local text transform: no API
// calls, no cost. Adapted from Skua Island's scaffold-zone-narration.mjs.
//
// Line i of a beat becomes segment i of that beat's manifest entry, which
// is how the game pairs subtitles with clips. Keep one tagged line per
// beat line when editing the script, or the pairing drifts.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT, "narration-script", "script.md");

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    console.error("Usage: node scripts/scaffold-narration.mjs <content/chapter.json> [--force]");
    process.exit(1);
  }
  return { contentPath: positional[0], force: flags.has("--force") };
}

function scaffold(data) {
  const sections = [];
  for (const [beatId, beat] of Object.entries(data.beats || {})) {
    const lines = (beat.lines || []).map((l) => `[${l.speaker.toUpperCase()}] ${l.text}`);
    sections.push(`## ${beatId}\n\n${lines.join("\n")}\n`);
  }
  return sections;
}

function buildBlock(zoneId, title, contentPath, sections) {
  const header = `<!-- section:${zoneId} -->
# ${title}

Generated from \`${contentPath}\` by \`scripts/scaffold-narration.mjs\`.
Review before voicing. Nothing here has been generated as audio unless
it's listed in content/audio/narration/manifest.json.

`;
  return header + sections.join("\n");
}

async function main() {
  const { contentPath, force } = parseArgs(process.argv);
  const data = JSON.parse(await readFile(path.resolve(ROOT, contentPath), "utf8"));
  const zoneId = path.basename(contentPath, ".json");
  const title = data.title || zoneId;

  const sections = scaffold(data);
  const newBlock = buildBlock(zoneId, title, contentPath, sections);

  const existingFile = existsSync(SCRIPT_PATH) ? await readFile(SCRIPT_PATH, "utf8") : "";
  const marker = `<!-- section:${zoneId} -->`;
  const markerIndex = existingFile.indexOf(marker);

  if (markerIndex !== -1 && !force) {
    console.error(
      `${SCRIPT_PATH} already has a "${marker}" section -- refusing to overwrite possible hand-edits/speaker markup. Pass --force to regenerate it from scratch.`
    );
    process.exit(1);
  }

  let updatedFile;
  if (markerIndex !== -1) {
    // Replace only this chapter's block, up to the next "<!-- section:" marker
    // (or end of file), leaving every other chapter's hand-edits untouched.
    const rest = existingFile.slice(markerIndex);
    const nextMarkerOffset = rest.indexOf("<!-- section:", marker.length);
    const blockEnd = nextMarkerOffset === -1 ? existingFile.length : markerIndex + nextMarkerOffset;
    updatedFile = existingFile.slice(0, markerIndex) + newBlock.trimEnd() + "\n\n" + existingFile.slice(blockEnd);
  } else if (existingFile) {
    const separator = existingFile.endsWith("\n\n") ? "" : existingFile.endsWith("\n") ? "\n" : "\n\n";
    updatedFile = existingFile + separator + newBlock;
  } else {
    updatedFile = newBlock;
  }

  await mkdir(path.dirname(SCRIPT_PATH), { recursive: true });
  await writeFile(SCRIPT_PATH, updatedFile);
  console.log(`Wrote ${sections.length} section(s) for "${zoneId}" into ${SCRIPT_PATH}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
