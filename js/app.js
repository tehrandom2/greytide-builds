// greytide builds page. Reads builds.json (written by unity/tools/publish/publish.py) and site.json (feature
// switches). Everything is built with textContent, never innerHTML, because pull request titles are data.
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }

  function icon(name) {
    const paths = {
      play: "M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z",
      down: "M12 3v12m-5-5 5 5 5-5M5 21h14",
      chev: "m9 6 6 6-6 6",
    };
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", paths[name]);
    if (name === "play") p.setAttribute("fill", "currentColor");
    else { p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2.4"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); }
    s.append(p);
    return s;
  }

  const fmtMB = (n) => (n / 1e6 >= 100 ? Math.round(n / 1e6) : (n / 1e6).toFixed(1)) + " MB";

  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " minutes ago";
    if (s < 86400) { const h = Math.round(s / 3600); return h + (h === 1 ? " hour ago" : " hours ago"); }
    const d = Math.round(s / 86400);
    return d < 45 ? d + (d === 1 ? " day ago" : " days ago") : new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  // Which download does this visitor want? Phones and Macs get "play in browser" first.
  function myPlatform() {
    const ua = navigator.userAgent || "";
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/android|iphone|ipad|ipod/i.test(ua)) return null;
    if (/win/i.test(p) || /windows/i.test(ua)) return "win";
    if (/linux|x11/i.test(p) || /linux/i.test(ua)) return "linux";
    return null;
  }
  const NAMES = { win: "Windows", linux: "Linux", web: "Web zip" };
  const asset = (b, plat) => (b.assets || []).find((a) => a.platform === plat);

  function dlButton(a, extra) {
    return el("a", { class: "btn btn--dl", href: a.url, download: "" }, icon("down"), "Download " + (NAMES[a.platform] || a.label), el("small", { text: fmtMB(a.size) }), extra);
  }

  function changesList(b, cls) {
    const wrap = el("div", { class: "changes " + (cls || "") });
    wrap.append(el("h3", { text: b.previous ? "What changed tonight" : "Everything so far" }));
    const ul = el("ul");
    (b.changes || []).forEach((c) => ul.append(el("li", {}, c.title, el("span", { class: "n", text: "#" + c.number }))));
    if (b.moreChanges) ul.append(el("li", { class: "more", text: "...and " + b.moreChanges + " more" }));
    if (!(b.changes || []).length) ul.append(el("li", { class: "more", text: "Nothing merged since the last build. A rebuild for the sake of it." }));
    wrap.append(ul);
    return wrap;
  }

  function polaroids(shots, limit) {
    const ul = el("ul", { class: "polaroids" });
    (limit ? shots.slice(0, limit) : shots).forEach((s) => {
      const img = el("img", { src: s.path, alt: s.caption, loading: "lazy", decoding: "async" });
      const fig = el("figure", { class: "polaroid" },
        el("button", { type: "button", "aria-label": "Open screenshot: " + s.caption, onclick: () => openShot(s) },
          img, el("figcaption", {}, s.caption, el("i", { text: "#" + s.issue }))));
      ul.append(el("li", {}, fig));
    });
    return ul;
  }

  function openShot(s) {
    const d = $("#lightbox");
    $("#lightbox-img").src = s.path;
    $("#lightbox-img").alt = s.caption;
    $("#lightbox-cap").textContent = s.caption + "  (issue #" + s.issue + ")";
    if (d.showModal) d.showModal(); else window.open(s.path, "_blank");
  }

  // ---------------------------------------------------------------- the newest box
  function renderLatest(b, plat) {
    const slot = $("#latest-slot");
    slot.replaceChildren();
    if (!b) {
      slot.append(el("div", { class: "empty" }, el("b", { text: "Nothing on the shelf yet" }),
        "The first build has not been cut. Check back after the next merge, or subscribe to the Atom feed and be told."));
      return;
    }
    const play = asset(b, "web") && b.playable;
    const mine = plat && asset(b, plat);
    const art = (b.shots || [])[0];
    const artEl = el("div", { class: "box__art" + (art ? "" : " box__art--none") }, art ? el("img", { src: art.path, alt: "" }) : null, el("span", { class: "box__new", text: "Newest" }));

    const cta = el("div", { class: "box__cta" });
    if (play) cta.append(el("a", { class: "btn btn--play", href: "play/" }, icon("play"), "Play in browser", el("small", { text: "no install" })));
    if (mine) cta.append(dlButton(mine));
    else if (!play && asset(b, "win")) cta.append(dlButton(asset(b, "win")));

    const others = (b.assets || []).filter((a) => a !== mine && !(a.platform === "web" && play));
    const also = el("p", { class: "also" });
    if (others.length) {
      also.append("Also: ");
      others.forEach((a, i) => { if (i) also.append(" · "); also.append(el("a", { href: a.url, download: "", text: (NAMES[a.platform] || a.label) + " (" + fmtMB(a.size) + ")" })); });
    }
    if (!plat) also.append((others.length ? "  " : "") + "On a phone or a Mac? The browser build is the one for you.");

    const box = el("article", { class: "box", id: "newest" }, artEl,
      el("div", { class: "box__body" },
        el("span", { class: "tape", text: b.tag }),
        el("h3", { class: "box__title", text: b.headline || "A fresh build" }),
        el("p", { class: "box__when" }, el("b", { text: ago(b.published) }), " · " + when(b.published) + " · pre-release"),
        cta, also,
        changesList(b, (b.changes || []).length > 7 ? "changes--scroll" : "")));
    slot.append(box);
  }

  // ---------------------------------------------------------------- the shelf
  function renderShelf(builds, plat) {
    const shelf = $("#shelf");
    shelf.replaceChildren();
    builds.forEach((b, i) => {
      const body = el("div", { class: "kit__body" });
      const dl = el("div", { class: "kit__dl" });
      if (b.playable && asset(b, "web")) dl.append(el("a", { class: "btn btn--play", href: "play/" }, icon("play"), "Play in browser"));
      (b.assets || []).forEach((a) => dl.append(dlButton(a)));
      body.append(dl, changesList(b));
      if ((b.shots || []).length) body.append(polaroids(b.shots));
      body.append(el("p", { class: "kit__sha" }, "commit ", el("a", { href: b.commit_url, text: b.short, rel: "noopener" }), " · cut from `unity` · ",
        (b.assets || []).map((a) => a.name + " sha256 " + a.sha256.slice(0, 12) + "…").join(" · ")));

      const sum = el("summary", {},
        el("span", { class: "tape", text: b.tag }),
        el("div", { class: "kit__what" },
          el("h3", { class: "kit__headline" }, b.headline || "A fresh build", i === 0 ? el("span", { class: "badge", text: "newest" }) : null, b.playable ? el("span", { class: "badge badge--play", text: "playable" }) : null),
          el("p", { class: "kit__meta", text: ago(b.published) + " · " + (b.changes || []).length + (b.moreChanges ? "+" : "") + ((b.changes || []).length === 1 && !b.moreChanges ? " change" : " changes") + " · " + (b.assets || []).map((a) => NAMES[a.platform] + " " + fmtMB(a.size)).join(" · ") })),
        el("span", { class: "kit__chev" }, icon("chev")));
      const li = el("li", {}, el("details", { class: "kit", id: b.tag }, sum, body));
      shelf.append(li);
    });
    openFromHash();
  }

  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const d = document.getElementById(id);
    if (d && d.matches("details.kit")) { d.open = true; d.classList.add("is-target"); requestAnimationFrame(() => d.scrollIntoView({ block: "start" })); }
  }
  window.addEventListener("hashchange", openFromHash);

  function renderStats(builds) {
    if (!builds.length) return;
    const set = (k, v) => { $('[data-stat="' + k + '"]').textContent = v; };
    set("count", builds.length);
    set("changes", builds.reduce((n, b) => n + (b.changes || []).length + (b.moreChanges || 0), 0));
    set("mb", Math.round(builds.reduce((n, b) => n + (b.assets || []).reduce((m, a) => m + a.size, 0), 0) / 1e6));
    const first = Math.min(...builds.map((b) => new Date(b.published).getTime()));
    set("age", Math.max(1, Math.round((Date.now() - first) / 86400000)));
    $("#stats").hidden = false;
  }

  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(url + ": " + r.status);
    return r.json();
  }

  async function init() {
    $("#generated").textContent = new Date().toLocaleString();
    const plat = myPlatform();
    let site = {};
    try { site = await getJSON("site.json"); } catch (e) { /* optional */ }
    // The soundtrack is published at /soundtrack/ but only linked once the owner says so: flip it in site.json.
    if (site.soundtrack) document.querySelectorAll("[data-soundtrack-link]").forEach((a) => { a.hidden = false; });

    let data;
    try { data = await getJSON("builds.json"); }
    catch (e) {
      renderLatest(null, plat);
      const empty = $("#empty");
      empty.hidden = false;
      empty.textContent = location.protocol === "file:" ? "Open this page over HTTP (python unity/tools/publish/serve.py) so it can read builds.json." : "The shelf is empty, or builds.json could not be loaded.";
      return;
    }
    const builds = (data.builds || []).slice().sort((a, b) => new Date(b.published) - new Date(a.published));
    renderLatest(builds[0], plat);
    renderStats(builds);
    renderShelf(builds, plat);
    if (builds[0] && (builds[0].shots || []).length) {
      $("#shots-section").hidden = false;
      $("#shots").replaceWith(polaroids(builds[0].shots));
      $(".polaroids", $("#shots-section")).id = "shots";
    }
  }

  init();
})();
