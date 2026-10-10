// greytide as a Discord Activity (issue #754): the published Web build at /play/, booted inside Discord's iframe.
//
// Inside Discord the page is served from https://<application id>.discordsays.com/ and every request has to go through
// Discord's proxy, as /.proxy/<prefix>/<path>; the prefixes are the URL Mappings set in the developer portal (PORTAL_MAPPINGS,
// copied into README.md). The Unity loader is given proxy paths directly, and patchUrlMappings() rewrites the absolute
// URLs the game itself builds at run time (the relay's WebSocket and its /feedback POST) the same way.
//
// Outside Discord (no frame_id/instance_id in the query) the page says to open it inside Discord and links to /play/.
// Pure helpers are exported for activity.test.mjs (node --test); the browser gets them as window.GreytideActivity.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GreytideActivity = api;
})(this, function () {
  "use strict";

  var SITE_HOST = "greytide.advancedstudios.net";
  var RELAY_HOST = "greytide-relay.advancedstudios.net";

  // What the owner types into Activities > URL Mappings, in this order: "/" is the page itself and comes last, because Discord
  // tries the rows in order and "/" would swallow the others. The others are reached as /.proxy/<prefix>/...
  var PORTAL_MAPPINGS = [
    { prefix: "/relay", target: RELAY_HOST },
    { prefix: "/site", target: SITE_HOST },
    { prefix: "/", target: SITE_HOST + "/activity" },
  ];

  // The same mappings in the form patchUrlMappings() takes (client side, with the /.proxy/ part). The relay comes first:
  // the SDK matches on the host alone, first match wins.
  var CLIENT_MAPPINGS = [
    { prefix: "/.proxy/relay", target: RELAY_HOST },
    { prefix: "/.proxy/site", target: SITE_HOST },
  ];

  // The play page's own loader config (unity/Assets/WebGLTemplates/Greytide/index.html as BuildScript.BuildWeb fills it:
  // output Build/web, Brotli with the decompression fallback, so the files end in .unityweb).
  var PLAY_PATH = "/play/";
  var BUILD = {
    loaderUrl: "Build/web.loader.js",
    dataUrl: "Build/web.data.unityweb",
    frameworkUrl: "Build/web.framework.js.unityweb",
    codeUrl: "Build/web.wasm.unityweb",
    streamingAssetsUrl: "StreamingAssets",
  };
  var PRODUCT = { companyName: "greytide", productName: "greytide", productVersion: "1.0" };

  // Sign-in for the moniker. authorize() hands back a code that only the relay, holding the application's secret, could turn
  // into a token (the relay's POST /discord/token, issue #760). Set to null to start the Activity without asking the
  // player anything. See README.md, "The moniker".
  var TOKEN_PATH = "/.proxy/relay/discord/token";
  var MONIKER_MAX = 24; // FeedbackStore.MonikerMax

  var DISCORD_PARAMS = ["frame_id", "instance_id", "platform"];

  /** True when Discord launched the page: its iframe URL always carries these. */
  function inDiscord(search) {
    var q = new URLSearchParams(search || "");
    return DISCORD_PARAMS.every(function (k) { return !!q.get(k); });
  }

  /** The Activity is served from <application id>.discordsays.com, so the page needs no client id written into it. */
  function clientIdFromHost(host) {
    var m = /^(\d{15,22})\.discordsays\.com$/i.exec(String(host || ""));
    return m ? m[1] : null;
  }

  /** A canonical site URL (https://greytide.advancedstudios.net/play/...) as the path Discord's proxy serves it under. */
  function proxyPath(url) {
    var u = new URL(url);
    for (var i = 0; i < CLIENT_MAPPINGS.length; i++) {
      var m = CLIENT_MAPPINGS[i];
      if (u.host === m.target) return m.prefix + u.pathname + u.search;
    }
    return null;
  }

  /** The loader config with every URL in Discord's proxy form. */
  function loaderConfig() {
    var base = "https://" + SITE_HOST + PLAY_PATH, out = {};
    for (var k in BUILD) out[k] = proxyPath(base + BUILD[k]);
    for (var p in PRODUCT) out[p] = PRODUCT[p];
    return out;
  }

  /** The member's name trimmed to what the report slip's moniker line holds. */
  function cleanMoniker(name) {
    var s = String(name || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return s.length > MONIKER_MAX ? s.slice(0, MONIKER_MAX).trim() : s;
  }

  /** The page query with moniker=<name> added: the Web player reads its page URL's query as its command line (-moniker).
   *  Percent-encoded by hand: CommandLine decodes with Uri.UnescapeDataString, which leaves URLSearchParams' "+" for a space as "+".
   *  The rest of the query is kept byte for byte. */
  function withMoniker(search, name) {
    var m = cleanMoniker(name), pairs = String(search || "").replace(/^\?/, "").split("&").filter(function (p) {
      return p && p.split("=")[0] !== "moniker";
    });
    if (m) pairs.push("moniker=" + encodeURIComponent(m));
    return pairs.length ? "?" + pairs.join("&") : "";
  }

  /** Discord's display name, else the account name. */
  function displayName(user) {
    return (user && (user.global_name || user.username)) || "";
  }

  // ------------------------------------------------------------------ browser side

  function $(sel) { return document.querySelector(sel); }

  /** Shows one of the page's three panels (#outside, #loading, #error) and hides the other two. */
  function show(panel) {
    ["#outside", "#loading", "#error"].forEach(function (s) { var e = $(s); if (e) e.hidden = s !== panel; });
  }

  // As on the play page: Unity's own fatal message says nothing useful, so a page that ran out of memory (a table too big for
  // this browser) says so and offers the same page on the painting desk (an explicit ?board= is never saved, so it cannot loop).
  function fatal(message) {
    var oom = /OOM|out of memory|Cannot enlarge memory|memory access out of bounds|RangeError: Array buffer allocation/i.test(String(message));
    fail(oom ? "This browser ran out of memory building the table. " : "The game stopped: " + String(message).slice(0, 160) + " ");
    var q = new URLSearchParams(location.search); q.set("board", "desk");
    var a = document.createElement("a");
    a.href = location.pathname + "?" + q.toString();
    a.textContent = "Reload on the painting desk";
    a.style.color = "#ffe9a8";
    $("#error").appendChild(a);
  }

  function fail(text) {
    var e = $("#error");
    e.textContent = text;
    show("#error");
  }

  // Same render-size caps as the play page: device pixel ratio up to 2 (1.5 on phones), about 2560x1440 pixels in total.
  function sizeFor(mobile) {
    var d = Math.max(0.5, Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    var px = Math.max(1, window.innerWidth * window.innerHeight) * d * d, max = 2560 * 1440;
    if (px > max) d *= Math.sqrt(max / px);
    return d;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("could not load " + src)); };
      document.body.appendChild(s);
    });
  }

  /** Boot the published Web build through the proxy. Exposed so a local harness can drive it without Discord. */
  function boot(config) {
    config = config || loaderConfig();
    var canvas = $("#unity-canvas"), mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    var instance = null;
    canvas.hidden = false;
    show("#loading");
    window.addEventListener("resize", function () { if (instance && instance.Module) instance.Module.devicePixelRatio = sizeFor(mobile); });
    return loadScript(config.loaderUrl).then(function () {
      return window.createUnityInstance(canvas, {
        arguments: [],
        dataUrl: config.dataUrl,
        frameworkUrl: config.frameworkUrl,
        codeUrl: config.codeUrl,
        streamingAssetsUrl: config.streamingAssetsUrl,
        companyName: config.companyName,
        productName: config.productName,
        productVersion: config.productVersion,
        devicePixelRatio: sizeFor(mobile),
        errorHandler: function (message) { fatal(message); return true; },
        showBanner: function (msg, type) { if (type === "error") fail(msg); else console.warn(msg); },
      }, function (progress) {
        $("#bar > div").style.width = 100 * progress + "%";
        $("#pct").textContent = Math.round(100 * progress) + "%";
      });
    }).then(function (u) {
      instance = u;
      $("#loading").hidden = true;
      canvas.focus();
      return u;
    }).catch(function (e) {
      fatal((e && e.message) || e);
      throw e;
    });
  }

  function signIn(sdk, clientId) {
    if (!TOKEN_PATH) return Promise.resolve("");
    return sdk.commands.authorize({ client_id: clientId, response_type: "code", state: "", prompt: "none", scope: ["identify"] })
      .then(function (r) {
        return fetch(TOKEN_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: r.code }) });
      })
      .then(function (res) { if (!res.ok) throw new Error("token " + res.status); return res.json(); })
      .then(function (t) { return sdk.commands.authenticate({ access_token: t.access_token }); })
      .then(function (auth) { return displayName(auth && auth.user); })
      .catch(function (e) { console.warn("[activity] no moniker: " + ((e && e.message) || e)); return ""; });
  }

  function withTimeout(p, ms, what) {
    return Promise.race([p, new Promise(function (_, reject) { setTimeout(function () { reject(new Error(what + " timed out")); }, ms); })]);
  }

  function start() {
    if (!inDiscord(location.search)) { show("#outside"); return; }
    var sdkLib = window.DiscordEmbeddedAppSdk, clientId = clientIdFromHost(location.host);
    if (!sdkLib || !clientId) {
      // Discord's launch parameters, but not on Discord's proxy host (a copied link, or Application URL Override): say so on the card
      var why = $("#why");
      why.textContent = "This looks like a Discord launch, but the page is on " + location.host + ", not on Discord's proxy (<application id>.discordsays.com).";
      why.hidden = false;
      show("#outside");
      return;
    }
    sdkLib.patchUrlMappings(CLIENT_MAPPINGS, { patchFetch: true, patchWebSocket: true, patchXhr: true, patchSrcAttributes: false });
    var sdk = new sdkLib.DiscordSDK(clientId);
    show("#loading");
    $("#what").textContent = "connecting to Discord";
    withTimeout(sdk.ready(), 15000, "Discord's handshake")
      .then(function () { return signIn(sdk, clientId); })
      .then(function (name) {
        if (name) history.replaceState(null, "", location.pathname + withMoniker(location.search, name) + location.hash);
        console.log("[activity] ready on " + sdk.platform + ", moniker " + (name ? "'" + cleanMoniker(name) + "'" : "none"));
        $("#what").textContent = "unpacking the table";
        return boot();
      })
      .catch(function (e) { if (!$("#error").textContent) fail("Discord did not answer: " + ((e && e.message) || e)); });
  }

  return {
    SITE_HOST: SITE_HOST, RELAY_HOST: RELAY_HOST, PORTAL_MAPPINGS: PORTAL_MAPPINGS, CLIENT_MAPPINGS: CLIENT_MAPPINGS,
    BUILD: BUILD, PLAY_PATH: PLAY_PATH, MONIKER_MAX: MONIKER_MAX,
    inDiscord: inDiscord, clientIdFromHost: clientIdFromHost, proxyPath: proxyPath, loaderConfig: loaderConfig,
    cleanMoniker: cleanMoniker, withMoniker: withMoniker, displayName: displayName, boot: boot, start: start,
  };
});
