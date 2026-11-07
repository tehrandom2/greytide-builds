// The hero: a tiny live tabletop. Painted towers shoot an unpainted grey horde walking a road across a board
// on a cutting mat, under one lamp. Click or tap a grunt to flick it. Pure canvas, no assets; pauses off screen
// and when the tab is hidden; with reduced motion it draws one still frame.
(() => {
  "use strict";
  const canvas = document.getElementById("diorama");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasBlur = "filter" in ctx;

  let W = 0, H = 0, K = 1, DPR = 1, Y0 = 0;
  const dudes = [], parts = [], shots = [], flashes = [];
  const towers = [];
  let t = 0, spawnIn = 0.3, running = false, last = 0, flicked = 0, counter = null;

  // deterministic-enough rng so the still frame is the same every time
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rr = (a, b) => a + (b - a) * rnd();

  // ------------------------------------------------------------ layout
  const roadY = (x) => H * 0.72 + Math.sin(x / (W * 0.16) + 0.6) * H * 0.045 + Math.sin(x / (W * 0.07)) * H * 0.012;
  const depth = (y) => 0.5 + 0.95 * Math.min(1.2, Math.max(0, (y - Y0) / (H - Y0)));

  function resize() {
    const r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, r.width); H = Math.max(300, r.height);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    K = Math.max(0.62, Math.min(1.25, W / 1150));
    Y0 = H * 0.38;
    towers.length = 0;
    const defs = [
      { kind: "cannon", fx: 0.27, side: 1, color: "#d1432c", dark: "#7c2214", rate: 1.5, range: 200 },
      { kind: "mage", fx: 0.52, side: 1, color: "#8a5bb8", dark: "#4d2d70", rate: 1.05, range: 210 },
      { kind: "ballista", fx: 0.77, side: 1, color: "#2f9e94", dark: "#17564f", rate: 0.8, range: 210 },
    ];
    defs.forEach((d, i) => {
      const x = W * d.fx;
      towers.push({ ...d, x, y: roadY(x) + d.side * (78 + (i === 1 ? 6 : 0)) * K * 0.95, cd: 0.6 + i * 0.4, aim: 0, orb: rnd() * 6 });
    });
    if (reduce) { warm(); draw(); }
  }

  // ------------------------------------------------------------ entities
  function spawn(big) {
    const y = roadY(-30) + rr(-14, 14) * K;
    dudes.push({ x: -30 * K, y, off: rr(-16, 16), speed: (big ? 24 : rr(34, 58)) * K, ph: rnd() * 6.28, hp: big ? 3 : 1, big, v: (rnd() * 3) | 0, lift: 0 });
  }

  function killDude(d, fromX, fromY, power) {
    const i = dudes.indexOf(d);
    if (i < 0) return;
    dudes.splice(i, 1);
    const s = depth(d.y) * K * (d.big ? 1.6 : 1);
    const dx = Math.sign(d.x - fromX) || 1;
    const mk = (kind, dz, w, h) => parts.push({ kind, x: d.x, y: d.y, z: dz * s * 1.25, vx: dx * rr(30, 130) * power * K + rr(-20, 20), vy: rr(-40, 40), vz: rr(110, 330) * power * K, rot: rr(-1, 1), vr: rr(-9, 9), life: 0, s, w, h });
    mk("head", 40, 0, 0); mk("torso", 26, 0, 0); mk("arm", 32, 0, 0); mk("arm", 30, 0, 0); mk("leg", 12, 0, 0); mk("leg", 10, 0, 0); mk("base", 1, 0, 0);
    flashes.push({ x: d.x, y: d.y - 30 * s, r: 0, life: 0 });
    if (counter && power > 1) { flicked++; }
  }

  function fire(tw, target) {
    const s = depth(tw.y) * K;
    const sx = tw.x + (tw.kind === "mage" ? 0 : 6 * s), sy = tw.y - (tw.kind === "mage" ? 74 : 54) * s;
    const dist = 520 * K, lead = 0.0;
    const ttx = target.x + target.speed * (Math.hypot(target.x - sx, target.y - sy) / dist) * 1.0 + lead;
    const tx = ttx, ty = target.y - 30 * depth(target.y) * K;
    const a = Math.atan2(ty - sy, tx - sx), L = Math.hypot(tx - sx, ty - sy);
    shots.push({ x: sx, y: sy, px: sx, py: sy, tx, ty, vx: Math.cos(a) * dist, vy: Math.sin(a) * dist, left: L, kind: tw.kind, color: tw.color, target, ground: tw.y });
    tw.recoil = 1;
    tw.aim = a;
  }

  function step(dt) {
    t += dt;
    spawnIn -= dt;
    if (spawnIn <= 0) {
      const wave = Math.floor(t / 14) % 2 === 1;
      spawn(Math.floor(t / 7) % 5 === 4 && rnd() < 0.5);
      spawnIn = wave ? rr(0.35, 0.7) : rr(1.1, 2.0);
    }
    for (const d of dudes) {
      d.x += d.speed * dt; d.ph += dt * d.speed * 0.17 / K;
      d.y = roadY(d.x) + d.off * K * 0.8;
    }
    for (let i = dudes.length - 1; i >= 0; i--) if (dudes[i].x > W + 50) dudes.splice(i, 1);

    for (const tw of towers) {
      tw.cd -= dt; tw.recoil = Math.max(0, (tw.recoil || 0) - dt * 4); tw.orb += dt;
      if (tw.cd > 0) continue;
      let best = null, bd = tw.range * K;
      for (const d of dudes) { const dd = Math.hypot(d.x - tw.x, (d.y - tw.y) * 1.6); if (dd < bd && d.x > 0) { bd = dd; best = d; } }
      if (best) { fire(tw, best); tw.cd = tw.rate * rr(0.9, 1.15); }
    }
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.px = s.x; s.py = s.y;
      s.x += s.vx * dt; s.y += s.vy * dt; s.left -= Math.hypot(s.vx, s.vy) * dt;
      if (s.left <= 0) {
        shots.splice(i, 1);
        const hit = [];
        for (const d of dudes) if (Math.hypot(d.x - s.tx, (d.y - 30 * depth(d.y) * K) - s.ty) < (s.kind === "cannon" ? 44 : 26) * K) hit.push(d);
        hit.forEach((d) => { d.hp--; if (d.hp <= 0) killDude(d, s.tx - 10, s.ty, 1); else { d.speed *= 0.6; flashes.push({ x: d.x, y: d.y - 30 * depth(d.y) * K, r: 0, life: 0 }); } });
        flashes.push({ x: s.tx, y: s.ty, r: 0, life: 0 });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt; p.vz -= 900 * K * dt; p.z += p.vz * dt; p.x += p.vx * dt; p.y += p.vy * dt * 0.4; p.rot += p.vr * dt;
      if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.32; p.vx *= 0.7; p.vy *= 0.7; p.vr *= 0.6; if (Math.abs(p.vz) < 24) p.vz = 0; }
      if (p.life > 3.2) parts.splice(i, 1);
    }
    for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].life += dt; if (flashes[i].life > 0.3) flashes.splice(i, 1); }
    if (counter) counter.textContent = flicked ? "grunts flicked: " + flicked : "";
  }

  function warm() { seed = 7; dudes.length = 0; parts.length = 0; shots.length = 0; t = 0; for (let i = 0; i < 520; i++) step(1 / 30); }

  // ------------------------------------------------------------ drawing
  const G = { hi: "#d9dcdf", mid: "#a9adb2", lo: "#6f7378", edge: "#4a4d51" };

  function shadow(x, y, w, h, a) {
    // the lamp is up and to the right, so shadows fall down-left
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath(); ctx.ellipse(x - w * 0.35, y + h * 0.15, w, h, -0.12, 0, 6.283); ctx.fill();
  }

  function drawMat() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0f2420"); g.addColorStop(0.5, "#18362f"); g.addColorStop(1, "#1d4036");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // cutting-mat grid in perspective
    ctx.strokeStyle = "rgba(255,255,255,.075)"; ctx.lineWidth = 1;
    const vx = W * 0.5, vy = -H * 1.2;
    ctx.beginPath();
    for (let i = -14; i <= 14; i++) { const bx = vx + i * W * 0.11; ctx.moveTo(vx + (bx - vx) * 0.0, vy); ctx.lineTo(bx + (bx - vx) * 0.5, H); }
    ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 22; k++) { const f = Math.pow(k / 21, 1.7); const y = H * (0.02 + f * 1.05); ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.04)";
    // the board
    const topY = Y0 + 8, L0 = W * 0.10, R0 = W * 0.90, L1 = -W * 0.18, R1 = W * 1.18;
    ctx.fillStyle = "#0a0907";
    ctx.beginPath(); ctx.moveTo(L0 - 8, topY - 14); ctx.lineTo(R0 + 8, topY - 14); ctx.lineTo(R1 + 40, H + 40); ctx.lineTo(L1 - 40, H + 40); ctx.closePath(); ctx.fill();
    const bg = ctx.createLinearGradient(0, topY, 0, H);
    bg.addColorStop(0, "#4b4d3c"); bg.addColorStop(0.5, "#5b5f45"); bg.addColorStop(1, "#68694b");
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(L0, topY); ctx.lineTo(R0, topY); ctx.lineTo(R1, H + 30); ctx.lineTo(L1, H + 30); ctx.closePath(); ctx.fill();
    // flock tufts
    for (let i = 0; i < 160; i++) {
      const a = (i * 0.6180339) % 1, b = (i * 0.7548776) % 1;
      const y = topY + (H - topY) * Math.pow(b, 1.1), x = W * (-0.1 + 1.2 * a);
      const s = depth(y) * K;
      ctx.fillStyle = i % 3 ? "rgba(93,128,64,.55)" : "rgba(112,98,60,.5)";
      ctx.fillRect(x, y, 3 * s, 1.6 * s);
    }
    // the road
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const pass of [[1.0, "#2c2418"], [0.86, "#8d7a54"], [0.62, "#a48e63"]]) {
      ctx.beginPath();
      for (let x = -40; x <= W + 40; x += 12) { const y = roadY(x); if (x < -39) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.strokeStyle = pass[1]; ctx.lineWidth = 104 * K * pass[0]; ctx.stroke();
    }
    // pebbles
    for (let i = 0; i < 90; i++) {
      const x = (i * 97.3) % (W + 40) - 20, y = roadY(x) + (((i * 31) % 17) - 8) * K * 2.2, s = depth(y) * K;
      ctx.fillStyle = i % 2 ? "rgba(70,58,38,.7)" : "rgba(196,178,134,.6)";
      ctx.beginPath(); ctx.ellipse(x, y, 2.4 * s, 1.5 * s, 0, 0, 6.283); ctx.fill();
    }
  }

  function drawSprue() {
    // a sprue frame with unpainted dudes still attached, the thing the horde came out of
    const x = W * 0.84, y = Y0 + 24, s = 0.62 * K;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.08); ctx.scale(s, s);
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(-150, 18, 300, 12);
    ctx.fillStyle = G.mid; ctx.fillRect(-150, 0, 300, 10); ctx.fillStyle = G.hi; ctx.fillRect(-150, 0, 300, 3);
    for (let i = 0; i < 5; i++) {
      const px = -120 + i * 60;
      ctx.fillStyle = G.lo; ctx.fillRect(px - 1.5, 9, 3, 12);
      ctx.fillStyle = G.mid; ctx.beginPath(); ctx.arc(px, 30, 7, 0, 6.283); ctx.fill();
      ctx.fillRect(px - 5, 36, 10, 24); ctx.fillRect(px - 8, 38, 3, 18); ctx.fillRect(px + 5, 38, 3, 18);
      ctx.fillStyle = G.hi; ctx.fillRect(px + 1, 37, 3, 22);
    }
    ctx.restore();
  }

  function drawDude(d) {
    const s = depth(d.y) * K * (d.big ? 1.55 : 1) * 1.25;
    const sw = Math.sin(d.ph) * 0.9, x = d.x, y = d.y;
    shadow(x, y, 15 * s, 5 * s, 0.4);
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    // base
    ctx.fillStyle = G.lo; ctx.beginPath(); ctx.ellipse(0, 1, 13, 5.2, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = G.mid; ctx.beginPath(); ctx.ellipse(0, -1.5, 13, 5, 0, 0, 6.283); ctx.fill();
    // legs
    ctx.lineCap = "round"; ctx.strokeStyle = G.lo; ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.moveTo(-2.5, -12); ctx.lineTo(-2.5 + sw * 5, -3); ctx.moveTo(2.5, -12); ctx.lineTo(2.5 - sw * 5, -3); ctx.stroke();
    // torso
    ctx.fillStyle = G.mid; rrect(-6, -31, 12, 20, 3); ctx.fill();
    ctx.fillStyle = G.hi; rrect(2, -30, 3, 17, 1.5); ctx.fill();
    // arms
    ctx.strokeStyle = G.mid; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-6, -28); ctx.lineTo(-9 - sw * 3, -17); ctx.moveTo(6, -28); ctx.lineTo(9 + sw * 3, -17); ctx.stroke();
    // head
    ctx.fillStyle = G.hi; ctx.beginPath(); ctx.arc(0, -37, 6.4, 0, 6.283); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.beginPath(); ctx.arc(-1.8, -36.2, 6, 0, 6.283); ctx.fill();
    ctx.fillStyle = G.hi; ctx.beginPath(); ctx.arc(0.8, -37.4, 5.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#3a3c40"; ctx.fillRect(-1, -38, 1.7, 2.6); ctx.fillRect(2.4, -38, 1.7, 2.6); // two eye holes, that's the whole face
    if (d.v === 1) { ctx.fillStyle = G.lo; rrect(-8, -45, 16, 5, 2); ctx.fill(); }     // a bucket helmet
    if (d.v === 2) { ctx.strokeStyle = G.lo; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10 + sw * 3, -17); ctx.lineTo(12 + sw * 3, -38); ctx.stroke(); } // a stick, held
    if (d.big) { ctx.fillStyle = G.lo; rrect(-12, -33, 24, 6, 3); ctx.fill(); }
    ctx.restore();
  }

  function rrect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawPart(p) {
    const s = p.s * 1.25, x = p.x, y = p.y - p.z;
    const fade = p.life > 2.4 ? Math.max(0, 1 - (p.life - 2.4) / 0.8) : 1;
    ctx.globalAlpha = fade;
    if (p.kind === "base") { shadow(p.x, p.y, 14 * s, 5 * s, 0.28); }
    else shadow(p.x, p.y, 7 * s * (1 - Math.min(0.6, p.z / 200)), 3 * s, 0.3 * (1 - Math.min(0.7, p.z / 200)));
    ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.scale(s, s);
    if (p.kind === "head") { ctx.fillStyle = G.hi; ctx.beginPath(); ctx.arc(0, 0, 6.4, 0, 6.283); ctx.fill(); ctx.fillStyle = "#3a3c40"; ctx.fillRect(-2, -1, 1.7, 2.6); ctx.fillRect(1.4, -1, 1.7, 2.6); }
    else if (p.kind === "torso") { ctx.fillStyle = G.mid; rrect(-6, -10, 12, 20, 3); ctx.fill(); ctx.fillStyle = G.hi; rrect(2, -9, 3, 17, 1.5); ctx.fill(); }
    else if (p.kind === "arm") { ctx.fillStyle = G.mid; rrect(-1.7, -7, 3.4, 14, 1.7); ctx.fill(); }
    else if (p.kind === "leg") { ctx.fillStyle = G.lo; rrect(-2.1, -7, 4.2, 14, 2); ctx.fill(); }
    else { ctx.fillStyle = G.lo; ctx.beginPath(); ctx.ellipse(0, 1, 13, 5.2, 0, 0, 6.283); ctx.fill(); ctx.fillStyle = G.mid; ctx.beginPath(); ctx.ellipse(0, -1.5, 13, 5, 0, 0, 6.283); ctx.fill(); }
    ctx.restore(); ctx.globalAlpha = 1;
  }

  function drawTower(tw) {
    const s = depth(tw.y) * K * 1.5, x = tw.x, y = tw.y, rc = (tw.recoil || 0) * 3;
    shadow(x, y, 26 * s, 8 * s, 0.45);
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    // round base, brass, like every tower mini
    ctx.fillStyle = "#4a3a1c"; ctx.beginPath(); ctx.ellipse(0, 2, 24, 9, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#c79a3b"; ctx.beginPath(); ctx.ellipse(0, -2, 24, 9, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#8a8d92"; ctx.beginPath(); ctx.ellipse(0, -4, 20, 7.2, 0, 0, 6.283); ctx.fill(); // the felt-tip-black rim is the owner's job
    // body: painted cylinder with the lamp on its right side
    const grad = ctx.createLinearGradient(-15, 0, 15, 0);
    grad.addColorStop(0, tw.dark); grad.addColorStop(0.55, tw.color); grad.addColorStop(0.85, "#ffffff55"); grad.addColorStop(1, tw.color);
    ctx.fillStyle = tw.color; rrect(-14, -48, 28, 44, 5); ctx.fill();
    ctx.fillStyle = grad; ctx.globalAlpha = 0.9; rrect(-14, -48, 28, 44, 5); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(-14, -30, 28, 3);                // a stripe, cleanly painted
    ctx.fillStyle = "#dca834"; ctx.fillRect(-14, -34, 28, 3);
    if (tw.kind === "cannon") {
      ctx.save(); ctx.translate(0, -52); ctx.rotate(Math.max(-0.7, Math.min(0.2, Math.cos(tw.aim) < 0 ? 0.2 : tw.aim * 0.5)));
      ctx.scale(Math.cos(tw.aim) < 0 ? -1 : 1, 1);
      ctx.fillStyle = "#2c2f34"; rrect(-6 - rc, -7, 36, 14, 5); ctx.fill(); ctx.fillStyle = "#555a61"; rrect(-6 - rc, -7, 36, 6, 3); ctx.fill();
      ctx.fillStyle = "#17191c"; ctx.beginPath(); ctx.ellipse(30 - rc, 0, 3, 6, 0, 0, 6.283); ctx.fill();
      ctx.restore();
      ctx.fillStyle = tw.dark; rrect(-16, -53, 32, 8, 3); ctx.fill();
    } else if (tw.kind === "mage") {
      ctx.fillStyle = tw.dark; rrect(-17, -51, 34, 8, 3); ctx.fill();
      const bob = Math.sin(tw.orb * 2.2) * 3 - rc;
      const gl = ctx.createRadialGradient(0, -72 + bob, 2, 0, -72 + bob, 30);
      gl.addColorStop(0, "rgba(240,200,255,.95)"); gl.addColorStop(0.35, "rgba(170,110,255,.55)"); gl.addColorStop(1, "rgba(120,60,200,0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -72 + bob, 30, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#f2d9ff"; ctx.beginPath(); ctx.arc(0, -72 + bob, 7, 0, 6.283); ctx.fill();
      ctx.strokeStyle = "#dca834"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-10, -52); ctx.lineTo(-6, -64); ctx.moveTo(10, -52); ctx.lineTo(6, -64); ctx.stroke();
    } else {
      ctx.fillStyle = tw.dark; rrect(-17, -51, 34, 8, 3); ctx.fill();
      ctx.save(); ctx.translate(0, -58); const flip = Math.cos(tw.aim) < 0 ? -1 : 1; ctx.scale(flip, 1);
      ctx.strokeStyle = "#5a3a1c"; ctx.lineWidth = 3.4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(28 - rc, -6); ctx.stroke();                // the stock
      ctx.beginPath(); ctx.moveTo(18 - rc, -22); ctx.quadraticCurveTo(26 - rc - (tw.recoil || 0) * 7, -6, 18 - rc, 10); ctx.stroke(); // the bow
      ctx.strokeStyle = "#e8e0c8"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(18 - rc, -22); ctx.lineTo(12 - rc, -6); ctx.lineTo(18 - rc, 10); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawShots() {
    for (const s of shots) {
      const sc = depth(s.y) * K;
      ctx.lineCap = "round";
      const g = s.kind === "mage" ? "rgba(214,160,255," : s.kind === "cannon" ? "rgba(255,200,120," : "rgba(255,240,200,";
      ctx.strokeStyle = g + ".55)"; ctx.lineWidth = 3 * sc;
      ctx.beginPath(); ctx.moveTo(s.px - (s.x - s.px) * 3, s.py - (s.y - s.py) * 3); ctx.lineTo(s.x, s.y); ctx.stroke();
      ctx.fillStyle = s.kind === "mage" ? "#e9ccff" : s.kind === "cannon" ? "#2a2a2e" : "#fff4d6";
      ctx.beginPath(); ctx.arc(s.x, s.y, (s.kind === "cannon" ? 5 : 3.2) * sc, 0, 6.283); ctx.fill();
    }
    for (const f of flashes) {
      const a = 1 - f.life / 0.3; ctx.strokeStyle = `rgba(255,214,150,${a})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, 6 + f.life * 80 * K, 0, 6.283); ctx.stroke();
    }
  }

  function drawForeground() {
    // out-of-focus things at the front edge of the photo: a paint pot, a brush
    ctx.save();
    if (hasBlur) ctx.filter = "blur(5px)";
    const bx = W * 0.07, by = H * 0.97, s = K * 1.7;
    ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.ellipse(bx - 14, by + 6, 62 * s, 14 * s, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#2b2f36"; rrect(bx - 34 * s, by - 52 * s, 68 * s, 52 * s, 8 * s); ctx.fill();
    ctx.fillStyle = "#d1432c"; ctx.beginPath(); ctx.ellipse(bx, by - 52 * s, 34 * s, 10 * s, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(bx + 14 * s, by - 48 * s, 8 * s, 46 * s);
    ctx.strokeStyle = "#3a2a18"; ctx.lineWidth = 9 * s; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(W * 0.93, H * 1.02); ctx.lineTo(W * 0.80, H * 0.88); ctx.stroke();
    ctx.strokeStyle = "#caa24a"; ctx.lineWidth = 10 * s; ctx.beginPath(); ctx.moveTo(W * 0.80, H * 0.88); ctx.lineTo(W * 0.775, H * 0.855); ctx.stroke();
    ctx.strokeStyle = "#d1432c"; ctx.lineWidth = 8 * s; ctx.beginPath(); ctx.moveTo(W * 0.775, H * 0.855); ctx.lineTo(W * 0.762, H * 0.84); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawMat(); drawSprue();
    const list = [];
    towers.forEach((o) => list.push([o.y, 0, o]));
    dudes.forEach((o) => list.push([o.y, 1, o]));
    parts.forEach((o) => list.push([o.y, 2, o]));
    list.sort((a, b) => a[0] - b[0]);
    for (const [, k, o] of list) (k === 0 ? drawTower : k === 1 ? drawDude : drawPart)(o);
    drawShots(); drawForeground();
  }

  // ------------------------------------------------------------ loop and input
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    step(dt); draw();
    requestAnimationFrame(frame);
  }
  function start() { if (running || reduce) return; running = true; last = performance.now(); requestAnimationFrame(frame); }
  function stop() { running = false; }

  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 46 * K;
    for (const d of dudes) { const s = depth(d.y) * K; const dd = Math.hypot(d.x - x, (d.y - 30 * s) - y); if (dd < bd) { bd = dd; best = d; } }
    if (best) { killDude(best, x + 20, y, 1.6); if (reduce) { for (let i = 0; i < 20; i++) step(1 / 30); draw(); } }
  });

  const section = canvas.closest(".table");
  counter = document.createElement("div");
  counter.setAttribute("aria-hidden", "true");
  counter.style.cssText = "position:absolute;right:16px;bottom:14px;z-index:4;font:400 18px 'Permanent Marker',cursive;color:#f0e4cf;text-shadow:0 2px 8px #000;pointer-events:none";
  section.append(counter);

  new ResizeObserver(resize).observe(canvas);
  resize();
  if (!reduce) { warm(); draw(); }
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => { es[0].isIntersecting ? start() : stop(); }).observe(section); else start();
  document.addEventListener("visibilitychange", () => { document.hidden ? stop() : (section.getBoundingClientRect().bottom > 0 && start()); });
})();
