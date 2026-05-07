interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectNamespace<T> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub<T>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectId {}

interface DurableObjectStub<T> {
  fetch(request: Request): Promise<Response>;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
