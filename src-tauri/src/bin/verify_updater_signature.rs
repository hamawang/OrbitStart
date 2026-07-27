use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;
use std::env;
use std::fs;
use std::path::Path;

fn main() {
    if let Err(error) = run() {
        eprintln!("Updater signature verification failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let arguments = env::args().collect::<Vec<_>>();
    if arguments.len() != 3 {
        return Err("Usage: verify_updater_signature <installer> <signature>".to_string());
    }

    let installer_path = Path::new(&arguments[1]);
    let signature_path = Path::new(&arguments[2]);
    let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");

    let config: Value = serde_json::from_str(
        &fs::read_to_string(&config_path)
            .map_err(|error| format!("cannot read {}: {error}", config_path.display()))?,
    )
    .map_err(|error| format!("cannot parse {}: {error}", config_path.display()))?;
    let public_key_base64 = config
        .pointer("/plugins/updater/pubkey")
        .and_then(Value::as_str)
        .ok_or("tauri.conf.json has no updater public key")?;
    let public_key_text = String::from_utf8(
        STANDARD
            .decode(public_key_base64.trim())
            .map_err(|error| format!("updater public key is not Base64: {error}"))?,
    )
    .map_err(|error| format!("updater public key is not UTF-8: {error}"))?;
    let encoded_key = public_key_text
        .lines()
        .find(|line| line.starts_with("RW"))
        .ok_or("updater public key has no encoded minisign key")?;
    let public_key = PublicKey::from_base64(encoded_key)
        .map_err(|error| format!("cannot decode updater public key: {error}"))?;

    let signature_text = String::from_utf8(
        STANDARD
            .decode(
                fs::read_to_string(signature_path)
                    .map_err(|error| format!("cannot read {}: {error}", signature_path.display()))?
                    .trim(),
            )
            .map_err(|error| format!("updater signature is not Base64: {error}"))?,
    )
    .map_err(|error| format!("updater signature is not UTF-8: {error}"))?;
    let signature = Signature::decode(&signature_text)
        .map_err(|error| format!("cannot decode updater signature: {error}"))?;

    let installer_name = installer_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("installer has no UTF-8 file name")?;
    if !signature
        .trusted_comment()
        .split_whitespace()
        .any(|field| field == format!("file:{installer_name}"))
    {
        return Err("updater signature does not name the installer".to_string());
    }

    let installer = fs::read(installer_path)
        .map_err(|error| format!("cannot read {}: {error}", installer_path.display()))?;
    public_key
        .verify(&installer, &signature, false)
        .map_err(|error| format!("minisign verification failed: {error}"))?;

    println!("Updater signature verification passed for {installer_name}.");
    Ok(())
}
