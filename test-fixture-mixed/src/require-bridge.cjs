/**
 * CJS Bridge — require() forces ESM packages through WrapESM in esbuild.
 *
 * When esbuild bundles this CJS module, it sees require() calls targeting
 * ESM-only packages. Since CJS semantics need synchronous module evaluation
 * but ESM is async, esbuild wraps these with __esm() (WrapESM) — the lazy
 * initializer pattern with terminator markers.
 *
 * This file contributes WrapESM modules to the bundle. Other source files
 * use static `import` for ESM packages (→ WrapNone) or import CJS packages
 * (→ WrapCJS). The three WrapKinds are interleaved throughout the bundle
 * because each local module mixes CJS and ESM dependencies.
 */

const { execa, execaSync } = require("execa");
const jose = require("jose");
const got = require("got");

// --- execa: async process execution via CJS require ---
async function runCommand(cmd, args, options = {}) {
  const defaults = { timeout: 30000, reject: false };
  const merged = Object.assign({}, defaults, options);
  console.log(`[require-bridge] exec: ${cmd} ${args.join(" ")}`);
  const result = await execa(cmd, args, merged);
  if (result.exitCode !== 0) {
    console.warn(`[require-bridge] command failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    duration: result.durationMs || 0,
  };
}

async function getSystemInfo() {
  const [nodeResult, npmResult] = await Promise.all([
    runCommand("node", ["--version"]),
    runCommand("npm", ["--version"]),
  ]);
  const info = {
    node: nodeResult.stdout.trim(),
    npm: npmResult.stdout.trim(),
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
  };
  console.log(`[require-bridge] system: Node ${info.node}, npm ${info.npm}`);
  return info;
}

// --- jose: JWT operations via CJS require ---
const JWT_SECRET = new TextEncoder().encode("mixed-bundle-secret-key");
const JWT_ALG = "HS256";

async function createToken(payload, expiresIn = "1h") {
  console.log(`[require-bridge] creating JWT for subject: ${payload.sub || "anonymous"}`);
  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET);
  console.log(`[require-bridge] JWT created (${token.length} chars)`);
  return token;
}

async function verifyToken(token) {
  try {
    const { payload, protectedHeader } = await jose.jwtVerify(token, JWT_SECRET);
    console.log(`[require-bridge] JWT verified: alg=${protectedHeader.alg}, sub=${payload.sub}`);
    return { valid: true, payload, alg: protectedHeader.alg };
  } catch (err) {
    console.warn(`[require-bridge] JWT verification failed: ${err.message}`);
    return { valid: false, error: err.message };
  }
}

async function createSignedManifest(data) {
  const token = await createToken({ type: "manifest", entries: data.length });
  const verified = await verifyToken(token);
  return {
    data,
    signature: token.slice(0, 40) + "...",
    verified: verified.valid,
    timestamp: new Date().toISOString(),
  };
}

// --- got: HTTP client via CJS require ---
async function fetchJSON(url, options = {}) {
  const defaults = { timeout: { request: 10000 }, retry: { limit: 2 } };
  const merged = Object.assign({}, defaults, options);
  console.log(`[require-bridge] GET ${url}`);
  try {
    const response = await got(url, merged).json();
    console.log(`[require-bridge] response received (${JSON.stringify(response).length} bytes)`);
    return { ok: true, data: response };
  } catch (err) {
    console.warn(`[require-bridge] fetch failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function checkEndpoint(url) {
  console.log(`[require-bridge] checking endpoint: ${url}`);
  try {
    const response = await got.head(url, { timeout: { request: 5000 }, throwHttpErrors: false });
    const result = {
      url,
      status: response.statusCode,
      ok: response.statusCode >= 200 && response.statusCode < 300,
      headers: {
        contentType: response.headers["content-type"],
        server: response.headers["server"],
      },
    };
    console.log(`[require-bridge] endpoint ${url}: ${result.status} ${result.ok ? "OK" : "FAIL"}`);
    return result;
  } catch (err) {
    return { url, status: 0, ok: false, error: err.message };
  }
}

module.exports = {
  // execa wrappers
  runCommand,
  getSystemInfo,
  // jose wrappers
  createToken,
  verifyToken,
  createSignedManifest,
  // got wrappers
  fetchJSON,
  checkEndpoint,
};
