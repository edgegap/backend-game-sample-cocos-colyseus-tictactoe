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

Verified on 2026-10-29: two Node bots matched through the matchmaker and finished a game on one deployment; the Cocos web build (web-desktop, Chrome) was matched with a bot, played a game to "You win!", and the deployment stopped itself after the match. Not run: Cocos mini-game, native and mobile builds, the web-mobile template, direct mode on Edgegap (the e2e script supports it).

## Files

- `Server/src/edgegap.ts`: lifecycle. On Edgegap (`ARBITRIUM_REQUEST_ID` set) the server stops its deployment when nobody joins within 120 s, when it has been empty for 30 s, or when the match ends. Locally none of it runs.
- `Server/src/rooms/tictactoe.ts`: upstream room plus `playerJoined()` / `playerLeft()` and `endMatch()` (lock, show the result for 5 s, disconnect, `selfStop`).
- `Server/src/index.ts`: Colyseus 0.17 entry; playground and monitor only off Edgegap.
- `Server/Dockerfile`, `Server/scripts/edgegap-deploy.mjs` (one direct deployment), `Server/scripts/e2e.mjs` (bots).
- `assets/scripts/edgegap/Matchmaker.ts`, `joinWithRetry.ts`: matchmaker ticket client and the first-join retry (a fresh deployment answers 502 for a few seconds).
- `assets/scripts/SceneManager.ts`: picks where to connect, and the Colyseus 0.17 state callbacks.
- `edgegap/matchmaker-config.json`: one `casual` profile, 2 players.

## Run locally

```bash
cd Server && npm install && npm start
```

Open the project in Cocos Creator 3.8.8 and run the preview (`localhost:7456`) in two browser tabs. `node scripts/e2e.mjs` plays a game with two bots against the local server.

## Host it on Edgegap

1. Build and push the server image (tag = UTC timestamp):
   ```bash
   docker build --platform linux/amd64 -t registry.edgegap.com/<project>/cocos-tictactoe:<YYYYMMDD-HHMM> Server
   docker push registry.edgegap.com/<project>/cocos-tictactoe:<YYYYMMDD-HHMM>
   ```
2. Dashboard → Applications → create `cocos-tictactoe`, version `<YYYYMMDD-HHMM>`: the image above with the Container Registry login, 0.25 vCPU / 512 MB, one port `2567`, protocol **WS**, name `gameport`, **TLS Upgrade** on.
3. Matchmaker → Create → paste `edgegap/matchmaker-config.json` (set `application.version`, add every origin that serves the web build to `allowed_cors_origins`) → Create and Start. Copy the API URL and Auth Token.
4. Check with two bots: `cd Server && node scripts/e2e.mjs --mm=<API URL> --mm-token=<Auth Token>`.

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
- **Headless builds:** `CocosCreator.exe --project <path> --build "platform=web-desktop;debug=true"`; exit code 36 is a successful build.
