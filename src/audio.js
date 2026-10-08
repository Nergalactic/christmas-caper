// Looping background ambience, one "bed" track per panorama (each zone
// room and each prologue scene gets its own -- see panorama-ui.js's
// showRoomView() and runPrologue()), plus an optional second "detail"
// layer that plays simultaneously on top of it (e.g. a steady wind bed
// with occasional gulls layered in) -- two independent <audio> elements,
// each with its own src swap, no crossfade on either. Detail is entirely
// optional per panorama: a missing `<id>_detail.mp3` fails silently
// exactly like a missing bed track already does, so panoramas that only
// need one track work unchanged.
const MUTE_KEY = "coldcase_audio_muted";
// Turned down across the board so narration/subtitled dialogue reads
// clearly over the loop instead of competing with it -- was full volume
// (1.0), which drowned out narrator lines in the solicitor's office scene.
const BED_VOLUME = 0.5;
// Detail layers are meant to sit *under* the bed, not compete with it --
// source clips for the detail slot should already be sparse/occasional
// (per content/audio/SFX_SEARCH_TERMS.md's "detail" search terms), this
// is just a safety margin so a too-hot layer doesn't drown out the bed.
// Kept proportional to BED_VOLUME rather than a fixed value so the two
// layers' relative balance doesn't shift if BED_VOLUME changes again.
const DETAIL_VOLUME = BED_VOLUME * 0.7;

function trackUrl(id) {
  return `content/audio/${id}.mp3`;
}

class AmbienceLayer {
  constructor(volume = 1) {
    this.el = new Audio();
    this.el.loop = true;
    this.el.volume = volume;
    this.el.muted = localStorage.getItem(MUTE_KEY) === "1";
  }

  load(id) {
    this.el.src = trackUrl(id);
    // Missing/not-yet-sourced track files are expected during development
    // -- fail quietly rather than throwing, same spirit as the rest of
    // the UI never crashing the session over unimplemented content.
    this.el.play().catch((err) => {
      console.warn(`[audio] could not play "${id}":`, err.message);
    });
  }

  set muted(value) {
    this.el.muted = value;
  }

  get muted() {
    return this.el.muted;
  }
}

class AmbiencePlayer {
  constructor() {
    this.bed = new AmbienceLayer(BED_VOLUME);
    this.detail = new AmbienceLayer(DETAIL_VOLUME);
    this.pendingId = null;
    this.currentId = null;
    this.unlocked = false;
  }

  // Browsers (and, less strictly, Capacitor's WebView) block audio.play()
  // until it happens inside a real user-gesture handler. The game's first
  // interaction is always a button tap, so ui.js calls this from the same
  // click wrapper every button already goes through, then this fires
  // whatever track setZone() queued up before the gesture arrived.
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.pendingId) this._load(this.pendingId);
  }

  // Safe to call before unlock() -- just records which track should start
  // once a gesture arrives. Safe to call repeatedly with the same id.
  setZone(id) {
    if (id === this.currentId) return;
    this.pendingId = id;
    if (this.unlocked) this._load(id);
  }

  _load(id) {
    this.currentId = id;
    this.bed.load(id);
    // No separate "does a detail file exist" check -- same fail-silently
    // path as the bed track handles a panorama with no detail layer.
    this.detail.load(`${id}_detail`);
  }

  toggleMute() {
    const muted = !this.bed.muted;
    this.bed.muted = muted;
    this.detail.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    return muted;
  }

  get muted() {
    return this.bed.muted;
  }
}

export const Ambience = new AmbiencePlayer();

// Theme music (title/loading screen, end-of-game credits), unrelated to
// the per-panorama Ambience beds above -- no zone keying, just
// play-then-stop (optionally looping while it plays). Same gesture-unlock
// and mute-on-load conventions as AmbienceLayer, but plain enough not to
// warrant sharing that class. Credits music must NOT loop -- the crawl's
// duration is read from this same clip's length so the two can't drift;
// looping it would desync that. Loading/title screen music has no such
// constraint and should keep playing for as long as the player lingers
// on the title screen, hence `loop` is per-instance, defaulting off.
class OneShotMusicPlayer {
  constructor(id, { loop = false } = {}) {
    this.el = new Audio();
    this.el.loop = loop;
    this.el.muted = localStorage.getItem(MUTE_KEY) === "1";
    this.id = id;
  }

  play() {
    this.el.src = trackUrl(this.id);
    this.el.play().catch((err) => {
      console.warn(`[audio] could not play ${this.id} music:`, err.message);
    });
  }

  stop() {
    this.el.pause();
    this.el.currentTime = 0;
  }
}

export const LoadingMusic = new OneShotMusicPlayer("loading", { loop: true });
export const CreditsMusic = new OneShotMusicPlayer("credits");
