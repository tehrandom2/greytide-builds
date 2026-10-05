// The greytide tape deck. Reads tracks.json (staged at publish time by tools/publish/soundtrack_site.py).
// Works with zero tracks and fills itself in when there are some. No framework, no build step.
const FFLATE = "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js";
const $ = (s, r = document) => r.querySelector(s);
const audio = new Audio();
audio.preload = "metadata";
const canOgg = !!audio.canPlayType('audio/ogg; codecs="vorbis"');

const S = { tracks: [], i: -1, shuffle: false, repeat: false, order: [], graph: null, zipping: null };
const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const pad = (n) => String(n).padStart(2, "0");
const mb = (n) => (n / 1e6).toFixed(1) + " MB";

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (v == null || v === false) continue; if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v); }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
}
let toastT;
function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), ms); }

// ---------------------------------------------------------------- covers, painted from each track's seed
function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const PAINTS = ["#d1432c", "#dca834", "#2f9e94", "#7f52a8", "#3f6fb4", "#5ba14b"];
function paintCover(t, size = 256) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"), r = rng(hash(t.seed || t.slug)), fast = (t.bpm || 100) >= 110;
  const base = PAINTS[Math.floor(r() * PAINTS.length)], acc = PAINTS[Math.floor(r() * PAINTS.length)];
  g.fillStyle = "#1b130e"; g.fillRect(0, 0, size, size);
  // a cutting mat, then the track's own little tabletop scene
  g.strokeStyle = "rgba(255,255,255,.08)"; g.lineWidth = 1;
  for (let i = 0; i <= size; i += size / 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.moveTo(0, i); g.lineTo(size, i); g.stroke(); }
  g.fillStyle = base; g.globalAlpha = 0.9; g.fillRect(0, size * 0.62, size, size * 0.38); g.globalAlpha = 1;
  const n = fast ? 7 + Math.floor(r() * 5) : 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n * size + (r() - 0.5) * 12, y = size * (0.66 + r() * 0.24), s = size / 256 * (0.8 + r() * 0.5);
    g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(x - 5 * s, y + 2 * s, 14 * s, 5 * s, 0, 0, 6.283); g.fill();
    g.fillStyle = "#a9adb2"; g.beginPath(); g.ellipse(x, y, 13 * s, 5 * s, 0, 0, 6.283); g.fill();
    g.fillRect(x - 6 * s, y - 34 * s, 12 * s, 30 * s); g.fillStyle = "#d3d5d8"; g.beginPath(); g.arc(x, y - 40 * s, 7 * s, 0, 6.283); g.fill();
  }
  // one painted tower, always
  const tx = size * (0.25 + r() * 0.5), s = size / 256;
  g.fillStyle = acc; g.fillRect(tx - 16 * s, size * 0.28, 32 * s, size * 0.38); g.fillStyle = "#dca834"; g.fillRect(tx - 16 * s, size * 0.4, 32 * s, 5 * s);
  g.fillStyle = "rgba(255,255,255,.28)"; g.fillRect(tx + 5 * s, size * 0.28, 6 * s, size * 0.38);
  const gl = g.createRadialGradient(size * 0.9, 0, 0, size * 0.9, 0, size * 0.9); gl.addColorStop(0, "rgba(255,190,100,.55)"); gl.addColorStop(1, "rgba(255,190,100,0)"); g.fillStyle = gl; g.fillRect(0, 0, size, size);
  g.fillStyle = "rgba(240,228,207,.95)"; g.font = `700 ${size * 0.11}px "Barlow Condensed", Impact, sans-serif`; g.textBaseline = "top";
  g.fillText(pad(t.index) + "  " + (t.title || "").toUpperCase().slice(0, 18), size * 0.06, size * 0.05);
  return c;
}

// ---------------------------------------------------------------- audio graph and visualizer
function ensureGraph() {
  if (S.graph) return S.graph;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  try {
    const ctx = new AC(), src = ctx.createMediaElementSource(audio), an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.82;
    src.connect(an); an.connect(ctx.destination); S.graph = { ctx, an, data: new Uint8Array(an.frequencyBinCount) };
  } catch (e) { S.graph = null; }
  return S.graph;
}
const viz = $("#viz"), vg = viz.getContext("2d");
let vw = 0, vh = 0, vlast = 0, vcost = 0, vscale = 1;
function vsize() { const d = Math.min(devicePixelRatio || 1, 1.5) * vscale; vw = viz.width = Math.round(innerWidth * d); vh = viz.height = Math.round(innerHeight * d); }
addEventListener("resize", vsize); vsize();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function drawViz(now) {
  requestAnimationFrame(drawViz);
  if (document.hidden) return;
  const t0 = performance.now(); vlast = now;
  vg.clearRect(0, 0, vw, vh);
  const gr = S.graph; let lvl = 0;
  if (gr && !audio.paused) { gr.an.getByteFrequencyData(gr.data); }
  const N = 48, bw = vw / N;
  for (let i = 0; i < N; i++) {
    let v = 0.04 + 0.03 * Math.sin(now / 900 + i * 0.5);
    if (gr && !audio.paused) { const bin = Math.floor(Math.pow(i / N, 1.6) * gr.data.length * 0.8); v = gr.data[bin] / 255; }
    lvl += v;
    const h = v * vh * 0.5, x = i * bw;
    const g = vg.createLinearGradient(0, vh, 0, vh - h);
    g.addColorStop(0, "rgba(255,140,60,.0)"); g.addColorStop(1, `rgba(255,${150 + v * 80 | 0},${70 + v * 60 | 0},${0.12 + v * 0.3})`);
    vg.fillStyle = g; vg.fillRect(x + bw * 0.14, vh - h, bw * 0.72, h);
  }
  // the lamp breathes with the loudness
  const lg = vg.createRadialGradient(vw * 0.9, 0, 0, vw * 0.9, 0, vh * (0.9 + lvl / N * 0.9));
  lg.addColorStop(0, `rgba(255,180,90,${0.12 + lvl / N * 0.35})`); lg.addColorStop(1, "rgba(255,180,90,0)"); vg.fillStyle = lg; vg.fillRect(0, 0, vw, vh);
  // lower the resolution on a machine that cannot keep up (measure work, not the gap between frames)
  vcost = vcost * 0.9 + (performance.now() - t0) * 0.1;
  if (vcost > 6 && vscale > 0.4) { vscale -= 0.15; vsize(); vcost = 0; }
}
if (!reduceMotion) requestAnimationFrame(drawViz);

// ---------------------------------------------------------------- playback
const srcOf = (t) => (!canOgg && t.mp3) ? t.mp3 : t.file;
function cue(i, play = true) {
  const t = S.tracks[i]; if (!t) return;
  S.i = i; audio.src = srcOf(t); audio.load();
  renderNow(); markCurrent(); drawWave();
  if (play) start();
  if ("mediaSession" in navigator) { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: "greytide", album: "greytide (Original Game Soundtrack)", artwork: [{ src: t.cover || "", sizes: "256x256", type: "image/png" }] }); }
}
async function start() {
  const gr = ensureGraph(); if (gr && gr.ctx.state === "suspended") await gr.ctx.resume();
  try { await audio.play(); } catch (e) { toast("Your browser wants a tap before it plays sound"); }
}
function toggle() { if (S.i < 0) { cue(S.shuffle ? Math.floor(Math.random() * S.tracks.length) : 0); return; } audio.paused ? start() : audio.pause(); }
function pick(dir) {
  const n = S.tracks.length; if (!n) return 0;
  if (S.shuffle && n > 1) { let j; do { j = Math.floor(Math.random() * n); } while (j === S.i); return j; }
  return (S.i + dir + n) % n;
}
function next(auto) { if (auto && S.repeat) { audio.currentTime = 0; return start(); } cue(pick(1)); }
function prev() { if (audio.currentTime > 3) { audio.currentTime = 0; return; } cue(pick(-1)); }
audio.addEventListener("ended", () => next(true));
audio.addEventListener("play", () => syncPlay());
audio.addEventListener("pause", () => syncPlay());
audio.addEventListener("loadedmetadata", () => { $("#t-dur").textContent = fmt(audio.duration); });
audio.addEventListener("timeupdate", () => { $("#t-cur").textContent = fmt(audio.currentTime); drawWave(); });
audio.addEventListener("error", () => { const t = S.tracks[S.i]; if (t && t.mp3 && audio.src.indexOf(t.mp3) < 0) { audio.src = t.mp3; audio.play().catch(() => {}); } else toast("That track would not load"); });
function syncPlay() {
  const p = !audio.paused;
  document.body.classList.toggle("is-playing", p);
  $("#b-play span").textContent = p ? "⏸" : "▶"; $("#b-play").setAttribute("aria-label", p ? "Pause" : "Play");
  $("#hero-play span").textContent = p ? "Pause" : (S.i < 0 ? "Play" : "Resume");
}

// ---------------------------------------------------------------- waveform scrubber
function drawWave() {
  const c = $("#wave-c"), t = S.tracks[S.i]; if (!c) return;
  const w = c.clientWidth, h = c.clientHeight, d = Math.min(devicePixelRatio || 1, 2);
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const g = c.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
  const peaks = (t && t.peaks) || null, N = Math.max(20, Math.floor(w / 4)), frac = audio.duration ? audio.currentTime / audio.duration : 0;
  for (let i = 0; i < N; i++) {
    const v = peaks ? peaks[Math.floor(i / N * peaks.length)] / 99 : 0.35, bh = Math.max(2, v * h);
    g.fillStyle = i / N <= frac ? "#ffb45f" : "rgba(240,228,207,.28)"; g.fillRect(i * (w / N), (h - bh) / 2, Math.max(1.5, w / N - 1.5), bh);
  }
  $("#wave").setAttribute("aria-valuenow", Math.round(frac * 100));
}
function seekEvent(e) { const r = $("#wave").getBoundingClientRect(); const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); if (audio.duration) audio.currentTime = f * audio.duration; }
const wv = $("#wave"); let drag = false;
wv.addEventListener("pointerdown", (e) => { drag = true; wv.setPointerCapture(e.pointerId); seekEvent(e); });
wv.addEventListener("pointermove", (e) => { if (drag) seekEvent(e); });
wv.addEventListener("pointerup", () => { drag = false; });
wv.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") audio.currentTime += 5; if (e.key === "ArrowLeft") audio.currentTime -= 5; });
addEventListener("resize", drawWave);

// ---------------------------------------------------------------- rendering
function chips(t) {
  const out = [];
  if (t.mood) out.push(el("span", { class: "chip chip--m", text: t.mood }));
  if (t.bpm) out.push(el("span", { class: "chip chip--b", text: t.bpm + " bpm" }));
  if (t.genre) out.push(el("span", { class: "chip", text: t.genre }));
  return out;
}
function renderNow() {
  const t = S.tracks[S.i];
  if (!t) { return; }
  $("#now-title").textContent = t.title; $("#now-sub").textContent = pad(t.index) + " of " + pad(S.tracks.length) + " · " + fmt(t.duration);
  $("#now-chips").replaceChildren(...chips(t));
  $("#label-title").textContent = t.title.length > 22 ? t.title.slice(0, 21) + "…" : t.title; $("#label-sub").textContent = (t.genre || "").slice(0, 34); $("#label-side").textContent = (t.mood ? t.mood.toUpperCase() : "SIDE A") + " · " + pad(t.index);
  $("#label-art").setAttribute("href", t.cover);
  $("#dock").hidden = false; $("#dock-title").textContent = t.title; $("#dock-sub").textContent = t.genre || "";
  const dc = $("#dock-cover"); dc.getContext("2d").drawImage(t.canvas, 0, 0, 96, 96);
  $("#t-dur").textContent = fmt(t.duration);
}
function markCurrent() { document.querySelectorAll(".tr").forEach((n, i) => n.classList.toggle("is-current", i === S.i)); }
function trackRow(t, i) {
  const cov = t.canvas.cloneNode(); cov.getContext("2d").drawImage(t.canvas, 0, 0); cov.className = "cov"; cov.style.width = "56px";
  const dls = [el("a", { href: t.file, download: t.slug + ".ogg", text: "OGG " + mb(t.bytes) })];
  if (t.mp3) dls.unshift(el("a", { href: t.mp3, download: t.slug + ".mp3", text: "MP3 " + mb(t.mp3Bytes) }));
  dls.push(el("a", { href: t.notes, text: "Prompt file", target: "_blank", rel: "noopener" }));
  const row = el("button", { class: "tr__row", type: "button", "aria-label": "Play " + t.title, onclick: () => (S.i === i ? toggle() : cue(i)) },
    cov, el("div", {}, el("h3", { class: "tr__t", text: t.title }), el("p", { class: "tr__m", text: [t.mood, t.bpm ? t.bpm + " bpm" : "", t.genre].filter(Boolean).join(" · ") })), el("span", { class: "tr__d", text: fmt(t.duration) }));
  const more = el("div", { class: "tr__more" },
    t.why ? el("p", { text: t.why }) : null,
    el("dl", {}, ...[["Prompt", t.prompt], ["Seed", t.seed], ["Made", t.date], ["Model", t.model], ["Licence", t.licence]].filter((r) => r[1]).flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })])),
    el("div", { class: "tr__act" }, dls));
  const li = el("li", { class: "tr" }, row, more);
  row.addEventListener("dblclick", () => li.classList.toggle("is-open"));
  const toggler = el("button", { type: "button", class: "tr__tog", "aria-label": "Liner notes for " + t.title, text: "liner notes", onclick: () => li.classList.toggle("is-open") });
  toggler.style.cssText = "margin:0 0 10px 76px;background:none;border:0;color:#b9a98f;font:500 12px 'IBM Plex Mono',monospace;text-decoration:underline;cursor:pointer;padding:6px 4px";
  li.insertBefore(toggler, more);
  return li;
}

// ---------------------------------------------------------------- download all (zip built in the page; nothing prebuilt on the server)
async function downloadAll() {
  if (S.zipping) { S.zipping.abort(); return; }
  const useMp3 = S.tracks.every((t) => t.mp3), btn = $("#dl-all"), orig = btn.firstChild.textContent;
  const ctl = new AbortController(); S.zipping = ctl;
  try {
    const { Zip, ZipPassThrough, strToU8 } = await import(FFLATE);
    const chunks = []; let err = null;
    const zip = new Zip((e, d) => { if (e) err = e; else chunks.push(d); });
    const dir = "greytide-soundtrack/";
    const put = (name, bytes) => { const f = new ZipPassThrough(dir + name); zip.add(f); f.push(bytes, true); };
    put("README.txt", strToU8(["greytide (Original Game Soundtrack)", "", ...S.tracks.map((t) => `${pad(t.index)}  ${t.title.padEnd(26)} ${fmt(t.duration)}  ${t.bpm || ""} bpm`), "", "Generated locally from text prompts. Each track's prompt, seed and licence are in 'liner notes'.", "", "From " + location.href, ""].join("\r\n")));
    if (S.licenceText) put("LICENSES.md", strToU8(S.licenceText));
    for (let i = 0; i < S.tracks.length; i++) {
      const t = S.tracks[i]; btn.firstChild.textContent = `Packing ${i + 1}/${S.tracks.length} `;
      const res = await fetch(useMp3 ? t.mp3 : t.file, { signal: ctl.signal }); if (!res.ok) throw new Error(t.title + ": HTTP " + res.status);
      put(`${pad(t.index)} - ${t.title}.${useMp3 ? "mp3" : "ogg"}`, new Uint8Array(await res.arrayBuffer()));
      const notes = await (await fetch(t.notes)).text(); put(`liner notes/${pad(t.index)} - ${t.title}.txt`, strToU8(notes));
      if (err) throw err;
    }
    zip.end(); if (err) throw err;
    const blob = new Blob(chunks, { type: "application/zip" }), a = el("a", { href: URL.createObjectURL(blob), download: `greytide-soundtrack-${useMp3 ? "mp3" : "ogg"}.zip` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`Zipped ${S.tracks.length} tracks, ${mb(blob.size)}`);
  } catch (e) { if (e.name !== "AbortError") { console.error(e); toast("The zip could not be built. Every track still downloads on its own.", 5000); } }
  finally { S.zipping = null; btn.firstChild.textContent = orig; }
}

// ---------------------------------------------------------------- boot
async function boot() {
  let data = { tracks: [] };
  try { const r = await fetch("tracks.json", { cache: "no-cache" }); if (r.ok) data = await r.json(); } catch (e) { /* zero tracks */ }
  S.tracks = (data.tracks || []).map((t, i) => ({ ...t, index: t.index || i + 1 }));
  const empty = !S.tracks.length;
  $("#empty").hidden = !empty; $("#hero-play").hidden = empty;
  $("#now-sub").textContent = empty ? "No tape loaded." : S.tracks.length + " tracks · " + fmt(S.tracks.reduce((a, t) => a + t.duration, 0));
  $("#tr-sub").textContent = empty ? "" : "Tap a track to play it. Open the liner notes for the prompt and seed.";
  if (empty) { $("#label-title").textContent = "empty tape"; $("#label-sub").textContent = "no tracks committed yet"; return; }
  S.tracks.forEach((t) => { t.canvas = paintCover(t); t.cover = t.canvas.toDataURL("image/png"); });
  $("#tl").replaceChildren(...S.tracks.map(trackRow));
  $("#label-art").setAttribute("href", S.tracks[0].cover);
  $("#now-title").textContent = "Music for painting minis"; $("#label-title").textContent = "greytide OST"; $("#label-sub").textContent = S.tracks.length + " tracks"; $("#label-side").textContent = "SIDE A";
  $("#now-chips").replaceChildren(...chips(S.tracks[0]).slice(0, 0));
  if (data.licenceFile) { const a = $("#licence"); a.href = data.licenceFile; a.hidden = false; try { S.licenceText = await (await fetch(data.licenceFile)).text(); } catch (e) { /* optional */ } }
  const total = S.tracks.reduce((a, t) => a + (t.mp3Bytes || t.bytes), 0);
  $("#dl-all").hidden = false; $("#dl-all-size").textContent = mb(total); $("#dl-all").addEventListener("click", downloadAll);
  $("#hero-play").addEventListener("click", toggle);
  $("#b-play").addEventListener("click", toggle); $("#b-next").addEventListener("click", () => next(false)); $("#b-prev").addEventListener("click", prev);
  $("#b-shuf").addEventListener("click", () => { S.shuffle = !S.shuffle; $("#b-shuf").setAttribute("aria-pressed", S.shuffle); toast(S.shuffle ? "Shuffle on" : "Shuffle off"); });
  $("#b-rep").addEventListener("click", () => { S.repeat = !S.repeat; $("#b-rep").setAttribute("aria-pressed", S.repeat); toast(S.repeat ? "Repeating this track" : "Repeat off"); });
  const mute = () => { audio.muted = !audio.muted; $("#b-mute").textContent = audio.muted ? "🔇" : "🔊"; };
  $("#b-mute").addEventListener("click", mute);
  $("#vol").addEventListener("input", (e) => { audio.volume = +e.target.value; }); audio.volume = 0.85;
  if ("mediaSession" in navigator) { navigator.mediaSession.setActionHandler("nexttrack", () => next(false)); navigator.mediaSession.setActionHandler("previoustrack", prev); }
  addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input,textarea")) return;
    if (e.code === "Space" && !(e.target.closest && e.target.closest("button,a,[role=slider]"))) { e.preventDefault(); toggle(); }
    else if (e.code === "ArrowRight" && !e.target.closest("[role=slider]")) audio.currentTime += 5;
    else if (e.code === "ArrowLeft" && !e.target.closest("[role=slider]")) audio.currentTime -= 5;
    else if (e.key === "n") next(false); else if (e.key === "p") prev(); else if (e.key === "s") $("#b-shuf").click(); else if (e.key === "m") mute();
  });
  syncPlay();
}
boot();
