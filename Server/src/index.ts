import { defineRoom, defineServer, playground, monitor } from "colyseus";
import { TicTacToe } from "./rooms/tictactoe";
import { onEdgegap, startLifecycle } from "./edgegap";

const port = parseInt(process.env.PORT || "2567");

const server = defineServer({
  rooms: {
    tictactoe: defineRoom(TicTacToe),
  },
  express: (app) => {
    // Dev tools stay off on Edgegap: a match server only needs the matchmake route and WebSocket.
    if (onEdgegap) return;
    app.use("/", playground());
    app.use("/monitor", monitor());
  },
});

server.listen(port).then(() => {
  console.log(`Tic Tac Toe server listening on http://localhost:${port}`);
  startLifecycle();
});
