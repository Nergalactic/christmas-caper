// Pre-generated voiced narration, one <audio> element whose src gets
// swapped through a queue -- same "one element, id-keyed source, missing
// file fails silently" spirit as audio.js's Ambience, but queued rather
// than replaced: several beats can render onto the same screen before the
// player takes an action (see panorama-ui.js's runPrologue()), and they're
// meant to be heard as one continuous passage, not talk over each other.
//
// No live TTS, no per-play API calls -- every clip this ever plays is a
// pre-generated file dropped in content/audio/narration/, referenced from
// content/audio/narration/manifest.json. Until that manifest has real
// entries, every enqueue() is a silent no-op (empty manifest = {}), so
// this is safe to wire up long before any audio actually exists.
const manifestUrl = "content/audio/narration/manifest.json";

class NarrationPlayer {
  constructor() {
    this.el = new Audio();
    this.manifest = null;
    this.manifestPromise = fetch(manifestUrl)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((m) => (this.manifest = m));
    this.unlocked = false;
    this.queue = []; // [{speaker, file}, ...] waiting to play, in order
    this.playing = false;
  }

  // Same autoplay-policy constraint as Ambience.unlock() -- browsers (and
  // Capacitor's WebView) block audio.play() until it happens inside a
  // user-gesture handler. Wired into the same pointerdown listener as
  // Ambience in panorama-ui.js.
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this._pump();
  }

  // Appends this key's segments (if any exist yet) to whatever's already
  // queued/playing. Multiple beats rendered onto the same screen (no
  // reset() between them) are meant to be heard back-to-back as one
  // passage, same as they'd read as one continuous passage on screen.
  async enqueue(key) {
    if (!this.manifest) await this.manifestPromise;
    const segments = this.manifest[key];
    if (segments && segments.length) this.queue.push(...segments);
    if (this.unlocked) this._pump();
  }

  // Stops whatever's playing and drops anything queued -- called whenever
  // a new screen replaces the old one (panorama-ui.js's clearLog()),
  // mirroring how that function wipes the log itself.
  reset() {
    this.queue.length = 0;
    this.playing = false;
    this.el.onended = null;
    this.el.pause();
  }

  setMuted(muted) {
    this.el.muted = muted;
  }

  get muted() {
    return this.el.muted;
  }

  _pump() {
    if (this.playing || !this.queue.length) return;
    this.playing = true;
    const segment = this.queue.shift();
    this.el.src = `content/audio/narration/${segment.file}`;
    this.el.onended = () => {
      this.playing = false;
      this._pump();
    };
    // Missing/not-yet-generated clips are expected for most of the game
    // right now -- fail quietly, same as Ambience's missing-track handling.
    this.el.play().catch((err) => {
      console.warn(`[narration] could not play "${segment.file}":`, err.message);
      this.playing = false;
      this._pump();
    });
  }
}

export const Narration = new NarrationPlayer();
