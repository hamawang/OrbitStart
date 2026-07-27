import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = 1422;
const e2eBaseUrl = `http://${host}:${port}`;
const viteCli = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");
const testFiles = process.argv.slice(2);

function waitForExit(child) {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function waitForExitWithin(child, timeoutMs) {
  const result = await Promise.race([
    waitForExit(child).then((code) => ({ exited: true, code })),
    new Promise((resolve) => setTimeout(() => resolve({ exited: false }), timeoutMs))
  ]);
  return result;
}

function canReachServer() {
  return new Promise((resolve) => {
    const request = http.get({ host, port, path: "/" }, (response) => {
      response.resume();
      resolve(true);
    });
    request.once("error", () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function isPortAvailable() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(error);
    });
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(true);
      });
    });
  });
}

async function ensurePortAvailableBeforeStart() {
  if (await isPortAvailable()) return;
  throw new Error(
    `Port ${port} is already in use. Refusing to terminate it because it was not started by this E2E runner.`
  );
}

async function waitForPortRelease() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await isPortAvailable()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `The Vite process started by this E2E runner stopped, but port ${port} did not become available within 10 seconds. Refusing to terminate any unowned process.`
  );
}

async function waitForServer(vite) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready (exit code ${vite.exitCode}).`);
    }
    if (await canReachServer()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Vite at http://${host}:${port}.`);
}

async function stopOwnedProcess(child, { terminateTree = false } = {}) {
  if (!child?.pid || child.exitCode !== null) return;

  if (process.platform === "win32" && terminateTree) {
    const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    const taskkillExit = await waitForExitWithin(taskkill, 5_000);
    if (!taskkillExit.exited) {
      console.warn(`taskkill did not exit within 5 seconds for owned process ${child.pid}; terminating taskkill.`);
      try {
        taskkill.kill("SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      taskkill.unref();
    }
  } else {
    try {
      child.kill("SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  const forcedExit = await waitForExitWithin(child, 8_000);
  if (!forcedExit.exited) {
    console.warn(`Owned process ${child.pid} did not exit after termination was requested; terminating the owned root process.`);
    try {
      child.kill("SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await waitForExitWithin(child, 1_000);
  }
}

function streamAndWatchForSummary(child) {
  let resolveSummary;
  const summary = new Promise((resolve) => {
    resolveSummary = resolve;
  });
  let pendingOutput = "";

  const handleOutput = (chunk, destination) => {
    const text = chunk.toString();
    destination.write(text);
    const plainText = text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
    pendingOutput = `${pendingOutput}${plainText}`.slice(-4_096);

    const passed = pendingOutput.match(/\b(\d+)\s+passed\b/);
    if (passed) {
      resolveSummary({ exitCode: 0, summary: `${passed[1]} passed` });
      return;
    }

    const failed = pendingOutput.match(/\b(\d+)\s+failed\b/);
    if (failed) {
      resolveSummary({ exitCode: 1, summary: `${failed[1]} failed` });
    }
  };

  child.stdout.on("data", (chunk) => handleOutput(chunk, process.stdout));
  child.stderr.on("data", (chunk) => handleOutput(chunk, process.stderr));
  return summary;
}

let vite;
let exitCode = 1;

try {
  await ensurePortAvailableBeforeStart();
  vite = spawn(process.execPath, [viteCli, "--host", host, "--port", String(port), "--strictPort"], {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true
  });
  await waitForServer(vite);

  const playwright = spawn(process.execPath, [playwrightCli, "test", ...testFiles], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ORBITSTART_E2E_BASE_URL: e2eBaseUrl },
    windowsHide: true
  });
  const playwrightExit = waitForExit(playwright);
  const finalSummary = streamAndWatchForSummary(playwright);
  const result = await Promise.race([
    playwrightExit.then((code) => ({ type: "exit", code })),
    finalSummary.then((summary) => ({ type: "summary", ...summary }))
  ]);

  if (result.type === "exit") {
    exitCode = result.code;
  } else {
    const naturalExit = await Promise.race([
      playwrightExit.then((code) => ({ exited: true, code })),
      new Promise((resolve) => setTimeout(() => resolve({ exited: false }), 2_000))
    ]);
    if (!naturalExit.exited) {
      console.warn(`Playwright reported ${result.summary} but did not exit; stopping the owned test process.`);
      await stopOwnedProcess(playwright, { terminateTree: true });
    }
    exitCode = result.exitCode;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  if (vite) {
    try {
      await stopOwnedProcess(vite, { terminateTree: true });
      await waitForPortRelease();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      exitCode = 1;
    }
  }
}

process.exitCode = exitCode;
