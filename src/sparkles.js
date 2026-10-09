// Tinsel goggles: twinkling four-point sparkles drifting over the whole
// page. Drawn on a full-screen canvas inside #goggles-overlay, which never
// takes pointer events, so everything underneath stays clickable and
// draggable. The animation loop only runs while the goggles are on.

const COLORS = ["#fff6d5", "#ffd54f", "#ffe082", "#ff8a80", "#b9f6ca", "#ffffff"];
const DENSITY = 1 / 9000; // sparkles per square CSS pixel
const MAX_SPARKLES = 260;

const overlayEl = document.getElementById("goggles-overlay");
const canvas = document.getElementById("goggles-canvas");
const ctx = canvas.getContext("2d");
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let sparkles = [];
let running = false;
let rafId = null;
let lastTime = 0;
let width = 0;
let height = 0;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function makeSparkle(anywhere = true) {
  return {
    x: rand(0, width),
    y: anywhere ? rand(0, height) : rand(-20, 0),
    size: rand(2, 7),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    phase: rand(0, Math.PI * 2),
    speed: rand(1.5, 4), // twinkles per ~4 seconds
    driftX: rand(-8, 8), // px per second
    driftY: rand(6, 22),
    spin: rand(-0.6, 0.6),
    angle: rand(0, Math.PI),
  };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const target = Math.min(MAX_SPARKLES, Math.round(width * height * DENSITY));
  while (sparkles.length < target) sparkles.push(makeSparkle());
  sparkles.length = target;
}

// A four-point star with a soft glow.
function drawSparkle(s, brightness) {
  const r = s.size * (0.4 + brightness);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);
  ctx.globalAlpha = brightness;
  ctx.shadowColor = s.color;
  ctx.shadowBlur = r * 2.5;
  ctx.fillStyle = s.color;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.lineTo(Math.cos(a) * r * 2.2, Math.sin(a) * r * 2.2);
    ctx.lineTo(Math.cos(a + Math.PI / 4) * r * 0.35, Math.sin(a + Math.PI / 4) * r * 0.35);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function frame(time) {
  if (!running) return;
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
  lastTime = time;
  ctx.clearRect(0, 0, width, height);
  for (const s of sparkles) {
    if (!reducedMotion) {
      s.x += s.driftX * dt;
      s.y += s.driftY * dt;
      s.angle += s.spin * dt;
      if (s.y > height + 20 || s.x < -20 || s.x > width + 20) Object.assign(s, makeSparkle(false));
    }
    const twinkle = reducedMotion ? 0.7 : 0.5 + 0.5 * Math.sin(s.phase + (time / 1000) * s.speed);
    const brightness = Math.pow(twinkle, 3); // mostly dim, with sharp bright flashes
    if (brightness > 0.02) drawSparkle(s, brightness);
  }
  rafId = requestAnimationFrame(frame);
}

window.addEventListener("resize", () => {
  if (running) resize();
});

export const Sparkles = {
  setOn(on) {
    overlayEl.classList.toggle("on", on);
    if (on && !running) {
      running = true;
      lastTime = 0;
      resize();
      rafId = requestAnimationFrame(frame);
    } else if (!on && running) {
      running = false;
      cancelAnimationFrame(rafId);
      // Clear once the overlay's fade-out has finished.
      setTimeout(() => {
        if (!running) ctx.clearRect(0, 0, width, height);
      }, 450);
    }
  },
};
