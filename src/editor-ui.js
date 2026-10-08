// Companion tool to panorama-ui.js, carried over from Skua Island: loads a
// scene's panorama (or a placeholder), lets you click to drop a pin and
// give it a hotspot id, and exports the scene's `hotspots` array to
// hand-copy into content/<chapter>.json. Reusing an existing id moves that
// hotspot and keeps all its other fields (beat, go, requires, ...).
// Shares the same Three.js viewer approach as panorama-ui.js (equirectangular
// sphere, OrbitControls, yaw/pitch hotspot placement) -- duplicated rather
// than imported, since this is a standalone dev tool, not part of the game
// itself, and the two are expected to drift independently over time.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Game } from "./game.js";

let game = null;

const zoneSelectEl = document.getElementById("zone-select");
const roomSelectEl = document.getElementById("room-select");
const viewerEl = document.getElementById("viewer");
const canvasEl = document.getElementById("viewer-canvas");
const hotspotLayerEl = document.getElementById("hotspot-layer");
const pendingPinEl = document.getElementById("pending-pin");
const pendingYawEl = document.getElementById("pending-yaw");
const pendingPitchEl = document.getElementById("pending-pitch");
const pendingTargetEl = document.getElementById("pending-target");
const pendingLabelEl = document.getElementById("pending-label");
const pinListEl = document.getElementById("pin-list");
const exportTextEl = document.getElementById("export-text");

const pendingIdsEl = document.getElementById("pending-target-ids");

let currentScene = null;
let pins = []; // full hotspot objects for the current scene
let pendingYawPitch = null;

// -- Viewer (see panorama-ui.js for the annotated version of this same setup) --

const SPHERE_RADIUS = 500;
const HOTSPOT_RADIUS = 480;

let renderer, scene, camera, controls, sphere, textureLoader, raycaster;
let pinEls = []; // [{el, pos}]

function yawPitchToVector3(yawDeg, pitchDeg, radius = HOTSPOT_RADIUS) {
  const yaw = THREE.MathUtils.degToRad(yawDeg || 0);
  const pitch = THREE.MathUtils.degToRad(pitchDeg || 0);
  return new THREE.Vector3(
    radius * Math.cos(pitch) * Math.sin(yaw),
    radius * Math.sin(pitch),
    -radius * Math.cos(pitch) * Math.cos(yaw)
  );
}

// Inverse of yawPitchToVector3 -- given a unit direction vector (a raycast
// hit on the sphere, normalized), recover the yaw/pitch that would place a
// hotspot exactly there.
function vector3ToYawPitch(dir) {
  const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  const yaw = Math.atan2(dir.x, -dir.z);
  return { yaw: THREE.MathUtils.radToDeg(yaw), pitch: THREE.MathUtils.radToDeg(pitch) };
}

function makePlaceholderTexture(label) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#232b33");
  grad.addColorStop(0.55, "#12161a");
  grad.addColorStop(1, "#05070a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(230, 230, 230, 0.75)";
  ctx.font = "600 56px system-ui, sans-serif";
  // Straight ahead (yaw 0) is image column u = 0.75 on this inside-out sphere.
  ctx.fillText(label || "placeholder", canvas.width * 0.75, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function loadPanoramaTexture(path, label) {
  return new Promise((resolve) => {
    if (!path) {
      resolve(makePlaceholderTexture(label));
      return;
    }
    textureLoader.load(path, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; resolve(tex); }, undefined, () =>
      resolve(makePlaceholderTexture(label))
    );
  });
}

function initViewer() {
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 1, 1100);
  camera.position.set(0, 0, 0.01);

  const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 60, 40);
  geometry.scale(-1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ map: makePlaceholderTexture("") });
  sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);

  textureLoader = new THREE.TextureLoader();
  raycaster = new THREE.Raycaster();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.rotateSpeed = -0.25;
  controls.target.set(0, 0, 0);

  resizeViewer();
  new ResizeObserver(resizeViewer).observe(viewerEl);
  canvasEl.addEventListener("click", onViewerClick);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    updatePinPositions();
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

async function setScene(path, label, startYaw = 0, startPitch = 0) {
  const texture = await loadPanoramaTexture(path, label);
  const old = sphere.material.map;
  sphere.material.map = texture;
  sphere.material.needsUpdate = true;
  if (old) old.dispose();
  camera.position.copy(yawPitchToVector3(startYaw, startPitch, 0.01)).negate();
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}

function onViewerClick(event) {
  const rect = canvasEl.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(sphere);
  if (!hits.length) return;
  const dir = hits[0].point.clone().normalize();
  const { yaw, pitch } = vector3ToYawPitch(dir);
  showPendingPin(yaw, pitch);
}

function renderPins() {
  hotspotLayerEl.innerHTML = "";
  pinEls = [];
  for (const p of pins) {
    const el = document.createElement("div");
    el.className = "editor-pin";
    el.title = `${p.id} (yaw ${Math.round(p.yaw)}, pitch ${Math.round(p.pitch)}) -- click to remove`;
    el.addEventListener("click", () => {
      pins = pins.filter((x) => x !== p);
      renderPins();
      renderPinList();
      renderExport();
    });
    hotspotLayerEl.appendChild(el);
    pinEls.push({ el, pos: yawPitchToVector3(p.yaw, p.pitch) });
  }
}

function updatePinPositions() {
  if (!pinEls.length) return;
  const w = viewerEl.clientWidth;
  const h = viewerEl.clientHeight;
  for (const p of pinEls) {
    const v = p.pos.clone().project(camera);
    if (v.z > 1) {
      p.el.style.display = "none";
      continue;
    }
    p.el.style.display = "block";
    p.el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
    p.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
  }
}

// -- Pending-pin form -------------------------------------------------

function showPendingPin(yaw, pitch) {
  pendingYawPitch = { yaw, pitch };
  pendingYawEl.textContent = yaw.toFixed(1);
  pendingPitchEl.textContent = pitch.toFixed(1);
  pendingIdsEl.innerHTML = "";
  for (const p of pins) {
    const el = document.createElement("option");
    el.value = p.id;
    pendingIdsEl.appendChild(el);
  }
  pendingTargetEl.value = "";
  pendingLabelEl.value = "";
  pendingPinEl.hidden = false;
  pendingTargetEl.focus();
}

function upsertPin(id, yaw, pitch, label) {
  const rounded = { yaw: Math.round(yaw * 10) / 10, pitch: Math.round(pitch * 10) / 10 };
  const existing = pins.find((p) => p.id === id);
  if (existing) {
    Object.assign(existing, rounded);
    if (label) existing.label = label;
  } else {
    pins.push({ id, label: label || id, ...rounded });
  }
  renderPins();
  renderPinList();
  renderExport();
}

document.getElementById("pending-add").addEventListener("click", () => {
  if (!pendingYawPitch) return;
  const id = pendingTargetEl.value.trim();
  if (!id) {
    pendingTargetEl.focus();
    return;
  }
  upsertPin(id, pendingYawPitch.yaw, pendingYawPitch.pitch, pendingLabelEl.value.trim());
  pendingPinEl.hidden = true;
  pendingYawPitch = null;
});

document.getElementById("pending-cancel").addEventListener("click", () => {
  pendingPinEl.hidden = true;
  pendingYawPitch = null;
});

// Dev-only hook for placing hotspots by exact yaw/pitch without needing a
// precise on-canvas click -- useful when authoring many hotspots at once.
window.__addHotspot = (id, yaw, pitch, label) => upsertPin(id, yaw, pitch, label);
window.__clearHotspots = () => {
  pins = [];
  renderPins();
  renderPinList();
  renderExport();
};
window.__getHotspotsJSON = () => JSON.stringify(pins, null, 2);

// -- Pin list + JSON export -------------------------------------------

function renderPinList() {
  pinListEl.innerHTML = "";
  for (const p of pins) {
    const row = document.createElement("div");
    row.className = "pin-row";
    const label = document.createElement("span");
    label.textContent = `${p.id} -- "${p.label}" (yaw ${p.yaw}, pitch ${p.pitch})`;
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      pins = pins.filter((x) => x !== p);
      renderPins();
      renderPinList();
      renderExport();
    });
    row.append(label, remove);
    pinListEl.appendChild(row);
  }
}

function renderExport() {
  exportTextEl.value = JSON.stringify(pins, null, 2);
}

document.getElementById("export-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(exportTextEl.value);
  } catch {
    exportTextEl.select(); // clipboard API unavailable (e.g. non-HTTPS) -- select so Ctrl+C still works
  }
});

// -- Chapter / scene pickers --------------------------------------------

async function loadScene() {
  currentScene = game.scene(roomSelectEl.value);
  pins = (currentScene.hotspots || []).map((h) => ({ ...h }));
  renderPins();
  renderPinList();
  renderExport();
  await setScene(currentScene.panorama, currentScene.name, currentScene.startYaw, currentScene.startPitch);
}

async function loadChapter(chapterId) {
  roomSelectEl.innerHTML = "";
  for (const scene of game.scenes.values()) {
    if (scene.chapter !== chapterId) continue;
    const el = document.createElement("option");
    el.value = scene.id;
    el.textContent = scene.name || scene.id;
    roomSelectEl.appendChild(el);
  }
  await loadScene();
}

roomSelectEl.addEventListener("change", loadScene);
zoneSelectEl.addEventListener("change", () => loadChapter(zoneSelectEl.value));

async function main() {
  initViewer();
  game = await Game.load();
  for (const chapter of game.chapters) {
    const el = document.createElement("option");
    el.value = chapter.id;
    el.textContent = chapter.title || chapter.id;
    zoneSelectEl.appendChild(el);
  }
  await loadChapter(game.chapters[0].id);
}

main();
