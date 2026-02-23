import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import debug from "debug";
import { createQueue, createLimiter, generateId } from "./require-bridge.cjs";

const log = debug("proxy:tasks");

export function createTaskRunner(concurrency = 4) {
  const queue = createQueue(concurrency);
  const limiter = createLimiter(concurrency);
  return { queue, limiter, id: generateId() };
}

export function makeTask(name, fn) {
  const id = randomUUID();
  log("task created: %s (%s)", name, id);
  return { id, name, fn, status: "pending", created: Date.now() };
}

export function taskWorkdir(name) {
  return join(tmpdir(), "proxy-tasks", `${name}-${Date.now()}`);
}
