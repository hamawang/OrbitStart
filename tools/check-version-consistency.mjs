import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const releaseMode = args.includes("--release");
const expectedIndex = args.indexOf("--expect-version");
const expectedVersion = expectedIndex >= 0 ? args[expectedIndex + 1] : undefined;

if (expectedIndex >= 0 && (!expectedVersion || expectedVersion.startsWith("--"))) {
  throw new Error("--expect-version requires a semver value");
}
for (const arg of args) {
  if (arg !== "--release" && arg !== "--expect-version" && arg !== expectedVersion) {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

function readText(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    throw new Error(`Cannot parse ${relativePath}: ${error.message}`);
  }
}

function cargoPackageVersion() {
  const cargo = readText("src-tauri/Cargo.toml");
  let inPackageSection = false;
  let version;
  for (const line of cargo.split(/\r?\n/)) {
    if (/^\[package\]\s*$/.test(line)) {
      inPackageSection = true;
      continue;
    }
    if (inPackageSection && /^\[.+\]\s*$/.test(line)) break;
    if (inPackageSection) {
      version = line.match(/^version\s*=\s*"([^"]+)"\s*$/)?.[1];
      if (version) break;
    }
  }
  if (!version) throw new Error("Cannot find [package].version in src-tauri/Cargo.toml");
  return version;
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

const failures = [];
function expect(condition, message) {
  if (!condition) failures.push(message);
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const versions = {
  "package.json": packageJson.version,
  "package-lock.json packages[\"\"]": packageLock.packages?.[""]?.version,
  "src-tauri/Cargo.toml": cargoPackageVersion(),
  "src-tauri/tauri.conf.json": tauriConfig.version
};

for (const [source, version] of Object.entries(versions)) {
  expect(typeof version === "string" && isSemver(version), `${source} has an invalid semver version: ${String(version)}`);
  expect(version === packageJson.version, `${source} is ${String(version)}, expected ${packageJson.version}`);
}
if (expectedVersion) {
  expect(isSemver(expectedVersion), `Expected version is not semver: ${expectedVersion}`);
  expect(packageJson.version === expectedVersion, `Application version is ${packageJson.version}, expected ${expectedVersion}`);
}

if (releaseMode) {
  const manifest = readJson("latest.json");
  const platform = manifest.platforms?.["windows-x86_64"];
  expect(manifest.version === packageJson.version, `latest.json is ${String(manifest.version)}, expected ${packageJson.version}`);
  expect(typeof platform?.url === "string", "latest.json is missing platforms.windows-x86_64.url");
  expect(typeof platform?.signature === "string", "latest.json is missing platforms.windows-x86_64.signature");

  if (typeof platform?.url === "string") {
    let artifactName = "";
    try {
      artifactName = basename(decodeURIComponent(new URL(platform.url).pathname));
      expect(artifactName.includes(packageJson.version), `Updater artifact name does not contain ${packageJson.version}: ${artifactName}`);
    } catch (error) {
      failures.push(`Invalid updater URL: ${error.message}`);
    }

    if (typeof platform?.signature === "string") {
      const signature = platform.signature.trim();
      expect(/^[A-Za-z0-9+/]+={0,2}$/.test(signature), "Updater signature is not base64");
      const decoded = Buffer.from(signature, "base64").toString("utf8");
      const signedFile = decoded.match(/^trusted comment:[^\r\n]*\bfile:([^\r\n]+)/m)?.[1]?.trim();
      expect(Boolean(signedFile), "Updater signature has no trusted-comment file name");
      if (signedFile && artifactName) {
        expect(signedFile === artifactName, `Updater signature is for ${signedFile}, but URL targets ${artifactName}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Version consistency check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Version consistency check passed for ${packageJson.version}${releaseMode ? " (release manifest metadata)" : ""}.`);
}
