/**
 * Network handler — mixes CJS (ws, uuid) with WrapESM (got, jose via require-bridge).
 * The require-bridge imports create WrapESM regions; ws/uuid create WrapCJS.
 * This module is the primary bridge between WrapCJS and WrapESM in the bundle.
 */
import { WebSocketServer, WebSocket } from "ws";       // CJS → WrapCJS
import { v4 as uuidv4 } from "uuid";                   // CJS → WrapCJS
import {
  fetchJSON,
  checkEndpoint,
  createToken,
  verifyToken,
} from "./require-bridge.cjs";                          // CJS bridge → WrapESM for got/jose
import { randomBytes, createHash as netCreateHash } from "node:crypto";  // BMI: crypto
import { URL, URLSearchParams } from "node:url";                         // BMI: url
import { EventEmitter } from "node:events";                              // BMI: events

const CONNECTIONS = new Map();
const networkEvents = new EventEmitter();

export function createServer(port = 0) {
  const serverId = uuidv4();
  console.log(`[network] Creating WebSocket server (id: ${serverId})`);
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws, req) => {
    const clientId = uuidv4();
    CONNECTIONS.set(clientId, { ws, connectedAt: Date.now(), remote: req.socket.remoteAddress });
    console.log(`[network] Client connected: ${clientId} (total: ${CONNECTIONS.size})`);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      console.log(`[network] Message from ${clientId}: ${msg.type || "unknown"}`);
      ws.send(JSON.stringify({ ack: true, clientId, timestamp: Date.now() }));
    });

    ws.on("close", () => {
      CONNECTIONS.delete(clientId);
      console.log(`[network] Client disconnected: ${clientId} (total: ${CONNECTIONS.size})`);
    });
  });

  return new Promise((resolve) => {
    wss.on("listening", () => {
      const addr = wss.address();
      console.log(`[network] Server listening on port ${addr.port} (id: ${serverId})`);
      resolve({ wss, port: addr.port, serverId });
    });
  });
}

export async function connectAndSend(url, messages) {
  const sessionId = uuidv4();
  console.log(`[network] Connecting to ${url} (session: ${sessionId})`);
  const ws = new WebSocket(url);

  return new Promise((resolve, reject) => {
    const responses = [];
    ws.on("open", async () => {
      for (const msg of messages) {
        const payload = { ...msg, sessionId, sentAt: Date.now() };
        ws.send(JSON.stringify(payload));
        console.log(`[network] Sent: ${msg.type || "data"}`);
      }
      // Wait a beat for responses
      setTimeout(() => {
        ws.close();
        resolve({ sessionId, sent: messages.length, received: responses.length, responses });
      }, 100);
    });
    ws.on("message", (data) => {
      responses.push(JSON.parse(data.toString()));
    });
    ws.on("error", reject);
  });
}

export async function fetchData(url) {
  return fetchJSON(url);
}

export async function healthCheck(url) {
  return checkEndpoint(url);
}

export async function authenticatedFetch(url, subject) {
  const token = await createToken({ sub: subject, scope: "read" });
  console.log(`[network] Fetching ${url} with auth (subject: ${subject})`);
  // In a real scenario we'd pass the token as a header
  const result = await fetchJSON(url).catch((err) => ({ ok: false, error: err.message }));
  const verification = await verifyToken(token);
  return {
    ...result,
    auth: { subject, tokenValid: verification.valid },
    requestId: uuidv4(),
  };
}

export function getConnectionCount() {
  return CONNECTIONS.size;
}

// --- BMI exercising functions (crypto, url, events) ---

export function generateRequestId() {
  return randomBytes(16).toString("hex");
}

export function hashPayload(data) {
  return netCreateHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export function parseEndpoint(endpoint) {
  const parsed = new URL(endpoint);
  const params = new URLSearchParams(parsed.search);
  return { host: parsed.hostname, port: parsed.port, path: parsed.pathname, params: Object.fromEntries(params) };
}

export function onNetworkEvent(event, handler) {
  networkEvents.on(event, handler);
}

export function emitNetworkEvent(event, data) {
  networkEvents.emit(event, { ...data, timestamp: Date.now(), requestId: generateRequestId() });
}
