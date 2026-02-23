import { createHash, randomBytes, randomUUID, createHmac } from "node:crypto";
import { signJwt } from "./require-bridge.cjs";
import { v4 as uuidv4 } from "uuid";

export function hashString(input, algo = "sha256") {
  return createHash(algo).update(input).digest("hex");
}

export function hmacSign(key, data) {
  return createHmac("sha256", key).update(data).digest("hex");
}

export function generateToken() {
  return randomBytes(32).toString("base64url");
}

export function generateRequestId() {
  return randomUUID();
}

export function generateCorrelationId() {
  return uuidv4();
}

export async function createAuthToken(payload, secret) {
  return signJwt(payload, secret);
}

export function hashPayload(obj) {
  const sorted = JSON.stringify(obj, Object.keys(obj).sort());
  return hashString(sorted);
}
