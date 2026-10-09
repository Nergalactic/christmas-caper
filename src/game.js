// Cold Case's story engine: a deliberately small, strictly linear scene
// runner. It replaces Skua Island's engine.js/world.js/journal.js (lenses,
// ledger, four endings), which Cold Case doesn't need.
//
// Presentation-agnostic like the Skua engine was: this file knows nothing
// about Three.js or the DOM. panorama-ui.js asks it what's visible and what
// a click does, then renders the result.
//
// Content lives in content/game.json (title, speakers, chapter list) plus
// one file per chapter (scenes + beats). See content/README.md for the
// format.

const SAVE_KEY = "coldcase_save";

// -- Content --------------------------------------------------------------

export class Game {
  constructor(manifest) {
    this.title = manifest.title;
    this.start = manifest.start;
    this.speakers = manifest.speakers || {};
    this.chapters = manifest.chapters || [];
    this.scenes = new Map();
    this.beats = new Map();
  }

  static async load(url = "content/game.json") {
    const manifest = await (await fetch(url)).json();
    const game = new Game(manifest);
    for (const chapter of game.chapters) {
      const data = await (await fetch(`content/${chapter.file}`)).json();
      for (const [id, scene] of Object.entries(data.scenes || {})) {
        if (game.scenes.has(id)) throw new Error(`Duplicate scene id "${id}" in ${chapter.file}`);
        game.scenes.set(id, { id, chapter: chapter.id, hotspots: [], ...scene });
      }
      for (const [id, beat] of Object.entries(data.beats || {})) {
        if (game.beats.has(id)) throw new Error(`Duplicate beat id "${id}" in ${chapter.file}`);
        game.beats.set(id, { id, lines: [], ...beat });
      }
    }
    return game;
  }

  scene(id) {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error(`Unknown scene "${id}"`);
    return scene;
  }

  beat(id) {
    return id ? this.beats.get(id) || null : null;
  }

  chapter(id) {
    return this.chapters.find((c) => c.id === id) || null;
  }

  speakerName(key) {
    return this.speakers[key] || key;
  }
}

// -- Save state -----------------------------------------------------------

export class GameState {
  constructor(data = {}) {
    this.scene = data.scene || null;
    this.flags = new Set(data.flags || []);
    this.done = new Set(data.done || []); // "<sceneId>/<hotspotId>"
    this.seenBeats = new Set(data.seenBeats || []);
    this.goggles = !!data.goggles;
    // A hotspot whose scene is still playing: { hotspot: id }. Lets a game
    // closed mid-conversation resume at the start of that conversation.
    this.pending = data.pending || null;
    // Where the camera was facing, so a resumed game looks the same way.
    this.view = data.view || null;
  }

  flag(name) {
    return this.flags.has(name);
  }

  setFlag(name) {
    this.flags.add(name);
  }

  toJSON() {
    return {
      scene: this.scene,
      flags: [...this.flags],
      done: [...this.done],
      seenBeats: [...this.seenBeats],
      goggles: this.goggles,
      pending: this.pending,
      view: this.view,
    };
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this));
    } catch {
      // Storage can be unavailable (private windows, blocked site data);
      // the game still plays, it just won't resume.
    }
  }

  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? new GameState(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  static clear() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // see save()
    }
  }
}

// -- Engine ---------------------------------------------------------------
//
// Hotspot fields (all optional except id/yaw/pitch):
//   label     text on the marker
//   beat      beat id to play when clicked
//   go        scene id to move to after the beat
//   end       true = this click ends the game (credits follow its beat)
//   requires  [flags] that must all be set for the hotspot to appear
//   unless    [flags]; any one set hides the hotspot
//   sets      [flags] to set when clicked
//   once      hide after it's been clicked (default true unless `go`)
//   goggles   true = only visible while the tinsel goggles are on
//   grants    "goggles" = clicking this gives Tiny the goggles
//   boost     { by: speakerKey, beat: beatId } = too high to reach; the
//             boost beat plays first, then the hotspot's own beat

export class Engine {
  constructor(game, state) {
    this.game = game;
    this.state = state;
  }

  get scene() {
    return this.game.scene(this.state.scene);
  }

  get gogglesUnlocked() {
    return this.state.flag("has_goggles");
  }

  // Moves to a scene. Returns its on_enter beat only the first time, so
  // revisiting a scene doesn't replay its intro.
  enterScene(id) {
    const previous = this.state.scene ? this.game.scene(this.state.scene) : null;
    const scene = this.game.scene(id);
    if (this.state.scene !== id) this.state.view = null;
    this.state.scene = id;
    const chapterChanged = !previous || previous.chapter !== scene.chapter;
    let beat = null;
    // The opening beat only counts as seen once it has finished playing
    // (markBeatSeen), so a game closed partway through it replays it.
    if (scene.on_enter && !this.state.seenBeats.has(scene.on_enter)) {
      beat = this.game.beat(scene.on_enter);
    }
    this.state.save();
    return { scene, beat, chapter: chapterChanged ? this.game.chapter(scene.chapter) : null };
  }

  markBeatSeen(beatId) {
    this.state.seenBeats.add(beatId);
    this.state.save();
  }

  isOnce(h) {
    return h.once ?? !h.go;
  }

  isVisible(h) {
    const key = `${this.state.scene}/${h.id}`;
    if (this.isOnce(h) && this.state.done.has(key)) return false;
    if ((h.requires || []).some((f) => !this.state.flag(f))) return false;
    if ((h.unless || []).some((f) => this.state.flag(f))) return false;
    if (h.goggles && !this.state.goggles) return false;
    return true;
  }

  visibleHotspots() {
    return this.scene.hotspots.filter((h) => this.isVisible(h));
  }

  // Applies a click and returns what the UI should play/do, in order:
  //   { boostBeat, beat, go, end }
  activate(hotspotId) {
    const h = this.scene.hotspots.find((x) => x.id === hotspotId);
    if (!h || !this.isVisible(h)) return null;
    this.state.done.add(`${this.state.scene}/${h.id}`);
    for (const f of h.sets || []) this.state.setFlag(f);
    if (h.grants === "goggles") this.state.setFlag("has_goggles");
    if (h.beat) this.state.seenBeats.add(h.beat);
    this.state.pending = { hotspot: h.id };
    this.state.save();
    return this.result(h);
  }

  // The interrupted hotspot from a saved game, to play again on resume.
  resumePending() {
    const id = this.state.pending && this.state.pending.hotspot;
    const h = id && this.scene.hotspots.find((x) => x.id === id);
    if (!h) {
      this.clearPending();
      return null;
    }
    return this.result(h);
  }

  clearPending() {
    this.state.pending = null;
    this.state.save();
  }

  result(h) {
    return {
      hotspot: h,
      boostBeat: h.boost ? this.game.beat(h.boost.beat) : null,
      beat: this.game.beat(h.beat),
      go: h.go || null,
      end: !!h.end,
    };
  }

  setGoggles(on) {
    if (!this.gogglesUnlocked) return false;
    this.state.goggles = on;
    this.state.save();
    return true;
  }
}
