// node --test unity/site/activity/activity.test.mjs   (Node 18+, nothing to install)
//
// The Activity's URL rewriting, checked three ways: every URL the Unity loader is given is a /.proxy/ path; it is the path
// the vendored SDK's own attemptRemap() makes of the URL the /play/ page fetches; and the developer-portal mappings
// (README.md) send that path back to the very file /play/ serves. Plus guards that the hard-coded file names still match
// what BuildScript.BuildWeb and the WebGL template produce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const unity = join(here, "..", "..");
const A = createRequire(import.meta.url)("./activity.js");

const APP_HOST = "1234567890123456789.discordsays.com";
const SITE = "https://" + A.SITE_HOST;

// The vendored bundle, loaded the way the page loads it, with just enough of a window for attemptRemap.
function loadSdk() {
  const code = readFileSync(join(here, "discord-sdk-2.5.0.js"), "utf8");
  const window = { location: { host: APP_HOST, href: "https://" + APP_HOST + "/" } };
  const ctx = vm.createContext({ window, self: window, URL, URLSearchParams, console, setTimeout, clearTimeout, TextEncoder, TextDecoder });
  vm.runInContext(code + "\n;globalThis.DiscordEmbeddedAppSdk = DiscordEmbeddedAppSdk;", ctx);
  return ctx.DiscordEmbeddedAppSdk;
}

// What Discord's proxy does with a request: the rows are tried in order and the first prefix that matches wins (Discord's
// docs: put the shorter of two overlapping prefixes last). A mapping is reached as /.proxy/<prefix>/..., the root as /...
function portalResolve(path) {
  const bare = path.startsWith("/.proxy/") ? path.slice("/.proxy".length) : path;
  for (const m of A.PORTAL_MAPPINGS) {
    if (m.prefix === "/" ? path.startsWith("/.proxy/") : !(bare === m.prefix || bare.startsWith(m.prefix + "/"))) continue;
    const rest = m.prefix === "/" ? bare : bare.slice(m.prefix.length);
    return "https://" + m.target + (rest.startsWith("/") ? rest : "/" + rest);
  }
  assert.fail("no portal mapping serves " + path);
}

const URL_KEYS = Object.keys(A.BUILD);

test("every URL the loader is given is a /.proxy/ path on the Activity's own origin", () => {
  const cfg = A.loaderConfig();
  for (const k of URL_KEYS) {
    assert.equal(typeof cfg[k], "string", k);
    assert.match(cfg[k], /^\/\.proxy\/[a-z]+\//, k + " = " + cfg[k]);
    assert.equal(new URL(cfg[k], "https://" + APP_HOST + "/").host, APP_HOST, k);
  }
  assert.deepEqual(cfg, {
    loaderUrl: "/.proxy/site/play/Build/web.loader.js",
    dataUrl: "/.proxy/site/play/Build/web.data.unityweb",
    frameworkUrl: "/.proxy/site/play/Build/web.framework.js.unityweb",
    codeUrl: "/.proxy/site/play/Build/web.wasm.unityweb",
    streamingAssetsUrl: "/.proxy/site/play/StreamingAssets",
    companyName: "greytide", productName: "greytide", productVersion: "1.0",
  });
});

test("the vendored SDK's attemptRemap makes the same paths from the URLs /play/ fetches", () => {
  const sdk = loadSdk();
  assert.equal(typeof sdk.DiscordSDK, "function");
  assert.equal(typeof sdk.patchUrlMappings, "function");
  const cfg = A.loaderConfig();
  for (const k of URL_KEYS) {
    const canonical = SITE + A.PLAY_PATH + A.BUILD[k];
    const r = sdk.attemptRemap({ url: new URL(canonical), mappings: A.CLIENT_MAPPINGS });
    assert.equal(r.host, APP_HOST, k);
    assert.equal(r.pathname, cfg[k], k);
  }
  // a music track, as MusicPlayer builds it from Application.streamingAssetsPath
  const track = sdk.attemptRemap({ url: new URL(SITE + "/play/StreamingAssets/Music/couch/couch-build-1.mp3"), mappings: A.CLIENT_MAPPINGS });
  assert.equal(track.toString(), "https://" + APP_HOST + "/.proxy/site/play/StreamingAssets/Music/couch/couch-build-1.mp3");
});

test("the relay's WebSocket and its feedback POST go to /.proxy/relay/", () => {
  const sdk = loadSdk();
  const ws = sdk.attemptRemap({ url: new URL("wss://" + A.RELAY_HOST + "/lobby/a"), mappings: A.CLIENT_MAPPINGS });
  assert.equal(ws.toString(), "wss://" + APP_HOST + "/.proxy/relay/lobby/a");
  const fb = sdk.attemptRemap({ url: new URL("https://" + A.RELAY_HOST + "/feedback"), mappings: A.CLIENT_MAPPINGS });
  assert.equal(fb.toString(), "https://" + APP_HOST + "/.proxy/relay/feedback");
  // a request already on the Activity's origin is left alone
  const own = sdk.attemptRemap({ url: new URL("https://" + APP_HOST + "/.proxy/site/play/Build/web.loader.js"), mappings: A.CLIENT_MAPPINGS });
  assert.equal(own.pathname, "/.proxy/site/play/Build/web.loader.js");
});

test("the portal mappings send each proxy path back to the file /play/ serves", () => {
  const cfg = A.loaderConfig();
  assert.equal(A.PORTAL_MAPPINGS.at(-1).prefix, "/", "the root row is last, or it swallows the others");
  for (const k of URL_KEYS) assert.equal(portalResolve(cfg[k]), SITE + A.PLAY_PATH + A.BUILD[k], k);
  assert.equal(portalResolve("/"), SITE + "/activity/");
  assert.equal(portalResolve("/activity.js"), SITE + "/activity/activity.js");
  assert.equal(portalResolve("/discord-sdk-2.5.0.js"), SITE + "/activity/discord-sdk-2.5.0.js");
  assert.equal(portalResolve("/.proxy/relay/feedback"), "https://" + A.RELAY_HOST + "/feedback");
  // the README lists the same three mappings
  const readme = readFileSync(join(here, "README.md"), "utf8");
  for (const m of A.PORTAL_MAPPINGS) assert.ok(readme.includes("| `" + m.prefix + "` | `" + m.target + "` |"), "README row for " + m.prefix);
});

test("the file names match what BuildScript.BuildWeb and the WebGL template produce", () => {
  const bs = readFileSync(join(unity, "Assets", "Greytide", "Editor", "BuildScript.cs"), "utf8");
  assert.match(bs, /BuildTarget\.WebGL, BuildTargetGroup\.WebGL, "Build\/web"\)/, "web build goes to Build/web (files named web.*)");
  assert.match(bs, /compressionFormat = WebGLCompressionFormat\.Brotli/);
  assert.match(bs, /decompressionFallback = true/, "fallback on: Unity names the files .unityweb");
  const tpl = readFileSync(join(unity, "Assets", "WebGLTemplates", "Greytide", "index.html"), "utf8");
  // every *Url the template always passes (not inside an #if block) has a proxied counterpart here
  const always = tpl.replace(/#if [\s\S]*?#endif/g, "");
  const keys = [...always.matchAll(/^\s*(\w+Url):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 3, "found the template's loader config");
  for (const k of keys) assert.ok(URL_KEYS.includes(k), "template passes " + k + " and the Activity does not");
  assert.match(always, /src="Build\/\{\{\{ LOADER_FILENAME \}\}\}"/);
  // USE_WASM is always on for Unity 6 web builds: codeUrl is in an #if block in the template but must be given
  assert.match(tpl, /codeUrl: "Build\/\{\{\{ CODE_FILENAME \}\}\}"/);
});

test("Discord launch detection and the client id from the host", () => {
  assert.equal(A.inDiscord(""), false);
  assert.equal(A.inDiscord("?board=desk"), false);
  assert.equal(A.inDiscord("?frame_id=abc&instance_id=i-1"), false, "platform is always there too");
  assert.equal(A.inDiscord("?instance_id=i-1&location_id=l&launch_id=x&frame_id=abc&platform=desktop"), true);
  assert.equal(A.clientIdFromHost(APP_HOST), "1234567890123456789");
  assert.equal(A.clientIdFromHost(A.SITE_HOST), null);
  assert.equal(A.clientIdFromHost("localhost:8000"), null);
  assert.equal(A.clientIdFromHost("123.discordsays.com"), null, "too short for a snowflake");
});

// What Core/CommandLine.PlayerArgs makes of the query: split on "&", name and value at the first "=", each through
// Uri.UnescapeDataString, which decodes %XX and, unlike URLSearchParams, leaves "+" as "+".
function gameArgs(search) {
  const args = {};
  for (const pair of search.replace(/^\?/, "").split("&").filter(Boolean)) {
    const eq = pair.indexOf("=");
    args[decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq))] = eq < 0 ? null : decodeURIComponent(pair.slice(eq + 1));
  }
  return args;
}

test("the display name becomes moniker=<name> as the game decodes it, trimmed to the report slip's 24 characters", () => {
  const discord = "?frame_id=f&instance_id=i&platform=desktop";
  assert.equal(A.withMoniker(discord, ""), discord);
  assert.equal(A.withMoniker(discord, "  Brush Goblin  "), discord + "&moniker=Brush%20Goblin", "a space is %20, never +");
  assert.equal(gameArgs(A.withMoniker(discord, "Brush Goblin")).moniker, "Brush Goblin");
  assert.equal(gameArgs(A.withMoniker(discord, "Brush Goblin")).frame_id, "f", "the launch query is kept");
  assert.equal(A.withMoniker("?moniker=old&silent", "new"), "?silent&moniker=new", "replaces, keeps a bare switch as it was");
  const long = A.withMoniker("", "Grand Archduke of Unpainted Plastic");
  assert.equal(gameArgs(long).moniker, "Grand Archduke of Unpain");
  assert.equal(gameArgs(long).moniker.length, A.MONIKER_MAX);
  assert.equal(gameArgs(A.withMoniker("", "Zoë & co=1 + 2")).moniker, "Zoë & co=1 + 2", "escaped, not split");
  assert.equal(A.cleanMoniker("tab\there"), "tabhere");
  assert.equal(A.displayName({ username: "plastic", global_name: "Grey Plastic" }), "Grey Plastic");
  assert.equal(A.displayName({ username: "plastic", global_name: null }), "plastic");
  assert.equal(A.displayName(null), "");
});
