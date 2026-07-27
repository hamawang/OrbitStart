//! Portable data directory selection and resource-path resolution.
//!
//! The functions in this module deliberately keep portable activation local to
//! the executable directory.  A normal installation never migrates, copies,
//! or otherwise touches the user's `%APPDATA%\\OrbitStart` data.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub const PORTABLE_DATA_DIRECTORY_NAME: &str = "OrbitStart.Data";
const PORTABLE_FLAG_NAME: &str = "portable.flag";
const PORTABLE_SUBDIRECTORIES: [&str; 4] = ["resources", "plugins", "themes", "backups"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DataDirectoryMode {
    Standard,
    Portable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataDirectory {
    pub mode: DataDirectoryMode,
    pub path: PathBuf,
}

/// Chooses the active data directory without creating or moving anything.
///
/// Portable mode is intentionally opt-in: it is selected only when the
/// executable's directory contains a regular `portable.flag` file or an
/// existing `OrbitStart.Data` directory.  This prevents a standard install
/// from unexpectedly switching away from `%APPDATA%\\OrbitStart`.
pub fn resolve_data_directory(
    executable_path: Option<&Path>,
    standard_root: &Path,
) -> DataDirectory {
    if let Some(executable_dir) = executable_path.and_then(Path::parent) {
        let flag = executable_dir.join(PORTABLE_FLAG_NAME);
        let data_directory = executable_dir.join(PORTABLE_DATA_DIRECTORY_NAME);
        if is_regular_file(&flag) || is_directory(&data_directory) {
            return DataDirectory {
                mode: DataDirectoryMode::Portable,
                path: data_directory,
            };
        }
    }

    DataDirectory {
        mode: DataDirectoryMode::Standard,
        path: standard_root.join("OrbitStart"),
    }
}

/// Creates only the selected data directory.  In portable mode it also
/// prepares the documented portable layout.  Standard mode retains the
/// existing lazy creation behaviour for subdirectories.
pub fn prepare_data_directory(directory: &DataDirectory) -> Result<(), String> {
    fs::create_dir_all(&directory.path)
        .map_err(|error| format!("Failed to create data directory: {error}"))?;

    if directory.mode == DataDirectoryMode::Portable {
        for child in PORTABLE_SUBDIRECTORIES {
            fs::create_dir_all(directory.path.join(child)).map_err(|error| {
                format!("Failed to create portable data directory '{child}': {error}")
            })?;
        }
    }
    Ok(())
}

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_file() && !metadata.file_type().is_symlink())
        .unwrap_or(false)
}

fn is_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_dir() && !metadata.file_type().is_symlink())
        .unwrap_or(false)
}

/// How a resource target is interpreted.  Serialized names intentionally
/// match the public catalog format from the portable-mode design.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourcePathMode {
    #[default]
    Absolute,
    #[serde(alias = "dataRelative", alias = "data_relative")]
    DataRelative,
    #[serde(alias = "workspaceRelative", alias = "workspace_relative")]
    WorkspaceRelative,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NormalizedResourcePath {
    pub mode: ResourcePathMode,
    pub base_path: Option<String>,
}

/// Validates relative resource settings without touching any user files.
///
/// Absolute mode preserves legacy targets.  `base_path` only has meaning in
/// workspace-relative mode and is cleared for the other two modes so stale UI
/// state cannot affect a launch later.
pub fn normalize_resource_path_fields(
    mode: ResourcePathMode,
    target: &str,
    base_path: Option<&str>,
) -> Result<NormalizedResourcePath, String> {
    match mode {
        ResourcePathMode::Absolute => Ok(NormalizedResourcePath {
            mode,
            base_path: None,
        }),
        ResourcePathMode::DataRelative => {
            let _ = parse_safe_relative_path(target, "data-relative resource target")?;
            Ok(NormalizedResourcePath {
                mode,
                base_path: None,
            })
        }
        ResourcePathMode::WorkspaceRelative => {
            let _ = parse_safe_relative_path(target, "workspace-relative resource target")?;
            let base_path = base_path
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    "Workspace-relative resources require a non-empty basePath".to_string()
                })?;
            if !is_absolute_path_text(base_path) {
                let _ = parse_safe_relative_path(base_path, "workspace-relative basePath")?;
            }
            Ok(NormalizedResourcePath {
                mode,
                base_path: Some(base_path.to_string()),
            })
        }
    }
}

/// Resolves a logical resource target.  Relative components are parsed before
/// joining, so `..`, drive-qualified paths, UNC paths, and URI-looking values
/// cannot escape their declared base directory.
pub fn resolve_resource_path(
    data_directory: &Path,
    mode: ResourcePathMode,
    target: &str,
    base_path: Option<&str>,
) -> Result<PathBuf, String> {
    let normalized = normalize_resource_path_fields(mode, target, base_path)?;
    match normalized.mode {
        ResourcePathMode::Absolute => {
            let target = target.trim();
            if target.is_empty() {
                return Err("Absolute resource target cannot be empty".to_string());
            }
            Ok(PathBuf::from(target))
        }
        ResourcePathMode::DataRelative => Ok(data_directory.join(parse_safe_relative_path(
            target,
            "data-relative resource target",
        )?)),
        ResourcePathMode::WorkspaceRelative => {
            let base_path = normalized
                .base_path
                .as_deref()
                .expect("workspace-relative mode has a validated basePath");
            let base = if is_absolute_path_text(base_path) {
                PathBuf::from(base_path)
            } else {
                data_directory.join(parse_safe_relative_path(
                    base_path,
                    "workspace-relative basePath",
                )?)
            };
            Ok(base.join(parse_safe_relative_path(
                target,
                "workspace-relative resource target",
            )?))
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourcePathStatus {
    Available,
    Missing,
    PermissionDenied,
    NetworkUnavailable,
    Invalid,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePathStatusReport {
    pub path_mode: ResourcePathMode,
    pub target: String,
    pub base_path: Option<String>,
    pub resolved_path: Option<String>,
    pub status: ResourcePathStatus,
    pub message: Option<String>,
}

/// Performs an on-demand filesystem check for a resolved local resource.  A
/// missing UNC target is reported separately because the share may simply be
/// offline rather than permanently moved.
pub fn inspect_resource_path(
    data_directory: &Path,
    mode: ResourcePathMode,
    target: &str,
    base_path: Option<&str>,
) -> ResourcePathStatusReport {
    let base_path = base_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let resolved = match resolve_resource_path(data_directory, mode, target, base_path.as_deref()) {
        Ok(path) => path,
        Err(error) => {
            return ResourcePathStatusReport {
                path_mode: mode,
                target: target.to_string(),
                base_path,
                resolved_path: None,
                status: ResourcePathStatus::Invalid,
                message: Some(error),
            };
        }
    };

    let status = match fs::metadata(&resolved) {
        Ok(_) => (ResourcePathStatus::Available, None),
        Err(error) if error.kind() == ErrorKind::PermissionDenied => (
            ResourcePathStatus::PermissionDenied,
            Some(format!(
                "Permission denied while checking {}",
                resolved.display()
            )),
        ),
        Err(_) if is_network_path(&resolved) => (
            ResourcePathStatus::NetworkUnavailable,
            Some(format!(
                "Network path is unavailable: {}",
                resolved.display()
            )),
        ),
        Err(error) => (
            ResourcePathStatus::Missing,
            Some(format!("Target is unavailable: {error}")),
        ),
    };

    ResourcePathStatusReport {
        path_mode: mode,
        target: target.to_string(),
        base_path,
        resolved_path: Some(resolved.to_string_lossy().to_string()),
        status: status.0,
        message: status.1,
    }
}

pub fn is_network_path(path: &Path) -> bool {
    let text = path.to_string_lossy();
    text.starts_with(r"\\") || text.starts_with("//")
}

fn is_absolute_path_text(value: &str) -> bool {
    let value = value.trim();
    Path::new(value).is_absolute()
        || value.starts_with('\\')
        || value.starts_with('/')
        || has_windows_absolute_drive_prefix(value)
}

fn has_windows_absolute_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
}

fn parse_safe_relative_path(value: &str, label: &str) -> Result<PathBuf, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    if value.contains('\0') || is_absolute_path_text(value) {
        return Err(format!("{label} must be a relative path"));
    }

    let mut normalized = PathBuf::new();
    for segment in value.replace('\\', "/").split('/') {
        match segment {
            "" | "." => {}
            ".." => return Err(format!("{label} cannot contain '..'")),
            _ if segment.contains(':') => {
                return Err(format!("{label} cannot contain a drive or URI prefix"));
            }
            _ => normalized.push(segment),
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_DIRECTORY_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory {
        root: PathBuf,
    }

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default();
            let counter = TEST_DIRECTORY_COUNTER.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "orbitstart-portable-{label}-{}-{nonce}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("test directory should be created");
            Self { root }
        }

        fn executable_path(&self) -> PathBuf {
            let application = self.root.join("app");
            fs::create_dir_all(&application).expect("application directory should be created");
            application.join("OrbitStart.exe")
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn standard_mode_remains_the_default_without_a_portable_marker() {
        let directory = TestDirectory::new("standard");
        let standard_root = directory.root.join("appdata");
        let resolved = resolve_data_directory(Some(&directory.executable_path()), &standard_root);

        assert_eq!(resolved.mode, DataDirectoryMode::Standard);
        assert_eq!(resolved.path, standard_root.join("OrbitStart"));
    }

    #[test]
    fn portable_flag_selects_and_prepares_the_portable_layout() {
        let directory = TestDirectory::new("flag");
        let executable = directory.executable_path();
        let application = executable
            .parent()
            .expect("executable should have a parent");
        fs::write(application.join(PORTABLE_FLAG_NAME), "portable\n")
            .expect("portable marker should be written");
        let resolved = resolve_data_directory(Some(&executable), &directory.root.join("appdata"));

        assert_eq!(resolved.mode, DataDirectoryMode::Portable);
        assert_eq!(
            resolved.path,
            application.join(PORTABLE_DATA_DIRECTORY_NAME)
        );
        prepare_data_directory(&resolved).expect("portable layout should be created");
        for child in PORTABLE_SUBDIRECTORIES {
            assert!(resolved.path.join(child).is_dir(), "{child} should exist");
        }
    }

    #[test]
    fn existing_portable_data_directory_selects_portable_mode_without_a_flag() {
        let directory = TestDirectory::new("existing-data");
        let executable = directory.executable_path();
        let application = executable
            .parent()
            .expect("executable should have a parent");
        fs::create_dir_all(application.join(PORTABLE_DATA_DIRECTORY_NAME))
            .expect("portable data directory should be created");

        let resolved = resolve_data_directory(Some(&executable), &directory.root.join("appdata"));
        assert_eq!(resolved.mode, DataDirectoryMode::Portable);
    }

    #[test]
    fn relative_paths_resolve_only_inside_the_declared_data_or_workspace_root() {
        let data_directory = Path::new("C:/portable/OrbitStart.Data");
        let data_path = resolve_resource_path(
            data_directory,
            ResourcePathMode::DataRelative,
            r"resources\\tools\\tool.exe",
            None,
        )
        .expect("data-relative target should resolve");
        assert!(data_path.ends_with(Path::new("resources").join("tools").join("tool.exe")));

        let workspace_path = resolve_resource_path(
            data_directory,
            ResourcePathMode::WorkspaceRelative,
            "bin/tool.exe",
            Some("workspaces/project-a"),
        )
        .expect("workspace-relative target should resolve");
        assert!(workspace_path.ends_with(
            Path::new("workspaces")
                .join("project-a")
                .join("bin")
                .join("tool.exe")
        ));
    }

    #[test]
    fn relative_paths_reject_escapes_and_drive_qualified_values() {
        for value in [
            "../outside.exe",
            "resources/../../outside.exe",
            r"\\server\\share\\tool.exe",
            "C:/outside.exe",
            "C:outside.exe",
            "https://example.com/tool.exe",
        ] {
            assert!(
                resolve_resource_path(
                    Path::new("C:/portable/OrbitStart.Data"),
                    ResourcePathMode::DataRelative,
                    value,
                    None,
                )
                .is_err(),
                "{value} must not be accepted as a data-relative path"
            );
        }
    }

    #[test]
    fn workspace_relative_mode_requires_a_base_path_and_clears_stale_base_paths_elsewhere() {
        assert!(normalize_resource_path_fields(
            ResourcePathMode::WorkspaceRelative,
            "tool.exe",
            None,
        )
        .is_err());
        let normalized = normalize_resource_path_fields(
            ResourcePathMode::DataRelative,
            "resources/tool.exe",
            Some("obsolete-base"),
        )
        .expect("data-relative path should normalize");
        assert_eq!(normalized.base_path, None);
    }

    #[test]
    fn path_status_reports_missing_and_invalid_relative_targets_without_mutating_them() {
        let directory = TestDirectory::new("status");
        let data_directory = directory.root.join("OrbitStart.Data");
        fs::create_dir_all(&data_directory).expect("data directory should be created");

        let missing = inspect_resource_path(
            &data_directory,
            ResourcePathMode::DataRelative,
            "resources/missing.exe",
            None,
        );
        assert_eq!(missing.status, ResourcePathStatus::Missing);
        assert!(missing.resolved_path.is_some());

        let invalid = inspect_resource_path(
            &data_directory,
            ResourcePathMode::DataRelative,
            "../outside.exe",
            None,
        );
        assert_eq!(invalid.status, ResourcePathStatus::Invalid);
        assert_eq!(invalid.resolved_path, None);
    }
}
