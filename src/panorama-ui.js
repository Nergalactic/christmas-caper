// Cold Case front end, adapted from The Mystery of Skua Island's
// panorama-ui.js. Kept from Skua: the Three.js viewer (equirectangular
// sphere, drag to look via OrbitControls, DOM-button hotspots projected
// every frame), timed subtitles paced against narration audio, ambience
// per panorama, the title screen (pannable title panorama, loading music,
// pulsing "Tap to continue"), pause menu, tutorial checklist, and credits.
//
// Replaced: the sheet/log/journal UI and Skua's lens/ledger engine. Cold
// Case is strictly linear (see src/game.js): every hotspot click plays one
// fixed, fully voiced beat, then the game moves on.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Game, GameState, Engine } from "./game.js";
import { Ambience, LoadingMusic, CreditsMusic } from "./audio.js";
import { Narration } from "./narration.js";
import { TUTORIAL_STEPS, isTutorialComplete, skipTutorial } from "./tutorial.js";

const statusStripEl = document.getElementById("status-strip");
const statusSceneEl = document.getElementById("status-scene");
const gogglesButtonEl = document.getElementById("goggles-button");
const muteButtonEl = document.getElementById("mute-button");
const menuButtonEl = document.getElementById("menu-button");
const viewerEl = document.getElementById("viewer");
const canvasEl = document.getElementById("viewer-canvas");
const hotspotLayerEl = document.getElementById("hotspot-layer");
const viewerHintEl = document.getElementById("viewer-hint");
const titleOverlayEl = document.getElementById("title-overlay");
const tutorialPanelEl = document.getElementById("tutorial-panel");
const tutorialStepsEl = document.getElementById("tutorial-steps");
const tutorialSkipEl = document.getElementById("tutorial-skip");
const subtitleBarEl = document.getElementById("subtitle-bar");
const subtitleSpeakerEl = document.getElementById("subtitle-speaker");
const subtitleLineEl = document.getElementById("subtitle-line");
const captionBarEl = document.getElementById("caption-bar");
const captionTextEl = document.getElementById("caption-text");
const captionButtonsEl = document.getElementById("caption-buttons");
const captionHintEl = document.getElementById("caption-hint");
const pauseMenuEl = document.getElementById("pause-menu");
const pauseMenuBackdropEl = document.getElementById("pause-menu-backdrop");
const pauseMuteEl = document.getElementById("pause-mute");
const pauseSubtitlesEl = document.getElementById("pause-subtitles");
const pauseRestartEl = document.getElementById("pause-restart");
const pauseResumeEl = document.getElementById("pause-resume");
const creditsScreenEl = document.getElementById("credits-screen");
const creditsTrackEl = document.getElementById("credits-track");
const creditsSkipEl = document.getElementById("credits-skip");

const TITLE_PANORAMA = "content/panoramas/title_card.jpg";

let game = null;
let engine = null;
let busy = false; // true while a beat is playing; hotspots ignore clicks

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let resolveFirstInteraction;
const firstInteraction = new Promise((resolve) => {
  resolveFirstInteraction = resolve;
});
document.addEventListener(
  "pointerdown",
  () => {
    Ambience.unlock();
    Narration.unlock();
    LoadingMusic.play();
    resolveFirstInteraction();
  },
  { once: true }
);

// Tutorial "look around" step: a real drag, measured by how far the
// camera's azimuth moved, so a hotspot tap doesn't also count.
let dragStartAzimuth = null;
canvasEl.addEventListener("pointerdown", () => {
  dragStartAzimuth = controls ? controls.getAzimuthalAngle() : null;
});
canvasEl.addEventListener("pointerup", () => {
  if (dragStartAzimuth === null || !controls) return;
  const delta = Math.abs(controls.getAzimuthalAngle() - dragStartAzimuth);
  dragStartAzimuth = null;
  if (delta > THREE.MathUtils.degToRad(5)) markTutorialEvent("tutorial_looked");
});

// -- Caption bar (title screen, chapter cards, menus) ---------------------

function appendCaption(text) {
  for (const para of text.split("\n\n")) {
    const p = document.createElement("p");
    p.textContent = para;
    captionTextEl.appendChild(p);
  }
  captionBarEl.hidden = false;
  captionBarEl.scrollTop = 0;
}

function clearCaption() {
  captionTextEl.innerHTML = "";
  captionButtonsEl.innerHTML = "";
  captionBarEl.hidden = true;
  captionBarEl.classList.remove("awaiting-continue", "fade-in", "visible", "chapter-card");
  captionHintEl.hidden = true;
}

function waitForCaptionTap() {
  captionBarEl.classList.add("awaiting-continue");
  captionHintEl.hidden = false;
  return new Promise((resolve) => {
    // Deferred a macrotask so the click that opened this caption can't
    // also satisfy it while it's still bubbling.
    setTimeout(() => {
      captionBarEl.addEventListener(
        "click",
        () => {
          captionBarEl.classList.remove("awaiting-continue");
          captionHintEl.hidden = true;
          resolve();
        },
        { once: true }
      );
    }, 0);
  });
}

// Shows buttons in the caption bar and resolves with the chosen value.
function chooseInCaption(options) {
  captionButtonsEl.innerHTML = "";
  captionBarEl.hidden = false;
  return new Promise((resolve) => {
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.textContent = opt.label;
      if (opt.primary) btn.className = "primary";
      btn.addEventListener("click", () => resolve(opt.value));
      captionButtonsEl.appendChild(btn);
    }
  });
}

// -- Voiced beats with timed subtitles ------------------------------------
//
// A beat is an ordered list of {speaker, text} lines. Line i pairs with
// content/audio/narration/manifest.json's segment i for that beat id. Each
// line shows for its clip's real duration; with no clip yet, it falls back
// to an estimated reading pace. Tapping the subtitle bar skips the line.

const SUBTITLES_KEY = "coldcase_subtitles_enabled";
let subtitlesEnabled = readSubtitlesSetting();
const READING_CHARS_PER_SEC = 15;
const MIN_LINE_MS = 1200;
const LINE_TRANSITION_MS = 60;

function readSubtitlesSetting() {
  try {
    return localStorage.getItem(SUBTITLES_KEY) !== "0";
  } catch {
    return true;
  }
}

let skipCurrentLine = null;
subtitleBarEl.addEventListener("click", () => {
  if (skipCurrentLine) skipCurrentLine();
});

function setSubtitleLine(speaker, text) {
  return new Promise((resolve) => {
    const swap = () => {
      subtitleSpeakerEl.textContent = speaker;
      subtitleLineEl.textContent = text;
      void subtitleLineEl.offsetWidth; // reflow so re-adding .visible retriggers the transition
      subtitleLineEl.classList.add("visible");
      resolve();
    };
    if (!subtitleLineEl.classList.contains("visible")) {
      swap();
      return;
    }
    subtitleLineEl.classList.remove("visible");
    setTimeout(swap, LINE_TRANSITION_MS);
  });
}

function hideSubtitles() {
  subtitleLineEl.classList.remove("visible");
  subtitleBarEl.hidden = true;
}

async function playLine(beatId, index, line) {
  if (!Narration.manifest) await Narration.manifestPromise;
  const seg = (Narration.manifest[beatId] || [])[index];
  const estimatedMs = Math.max(MIN_LINE_MS, (line.text.length / READING_CHARS_PER_SEC) * 1000);

  if (subtitlesEnabled) {
    subtitleBarEl.hidden = false;
    await setSubtitleLine(game.speakerName(line.speaker), line.text);
  }

  let audio = null;
  const done = new Promise((resolve) => {
    skipCurrentLine = resolve;
    if (seg) {
      audio = new Audio(`content/audio/narration/${seg.file}`);
      audio.muted = Ambience.muted;
      audio.addEventListener("ended", resolve, { once: true });
      audio.addEventListener("error", () => sleep(estimatedMs).then(resolve), { once: true });
      audio.play().catch((err) => {
        console.warn(`[narration] could not play "${seg.file}":`, err.message);
        sleep(estimatedMs).then(resolve);
      });
    } else {
      sleep(estimatedMs).then(resolve);
    }
  });
  await done;
  skipCurrentLine = null;
  if (audio) audio.pause();
}

async function playBeat(beat) {
  if (!beat) return;
  for (let i = 0; i < beat.lines.length; i++) {
    await playLine(beat.id, i, beat.lines[i]);
  }
  hideSubtitles();
}

// -- Panorama viewer (Three.js) --------------------------------------------

const SPHERE_RADIUS = 500;
const HOTSPOT_RADIUS = 480; // just inside the sphere, so markers never clip

let renderer, scene3d, camera, controls, sphere, textureLoader;
let hotspotState = []; // [{el, pos: THREE.Vector3}]
let lastPanoramaPath; // avoid reloading the same texture on every action

// yaw 0 / pitch 0 faces the camera's default forward (0,0,-1).
function yawPitchToVector3(yawDeg, pitchDeg, radius = HOTSPOT_RADIUS) {
  const yaw = THREE.MathUtils.degToRad(yawDeg || 0);
  const pitch = THREE.MathUtils.degToRad(pitchDeg || 0);
  return new THREE.Vector3(
    radius * Math.cos(pitch) * Math.sin(yaw),
    radius * Math.sin(pitch),
    -radius * Math.cos(pitch) * Math.cos(yaw)
  );
}

// Gray test sphere used until real art exists for a scene: a grid with
// compass labels so hotspot placement and camera direction are readable,
// plus the scene name. Swapping in real art is just setting the scene's
// `panorama` field.
function makePlaceholderTexture(label, subtitle = "panorama placeholder, awaiting art") {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Floor half a little darker, since Tiny spends most of his time down there.
  ctx.fillStyle = "#2e2e2e";
  ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 2;
  for (let x = 0; x <= canvas.width; x += canvas.width / 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += canvas.height / 12) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // With the sphere rotated in initViewer, image column u faces yaw
  // (u - 0.5) * 360: the image center is straight ahead, the right half is
  // positive yaw. Label every 90 degrees.
  const uForYaw = (yaw) => (((0.5 + yaw / 360) % 1) + 1) % 1;
  const marks = [
    [uForYaw(0), "yaw 0"],
    [uForYaw(90), "yaw 90"],
    [uForYaw(-90), "yaw -90"],
    [0, "yaw 180"],
    [1, "yaw 180"],
  ];
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = "500 26px system-ui, sans-serif";
  for (const [u, text] of marks) ctx.fillText(text, u * canvas.width, canvas.height / 2 + 24);

  const centerX = uForYaw(0) * canvas.width;
  ctx.fillStyle = "rgba(240, 240, 240, 0.85)";
  ctx.font = "600 56px system-ui, sans-serif";
  ctx.fillText(label ?? "Cold Case", centerX, canvas.height / 2 - 60);
  ctx.fillStyle = "rgba(200, 200, 200, 0.65)";
  ctx.font = "300 28px system-ui, sans-serif";
  ctx.fillText(subtitle, centerX, canvas.height / 2 - 14);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function loadPanoramaTexture(path, label, subtitle) {
  return new Promise((resolve) => {
    if (!path) {
      resolve(makePlaceholderTexture(label, subtitle));
      return;
    }
    textureLoader.load(
      path,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      () => resolve(makePlaceholderTexture(label, subtitle)) // no art yet, or a load error
    );
  });
}

function initViewer() {
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  scene3d = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 1, 1100);
  camera.position.set(0, 0, 0.01); // OrbitControls needs a nonzero camera/target distance

  const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 60, 40);
  geometry.scale(-1, 1, 1); // view the inside of the sphere right-reading, not mirrored
  const material = new THREE.MeshBasicMaterial({ map: makePlaceholderTexture("Cold Case") });
  sphere = new THREE.Mesh(geometry, material);
  // Turn the sphere so the image's center column faces the default camera
  // direction (yaw 0). Without this, image center lands at yaw -90.
  sphere.rotation.y = -Math.PI / 2;
  scene3d.add(sphere);

  textureLoader = new THREE.TextureLoader();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.rotateSpeed = -0.25; // dragging right looks right
  controls.target.set(0, 0, 0);

  resizeViewer();
  new ResizeObserver(resizeViewer).observe(viewerEl);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene3d, camera);
    updateHotspotPositions();
  }
  animate();
}

function resizeViewer() {
  const w = viewerEl.clientWidth || 1;
  const h = viewerEl.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

async function setScene(path, label, startYaw = 0, startPitch = 0, { fov = 75, subtitle } = {}) {
  const key = path || `placeholder:${label}`;
  if (key === lastPanoramaPath) return;
  lastPanoramaPath = key;
  const texture = await loadPanoramaTexture(path, label, subtitle);
  const old = sphere.material.map;
  sphere.material.map = texture;
  sphere.material.needsUpdate = true;
  if (old) old.dispose();
  camera.fov = fov;
  camera.updateProjectionMatrix();
  centerCameraOn(startYaw, startPitch);
}

function centerCameraOn(yaw, pitch) {
  camera.position.copy(yawPitchToVector3(yaw, pitch, 0.01)).negate();
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}

// A brief top-anchored reminder on every scene entry that the view drags.
let lookAroundHintTimer = null;
function flashLookAroundHint() {
  clearTimeout(lookAroundHintTimer);
  viewerHintEl.classList.add("pulse-top");
  viewerHintEl.hidden = false;
  lookAroundHintTimer = setTimeout(() => {
    viewerHintEl.classList.remove("pulse-top");
    viewerHintEl.hidden = true;
  }, 4000);
}

// -- Hotspots --------------------------------------------------------------

function clearHotspots() {
  hotspotLayerEl.innerHTML = "";
  hotspotState = [];
}

function refreshHotspots() {
  clearHotspots();
  if (!engine) return;
  for (const h of engine.visibleHotspots()) {
    const el = document.createElement("button");
    el.type = "button";
    el.className =
      "hotspot" + (h.go ? " exit" : "") + (h.goggles ? " goggles" : "") + (h.boost ? " boost" : "");
    el.textContent = h.label || h.id;
    if (h.boost) el.title = "Too high to reach";
    el.addEventListener("click", () => onHotspotClick(h));
    hotspotLayerEl.appendChild(el);
    hotspotState.push({ el, pos: yawPitchToVector3(h.yaw, h.pitch) });
  }
}

// Projects each hotspot's fixed 3D position to screen space every frame.
function updateHotspotPositions() {
  if (!hotspotState.length) return;
  const w = viewerEl.clientWidth;
  const h = viewerEl.clientHeight;
  for (const hs of hotspotState) {
    const v = hs.pos.clone().project(camera);
    if (v.z > 1) {
      hs.el.style.display = "none";
      continue;
    }
    hs.el.style.display = "flex";
    hs.el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
    hs.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
  }
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle("beat-playing", value);
}

async function onHotspotClick(h) {
  if (busy || !engine) return;
  markTutorialEvent("tutorial_tapped_hotspot");
  centerCameraOn(h.yaw, h.pitch);
  const result = engine.activate(h.id);
  if (!result) return;
  setBusy(true);
  refreshHotspots();
  updateGogglesButton();
  updateTutorialPanel();

  if (result.boostBeat) {
    // Someone hoists Tiny up: the view lifts a little while the boost
    // line plays, then settles back.
    viewerEl.classList.add("boosted");
    await playBeat(result.boostBeat);
  }
  await playBeat(result.beat);
  viewerEl.classList.remove("boosted");
  setBusy(false);

  if (result.end) {
    await runEnding(result.hotspot.end_title);
    return;
  }
  if (result.go) {
    await enterScene(result.go);
    return;
  }
  refreshHotspots();
}

// -- Scenes ----------------------------------------------------------------

async function showChapterCard(chapter) {
  if (!chapter || !chapter.title) return;
  clearCaption();
  captionBarEl.classList.add("chapter-card");
  appendCaption(chapter.title);
  await waitForCaptionTap();
  clearCaption();
}

async function enterScene(id) {
  const { scene, beat, chapter } = engine.enterScene(id);
  clearHotspots();
  if (chapter) await showChapterCard(chapter);
  Ambience.setZone(scene.ambience || scene.id);
  statusStripEl.hidden = false;
  statusSceneEl.textContent = scene.name || scene.id;
  updateGogglesButton();
  // `dark_open`: the scene stays black while its opening beat plays, then
  // fades in (the game's noir cold open).
  const dark = !!(scene.dark_open && beat);
  viewerEl.classList.toggle("dark", dark);
  if (dark) tutorialPanelEl.hidden = true;
  else updateTutorialPanel();
  await setScene(scene.panorama, scene.name, scene.startYaw, scene.startPitch, { fov: scene.fov || 75 });
  if (!dark) flashLookAroundHint();
  if (beat) {
    setBusy(true);
    await playBeat(beat);
    setBusy(false);
  }
  if (dark) {
    viewerEl.classList.remove("dark");
    flashLookAroundHint();
    updateTutorialPanel();
  }
  refreshHotspots();
}

async function runEnding(title = "Case closed.") {
  clearHotspots();
  clearCaption();
  captionBarEl.classList.add("chapter-card");
  appendCaption(title);
  const choice = await chooseInCaption([{ label: "View credits", value: "credits", primary: true }]);
  clearCaption();
  if (choice === "credits") await showCredits();
  GameState.clear();
}

// -- Tinsel goggles --------------------------------------------------------

function updateGogglesButton() {
  const unlocked = !!engine && engine.gogglesUnlocked;
  gogglesButtonEl.hidden = !unlocked;
  const on = unlocked && engine.state.goggles;
  gogglesButtonEl.textContent = on ? "Goggles: on" : "Goggles: off";
  gogglesButtonEl.setAttribute("aria-pressed", String(on));
  viewerEl.classList.toggle("goggles-on", on);
}

gogglesButtonEl.addEventListener("click", () => {
  if (!engine || busy) return;
  engine.setGoggles(!engine.state.goggles);
  markTutorialEvent("tutorial_used_goggles");
  updateGogglesButton();
  refreshHotspots();
});

// -- Sound / subtitles -----------------------------------------------------

function updateMuteButton() {
  const label = Ambience.muted ? "Sound: off" : "Sound: on";
  for (const el of [muteButtonEl, pauseMuteEl]) {
    el.textContent = label;
    el.setAttribute("aria-pressed", String(Ambience.muted));
  }
}

function handleToggleMute() {
  Ambience.toggleMute();
  Narration.setMuted(Ambience.muted);
  updateMuteButton();
}

muteButtonEl.addEventListener("click", handleToggleMute);
pauseMuteEl.addEventListener("click", handleToggleMute);
Narration.setMuted(Ambience.muted);
updateMuteButton();

function updateSubtitlesButton() {
  pauseSubtitlesEl.textContent = subtitlesEnabled ? "Subtitles: on" : "Subtitles: off";
  pauseSubtitlesEl.setAttribute("aria-pressed", String(!subtitlesEnabled));
}

pauseSubtitlesEl.addEventListener("click", () => {
  subtitlesEnabled = !subtitlesEnabled;
  try {
    localStorage.setItem(SUBTITLES_KEY, subtitlesEnabled ? "1" : "0");
  } catch {
    // setting just won't persist
  }
  if (!subtitlesEnabled) hideSubtitles();
  updateSubtitlesButton();
});
updateSubtitlesButton();

// -- Pause menu ------------------------------------------------------------

function openPauseMenu() {
  pauseMenuEl.hidden = false;
  pauseMenuBackdropEl.hidden = false;
  markTutorialEvent("tutorial_opened_menu");
}

function closePauseMenu() {
  pauseMenuEl.hidden = true;
  pauseMenuBackdropEl.hidden = true;
}

function togglePauseMenu() {
  if (pauseMenuEl.hidden) openPauseMenu();
  else closePauseMenu();
}

menuButtonEl.addEventListener("click", togglePauseMenu);
pauseMenuBackdropEl.addEventListener("click", closePauseMenu);
pauseResumeEl.addEventListener("click", closePauseMenu);
pauseRestartEl.addEventListener("click", () => {
  if (!window.confirm("Start the case over from the beginning?")) return;
  GameState.clear();
  window.location.reload();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") togglePauseMenu();
});

// -- Tutorial checklist ------------------------------------------------------

function updateTutorialPanel() {
  if (!engine || isTutorialComplete(engine.state)) {
    tutorialPanelEl.hidden = true;
    return;
  }
  tutorialPanelEl.hidden = false;
  tutorialStepsEl.innerHTML = "";
  let activeAssigned = false;
  for (const step of TUTORIAL_STEPS) {
    if (step.isUnlocked && !step.isUnlocked(engine.state)) continue;
    const li = document.createElement("li");
    li.textContent = step.label;
    if (step.isDone(engine.state)) {
      li.className = "done";
    } else if (!activeAssigned) {
      li.className = "active";
      activeAssigned = true;
    }
    tutorialStepsEl.appendChild(li);
  }
}

function markTutorialEvent(flagName) {
  if (!engine || engine.state.flag(flagName)) return;
  engine.state.setFlag(flagName);
  engine.state.save();
  updateTutorialPanel();
}

tutorialSkipEl.addEventListener("click", () => {
  if (!engine) return;
  skipTutorial(engine.state);
  engine.state.save();
  updateTutorialPanel();
});

// -- Credits ----------------------------------------------------------------
//
// Ambience attribution is read from content/audio/CREDITS.md at runtime
// (one "- **name** by AUTHOR -- LICENSE -- ..." line per track), so there's
// one list to keep up to date.

const AUTHOR_CREDIT = "Nergalactic";

function parseCreditsAttribution(markdown) {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const firstSegment = line.split(" -- ")[0];
      const nameMatch = firstSegment.match(/\*\*(.+?)\*\*/);
      const byIdx = firstSegment.indexOf(" by ");
      let author = byIdx >= 0 ? firstSegment.slice(byIdx + 4).trim() : "";
      const linkMatch = author.match(/^\[([^\]]+)\]/);
      if (linkMatch) author = linkMatch[1];
      return { name: nameMatch ? nameMatch[1] : firstSegment.slice(2), author };
    });
}

function addCreditsHeading(text) {
  const h = document.createElement("h2");
  h.textContent = text;
  creditsTrackEl.appendChild(h);
}

function addCreditsLine(text, { dim = false } = {}) {
  const p = document.createElement("p");
  p.textContent = text;
  if (dim) p.className = "dim";
  creditsTrackEl.appendChild(p);
}

function addCreditsSpacer() {
  const div = document.createElement("div");
  div.className = "credits-spacer";
  creditsTrackEl.appendChild(div);
}

async function buildCreditsTrack() {
  creditsTrackEl.innerHTML = "";
  const title = document.createElement("div");
  title.className = "credits-title";
  title.textContent = (game?.title || "Cold Case").toUpperCase();
  creditsTrackEl.appendChild(title);
  addCreditsLine("Written & Designed By", { dim: true });
  addCreditsLine(AUTHOR_CREDIT);
  addCreditsSpacer();

  addCreditsHeading("Starring");
  for (const name of Object.values(game?.speakers || {})) addCreditsLine(name);
  addCreditsSpacer();

  try {
    const res = await fetch("content/audio/CREDITS.md");
    if (res.ok) {
      const entries = parseCreditsAttribution(await res.text());
      if (entries.length) {
        addCreditsHeading("Ambience & Sound Attribution");
        for (const { name, author } of entries) addCreditsLine(author ? `${name}, ${author}` : name);
        addCreditsSpacer();
      }
    }
  } catch (err) {
    console.warn("[credits] could not load attribution:", err.message);
  }
}

let creditsCloseTimer = null;
let resolveCreditsClosed = null;
const CREDITS_SPEED_MULTIPLIER = 2;

async function showCredits() {
  await buildCreditsTrack();
  creditsScreenEl.hidden = false;
  CreditsMusic.play();
  const duration = await new Promise((resolve) => {
    const fallback = setTimeout(() => resolve(60), 1500); // no credits track yet
    if (CreditsMusic.el.duration && !Number.isNaN(CreditsMusic.el.duration)) {
      clearTimeout(fallback);
      resolve(CreditsMusic.el.duration);
      return;
    }
    CreditsMusic.el.addEventListener(
      "loadedmetadata",
      () => {
        clearTimeout(fallback);
        resolve(CreditsMusic.el.duration || 60);
      },
      { once: true }
    );
  });
  const scrollSeconds = (duration + 6) / CREDITS_SPEED_MULTIPLIER;
  creditsTrackEl.style.animationDuration = `${scrollSeconds}s`;
  creditsCloseTimer = setTimeout(closeCredits, scrollSeconds * 1000);
  await new Promise((resolve) => {
    resolveCreditsClosed = resolve;
  });
}

function closeCredits() {
  clearTimeout(creditsCloseTimer);
  CreditsMusic.stop();
  creditsScreenEl.hidden = true;
  if (resolveCreditsClosed) {
    resolveCreditsClosed();
    resolveCreditsClosed = null;
  }
}

creditsSkipEl.addEventListener("click", closeCredits);

// Dev hooks for previewing without playing through.
window.__showCredits = showCredits;
window.__goto = (sceneId) => engine && enterScene(sceneId);
window.__look = (yaw, pitch) => centerCameraOn(yaw, pitch);

// -- Title / entry point ----------------------------------------------------
//
// Same flow as Skua Island: a pannable title panorama with the loading
// theme underneath, the drag hint showing, and a "Tap to continue" prompt
// that fades in after the first interaction and then pulses (see
// #caption-bar.fade-in in panorama.css). The music is only heard if the
// player drags around before tapping through, since that drag's pointerdown
// is what unlocks audio.
async function showLoadingScreen() {
  await setScene(TITLE_PANORAMA, "", 0, -14, { fov: 91, subtitle: "title card placeholder, awaiting art" });
  // The title is drawn by the page rather than baked into the art, since
  // image generators tend to garble lettering.
  titleOverlayEl.hidden = false;
  viewerHintEl.hidden = false;
  await firstInteraction;
  captionBarEl.hidden = false;
  captionBarEl.classList.add("fade-in");
  requestAnimationFrame(() => captionBarEl.classList.add("visible"));
  await waitForCaptionTap();
  clearCaption();
  titleOverlayEl.hidden = true;
  viewerHintEl.hidden = true;
  LoadingMusic.stop();
}

async function main() {
  initViewer();
  game = await Game.load();
  await showLoadingScreen();

  let state = GameState.load();
  if (state && state.scene) {
    appendCaption("A case file in progress was found.");
    const choice = await chooseInCaption([
      { label: "Continue the case", value: "continue", primary: true },
      { label: "Start over", value: "new" },
    ]);
    clearCaption();
    if (choice === "new") {
      GameState.clear();
      state = null;
    }
  }

  if (state && state.scene) {
    engine = new Engine(game, state);
    const sceneId = state.scene;
    state.scene = null; // so enterScene shows the chapter card again on resume
    await enterScene(sceneId);
    return;
  }
  engine = new Engine(game, new GameState());
  await enterScene(game.start);
}

main().catch((err) => {
  console.error(err);
  appendCaption(`Something went wrong loading the game: ${err.message}`);
});
