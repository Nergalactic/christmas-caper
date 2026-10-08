#!/usr/bin/env node
// Content checker for Cold Case. Run with `npm run check`.
//
// 1. References: every `go` scene, beat, boost beat, and speaker exists,
//    and every required flag is set by some hotspot.
// 2. Playthrough: simulates the game from the start scene by always
//    clicking the first available hotspot (toggling the goggles when that's
//    the only way to see something new). Fails on a dead end, warns when
//    more than one hotspot is available at once, since the design calls
//    for exactly one way forward.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Game, GameState, Engine } from "../src/game.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJSON = async (rel) => JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));

async function loadGame() {
  const manifest = await readJSON("content/game.json");
  const game = new Game(manifest);
  for (const chapter of game.chapters) {
    const data = await readJSON(`content/${chapter.file}`);
    for (const [id, scene] of Object.entries(data.scenes || {})) {
      game.scenes.set(id, { id, chapter: chapter.id, hotspots: [], ...scene });
    }
    for (const [id, beat] of Object.entries(data.beats || {})) {
      game.beats.set(id, { id, lines: [], ...beat });
    }
  }
  return game;
}

const errors = [];
const warnings = [];

function checkReferences(game) {
  if (!game.scenes.has(game.start)) errors.push(`start scene "${game.start}" does not exist`);
  const setFlags = new Set(["has_goggles"]);
  for (const scene of game.scenes.values()) {
    for (const h of scene.hotspots) for (const f of h.sets || []) setFlags.add(f);
  }
  const checkBeat = (where, id) => {
    if (id && !game.beats.has(id)) errors.push(`${where}: beat "${id}" does not exist`);
  };
  for (const scene of game.scenes.values()) {
    checkBeat(`scene ${scene.id} on_enter`, scene.on_enter);
    const ids = new Set();
    for (const h of scene.hotspots) {
      const where = `${scene.id}/${h.id}`;
      if (ids.has(h.id)) errors.push(`${where}: duplicate hotspot id`);
      ids.add(h.id);
      if (h.go && !game.scenes.has(h.go)) errors.push(`${where}: go target "${h.go}" does not exist`);
      checkBeat(where, h.beat);
      if (h.boost) checkBeat(`${where} boost`, h.boost.beat);
      for (const f of h.requires || []) {
        if (!setFlags.has(f)) errors.push(`${where}: requires flag "${f}" that nothing sets`);
      }
    }
  }
  for (const beat of game.beats.values()) {
    for (const [i, line] of beat.lines.entries()) {
      if (!(line.speaker in game.speakers)) errors.push(`beat ${beat.id} line ${i + 1}: unknown speaker "${line.speaker}"`);
      if (!line.text || !line.text.trim()) errors.push(`beat ${beat.id} line ${i + 1}: empty text`);
    }
  }
}

function simulate(game) {
  const engine = new Engine(game, new GameState());
  engine.enterScene(game.start);
  const path = [game.start];
  for (let step = 0; step < 1000; step++) {
    let visible = engine.visibleHotspots();
    if (!visible.length && engine.gogglesUnlocked) {
      engine.setGoggles(!engine.state.goggles);
      visible = engine.visibleHotspots();
    }
    if (!visible.length) {
      errors.push(`dead end in scene "${engine.state.scene}" after: ${path.join(" > ")}`);
      return;
    }
    if (visible.length > 1) {
      warnings.push(`${engine.state.scene}: ${visible.length} hotspots available at once (${visible.map((h) => h.id).join(", ")})`);
    }
    const h = visible[0];
    const result = engine.activate(h.id);
    path.push(h.id);
    if (result.end) {
      console.log(`Playthrough reached the ending in ${path.length - 1} clicks.`);
      return;
    }
    if (result.go) {
      engine.enterScene(result.go);
      path.push(`[${result.go}]`);
    }
  }
  errors.push("playthrough did not finish within 1000 clicks (loop?)");
}

const game = await loadGame();
console.log(`${game.scenes.size} scenes, ${game.beats.size} beats across ${game.chapters.length} chapter file(s).`);
checkReferences(game);
if (!errors.length) simulate(game);

for (const w of [...new Set(warnings)]) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
if (errors.length) process.exit(1);
console.log("Content OK.");
