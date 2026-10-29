// Types for the parts of the Colyseus JavaScript SDK (colyseus.js 0.17.43, from the
// "@colyseus/sdk@0.17.43" release's colyseus-sdk.zip) that this project uses. The full typings ship
// with the npm package @colyseus/sdk; runtime/colyseus.js is its UMD browser bundle.

export interface Room<State = any> {
    roomId: string;
    sessionId: string;
    reconnectionToken: string;
    state: State;
    send(type: string | number, message?: any): void;
    leave(consented?: boolean): Promise<number>;
    onLeave(callback: (code: number, reason?: string) => void): void;
    onError(callback: (code: number, message?: string) => void): void;
    onMessage(type: string | number | "*", callback: (...args: any[]) => void): () => void;
}

export declare class Client {
    constructor(endpoint?: string);
    joinOrCreate<State = any>(roomName: string, options?: any): Promise<Room<State>>;
    join<State = any>(roomName: string, options?: any): Promise<Room<State>>;
    joinById<State = any>(roomId: string, options?: any): Promise<Room<State>>;
    reconnect<State = any>(reconnectionToken: string): Promise<Room<State>>;
}

export interface StateCallbacks {
    listen(property: string, handler: (value: any, previousValue: any) => void, immediate?: boolean): () => void;
    listen(instance: any, property: string, handler: (value: any, previousValue: any) => void, immediate?: boolean): () => void;
    onAdd(collection: string, handler: (item: any, key: any) => void, immediate?: boolean): () => void;
    onRemove(collection: string, handler: (item: any, key: any) => void): () => void;
    // Collection items: the key (array index or map key) comes first, then the new value.
    onChange(collection: string, handler: (key: any, value: any) => void): () => void;
    onChange(instance: any, handler: () => void): () => void;
}

export declare const Callbacks: {
    get(room: Room): StateCallbacks;
};

declare const Colyseus: {
    Client: typeof Client;
    Callbacks: typeof Callbacks;
};
export default Colyseus;
