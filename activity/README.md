# greytide as a Discord Activity

`unity/site/activity/` is a thin wrapper that runs the published Web build (`https://greytide.advancedstudios.net/play/`)
inside Discord, as an [Activity](https://discord.com/developers/docs/activities/overview): a web page Discord shows in an
iframe in a voice channel or DM call. The build is not changed. `publish.py` copies this folder to
`https://greytide.advancedstudios.net/activity/` like every other folder under `unity/site/` (no code there knows about it).

| File | What |
|---|---|
| `index.html` | The page: the "open this inside Discord" card, and the canvas and loading bar for the game. |
| `activity.js` | Everything it does (below). Pure helpers are exported for the test. |
| `discord-sdk-2.5.0.js` | `@discord/embedded-app-sdk` 2.5.0, bundled into one script and served from our site, because the Activity's content security policy only allows Discord's own proxy. |
| `activity.test.mjs` | `node --test unity/site/activity/activity.test.mjs`: the URL rewriting (below), launch detection, the moniker. |

## What the page does

1. **Outside Discord** (no `frame_id`, `instance_id` and `platform` in the query, which Discord always adds) it shows a card
   that says to open it inside Discord, with a link to `/play/`. Nothing else loads.
2. **Inside Discord** it reads the application id from its own host (`<application id>.discordsays.com`, so no id is written
   in the page), calls `patchUrlMappings` so the game's own absolute URLs go through the proxy, and does the SDK's `ready()`
   handshake (15 s timeout, then an error line).
3. **The moniker**: `authorize` (scope `identify`, `prompt: "none"`, so a player who consented once is not asked again) returns a
   code that only something holding the application's client secret can exchange for a token. The relay does that at
   `POST /discord/token` (`/.proxy/relay/discord/token` from here, `unity/relay/README.md`); `authenticate` then gives the
   member's display name. It is added to the page query as `moniker=<name>` (trimmed to the report slip's 24 characters)
   before the game starts, because the Web player reads its page query as its command line. The game (`FeedbackDesk`) uses
   `-moniker` as the slip's moniker when the player has no remembered one, and never saves it by itself. Any failure (no
   consent, relay down) logs `no moniker` and the Activity starts with an empty moniker line. Setting `TOKEN_PATH` to `null`
   switches the sign-in off. The relay needs the secrets `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
4. **Boots the same Unity loader as `/play/`** (`web.loader.js`, `.data`, `.framework.js`, `.wasm`, all `.unityweb`, and
   `StreamingAssets` for the music), with every URL in Discord's proxy form, `/.proxy/site/play/...`. No `silent`, `nomusic`
   or `nosfx`: this is real play.

How each request travels:

| The game asks for | The page uses | Discord's proxy fetches |
|---|---|---|
| the Activity itself | `/` | `greytide.advancedstudios.net/activity/` |
| `play/Build/web.loader.js` and the other three build files | `/.proxy/site/play/Build/...` | `greytide.advancedstudios.net/play/Build/...` |
| a music track (`Application.streamingAssetsPath`) | `/.proxy/site/play/StreamingAssets/Music/...` | `greytide.advancedstudios.net/play/StreamingAssets/Music/...` |
| the relay (`wss://greytide-relay.advancedstudios.net/...`, the street map's lobbies) | rewritten by `patchUrlMappings` to `wss://<id>.discordsays.com/.proxy/relay/...` | `greytide-relay.advancedstudios.net/...` |
| a feedback report (`POST https://greytide-relay.advancedstudios.net/feedback`) | rewritten to `/.proxy/relay/feedback` | `greytide-relay.advancedstudios.net/feedback` |

## The Discord side (the owner, in the developer portal)

Use the same Discord application as GameBot (`tools/gamebot/README.md`); if it does not exist yet, create it there first.
Everything below is at <https://discord.com/developers/applications> > that application.

1. **Activities > Getting Started** walks through the steps below. **Activities > Settings**: turn on the first checkbox,
   **Enable Activities**. Discord's docs: <https://discord.com/developers/docs/activities/building-an-activity>.
2. **Activities > URL Mappings**: add exactly these three rows, in this order (the target has no `https://`):

   | Prefix | Target |
   |---|---|
   | `/relay` | `greytide-relay.advancedstudios.net` |
   | `/site` | `greytide.advancedstudios.net` |
   | `/` | `greytide.advancedstudios.net/activity` |

   Discord tries the rows in order, and its docs say to put the shorter of two overlapping prefixes last, so `/` (the root,
   the page Discord opens) goes at the bottom. It points at `/activity`, not at the site root, because Discord always opens
   `/` and the site root is the builds page; targets must be folders, and `/activity` is one. `/site` gives the page the rest
   of the site, `/play/` included. `/relay` is the multiplayer relay, which also takes report slips.
3. **Activities > Settings > Supported Platforms**: Web and Desktop on (the shelf only lists the app on a ticked platform).
   iOS and Android can be ticked too: the play page runs on phones, but the first load is the same (below) and it has not been
   tried inside Discord's mobile app. If offered, lock the orientation to landscape.
4. **The Entry Point command.** Enabling Activities creates a global command called **Launch** (an Entry Point command, handler
   `DISCORD_LAUNCH_ACTIVITY`): it is what the App Launcher and the Activity shelf run, and with that handler Discord opens the
   Activity and posts a message in the channel by itself. Leave it as it is. **GameBot caution:** without `DISCORD_GUILD_ID`,
   GameBot calls `tree.sync()` on start, which is Discord's bulk overwrite of *all* the application's global commands; check
   under **Application Commands** (or by running the Activity) that **Launch** is still there after GameBot has started, and keep
   `DISCORD_GUILD_ID` set (guild commands leave the global Launch command alone).
5. **Installation**: the app must be in the owner's server (GameBot's invite does that). Users can also add it as a user app
   (Installation > User Install) to start it in DMs.

### Test it in the owner's own server, before any public submission

1. Discord **User Settings > App Settings > Advanced > Developer Mode** on (mobile: User Profile > Appearance > Developer Mode).
2. Join any voice channel in the owner's server.
3. Press the rocket button (in the voice panel or the call's control tray) to open the Activity shelf. With Developer Mode on,
   it lists every Activity your account owns, released or not. Pick **greytide**. This is the real configuration, through the
   proxy and the mappings above; it is the same thing players will get once the app is public.
4. Leave **Application URL Override** off. It loads a page directly instead of through Discord's proxy, and this page expects
   the proxy: it reads the application id from `<id>.discordsays.com` and fetches the game from `/.proxy/site/...`.
5. What to look for: the loading bar fills; the game starts on the painting desk; the music plays (the Activity has no silent
   flag); the street map shows the other houses (the relay through `/.proxy/relay`); a report slip sent from the game arrives
   in the Discord feedback channel. If something stalls, the desktop app's developer tools (Ctrl+Shift+I with Developer Mode on;
   Discord's support article "Troubleshooting Console Log Errors") show the Activity's console: the page logs
   `[activity] ready on desktop, moniker none` after the handshake, and a request without a mapping shows up as `blocked:csp`.
6. A public listing (App Directory, discoverable) is a separate review; do not submit until the steps above pass.

## Size, first load and caching

The play page is ~16 MB compressed before the first frame (`web.data.unityweb` 8.1 MB, `web.wasm.unityweb` 7.7 MB, the
framework and loader under 1 MB), measured on the live site on 2026-10-09. The "~250 MB" Web build is almost all
`StreamingAssets/Music` (238 MB, about 15 MB per table): it is **not** downloaded up front; `MusicPlayer` streams one track
at a time for the table being played. Discord's iframe loads all of this like a browser tab does, through its proxy.

- **First launch**: the 16 MB plus the first music track (about 1.4 MB) through Discord's proxy, then the build is decompressed in
  JavaScript (the site sends no `Content-Encoding`; Unity's fallback does it, as on `/play/`). Expect roughly the same
  wait as a first visit to `/play/`; on a slow connection the loading bar is the only feedback.
- **What is cached**: the build's `.data` goes into the browser's IndexedDB (`webGLDataCaching` is on), per origin, so the
  Activity's `<id>.discordsays.com` cache is separate from `/play/`'s: a player who has played in the browser downloads it
  again once in Discord. The `.wasm`, framework and music land in the ordinary HTTP cache; GitHub Pages sends
  `Cache-Control: max-age=600` with an ETag, so after ten minutes a relaunch revalidates (a 304, no body) instead of
  downloading again. A new build changes the files and is downloaded in full, once. Saves (PlayerPrefs) are per origin too:
  progress made on `/play/` does not appear in the Activity, and the reverse.
- Discord's docs say the proxy keeps cache headers except on `text/html` (so `index.html` is always fetched fresh). Our
  `activity.js` and the build files have fixed names, so a change reaches a returning player within those ten minutes
  (revalidation), not instantly.
- Not verified (needs Discord): that its content security policy allows the `blob:` scripts and the WebAssembly compile that
  Unity's loader uses with the decompression fallback, and that autoplay of the music is allowed in its iframe.

## Rebuilding the SDK bundle

Only when moving to another SDK version (`publish.py` copies the committed file; nothing runs at publish time). In a scratch
folder outside the repo:

```bash
npm init -y && npm install --save-exact @discord/embedded-app-sdk@2.5.0 esbuild@0.25.10
printf 'export { DiscordSDK, patchUrlMappings, attemptRemap } from "@discord/embedded-app-sdk";\n' > entry.mjs
node_modules/.bin/esbuild entry.mjs --bundle --minify --format=iife --global-name=DiscordEmbeddedAppSdk --target=es2020 --outfile=out.js
```

Put the licence header from the current file above `out.js`, save it as `discord-sdk-<version>.js`, change the two names
in `index.html` and `activity.test.mjs`, and run the test.
