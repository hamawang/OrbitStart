[CmdletBinding()]
param(
  [string]$SecretDirectory = $env:ORBITSTART_RELEASE_SECRET_DIR,
  [string]$TargetDirectory
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($SecretDirectory)) {
  $SecretDirectory = Join-Path $projectRoot "release-secrets-local"
}
if ([string]::IsNullOrWhiteSpace($TargetDirectory)) {
  $TargetDirectory = Join-Path $projectRoot ".tmp\tauri-release"
}

$secretRoot = (Resolve-Path -LiteralPath $SecretDirectory -ErrorAction Stop).Path
$privateKeyPath = Join-Path $secretRoot "orbitstart-updater-private.key"
$passwordPath = Join-Path $secretRoot "orbitstart-updater-password.txt"
$publicKeyPath = Join-Path $secretRoot "orbitstart-updater-private.key.pub"
foreach ($requiredPath in @($privateKeyPath, $passwordPath, $publicKeyPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required signing file is missing from the configured secret directory."
  }
}

$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$tauriConfig = Get-Content -LiteralPath (Join-Path $projectRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
  throw "package.json has an invalid release version."
}

$storedPublicKey = [System.IO.File]::ReadAllText($publicKeyPath).Trim()
if ($storedPublicKey -ne [string]$tauriConfig.plugins.updater.pubkey) {
  throw "The stored updater public key does not match src-tauri/tauri.conf.json."
}
try {
  $decodedPublicKey = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($storedPublicKey))
} catch {
  throw "The stored updater public key is not valid Base64."
}
if ($decodedPublicKey -notmatch '^untrusted comment:.*\r?\nRW[A-Za-z0-9+/=]+\s*$') {
  throw "The stored updater public key is not a Tauri/minisign public key."
}

$notesPath = Join-Path $projectRoot ("docs\RELEASE_NOTES_" + $version + ".md")
if (-not (Test-Path -LiteralPath $notesPath -PathType Leaf)) {
  throw "Release notes are missing for $version."
}

$releaseDirectory = Join-Path $projectRoot ("release-artifacts\signed-" + $version)
if (Test-Path -LiteralPath $releaseDirectory) {
  throw "Refusing to overwrite an existing signed release directory: $releaseDirectory"
}

$hadPrivateKey = Test-Path Env:TAURI_SIGNING_PRIVATE_KEY
$previousPrivateKey = $env:TAURI_SIGNING_PRIVATE_KEY
$hadPassword = Test-Path Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$previousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$hadCargoTarget = Test-Path Env:CARGO_TARGET_DIR
$previousCargoTarget = $env:CARGO_TARGET_DIR

try {
  $env:TAURI_SIGNING_PRIVATE_KEY = [System.IO.File]::ReadAllText($privateKeyPath).TrimEnd([char[]]"`r`n")
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.IO.File]::ReadAllText($passwordPath).TrimEnd([char[]]"`r`n")
  $env:CARGO_TARGET_DIR = $TargetDirectory

  & npm.cmd run version:check -- --expect-version $version
  if ($LASTEXITCODE -ne 0) { throw "Version consistency check failed." }

  & npm.cmd run tauri:build -- --bundles nsis --ci -- --bin orbitstart
  if ($LASTEXITCODE -ne 0) { throw "Signed Tauri build failed." }

  $artifactName = "OrbitStart_" + $version + "_x64-setup.exe"
  $artifactPath = Join-Path $TargetDirectory ("release\bundle\nsis\" + $artifactName)
  $signaturePath = $artifactPath + ".sig"
  if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw "Signed installer was not generated." }
  if (-not (Test-Path -LiteralPath $signaturePath -PathType Leaf)) { throw "Updater signature was not generated." }

  New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
  $publishedArtifact = Join-Path $releaseDirectory $artifactName
  $publishedSignature = $publishedArtifact + ".sig"
  $manifestPath = Join-Path $releaseDirectory "latest.json"
  Copy-Item -LiteralPath $artifactPath -Destination $publishedArtifact -ErrorAction Stop
  Copy-Item -LiteralPath $signaturePath -Destination $publishedSignature -ErrorAction Stop

  & cargo run --quiet --manifest-path (Join-Path $projectRoot "src-tauri\Cargo.toml") --bin verify_updater_signature -- $publishedArtifact $publishedSignature
  if ($LASTEXITCODE -ne 0) { throw "Updater signature verification failed." }

  & node (Join-Path $projectRoot "tools\create-updater-manifest.mjs") --version $version --artifact $publishedArtifact --signature $publishedSignature --notes-file $notesPath --output $manifestPath
  if ($LASTEXITCODE -ne 0) { throw "Updater manifest generation failed." }

  & node (Join-Path $projectRoot "tools\check-version-consistency.mjs") --release --expect-version $version --manifest $manifestPath
  if ($LASTEXITCODE -ne 0) { throw "Signed release verification failed." }

  $hash = Get-FileHash -LiteralPath $publishedArtifact -Algorithm SHA256
  $hashPath = Join-Path $releaseDirectory ($artifactName + ".sha256")
  [System.IO.File]::WriteAllText($hashPath, ("{0} *{1}`r`n" -f $hash.Hash, $artifactName), [System.Text.UTF8Encoding]::new($false))
  $hash | Select-Object Algorithm,Hash,Path | Format-List
  Write-Output ("Wrote SHA-256 file to " + $hashPath)
  Write-Output ("Signed release artifacts are ready in " + $releaseDirectory)
}
finally {
  if ($hadPrivateKey) { $env:TAURI_SIGNING_PRIVATE_KEY = $previousPrivateKey } else { Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue }
  if ($hadPassword) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousPassword } else { Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue }
  if ($hadCargoTarget) { $env:CARGO_TARGET_DIR = $previousCargoTarget } else { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue }
}
