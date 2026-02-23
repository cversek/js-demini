// Large Bundle Bundle — 1/10 scale entry point
// Exercises all internal modules + direct package imports

import * as pathUtils from "./mod-path-utils.js";
import * as fsOps from "./mod-fs-ops.js";
import * as cryptoAuth from "./mod-crypto-auth.js";
import * as osInfo from "./mod-os-info.js";
import * as config from "./mod-config.js";
import * as processMgr from "./mod-process-mgr.js";
import * as netClient from "./mod-net-client.js";
import * as version from "./mod-version.js";
import * as textFmt from "./mod-text-fmt.js";
import * as taskQueue from "./mod-task-queue.js";
import * as env from "./mod-env.js";
import * as globScan from "./mod-glob-scan.js";
import * as cliUi from "./mod-cli-ui.js";
import * as wsServer from "./mod-ws-server.js";

// Direct CJS imports (ensure tree-shaking doesn't remove)
import debug from "debug";
import dotenv from "dotenv";
import semver from "semver";
import { v4 as uuidv4 } from "uuid";
import minimist from "minimist";
import ms from "ms";
import ini from "ini";
import crossSpawn from "cross-spawn";
import whichMod from "which";
import { WebSocket } from "ws";
import { cosmiconfig } from "cosmiconfig";
import fs from "fs-extra";
import jsYaml from "js-yaml";

// WrapESM bridge imports
import {
  colorize, spin, parseCliArgs, exec, findFiles, findConfig,
  createQueue, createLimiter, generateId, cleanAnsi, measureWidth,
  wrapText, httpGet, signJwt, onExit
} from "./require-bridge.cjs";

// Exercise path subsystem
const paths = pathUtils.resolvePaths("/tmp", "proxy", "test");
const rel = pathUtils.relativize("/tmp", "/tmp/proxy/test");
const norm = pathUtils.normPath("./relative/../path");
const joined = pathUtils.joinAll("/root", "sub", "file.js");

// Exercise fs subsystem
const content = fsOps.readSafe("/tmp/nonexistent");
const listing = fsOps.listDir("/tmp");

// Exercise crypto subsystem
const hash = cryptoAuth.hashString("test-payload");
const hmac = cryptoAuth.hmacSign("secret", "data");
const token = cryptoAuth.generateToken();
const reqId = cryptoAuth.generateRequestId();
const corrId = cryptoAuth.generateCorrelationId();
const payloadHash = cryptoAuth.hashPayload({ key: "value" });

// Exercise os subsystem
const sysInfo = osInfo.getSystemInfo();
const userCtx = osInfo.getUserContext();
const cacheDir = osInfo.getCacheDir();
const uptime = osInfo.formatUptime(3600000);
const tmpPath = osInfo.getTempPath("proxy");

// Exercise config subsystem
const configPath = config.getConfigPath("/root", "settings.yaml");

// Exercise process subsystem
const isWin = processMgr.isWindows();
const scriptPath = processMgr.resolveScript("/app", "build.sh");

// Exercise net subsystem
const parsed = netClient.parseUrl("https://example.com:8080/api?key=val");
const checksum = netClient.checksumPayload({ data: 123 });

// Exercise version subsystem
const bump = version.bumpVersion("1.2.3", "minor");
const sorted = version.sortVersions(["2.0.0", "1.0.0", "1.5.0"]);

// Exercise text formatting
const table = textFmt.formatTable([["Name", "Value"], ["a", "1"]], [20, 10]);
const truncated = textFmt.truncate("a long string here", 10);
const wrapped = textFmt.wrapOutput("text to wrap at column boundary", 40);
const hilite = textFmt.highlight("important", "cyan");

// Exercise task queue
const runner = taskQueue.createTaskRunner(2);
const task = taskQueue.makeTask("test-task", () => {});
const workdir = taskQueue.taskWorkdir("build");

// Exercise env
const envVal = env.getEnv("HOME", "/default");
const envPath = env.resolveEnvPath("PATH");

// Exercise glob scan
const fileSize = globScan.getSize("/tmp");

// Exercise cli ui
const flags = cliUi.parseFlags(["node", "cli", "--verbose", "--port", "3000"]);
const name = cliUi.scriptName();

// Exercise ws server
netClient.onNetEvent("test", () => {});

// Direct package exercises (prevent tree-shaking)
const log = debug("proxy:main");
log("initialized");
dotenv.config({ path: ".env.proxy", override: false });
const ver = semver.valid("1.0.0");
const id = uuidv4();
const args = minimist(["--test"]);
const duration = ms("2 days");
const iniStr = ini.stringify({ section: { key: "value" } });
const explorer = cosmiconfig("proxy");
const yaml = jsYaml.dump({ test: true });

// Bridge exercises
const colored = colorize("proxy ready", "green");
const clean = cleanAnsi(colored);
const width = measureWidth("test string");
const wrappedBridge = wrapText("bridge text", 60);
const bridgeId = generateId();

console.log(JSON.stringify({
  paths, rel, norm, joined, hash, hmac, token, reqId, corrId,
  sysInfo: sysInfo.platform, userCtx: userCtx.username,
  cacheDir, uptime, configPath, isWin, scriptPath,
  parsed: parsed.host, checksum, bump, table: table.length,
  runner: runner.id, task: task.id, workdir, envVal, flags,
  ver, id, duration, width, bridgeId, name
}));
