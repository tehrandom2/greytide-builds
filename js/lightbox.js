/* A post's screenshots in a lightbox: click an image, step through all of them (arrows, swipe, buttons), Escape or a
   click outside closes. No library. Without JavaScript the images stay plain <img> with their captions. */
(function () {
  "use strict";
  var figs = Array.prototype.slice.call(document.querySelectorAll(".prose figure"))
    .filter(function (f) { return f.querySelector("img"); });
  if (!figs.length) return;

  var box = document.createElement("div");
  box.className = "lb";
  box.hidden = true;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Screenshots");
  box.innerHTML = '<div class="lb__stage"><img class="lb__img" alt=""></div>' +
    '<p class="lb__cap" aria-live="polite"><span class="lb__count"></span><span class="lb__text"></span></p>' +
    '<button type="button" class="lb__x" aria-label="Close">&times;</button>' +
    '<button type="button" class="lb__prev" aria-label="Previous screenshot">&#8249;</button>' +
    '<button type="button" class="lb__next" aria-label="Next screenshot">&#8250;</button>';
  document.body.appendChild(box);
  var img = box.querySelector(".lb__img"), count = box.querySelector(".lb__count"), text = box.querySelector(".lb__text");
  var prev = box.querySelector(".lb__prev"), next = box.querySelector(".lb__next"), close = box.querySelector(".lb__x");
  var at = 0, opener = null;

  function show(i) {
    at = (i + figs.length) % figs.length;
    var src = figs[at].querySelector("img"), cap = figs[at].querySelector("figcaption");
    img.src = src.currentSrc || src.src;
    img.alt = cap ? cap.textContent : src.alt;
    text.textContent = cap ? cap.textContent : "";
    count.textContent = figs.length > 1 ? (at + 1) + " / " + figs.length : "";
    prev.hidden = next.hidden = figs.length < 2;
    [at - 1, at + 1].forEach(function (n) {          // warm the neighbours so stepping does not flash
      var s = figs[(n + figs.length) % figs.length].querySelector("img");
      if (s) new Image().src = s.currentSrc || s.src;
    });
  }
  function open(i, from) {
    opener = from || null;
    box.hidden = false;
    document.body.classList.add("lb-open");
    show(i);
    close.focus();
  }
  function shut() {
    box.hidden = true;
    document.body.classList.remove("lb-open");
    if (opener) opener.focus();
  }

  figs.forEach(function (f, i) {
    var im = f.querySelector("img");
    im.tabIndex = 0;
    im.setAttribute("role", "button");
    im.addEventListener("click", function () { open(i, im); });
    im.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i, im); } });
  });

  prev.addEventListener("click", function () { show(at - 1); });
  next.addEventListener("click", function () { show(at + 1); });
  close.addEventListener("click", shut);
  box.addEventListener("click", function (e) {       // anywhere that is not the picture, a button or the caption
    if (e.target === box || e.target.classList.contains("lb__stage") || e.target.classList.contains("lb__cap")) shut();
  });
  document.addEventListener("keydown", function (e) {
    if (box.hidden) return;
    if (e.key === "Escape") shut();
    else if (e.key === "ArrowLeft") show(at - 1);
    else if (e.key === "ArrowRight") show(at + 1);
    else if (e.key === "Tab") {                       // keep focus inside
      var items = [close, prev, next].filter(function (b) { return !b.hidden; });
      var i = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
    }
  });

  var x0 = null, y0 = 0;                              // swipe
  box.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  box.addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(at + (dx < 0 ? 1 : -1));
  }, { passive: true });
})();
