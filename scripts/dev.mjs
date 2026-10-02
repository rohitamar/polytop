import { spawn, spawnSync } from "node:child_process";

const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this launcher with npm run dev.");

const children = [];
let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
  }
  process.exit(code);
};

for (const args of [
  ["run", "dev", "-w", "@reach/server"],
  ["run", "dev:web", "--", ...process.argv.slice(2)],
]) {
  const child = spawn(process.execPath, [npm, ...args], {
    stdio: "inherit",
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 1));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
