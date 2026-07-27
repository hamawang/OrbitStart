import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const version = args.find((argument) => !argument.startsWith("--"));
const checkOnly = args.includes("--check");

if (!version || args.some((argument) => argument !== version && argument !== "--check")) {
  throw new Error("Usage: node tools/set-version.mjs <semver> [--check]");
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Version must be semver; received " + version);
}

const packagePath = resolve(root, "package.json");
const packageLockPath = resolve(root, "package-lock.json");
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const tauriConfigPath = resolve(root, "src-tauri/tauri.conf.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const packageJson = readJson(packagePath);
const packageLock = readJson(packageLockPath);
const tauriConfig = readJson(tauriConfigPath);
const cargoToml = readFileSync(cargoPath, "utf8");
const cargoPackageVersion = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"\s*$/m)?.[1];

if (!cargoPackageVersion) {
  throw new Error("Could not find the package version in src-tauri/Cargo.toml");
}

const currentVersions = {
  "package.json": packageJson.version,
  "package-lock.json": packageLock.version,
  "package-lock.json packages[\"\"]": packageLock.packages?.[""]?.version,
  "src-tauri/Cargo.toml": cargoPackageVersion,
  "src-tauri/tauri.conf.json": tauriConfig.version
};

const mismatches = Object.entries(currentVersions)
  .filter(([, current]) => current !== version)
  .map(([path, current]) => path + " is " + String(current) + ", expected " + version);

if (checkOnly) {
  if (mismatches.length > 0) {
    throw new Error("Version fields are not synchronized:\n- " + mismatches.join("\n- "));
  }
  console.log("Version fields already match " + version + ".");
  process.exit(0);
}

packageJson.version = version;
packageLock.version = version;
if (!packageLock.packages?.[""]) {
  throw new Error("package-lock.json has no root package entry");
}
packageLock.packages[""].version = version;
tauriConfig.version = version;

const updatedCargoToml = cargoToml.replace(
  /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m,
  "$1" + version + "$2"
);
if (updatedCargoToml === cargoToml) {
  throw new Error("Could not update the package version in src-tauri/Cargo.toml");
}

writeJson(packagePath, packageJson);
writeJson(packageLockPath, packageLock);
writeFileSync(cargoPath, updatedCargoToml, "utf8");
writeJson(tauriConfigPath, tauriConfig);

console.log("Updated application version fields to " + version + ".");
console.log("latest.json was intentionally not changed: generate it from the signed installer with tools/create-updater-manifest.mjs.");
