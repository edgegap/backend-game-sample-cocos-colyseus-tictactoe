
import { _decorator, Component, Node, input, Input, Vec2, Label, Color, sys } from 'cc';
import { Board } from './board';
import Colyseus, { Room } from 'db://colyseus-sdk/colyseus.js';
import { Matchmaker } from './edgegap/Matchmaker';
import { joinWithRetry } from './edgegap/joinWithRetry';

const { ccclass, property } = _decorator;
@ccclass('SceneManager')
export class SceneManager extends Component {
  
    //Server connection settings
    @property
    private serverURL : string = "localhost";
    @property
    private port : string = "2567";

    // Edgegap: a page parameter wins over these fields, an explicit server over the matchmaker.
    //   ?server=wss://<fqdn>:<port>          one direct deployment
    //   ?mm=<matchmaker url>&mmToken=<token>  Find Match through the Edgegap matchmaker
    @property({tooltip: "Edgegap matchmaker API URL. Empty = connect to serverURL:port."})
    private matchmakerURL : string = "";
    @property({tooltip: "Edgegap matchmaker Auth Token (client-safe: it can only create and read tickets)."})
    private matchmakerToken : string = "";
    @property
    private matchmakerProfile : string = "casual";

    //UI Nodes
    @property({type:Node})
    private menuNode : Node | null = null;
    @property({type:Node})
    private lobbyNode : Node | null = null;
    @property({type:Node})
    private gameNode : Node | null = null;
    @property({type:Node})
    private endgameNode : Node | null = null;

    //Game Elements
    @property({type : Board})
    private board : Board | null = null;
    @property({type : Label})
    private statusText : Label | null = null;
    @property({type : Label})
    private resultsText : Label | null = null;
    @property({type:Label})
    private timerText : Label | null = null;

    //local private variables
    private gameState : string = "MENU";
    private client : Colyseus.Client | null = null;
    private room : Colyseus.Room | null = null;
    private countdownInterval : any;
    private matchmaker : Matchmaker | null = null;
    private lobbyText : Label | null = null;

    onLoad(){
        this.lobbyText = this.lobbyNode!.getComponentInChildren(Label);
        this.resetGame();
    }

    onDestroy(){
        this.matchmaker?.cancel();
    }

    resetGame(){
        this.gameState = "MENU";
        this.board!.initialize(this);
        this.handleGameState();
    }

    onEnable () {
        input.on(Input.EventType.MOUSE_DOWN, this.handleMouseClick, this);
        input.on(Input.EventType.TOUCH_START, this.handleMouseClick, this);
    }

    onDisable(){
        input.off(Input.EventType.MOUSE_DOWN, this.handleMouseClick, this);
        input.off(Input.EventType.TOUCH_START, this.handleMouseClick, this);
    }

    handleGameState() {
        this.menuNode!.active = this.gameState == "MENU";
        this.lobbyNode!.active = this.gameState == "LOBBY";
        this.gameNode!.active = this.gameState == "GAME";
        this.endgameNode!.active = this.gameState == "ENDGAME"
    }

    handleMouseClick(event: any){
        switch(this.gameState){
            case "MENU":
                {
                    this.gameState = "LOBBY";
                    this.handleGameState();
                    this.connect();
                    break;
                }
        }
    }

    // Edgegap: where to connect. ?server= > matchmaker (page parameters, then inspector fields) > serverURL:port.
    async findServer () : Promise<{ url: string, attempts: number }> {
        const params = new URLSearchParams(sys.isBrowser ? window.location.search : "");
        const direct = params.get("server");
        if (direct) return { url: direct, attempts: 10 };

        const mmUrl = params.get("mm") || this.matchmakerURL;
        const mmToken = params.get("mmToken") || this.matchmakerToken;
        if (mmUrl && mmToken) {
            this.matchmaker = new Matchmaker({
                url: mmUrl,
                token: mmToken,
                profile: params.get("profile") || this.matchmakerProfile,
                onStatus: (status) => this.lobbyText!.string = status,
            });
            const url = await this.matchmaker.findMatch();
            this.matchmaker = null;
            // A server that just started answers 502 for a few seconds: retry the first join.
            return { url, attempts: 10 };
        }

        const secure = sys.isBrowser && window.location.protocol === "https:";
        return { url: `${secure ? "wss" : "ws"}://${this.serverURL}:${this.port}`, attempts: 1 };
    }

    async connect () {
        console.log("Joining game...");
        try {
            const { url, attempts } = await this.findServer();
            this.lobbyText!.string = "Waiting for an opponent...";
            this.client = new Colyseus.Client(url);
            this.room = await joinWithRetry(this.client, "tictactoe", {}, attempts);
        } catch (e: any) {
            console.error(e);
            this.showEndgame(e?.message?.includes("expired") ? "No opponent found, try again" : "Could not connect, sorry!");
            return;
        }

        // Colyseus 0.17 state callbacks
        const $ = Colyseus.Callbacks.get(this.room);

        let numPlayers = 0;
        $.onAdd("players", () => {
          numPlayers++;

          if (numPlayers === 2) {
            this.onJoin();
          }
        });

        // 0.17 passes (index, value) for array items; 0.14 passed (value, index).
        $.onChange("board", (index: number, value: number) => {
            if (!value) return; // empty cell
            const x = index % 3;
            const y = Math.floor(index / 3);
            this.board!.set(x, y, value);
          });

          $.listen("currentTurn", (sessionId: string ) => {
            if (!sessionId) return;
            // go to next turn after a little delay, to ensure "onJoin" gets called before this.
            setTimeout(() => this.nextTurn(sessionId), 10);
          });

          $.listen("draw", (draw: boolean) => draw && this.showEndgame("Draw!"));
          $.listen("winner", (sessionId: string) => sessionId && this.showEndgame(this.room!.sessionId == sessionId ? "You win!" : "You lose!"));

          this.room.onError(() => {
            this.showEndgame("And error has occurred, sorry!");
          });
    }
    
    showWinner (sessionId: string) {
        this.showEndgame(this.room!.sessionId == sessionId ? "You win!" : "You lose!");
    }

    showEndgame(message : string){
        if (this.gameState == "ENDGAME") return;
        this.room?.leave()
        this.room = null;
        this.resultsText!.string = message;
        this.gameState = "ENDGAME";
        this.handleGameState();
        clearInterval(this.countdownInterval);
        //Reset afer a time
        setTimeout(() => {
            this.resetGame();
        }, 5000);
    }

    nextTurn (playerId: string) {
        if (playerId == this.room!.sessionId) {
            this.statusText!.string = "Your move!"
        } else {
            this.statusText!.string = "Opponent's turn..."
        }

        this.timerText!.string = "10";
        this.timerText!.color.set(Color.fromHEX(this.timerText!.color, '#000000'));
    }



    onJoin(){
        console.log("Joined game!");
        this.gameState = "GAME";
        this.handleGameState();
        this.countdownInterval = setInterval(this.turnCountdown.bind(this), 1000)
    }

    turnCountdown () {
        var currentNumber = parseInt(this.timerText!.string, 10) - 1
    
        if (currentNumber >= 0) {
          this.timerText!.string = currentNumber.toString()
        }
    
        let color = this.timerText!.color;
        if (currentNumber <= 3) {
          this.timerText!.color.set(Color.fromHEX(color, '#934e60'));
        } else {
            this.timerText!.color.set(Color.fromHEX(color, '#000000'));
        }
    
      }

    playerAction(pos: Vec2){
        this.room!.send("action", { x: pos.x, y: pos.y })
    }
    
}