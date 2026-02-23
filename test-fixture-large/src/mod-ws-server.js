import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

const bus = new EventEmitter();

export function startServer(port = 0) {
  const wss = new WebSocketServer({ port });
  const id = uuidv4();
  wss.on("connection", (ws) => {
    const cid = uuidv4();
    bus.emit("client:connect", { server: id, client: cid });
    ws.on("message", (data) => {
      const hash = createHash("sha256").update(data).digest("hex").slice(0, 8);
      bus.emit("client:message", { client: cid, hash });
    });
  });
  return { wss, id };
}

export function connectTo(url) {
  return new WebSocket(url);
}

export function onServerEvent(event, fn) { bus.on(event, fn); }
