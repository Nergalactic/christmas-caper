#!/usr/bin/env node
// Carried over unchanged in behavior from Skua Island. Turns the reviewed
// narration-script/script.md into voiced clips + manifest entries. The
// script format is "## <beat id>" headings with [SPEAKER] tagged lines
// (see scripts/scaffold-narration.mjs); each tag starts a new segment, and
// segment i pairs with line i of that beat in the game.
//
// Costs real ElevenLabs credits per character generated. Default mode is
// --dry-run (no flag needed -- that's the default): prints what *would*
// happen with no API calls. Pass --generate to actually spend. This script
// is meant to be run by a human who has reviewed the dry-run output, not
// invoked automatically by anything.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NARRATION_DIR = path.join(ROOT, "content", "audio", "narration");
const MANIFEST_PATH = path.join(NARRATION_DIR, "manifest.json");
const VOICES_PATH = path.join(ROOT, "narration-script", "voices.json");

const MODEL_ID = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    console.error("Usage: node scripts/generate-narration.mjs narration-script/script.md [--generate] [--force]");
    process.exit(1);
  }
  return {
    scriptPath: positional[0],
    generate: flags.has("--generate"),
    force: flags.has("--force"),
  };
}

// Tiny manual .env loader -- no new dependency for one key/value pair.
// Only fills in vars not already set in the real environment.
async function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const contents = await readFile(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Parses "## key" sections into { key, segments: [{speaker, text}] }, in
// file order. A [SPEAKER] tag starts a new segment (ends whatever segment
// came before it); everything else -- wrapped lines and blank lines alike
// -- just accumulates onto the current segment's text until the next tag
// or the next "##" heading. Blank lines become a paragraph break (kept as
// "\n\n" in the text) rather than ending the segment -- a single speaker's
// multi-paragraph block (e.g. a letter read aloud) is one clip, not one
// clip per paragraph.
//
// The merged script.md also carries `<!-- section:id -->` markers and
// level-1 "# Heading" section dividers between beats (e.g. between the
// last prologue beat and the first zone1 beat) -- both are ignored the
// same way front-matter before the very first "##" is: a "#" heading
// flushes whatever beat was open and drops back into ignored-prose mode
// until the next "##", so it can't get silently appended onto the
// previous beat's last segment.
function parseScript(markdown) {
  const lines = markdown.split(/\r?\n/);
  const beats = [];
  let current = null; // { key, segments }
  let currentSegment = null;

  const flushSegment = () => {
    if (currentSegment && currentSegment.text.trim()) {
      current.segments.push({
        speaker: currentSegment.speaker,
        text: currentSegment.text.trim(),
      });
    }
    currentSegment = null;
  };
  const flushBeat = () => {
    flushSegment();
    if (current && current.segments.length) beats.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    if (/^<!--.*-->\s*$/.test(rawLine)) continue; // section markers

    const headingMatch = rawLine.match(/^##\s+(\S+)\s*$/);
    if (headingMatch) {
      flushBeat();
      current = { key: headingMatch[1], segments: [] };
      continue;
    }
    if (/^#\s+/.test(rawLine)) {
      flushBeat(); // level-1 section divider, e.g. "# Zone 1 -- ..."
      continue;
    }
    if (!current) continue; // front-matter/intro prose before/between sections

    if (!rawLine.trim()) {
      if (currentSegment && !currentSegment.text.endsWith("\n\n")) {
        currentSegment.text += "\n\n";
      }
      continue;
    }
    const tagMatch = rawLine.match(/^\[([A-Za-z0-9_]+)\]\s*(.*)$/);
    if (tagMatch) {
      flushSegment();
      currentSegment = { speaker: tagMatch[1].toLowerCase(), text: tagMatch[2] };
    } else if (currentSegment) {
      const sep = currentSegment.text.endsWith("\n\n") || !currentSegment.text ? "" : " ";
      currentSegment.text += sep + rawLine.trim();
    }
    // A non-tag line with no open segment (shouldn't happen in a well-formed
    // script) is silently dropped rather than crashing the whole run.
  }
  flushBeat();
  return beats;
}

function segmentFilename(key, index) {
  return `${key.replace(/:/g, "_")}_${index}.mp3`;
}

async function loadJSON(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function ttsRequest(text, voice) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: voice.stability ?? 0.5,
        similarity_boost: voice.similarity_boost ?? 0.75,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status} for voice ${voice.voice_id}: ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const { scriptPath, generate, force } = parseArgs(process.argv);
  await loadDotEnv();

  const markdown = await readFile(path.resolve(ROOT, scriptPath), "utf8");
  const beats = parseScript(markdown);
  const voices = await loadJSON(VOICES_PATH, {});
  const manifest = await loadJSON(MANIFEST_PATH, {});

  // Validate every speaker has a usable voice BEFORE any API calls or file
  // writes -- a mid-batch failure shouldn't leave a beat half-voiced.
  const missingSpeakers = new Set();
  for (const beat of beats) {
    for (const seg of beat.segments) {
      const voice = voices[seg.speaker];
      if (!voice || !voice.voice_id) missingSpeakers.add(seg.speaker);
    }
  }
  if (missingSpeakers.size) {
    console.error(
      `Missing voice_id in narration-script/voices.json for: ${[...missingSpeakers].join(", ")}`
    );
    if (generate) process.exit(1);
  }

  let totalChars = 0;
  const perSpeakerChars = {};
  const plan = []; // { manifestKey, filename, speaker, text, skip }

  for (const beat of beats) {
    const manifestKey = beat.key;
    const existing = manifest[manifestKey];
    const filesExist =
      existing &&
      existing.every((seg) => existsSync(path.join(NARRATION_DIR, seg.file)));
    const skip = filesExist && !force;

    beat.segments.forEach((seg, i) => {
      const filename = segmentFilename(beat.key, i + 1);
      totalChars += seg.text.length;
      perSpeakerChars[seg.speaker] = (perSpeakerChars[seg.speaker] || 0) + seg.text.length;
      plan.push({ manifestKey, filename, speaker: seg.speaker, text: seg.text, skip });
    });
  }

  console.log(`Parsed ${beats.length} beat(s), ${plan.length} segment(s) from ${scriptPath}\n`);
  for (const [speaker, chars] of Object.entries(perSpeakerChars)) {
    console.log(`  ${speaker.padEnd(12)} ${chars} chars`);
  }
  console.log(`  ${"TOTAL".padEnd(12)} ${totalChars} chars\n`);

  const toGenerate = plan.filter((p) => !p.skip);
  const toSkip = plan.filter((p) => p.skip);
  if (toSkip.length) {
    console.log(`Skipping ${toSkip.length} already-generated segment(s) (pass --force to redo).`);
  }

  if (!generate) {
    console.log(`\n[dry run] Would generate ${toGenerate.length} segment(s):`);
    for (const seg of toGenerate) {
      console.log(`  ${seg.manifestKey} #${seg.filename} [${seg.speaker}] (${seg.text.length} chars)`);
    }
    console.log("\nRe-run with --generate to actually call ElevenLabs and spend credits.");
    return;
  }

  if (missingSpeakers.size) return; // already exited above, but guard anyway

  await mkdir(NARRATION_DIR, { recursive: true });
  const byBeat = new Map();
  for (const seg of toGenerate) {
    if (!byBeat.has(seg.manifestKey)) byBeat.set(seg.manifestKey, []);
    byBeat.get(seg.manifestKey).push(seg);
  }

  for (const [manifestKey, segs] of byBeat) {
    const entry = [];
    for (const seg of segs) {
      process.stdout.write(`Generating ${seg.filename} [${seg.speaker}]... `);
      const audio = await ttsRequest(seg.text, voices[seg.speaker]);
      await writeFile(path.join(NARRATION_DIR, seg.filename), audio);
      entry.push({ speaker: seg.speaker, file: seg.filename });
      console.log("done");
    }
    manifest[manifestKey] = entry;
    // Write after every beat, not just at the end, so a crash/interruption
    // mid-run doesn't lose progress already paid for.
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  }

  console.log(`\nWrote ${toGenerate.length} clip(s), updated ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
