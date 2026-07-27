import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function argument(name, required = true) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) {
    throw new Error(name + " requires a value");
  }
  return value;
}

const knownFlags = new Set([
  "--version",
  "--artifact",
  "--signature",
  "--notes-file",
  "--output",
  "--repository",
  "--published-at"
]);
for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value.startsWith("--")) {
    if (!knownFlags.has(value)) throw new Error("Unknown argument: " + value);
    index += 1;
  }
}

const version = argument("--version");
const artifactPath = resolve(root, argument("--artifact"));
const signaturePath = resolve(root, argument("--signature"));
const notesFile = argument("--notes-file", false);
const outputPath = resolve(root, argument("--output", false) ?? "latest.json");
const repository = argument("--repository", false) ?? "xuxinxi14/OrbitStart";
const publishedAt = argument("--published-at", false) ?? new Date().toISOString();

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Version must be semver; received " + version);
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("Repository must be owner/name; received " + repository);
}
if (Number.isNaN(Date.parse(publishedAt))) {
  throw new Error("--published-at must be an ISO-8601 timestamp; received " + publishedAt);
}

const artifact = statSync(artifactPath);
if (!artifact.isFile() || artifact.size === 0) {
  throw new Error("Updater artifact is missing or empty: " + artifactPath);
}

const signature = readFileSync(signaturePath, "utf8").trim();
if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
  throw new Error("Updater signature is not base64: " + signaturePath);
}
const decodedSignature = Buffer.from(signature, "base64").toString("utf8");
const signedFile = decodedSignature.match(/^trusted comment:[^\r\n]*\bfile:([^\r\n]+)/m)?.[1]?.trim();
const artifactName = basename(artifactPath);
if (!signedFile) {
  throw new Error("Updater signature has no trusted-comment file name: " + signaturePath);
}
if (signedFile !== artifactName) {
  throw new Error("Updater signature is for " + signedFile + ", not " + artifactName);
}

const notes = notesFile
  ? readFileSync(resolve(root, notesFile), "utf8").trim()
  : "OrbitStart " + version;
const manifest = {
  version,
  notes,
  pub_date: new Date(publishedAt).toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: "https://github.com/" + repository + "/releases/download/v" + version + "/" + encodeURIComponent(artifactName)
    }
  }
};

writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("Wrote signed updater manifest for " + artifactName + " to " + outputPath + ".");
