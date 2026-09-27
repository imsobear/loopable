type Phase = "in" | "orbit" | "run" | "back";

type Signal = {
  phase: Phase;
  t: number;
  color: string;
  origin: { x: number; y: number };
  entry: number;
  exit: number;
};

const SOURCES = ["--slack", "--lark", "--github", "--live"];
const DURATION: Record<Phase, number> = { in: 900, orbit: 1500, run: 420, back: 1000 };
const TRAIL = 14;
const STEP = 16;
const GAP = 0.42;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;

export function startFooter(stage: HTMLElement, canvas: HTMLCanvasElement, counter: HTMLElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const css = getComputedStyle(document.documentElement);
  const colors = SOURCES.map((name) => css.getPropertyValue(name).trim() || "#f2eee6");
  const ink = css.getPropertyValue("--ink").trim() || "#f2eee6";
  const live = css.getPropertyValue("--live").trim() || "#d4ff3f";
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w = 0;
  let h = 0;
  let runs = 0;
  let pulse = 0;
  let visible = false;
  let last = 0;
  let nextSpawn = 0;
  const signals: Signal[] = [];

  const center = () => ({ x: w / 2, y: h * 0.44 });
  const radius = () => Math.min(w * 0.34, h * 0.34);
  const onRing = (a: number) => {
    const c = center();
    const r = radius();
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = stage.clientWidth;
    h = stage.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (still) draw();
  }

  function edgePoint() {
    const side = Math.floor(Math.random() * 3);
    if (side === 0) return { x: -20, y: Math.random() * h * 0.7 };
    if (side === 1) return { x: w + 20, y: Math.random() * h * 0.7 };
    return { x: Math.random() * w, y: -20 };
  }

  function spawn(origin = edgePoint()) {
    if (signals.length > 28) return;
    const c = center();
    const entry = Math.atan2(origin.y - c.y, origin.x - c.x);
    signals.push({
      phase: "in",
      t: 0,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      origin,
      entry,
      // The mark's arrow points anticlockwise, so work travels that way.
      exit: entry - Math.PI * (0.9 + Math.random() * 0.5),
    });
  }

  function position(s: Signal, t = s.t) {
    const c = center();
    const p = Math.min(Math.max(t, 0) / DURATION[s.phase], 1);
    if (s.phase === "in") {
      const to = onRing(s.entry);
      const k = ease(p);
      return { x: s.origin.x + (to.x - s.origin.x) * k, y: s.origin.y + (to.y - s.origin.y) * k };
    }
    if (s.phase === "orbit") return onRing(s.entry + (s.exit - s.entry) * ease(p));
    if (s.phase === "run") {
      const from = onRing(s.exit);
      const k = easeIn(p);
      return { x: from.x + (c.x - from.x) * k, y: from.y + (c.y - from.y) * k };
    }
    const k = ease(p);
    return { x: c.x + (s.origin.x - c.x) * k, y: c.y + (s.origin.y - c.y) * k };
  }

  function advance(s: Signal, dt: number) {
    s.t += dt;
    if (s.t < DURATION[s.phase]) return true;
    s.t = 0;
    if (s.phase === "in") s.phase = "orbit";
    else if (s.phase === "orbit") s.phase = "run";
    else if (s.phase === "run") {
      s.phase = "back";
      s.color = live;
      pulse = 1;
      runs += 1;
      counter.textContent = String(runs);
    } else return false;
    return true;
  }

  function drawRing() {
    const c = center();
    const r = radius();
    const top = -Math.PI / 2;
    ctx!.lineWidth = 1.5;
    ctx!.strokeStyle = "rgba(242, 238, 230, 0.2)";
    ctx!.beginPath();
    ctx!.arc(c.x, c.y, r, top + GAP, top + Math.PI * 2 - 0.08);
    ctx!.stroke();

    const tip = onRing(top);
    ctx!.fillStyle = "rgba(242, 238, 230, 0.35)";
    ctx!.beginPath();
    ctx!.moveTo(tip.x - 12, tip.y);
    ctx!.lineTo(tip.x + 4, tip.y - 7);
    ctx!.lineTo(tip.x + 4, tip.y + 7);
    ctx!.closePath();
    ctx!.fill();

    ctx!.strokeStyle = "rgba(242, 238, 230, 0.06)";
    ctx!.lineWidth = 1;
    ctx!.beginPath();
    ctx!.arc(c.x, c.y, r * 0.62, 0, Math.PI * 2);
    ctx!.stroke();

    const glow = 7 + pulse * 26;
    ctx!.fillStyle = `rgba(212, 255, 63, ${0.1 + pulse * 0.25})`;
    ctx!.beginPath();
    ctx!.arc(c.x, c.y, glow, 0, Math.PI * 2);
    ctx!.fill();
    ctx!.fillStyle = pulse > 0.05 ? live : ink;
    ctx!.beginPath();
    ctx!.arc(c.x, c.y, 6, 0, Math.PI * 2);
    ctx!.fill();

    ctx!.font = '500 10px "Geist Mono", ui-monospace, monospace';
    ctx!.fillStyle = "rgba(242, 238, 230, 0.4)";
    ctx!.textAlign = "center";
    ctx!.fillText("RUNNER", c.x, c.y + 26);
  }

  // Sampled from time rather than kept per frame, so a slow frame rate still
  // draws a curve instead of a few long straight strokes.
  function trailOf(s: Signal) {
    const points: { x: number; y: number }[] = [];
    for (let k = TRAIL; k >= 0; k--) {
      const t = s.t - k * STEP;
      if (t < 0) continue;
      points.push(position(s, t));
    }
    return points;
  }

  function drawSignal(s: Signal) {
    const trail = trailOf(s);
    const n = trail.length;
    for (let i = 1; i < n; i++) {
      const a = trail[i - 1]!;
      const b = trail[i]!;
      ctx!.globalAlpha = (i / n) * 0.55;
      ctx!.strokeStyle = s.color;
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.moveTo(a.x, a.y);
      ctx!.lineTo(b.x, b.y);
      ctx!.stroke();
    }
    const head = trail[n - 1];
    if (!head) return;
    ctx!.globalAlpha = s.phase === "back" ? 1 - Math.min(s.t / DURATION.back, 1) * 0.8 : 1;
    ctx!.fillStyle = s.color;
    ctx!.shadowColor = s.color;
    ctx!.shadowBlur = 12;
    ctx!.beginPath();
    ctx!.arc(head.x, head.y, 3.5, 0, Math.PI * 2);
    ctx!.fill();
    ctx!.shadowBlur = 0;
    ctx!.globalAlpha = 1;
  }

  function draw() {
    ctx!.clearRect(0, 0, w, h);
    drawRing();
    for (const s of signals) drawSignal(s);
  }

  function frame(now: number) {
    const dt = last ? Math.min(now - last, 250) : 16;
    last = now;
    if (visible && !document.hidden) {
      if (now > nextSpawn) {
        spawn();
        nextSpawn = now + 1100 + Math.random() * 1300;
      }
      for (let i = signals.length - 1; i >= 0; i--) {
        const s = signals[i]!;
        if (!advance(s, dt)) signals.splice(i, 1);
      }
      pulse = Math.max(0, pulse - dt / 700);
      draw();
    }
    requestAnimationFrame(frame);
  }

  new ResizeObserver(resize).observe(stage);
  resize();

  if (still) {
    draw();
    return;
  }

  new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
  }).observe(stage);

  stage.addEventListener("pointerdown", (event) => {
    const box = stage.getBoundingClientRect();
    spawn({ x: event.clientX - box.left, y: event.clientY - box.top });
  });

  requestAnimationFrame(frame);
}
