# Cocos Creator + Colyseus Tic Tac Toe on Edgegap

This fork of [colyseus/cocos-demo-tictactoe](https://github.com/colyseus/cocos-demo-tictactoe) runs every match on its own Colyseus server on [Edgegap](https://edgegap.com), started near the two players by Edgegap's matchmaker. The server stops itself when the match ends.

```
Cocos client --ticket--> Edgegap Matchmaker --deploy--> Edgegap (one Colyseus server per match)
Cocos client <--assignment--          Cocos client --wss://<id>.pr.edgegap.net:<port>--> server
```

Changes from upstream:

| | Upstream | This fork |
|---|---|---|
| Cocos Creator | 3.1.1 | 3.8.8 |
| Colyseus | 0.14 (Arena) | 0.17 (`defineServer`), SDK 0.17.43 in `extensions/colyseus-sdk` |
| Hosting | one server, many rooms | one Edgegap deployment per match, stops itself |
| Finding a game | `joinOrCreate` on `localhost:2567` | Edgegap matchmaker, or a direct `?server=` URL, or `localhost:2567` |
| Server build and upload | - | [Edgegap Cocos extension](https://github.com/edgegap/edgegap-cocos-plugin) 2.0 in `extensions/edgegap-extension`, preconfigured |

Verified on 2026-10-29: two Node bots matched through the matchmaker and finished a game on one deployment; the Cocos web build (web-desktop, Chrome) was matched with a bot, played a game to "You win!", and the deployment stopped itself after the match. The server image and version `cocos-tictactoe/20261029-1923` were then built, pushed, created and test-deployed by the Edgegap Cocos extension's steps (headless, `scripts/e2e.mjs` of the extension), and two bots played a game on that deployment over `wss://`. Not run: Cocos mini-game, native and mobile builds, the web-mobile template, direct mode on Edgegap (the e2e script supports it).

## Files

- `Server/src/edgegap.ts`: lifecycle. On Edgegap (`ARBITRIUM_REQUEST_ID` set) the server stops its deployment when nobody joins within 120 s, when it has been empty for 30 s, or when the match ends. Locally none of it runs.
- `Server/src/rooms/tictactoe.ts`: upstream room plus `playerJoined()` / `playerLeft()` and `endMatch()` (lock, show the result for 5 s, disconnect, `selfStop`).
- `Server/src/index.ts`: Colyseus 0.17 entry; playground and monitor only off Edgegap.
- `extensions/edgegap-extension/`: the [Edgegap Cocos extension](https://github.com/edgegap/edgegap-cocos-plugin) (build, test, upload, deploy); its settings for this project are in `settings/v2/packages/edgegap-extension.json`.
- `Server/Dockerfile` (the extension builds it), `Server/scripts/e2e.mjs` (bots), `Server/scripts/edgegap-deploy.mjs` (one direct deployment from a script).
- `assets/scripts/edgegap/Matchmaker.ts`, `joinWithRetry.ts`: matchmaker ticket client and the first-join retry (a fresh deployment answers 502 for a few seconds).
- `assets/scripts/SceneManager.ts`: picks where to connect, and the Colyseus 0.17 state callbacks.
- `edgegap/matchmaker-config.json`: one `casual` profile, 2 players.

## Run locally

```bash
cd Server && npm install && npm start
```

Open the project in Cocos Creator 3.8.8 and run the preview (`localhost:7456`) in two browser tabs. `node scripts/e2e.mjs` plays a game with two bots against the local server.

## Host it on Edgegap

Needs Docker Desktop running.

1. In Cocos Creator: **Extension → Edgegap → Open Panel** (if it isn't in the menu: Extension Manager → Project → enable `edgegap-extension`).
2. **1. Sign in**: **Get a token** (one-click sign-in), paste it, **Verify and sign in**.
3. **2. Server** is preset for this project: folder `Server`, image `cocos-tictactoe`, port `2567`, **WS**, **TLS Upgrade** on, port name `gameport`. Click **Now** for a fresh tag.
4. **3. Build and test locally**: **Build image**, then **Run locally** and play the preview against `ws://localhost:2567` if you like; **Stop local**.
5. **4. Upload**: application `cocos-tictactoe`, **Push image and create version**.
6. Optional, **5. Deploy a test server**: **Deploy near me**, then open the web build with `?server=<the wss:// URL>` in two tabs, or run `cd Server && node scripts/e2e.mjs --server=<the wss:// URL>`; **Stop server**.
7. Matchmaker → Create → paste `edgegap/matchmaker-config.json` (set `application.version` to the tag you uploaded, add every origin that serves the web build to `allowed_cors_origins`) → Create and Start. Copy the API URL and Auth Token.
8. Check with two bots: `cd Server && node scripts/e2e.mjs --mm=<API URL> --mm-token=<Auth Token>`.

## Point the Cocos client at it

`SceneManager` connects to, in order:

1. `?server=wss://<fqdn>:<port>`: one direct deployment (`npm run edgegap:deploy -- cocos-tictactoe <version>` prints it).
2. The matchmaker: `?mm=<API URL>&mmToken=<Auth Token>` on the page, or the **Matchmaker URL / Token** fields of the SceneManager component on the `Canvas` node.
3. `serverURL:port` (default `localhost:2567`).

The matchmaker Auth Token is made to ship in clients: it can create and read tickets, nothing else. The Edgegap API token never goes into the client.

Play against a bot: open the web build, click to start, then run `node scripts/e2e.mjs --players=1 --mm=<API URL> --mm-token=<Auth Token>` within 30 s.

## Pitfalls hit while porting

- **Colyseus 0.14 → 0.17 state callbacks.** `state.players.onAdd = ...` and `state.listen` are gone; use `Callbacks.get(room)`. For array items `onChange("board", (index, value) => ...)` passes the **index first**, the opposite of 0.14.
- **Initial values.** `listen` calls its handler right away when a value is already set, and the board starts as nine `0`s: the client ignores empty `winner`, `currentTurn`, `draw` and `0` cells.
- **SDK version.** The 0.14 extension can't talk to a 0.17 server. `extensions/colyseus-sdk/runtime/colyseus.js` is the UMD bundle from the `@colyseus/sdk@0.17.43` GitHub release (`colyseus-sdk.zip`), imported as `db://colyseus-sdk/colyseus.js`.
- **`systemEvent`** is deprecated in 3.8: input uses `input.on(Input.EventType.MOUSE_DOWN / TOUCH_START)`.
- **Background tabs.** A Cocos web build in a hidden tab doesn't run frames, so it never loads its scene or answers its turn; test with the tab in front.
- **First join after matchmaking** gets `Bad Gateway` for a few seconds: `joinWithRetry` retries 10 times, 2 s apart.
- **Building by hand** instead of the extension: `docker build --platform linux/amd64 -t registry.edgegap.com/<project>/cocos-tictactoe:<YYYYMMDD-HHMM> Server`, push, then create the version in the dashboard with the same port settings and the Container Registry login.
- **Headless builds:** `CocosCreator.exe --project <path> --build "platform=web-desktop;debug=true"`; exit code 36 is a successful build.
