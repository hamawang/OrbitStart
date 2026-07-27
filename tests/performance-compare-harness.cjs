const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const directory = mkdtempSync(join(tmpdir(), "orbitstart-performance-"));

function measurement({ buildLabel, workingSet, privateMemory, cpu, webViewCount = 3, scenario = "A-main-window-idle" }) {
  return {
    SchemaVersion: 1,
    Scenario: scenario,
    BuildLabel: buildLabel,
    Host: { MachineName: "test-machine", OsVersion: "Windows test", ProcessorCount: 8 },
    Configuration: { SampleSeconds: 30, IntervalMilliseconds: 1000 },
    Summary: {
      SampleCount: 30,
      WorkingSetMiBAverage: workingSet,
      PrivateMemoryMiBAverage: privateMemory,
      CpuPercentAverage: cpu,
      HasParentProcessInfo: true,
      IncludesUnattributedWebView2: false,
      Latest: { TrackedProcesses: webViewCount + 1, WebView2Processes: webViewCount }
    }
  };
}

try {
  const before = join(directory, "before.json");
  const after = join(directory, "after.json");
  const report = join(directory, "report.md");
  writeFileSync(before, JSON.stringify(measurement({ buildLabel: "before", workingSet: 500, privateMemory: 430, cpu: 1.5 })), "utf8");
  writeFileSync(after, JSON.stringify(measurement({ buildLabel: "after", workingSet: 320, privateMemory: 270, cpu: 0.8, webViewCount: 2 })), "utf8");
  const success = spawnSync(process.execPath, ["tools/compare-performance-measurements.mjs", "--before", before, "--after", after, "--output", report], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(success.status, 0, success.stderr);
  const text = readFileSync(report, "utf8");
  assert.match(text, /A-main-window-idle/);
  assert.match(text, /-180\.00 MiB/);
  assert.match(text, /-36\.00%/);
  assert.match(text, /WebView2 进程数/);

  const mismatch = join(directory, "mismatch.json");
  writeFileSync(mismatch, JSON.stringify(measurement({ buildLabel: "after", workingSet: 320, privateMemory: 270, cpu: 0.8, scenario: "B-tray-idle" })), "utf8");
  const failed = spawnSync(process.execPath, ["tools/compare-performance-measurements.mjs", "--before", before, "--after", mismatch], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Scenario mismatch/);
  console.log("Performance comparison harness passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
