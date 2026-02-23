// CJS bridge — forces WrapESM for ESM packages imported via require()
const chalk = require("chalk");
const ora = require("ora");
const meow = require("meow");
const execa = require("execa");
const globby = require("globby");
const findUp = require("find-up");
const pQueue = require("p-queue");
const pLimit = require("p-limit");
const nanoid = require("nanoid");
const stripAnsi = require("strip-ansi");
const stringWidth = require("string-width");
const wrapAnsi = require("wrap-ansi");
const got = require("got");
const jose = require("jose");
const signalExit = require("signal-exit");

// Exercise each to prevent tree-shaking
function colorize(text, color) {
  const c = chalk.default || chalk;
  return c[color] ? c[color](text) : text;
}

function spin(msg) {
  const start = ora.default || ora;
  return typeof start === "function" ? start(msg) : null;
}

function parseCliArgs(def) {
  const m = meow.default || meow;
  return typeof m === "function" ? m(def, { importMeta: { url: "" } }) : {};
}

async function exec(cmd, args) {
  const e = execa.execa || execa.default || execa;
  return typeof e === "function" ? e(cmd, args) : {};
}

async function findFiles(patterns) {
  const g = globby.globby || globby.default || globby;
  return typeof g === "function" ? g(patterns) : [];
}

async function findConfig(name) {
  const f = findUp.findUp || findUp.default || findUp;
  return typeof f === "function" ? f(name) : null;
}

function createQueue(concurrency) {
  const PQ = pQueue.default || pQueue;
  return typeof PQ === "function" ? new PQ({ concurrency }) : null;
}

function createLimiter(max) {
  const pl = pLimit.default || pLimit;
  return typeof pl === "function" ? pl(max) : (fn) => fn();
}

function generateId() {
  const n = nanoid.nanoid || nanoid.default || nanoid;
  return typeof n === "function" ? n() : "fallback-id";
}

function cleanAnsi(text) {
  const s = stripAnsi.default || stripAnsi;
  return typeof s === "function" ? s(text) : text;
}

function measureWidth(text) {
  const sw = stringWidth.default || stringWidth;
  return typeof sw === "function" ? sw(text) : text.length;
}

function wrapText(text, cols) {
  const w = wrapAnsi.default || wrapAnsi;
  return typeof w === "function" ? w(text, cols) : text;
}

async function httpGet(url) {
  const g = got.got || got.default || got;
  return typeof g === "function" ? g(url).json() : {};
}

async function signJwt(payload, secret) {
  const { SignJWT } = jose;
  if (SignJWT) {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .sign(new TextEncoder().encode(secret));
  }
  return "unsigned";
}

function onExit(fn) {
  const se = signalExit.onExit || signalExit.default || signalExit;
  return typeof se === "function" ? se(fn) : null;
}

module.exports = {
  colorize, spin, parseCliArgs, exec, findFiles, findConfig,
  createQueue, createLimiter, generateId, cleanAnsi, measureWidth,
  wrapText, httpGet, signJwt, onExit
};
