import { createHash } from "node:crypto";
import { URL } from "node:url";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { httpGet, generateId } from "./require-bridge.cjs";

const events = new EventEmitter();

export async function fetchJson(url) {
  return httpGet(url);
}

export function parseUrl(raw) {
  const u = new URL(raw);
  return { host: u.hostname, port: u.port, path: u.pathname, protocol: u.protocol };
}

export function connectWs(url) {
  const ws = new WebSocket(url);
  const id = generateId();
  ws.on("open", () => events.emit("ws:open", { id, url }));
  ws.on("close", () => events.emit("ws:close", { id }));
  return { ws, id };
}

export function checksumPayload(data) {
  return createHash("md5").update(JSON.stringify(data)).digest("hex");
}

export function onNetEvent(event, fn) { events.on(event, fn); }
export function emitNetEvent(event, data) { events.emit(event, data); }
