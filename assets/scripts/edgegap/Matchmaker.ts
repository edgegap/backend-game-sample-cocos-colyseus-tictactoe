// Edgegap matchmaker client (matchmaker 3.x ticket API), called straight from the browser.
//
//   POST   {url}/tickets        { profile, attributes }  -> { id, status, ... }
//   GET    {url}/tickets/{id}   SEARCHING | MATCH_FOUND | HOST_ASSIGNED (+ assignment) | CANCELLED
//   DELETE {url}/tickets/{id}   leave the queue
// Header: Authorization: <matchmaker auth token>, raw. That token is made to ship in game clients:
// it can only create and read tickets, never touch the Edgegap account. The page's origin must be
// listed in the matchmaker config's allowed_cors_origins.

export interface MatchmakerOptions {
  url: string;
  token: string;
  profile: string;
  pollMs?: number;
  portName?: string; // port name in the Edgegap app version
  onStatus?: (status: string) => void;
}

export class Matchmaker {
  private ticketId: string | null = null;
  private cancelled = false;
  private o: Required<MatchmakerOptions>;

  constructor(options: MatchmakerOptions) {
    this.o = { pollMs: 2000, portName: "gameport", onStatus: () => {}, ...options };
    this.o.url = this.o.url.replace(/\/+$/, "");
    // Leave the queue if the tab closes while searching.
    window.addEventListener("pagehide", () => this.cancel());
  }

  /** Queues one player and resolves with the game server's wss:// URL once a server is assigned. */
  async findMatch(): Promise<string> {
    this.cancelled = false;
    this.o.onStatus("Joining queue...");
    const ticket = await this.request("POST", "/tickets", { profile: this.o.profile, attributes: {} });
    this.ticketId = ticket.id;
    const started = Date.now();

    while (!this.cancelled) {
      await new Promise((r) => setTimeout(r, this.o.pollMs));
      const t = await this.request("GET", `/tickets/${encodeURIComponent(ticket.id)}`);
      const seconds = Math.round((Date.now() - started) / 1000);
      switch (t.status) {
        case "SEARCHING":
          this.o.onStatus(`Searching for players... ${seconds}s`);
          break;
        case "TEAM_FOUND":
        case "MATCH_FOUND":
          this.o.onStatus("Match found, starting server...");
          break;
        case "HOST_ASSIGNED": {
          const a = t.assignment;
          const port = Number(a?.ports?.[this.o.portName]?.external);
          if (!a?.fqdn || !port) throw new Error(`Assignment without ${this.o.portName}: ${JSON.stringify(a)}`);
          this.ticketId = null; // matched: a DELETE now would only get a 409
          // TLS Upgrade on the port: connect by fqdn, the certificate matches it.
          return `wss://${a.fqdn}:${port}`;
        }
        case "CANCELLED":
          this.ticketId = null;
          throw new Error("Ticket expired before a match was found");
        default:
          throw new Error(`Unexpected ticket status ${t.status}`);
      }
    }
    throw new Error("Matchmaking cancelled");
  }

  cancel() {
    this.cancelled = true;
    if (!this.ticketId) return;
    const id = this.ticketId;
    this.ticketId = null;
    fetch(`${this.o.url}/tickets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: this.o.token },
      keepalive: true,
    }).catch(() => {});
  }

  private async request(method: string, path: string, body?: unknown) {
    const res = await fetch(this.o.url + path, {
      method,
      headers: { Authorization: this.o.token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Matchmaker ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  }
}
