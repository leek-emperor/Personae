<p align="center">
  <img src="design/logo/icon.svg" width="128" alt="Personae">
</p>

<h1 align="center">Personae</h1>

<p align="center">
  A multi-identity browser · every identity is an isolated partition, every window is agent-controllable
</p>

<p align="center">
  <sub>Bundles agent-browser and an MCP server — no Node or CLI install needed</sub>
</p>

<p align="center">
  <b>English</b> · <a href="./README.zh-CN.md">中文</a>
</p>

<!-- Demo GIF goes here. Record with Shift+Cmd+5, then:
       ./scripts/mov2gif.sh ~/Desktop/recording.mov
     and uncomment the block below.
<p align="center">
  <img src="docs/demo.gif" width="820" alt="Two identities driven independently by an agent">
</p>
-->

An Electron desktop browser that combines two things: **multi-account isolation** and **letting AI agents drive the browser**.

- Each **browser identity** is its own Chromium `persist:` partition — cookies, localStorage and login state are fully isolated, so you can be signed into the same site under several accounts at once.
- Each identity is a standalone window with back/forward buttons and an address bar. It behaves like an ordinary browser.
- The [agent-browser](https://github.com/vercel-labs/agent-browser) binary is bundled, and those windows are exposed over **MCP**, so Codex / Claude Code can drive the page of a **specific identity**.

Users don't need to pre-install Node, Chrome for Testing, or any CLI.

## The problem it solves

Existing browser-automation tools assume **the agent launches the browser**. If your product _is_ a browser client, it's the other way around: **the windows already exist, and they belong to different account identities**. What the agent needs is to attach without crossing identities.

The approach here:

1. The app opens a CDP port on startup (system-assigned, loopback only).
2. When an identity window opens, the main process resolves the **authoritative targetId** of its content page via `Target.getTargetInfo`.
3. A local bridge exposes the `identity → targetId` mapping.
4. The MCP server uses that targetId directly as a tab ref — a single-step hit.

So `snapshot(identity: "Account A")` and `snapshot(identity: "Account B")` always land on the right window, even when both have the same site open with identical titles and URLs.

## Quick start

Requires Node ≥ 20 and pnpm (for development only; the packaged app depends on neither).

```bash
pnpm install
pnpm bundle:ab      # copy the agent-browser binary and core skill into resources/
pnpm dev
```

Add one or two browser identities in the UI, then click an identity to open its window.

Packaging:

```bash
pnpm build:mac      # or build:win
```

The default is **adhoc signing** (`identity: '-'`), which needs no Apple Developer certificate and runs fine on the build machine. But an adhoc-signed app **cannot be distributed** — Gatekeeper will block it on someone else's Mac. For real distribution, supply a certificate via environment variables and set `notarize` to `true`:

```bash
CSC_LINK=/path/to/cert.p12 CSC_KEY_PASSWORD=... \
APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... \
pnpm build:mac
```

## Connecting Codex / Claude Code

### The fastest path: let the agent connect itself

The UI has a **"Let the agent connect itself"** block that renders a ready-to-send prompt. Copy it, paste it into Codex or Claude Code, and the agent will write its own MCP config, restart, and verify the link by calling `list_identities`.

The prompt isn't just a config snippet — it also tells the agent what the 13 tools do and which mistakes to avoid (stale refs, guessing at `agent-browser` syntax, trying to tell identities apart by page title). It's generated from live runtime values, so the paths in it are always correct for the machine it's running on.

### Or click one button

The same panel has a one-click install that writes the MCP server into `~/.codex/config.toml` (idempotent, with an automatic backup first). Paths are resolved at runtime from `process.execPath`, so they can't be wrong.

### Or configure it by hand

On macOS:

```toml
[mcp_servers.personae]
command = "/Applications/Personae.app/Contents/MacOS/Personae"
args = ["/Applications/Personae.app/Contents/Resources/mcp-server.mjs"]

[mcp_servers.personae.env]
ELECTRON_RUN_AS_NODE = "1"
```

The executable under `Contents/MacOS/` follows `productName`, so it's `Personae`. Note that `electron-builder`'s `executableName` only applies to Windows.

`command` points at the app's own binary; `ELECTRON_RUN_AS_NODE=1` makes it degrade into a plain Node runtime. **That's why no Node install is required** (verified: with `PATH` set to `/usr/bin:/bin`, the full flow still works).

Claude Code:

```bash
claude mcp add personae \
  --env ELECTRON_RUN_AS_NODE=1 \
  -- /Applications/Personae.app/Contents/MacOS/Personae \
     /Applications/Personae.app/Contents/Resources/mcp-server.mjs
```

## MCP tools

Every tool takes an `identity` argument (name or id).

| Tool                       | Purpose                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `load_skill`               | Fetch the real command syntax of the bundled agent-browser version (returns a section index by default; pass `section` for a specific one) |
| `list_identities`          | List all identities with open state and current URL                                                                                        |
| `open_identity`            | Open an identity's window                                                                                                                  |
| `snapshot`                 | Accessibility-tree snapshot returning `[ref=eN]` element refs                                                                              |
| `navigate`                 | Navigate to a URL                                                                                                                          |
| `click` / `fill` / `press` | Interaction; `click` accepts either a ref or visible text                                                                                  |
| `act`                      | Run several commands inside one agent-browser process                                                                                      |
| `get_text` / `get_url`     | Read content                                                                                                                               |
| `screenshot`               | Capture a screenshot                                                                                                                       |
| `eval_js`                  | Evaluate JavaScript                                                                                                                        |

When `click` / `fill` receive an `@eN` ref they automatically take a snapshot first, because **refs are only valid within a single agent-browser process** — reusing one across processes always fails with `Unknown ref`. For multi-step interactions, put them in one `act` batch.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron main process                                   │
│                                                          │
│  ├─ CDP server (port 0 → system-assigned, 127.0.0.1 only)│
│  ├─ IdentityManager   storage / window lifecycle / target │
│  └─ Agent Bridge      local HTTP, exposes identity↔target │
└───────────┬─────────────────────────────────┬────────────┘
            │                                 │
  ┌─────────▼──────────┐          ┌───────────▼───────────┐
  │ Identity window    │          │  Discovery file       │
  │ (one per identity) │          │  userData/            │
  │                    │          │  agent-bridge.json    │
  │ BrowserWindow shell│          │  (port changes every  │
  │  ├ WebContentsView │          │   launch; found via   │
  │  │   chrome.html   │          │   a fixed path)       │
  │  └ WebContentsView │          └───────────┬───────────┘
  │      content       │                      │
  │      ↑ agent acts  │                      │
  └────────────────────┘                      │
                                              │
            ┌─────────────────────────────────▼───────────┐
            │  scripts/mcp-server.mjs (stdio JSON-RPC)    │
            │  read discovery → get targetId → run CLI    │
            └───────────────────┬─────────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │  Codex / Claude Code   │
                    └────────────────────────┘
```

### Why each identity window is "a shell plus two WebContentsViews"

The goal is to wrap third-party pages in our own navigation UI **without** using the `<webview>` tag. So:

- the shell `BrowserWindow` is only a container and loads `about:blank`;
- the top bar is a local `chrome.html` with a dedicated preload exposing just six navigation methods;
- the content area is a `WebContentsView` where the partition applies, and it **deliberately loads no preload at all**, keeping third-party pages untouched.

Nested `BrowserWindow`s and `BrowserView` both work too, and the agent can drive all three (all verified). `WebContentsView` was chosen because `BrowserView` is marked `@deprecated` in Electron's type definitions, and because a nested window is a separate native window on macOS — dragging, resizing and minimizing would all need manual bounds syncing, which never quite feels like "one browser window".

## Things that bit us

Kept here because most of them aren't documented anywhere.

**The CDP port is per browser process.** `--remote-debugging-port` is a process-level switch and has no `webPreferences` counterpart, so **one Electron app has exactly one CDP server**; you cannot give each window its own port. Use port `0` to let the system assign one, then read it back from `userData/DevToolsActivePort` — that file is written _before_ the bind succeeds, so also probe `/json/version` for liveness.

**`--pin-tab` simply fails on Electron.** It triggers `Target.createTarget`, which Electron reports as `Not supported`. Worse, **pinning is sticky**: once a session has used it, the state is persisted and even `close --all` won't clear it, breaking every later command. So pass `--no-pin-tab` explicitly on every call.

**A page target with an empty title hangs agent-browser.** If the shell window never calls `loadURL`, it appears in CDP as a page target with empty url _and_ title; attaching to it hangs forever (`tab list` returns nothing, not even a timeout). Hence the shell must load `about:blank` and set a readable title.

Use `about:blank` rather than `data:text/html,<title>...` — non-ASCII titles in the latter get decoded as latin-1 and turn into mojibake.

Setting the title also has a race: `about:blank` loads so fast that `did-finish-load` may fire before the listener is attached, leaving the title stuck at `about:blank` when several identities open concurrently. Fix: call `setTitle` synchronously once, then again after load.

**Never identify a window by title, url, or tab index.** Titles and URLs are identical when several identities open the same site, and the CDP target order does not match agent-browser's tab index order, so indices can't be derived either. Only targetId works.

**agent-browser's skill content changes between versions — don't copy syntax off the web.** Its own SKILL.md states explicitly that it contains no command syntax and requires `skills get` to fetch it from the CLI. This project proved the point: `tab --url "*settings*"` and `--pin-tab` found online don't exist in earlier versions, while `tab list --json` emitting `targetId` is a newer capability — and this project's entire targeting scheme is built on it.

**agent-browser searches upward from the binary's location for a `skills/` directory**, which can collide with an unrelated project's directory of the same name. Pass `AGENT_BROWSER_SKILLS_DIR` explicitly.

**A bundled binary can't rely on `asarUnpack` alone.** `asarUnpack` places files under `app.asar.unpacked/resources/bin/`, while `process.resourcesPath` points at `Contents/Resources` — not the same location, so the binary isn't found after packaging. Use `extraResources` to align the paths, and keep `asarUnpack` limited to files actually imported with `?asset`, otherwise the same binary ships twice.

**On macOS you can't just "skip signing".** Setting `identity: null` makes electron-builder skip signing entirely; the bundle keeps Electron's original adhoc signature, but the resources have been modified, so signature and content disagree and the app **refuses to launch silently** (no error, no log; `spctl` reports `code has no resources but signature indicates they must be present`). The correct approach is `identity: '-'` for adhoc signing plus `com.apple.security.cs.disable-library-validation` in the entitlements — set both `entitlements` and `entitlementsInherit`, since the former covers the main process.

**The userData directory follows `package.json`'s `name`, while the executable follows `productName`.** These are two different fields, and `executableName` only applies to Windows — so if they disagree, you will look in the wrong place. This project deliberately sets both to `Personae` to avoid that. (Watch out on Linux: its filesystem is case-sensitive, so a directory created under an older lowercase name won't be found.)

**`publish: generic` with a placeholder URL crashes packaging at the very last step.** electron-builder's template ships `provider: generic` with `url: https://example.com/auto-updates`. Switching to `provider: github` makes it try to infer a release channel at the end of packaging, and without owner/repo context it throws `TypeError: Cannot read properties of null (reading 'channel')` — the build is already complete, yet it exits as a failure. This project publishes via `gh release upload` in CI, so `publish: null` it is.

**A job-level `if` in GitHub Actions cannot access the `matrix` context.** Writing `if: inputs.platforms == matrix.name` to filter platforms **fails silently** (`actionlint` flags `context "matrix" is not allowed here`, but GitHub itself doesn't complain), so every platform gets built regardless of the input. Generate the matrix JSON in an upstream job and feed it to `strategy.matrix` with `fromJSON`.

**When rendering SVG with Electron, suppress `window-all-closed`.** The icon script loops "create window → capture → destroy → create next", and each `destroy()` drops the window count to zero, which by default quits the whole app — the symptom is a crash after only the first size, with the child reporting `No rendezvous client, terminating process (parent died?)`. It looks like a timing issue but retrying doesn't help. Register an empty `window-all-closed` handler.

Two more: on Retina displays `capturePage` outputs at devicePixelRatio (asking for 512 yields 1024), so pin `zoomFactor` / `deviceScaleFactor`; and inlining a moderately long SVG into `data:text/html;base64,...` exceeds the URL length limit and makes `loadURL` fail with `ERR_FAILED (-2)`, so use a temp file with a `file://` reference.

## Known limitations and security notes

- **Isolation is a convention, not an architectural boundary.** The CDP port has no access control. It only listens on loopback with a random port, but any local process that connects can drive **every** identity, crossing partition boundaries. That's the direct cost of letting external agents attach. Don't handle sensitive accounts on a shared machine.
- **All navigation is confined to the window.** `setWindowOpenHandler` turns `window.open` and `target="_blank"` into same-window navigation so that one identity always maps to one target. The cost is that **OAuth flows relying on popups break**.
- **Each identity occupies 3 CDP page targets** (shell + top bar + content), so it scales at 3× the identity count.
- **The bundled agent-browser version is pinned** at build time; upstream fixes are not picked up automatically.
- **Runtime behaviour is only verified on macOS (arm64)**, including the packaged build. Windows packaging succeeds in CI (macOS + Windows are both built and produce installers), but the app has never actually been **run** on Windows, so runtime behaviour there is unverified. Linux is not a build target. `bundle:ab` bundles for the current platform only.
- **Adhoc-signed builds are not distributable**: they run only on the build machine and are blocked by Gatekeeper elsewhere. Real distribution needs your own certificate and notarization.
- **The Codex side has not been verified with a real client**: the MCP flow was tested with a script acting as the client (including the packaged build in a Node-free environment), but never against an actual codex run.

## Project layout

```
src/main/
  cdp.ts          CDP port setup/discovery, targetId resolution
  identity.ts     identity storage, window lifecycle, nav-bar IPC
  agent-bridge.ts local HTTP bridge + discovery file
  mcp-setup.ts    one-click Codex configuration
  index.ts        main entry and IPC registration
src/shared/
  colors.ts       identity palette — imported by BOTH main and renderer,
                  so a window's top-bar dot always matches its list entry
src/preload/
  index.ts        main-window API
  chrome.ts       top-bar preload (navigation methods only)
src/renderer/
  chrome.html     navigation-bar UI
  src/App.tsx     identity management and connection panel
  src/agent-prompt.ts    builds the copy-and-paste prompt for agents
  src/assets/fonts/      self-hosted latin subsets (the CSP blocks
                         external font CDNs; CJK falls back to the system)
scripts/
  mcp-server.mjs           MCP server (stdio JSON-RPC)
  bundle-agent-browser.mjs bundles the binary and core skill
  make-icons.mjs           SVG → PNG / icns / ico
design/logo/
  icon.svg                 icon source (edit this, then run pnpm icons)
  concept*.svg             alternative concepts from the design pass
.github/workflows/
  release.yml     build and publish a GitHub Release (manual)
  check.yml       lint / typecheck / packaging smoke test (manual)
```

`resources/bin/` and `resources/skills/` are generated by `pnpm bundle:ab` and not committed.

## Icon

The source is `design/logo/icon.svg` — three non-overlapping coloured cards for three isolated identities, with a pointer for agent control. After editing the SVG, regenerate every platform format:

```bash
pnpm icons
```

This produces `build/icon.png` (1024), `build/icon.icns`, `build/icon.ico` and `resources/icon.png` (512, the runtime window icon).

Rendering goes through **Electron's bundled Chromium**, so rsvg-convert / Inkscape / ImageMagick aren't needed — those are usually absent from a clean environment, whereas Electron is a dependency this project has anyway. `.icns` is assembled by the system `iconutil`; `.ico` is written byte by byte.

## Releasing

Both workflows are **manual only** (`workflow_dispatch`) and never run on push or tag.

Go to **Actions** on GitHub, pick a workflow, then **Run workflow**:

| Workflow            | Purpose                                 | Inputs                                                                                   |
| ------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Build & Release** | Build macOS + Windows, create a Release | version (optional), platform (all / macos / windows), create release, prerelease |
| **Check**           | lint + typecheck + packaging smoke test | whether to run packaging                                                                 |

The Release is created as a **draft**; review the assets, then hit Publish yourself. If the tag already exists, assets are appended to it (`--clobber` overwrites same-named files), so re-runs don't just fail.

Publishing does not use electron-builder's own publish step (`publish: null` in `electron-builder.yml`); a single aggregation job uploads everything with `gh release upload` instead, because three platforms running in parallel would otherwise each try to create the same Release and clobber one another.

macOS artifacts from CI are adhoc-signed too. For real signing, add `CSC_LINK` / `CSC_KEY_PASSWORD` to the repository secrets and set `notarize` to `true` in `electron-builder.yml`.

## License

MIT — see [LICENSE](./LICENSE).

The bundled [agent-browser](https://github.com/vercel-labs/agent-browser) is Apache-2.0; copyright belongs to its authors.
