import { homedir, tmpdir, platform, arch, cpus, hostname, userInfo, type as osType } from "node:os";
import { join } from "node:path";
import ms from "ms";

export function getSystemInfo() {
  return {
    home: homedir(), tmp: tmpdir(), platform: platform(),
    arch: arch(), cores: cpus().length, host: hostname(), osType: osType()
  };
}

export function getUserContext() {
  const info = userInfo();
  return { username: info.username, home: info.homedir, shell: info.shell };
}

export function getCacheDir() {
  return join(homedir(), ".cache", "proxy");
}

export function formatUptime(uptimeMs) {
  return ms(uptimeMs, { long: true });
}

export function getTempPath(prefix) {
  return join(tmpdir(), `${prefix}-${Date.now()}`);
}
