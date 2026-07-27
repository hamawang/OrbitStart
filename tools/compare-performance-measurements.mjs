#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  throw new Error(message);
}

function requiredArgument(name, args) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith("--")) {
    fail(`Missing required argument: ${name}`);
  }
  return args[index + 1];
}

function optionalArgument(name, args) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  if (!args[index + 1] || args[index + 1].startsWith("--")) fail(`Missing value for ${name}`);
  return args[index + 1];
}

function loadMeasurement(filePath) {
  const fullPath = resolve(filePath);
  if (!existsSync(fullPath)) fail(`Measurement file was not found: ${fullPath}`);
  let measurement;
  try {
    measurement = JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (error) {
    fail(`Measurement file is not valid JSON (${fullPath}): ${error.message}`);
  }
  if (measurement?.SchemaVersion !== 1 || !measurement?.Summary || !measurement?.Host || !measurement?.Configuration) {
    fail(`Measurement file does not match measure-processes schema v1: ${fullPath}`);
  }
  return { ...measurement, filePath: fullPath };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fixed(value, digits = 2) {
  return value === null ? "n/a" : value.toFixed(digits);
}

function numericRow(label, beforeValue, afterValue, unit = " MiB") {
  const before = numberOrNull(beforeValue);
  const after = numberOrNull(afterValue);
  const delta = before === null || after === null ? null : after - before;
  const percent = delta === null || before === 0 ? null : (delta / before) * 100;
  const sign = delta !== null && delta > 0 ? "+" : "";
  const percentSign = percent !== null && percent > 0 ? "+" : "";
  return `| ${label} | ${fixed(before)}${unit} | ${fixed(after)}${unit} | ${delta === null ? "n/a" : `${sign}${fixed(delta)}${unit}`} | ${percent === null ? "n/a" : `${percentSign}${fixed(percent)}%`} |`;
}

function countRow(label, beforeValue, afterValue) {
  const before = numberOrNull(beforeValue);
  const after = numberOrNull(afterValue);
  const delta = before === null || after === null ? null : after - before;
  const percent = delta === null || before === 0 ? null : (delta / before) * 100;
  const sign = delta !== null && delta > 0 ? "+" : "";
  const percentSign = percent !== null && percent > 0 ? "+" : "";
  return `| ${label} | ${before ?? "n/a"} | ${after ?? "n/a"} | ${delta === null ? "n/a" : `${sign}${delta}`} | ${percent === null ? "n/a" : `${percentSign}${fixed(percent)}%`} |`;
}

function attributionNote(measurement) {
  if (!measurement.Summary.HasParentProcessInfo) {
    return "父进程信息不可用；结果只可靠覆盖 OrbitStart 根进程，不能代表完整 WebView2 会话。";
  }
  if (measurement.Summary.IncludesUnattributedWebView2) {
    return "包含未归因的 WebView2 进程；不得把总内存作为 OrbitStart 专属结论。";
  }
  return "已通过父进程关系归因 OrbitStart 及其 WebView2 子进程。";
}

function comparableWarnings(before, after) {
  const beforeScenario = String(before.Scenario ?? "").trim();
  const afterScenario = String(after.Scenario ?? "").trim();
  if (!beforeScenario || !afterScenario) fail("Both measurements must include a non-empty Scenario.");
  if (beforeScenario !== afterScenario) {
    fail(`Scenario mismatch: '${beforeScenario}' vs '${afterScenario}'. Compare only the same controlled scenario.`);
  }

  const warnings = [];
  const pairs = [
    ["测试机器不同", before.Host.MachineName, after.Host.MachineName],
    ["Windows 版本不同", before.Host.OsVersion, after.Host.OsVersion],
    ["CPU 核心数不同", before.Host.ProcessorCount, after.Host.ProcessorCount],
    ["采样时长不同", before.Configuration.SampleSeconds, after.Configuration.SampleSeconds],
    ["采样间隔不同", before.Configuration.IntervalMilliseconds, after.Configuration.IntervalMilliseconds]
  ];
  for (const [warning, beforeValue, afterValue] of pairs) {
    if (String(beforeValue ?? "") !== String(afterValue ?? "")) warnings.push(warning);
  }
  return warnings;
}

function buildReport(before, after, warnings) {
  const beforeSummary = before.Summary;
  const afterSummary = after.Summary;
  const limits = [
    ...warnings,
    `优化前：${attributionNote(before)}`,
    `优化后：${attributionNote(after)}`
  ];
  return `# 性能对比报告\n\n` +
    `场景：\`${before.Scenario}\`\n\n` +
    `> 本报告仅比较相同受控场景下的进程采样结果；不替代冷启动、首屏、搜索或拖拽的独立测量。\n\n` +
    `## 样本来源\n\n` +
    `| 字段 | 优化前 | 优化后 |\n| --- | --- | --- |\n` +
    `| 构建标签 | ${before.BuildLabel || "未填写"} | ${after.BuildLabel || "未填写"} |\n` +
    `| 采样文件 | \`${before.filePath}\` | \`${after.filePath}\` |\n` +
    `| 采样数 | ${beforeSummary.SampleCount ?? "n/a"} | ${afterSummary.SampleCount ?? "n/a"} |\n` +
    `| 采样配置 | ${before.Configuration.SampleSeconds}s / ${before.Configuration.IntervalMilliseconds}ms | ${after.Configuration.SampleSeconds}s / ${after.Configuration.IntervalMilliseconds}ms |\n\n` +
    `## 聚合结果\n\n` +
    `| 指标 | 优化前 | 优化后 | 绝对差值 | 相对变化 |\n| --- | ---: | ---: | ---: | ---: |\n` +
    `${numericRow("Working Set 平均值", beforeSummary.WorkingSetMiBAverage, afterSummary.WorkingSetMiBAverage)}\n` +
    `${numericRow("Private Memory 平均值", beforeSummary.PrivateMemoryMiBAverage, afterSummary.PrivateMemoryMiBAverage)}\n` +
    `${numericRow("CPU 平均值", beforeSummary.CpuPercentAverage, afterSummary.CpuPercentAverage, "%")}\n` +
    `${countRow("已跟踪进程数（最后样本）", beforeSummary.Latest?.TrackedProcesses, afterSummary.Latest?.TrackedProcesses)}\n` +
    `${countRow("WebView2 进程数（最后样本）", beforeSummary.Latest?.WebView2Processes, afterSummary.Latest?.WebView2Processes)}\n\n` +
    `## 可比性与限制\n\n${limits.map((item) => `- ${item}`).join("\n")}\n\n` +
    `生成时间：${new Date().toISOString()}\n`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node tools/compare-performance-measurements.mjs --before <before.json> --after <after.json> [--output <report.md>]");
    return;
  }
  const before = loadMeasurement(requiredArgument("--before", args));
  const after = loadMeasurement(requiredArgument("--after", args));
  const output = optionalArgument("--output", args);
  const report = buildReport(before, after, comparableWarnings(before, after));
  if (!output) return process.stdout.write(report);

  const outputPath = resolve(output);
  if (existsSync(outputPath)) fail(`Output file already exists; refusing to overwrite: ${outputPath}`);
  writeFileSync(outputPath, report, "utf8");
  console.log(`Performance comparison report written: ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(`Performance comparison failed: ${error.message}`);
  process.exitCode = 1;
}
