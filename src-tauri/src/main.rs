#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod portable;

use base64::{engine::general_purpose, Engine as _};
use portable::{
    inspect_resource_path, normalize_resource_path_fields, prepare_data_directory,
    resolve_data_directory, resolve_resource_path, ResourcePathMode, ResourcePathStatusReport,
};
use rusqlite::{
    backup::{Backup, StepResult},
    params, Connection, OptionalExtension, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use std::collections::{hash_map::DefaultHasher, HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::process::Command as ProcessCommand;
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[cfg(desktop)]
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

#[cfg(desktop)]
use tauri_plugin_global_shortcut::ShortcutState;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrbitGroup {
    id: String,
    title: String,
    icon: String,
    description: String,
    custom: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrbitItem {
    id: String,
    title: String,
    subtitle: String,
    kind: String,
    group: String,
    target: String,
    #[serde(default)]
    arguments: String,
    aliases: Vec<String>,
    tags: Vec<String>,
    icon: String,
    accent: String,
    favorite: bool,
    launch_count: u32,
    last_launched_at: Option<String>,
    #[serde(default)]
    sort_order: i64,
    #[serde(default)]
    sub_tag: String,
    #[serde(default)]
    path_mode: ResourcePathMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrbitItemInput {
    title: String,
    subtitle: String,
    kind: String,
    group: String,
    target: String,
    #[serde(default)]
    arguments: String,
    aliases: Vec<String>,
    tags: Vec<String>,
    #[serde(default)]
    sub_tag: String,
    icon: String,
    accent: String,
    favorite: bool,
    #[serde(default)]
    path_mode: ResourcePathMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_path: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrbitCommand {
    id: String,
    title: String,
    subtitle: String,
    plugin_id: String,
    icon: String,
    keywords: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginPermission {
    id: String,
    label: String,
    risk: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginContributes {
    commands: u32,
    search_providers: u32,
    themes: u32,
    views: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    id: String,
    name: String,
    version: String,
    description: String,
    enabled: bool,
    #[serde(default)]
    builtin: bool,
    #[serde(default)]
    permissions: Vec<PluginPermission>,
    contributes: PluginContributes,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginRuntimeSource {
    id: String,
    entry: String,
    source: String,
    permissions: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeManifest {
    id: String,
    name: String,
    author: String,
    description: String,
    #[serde(default)]
    builtin: bool,
    tokens: HashMap<String, String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginLog {
    id: String,
    plugin_id: String,
    level: String,
    message: String,
    created_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    active_theme_id: String,
    safe_mode: bool,
    density: String,
    global_hotkey: String,
    close_behavior: String,
    data_dir: String,
    auto_pinned_mode: bool,
    display_mode: String,
    resource_mode: String,
    workbench_visible: bool,
    workbench_show_status: bool,
    workbench_show_workspaces: bool,
    workbench_show_actions: bool,
    workbench_show_toast: bool,
    workbench_show_statistics: bool,
    hotkey_behavior: String,
    bubble_enabled: bool,
    bubble_show_when_main_hidden: bool,
    bubble_always_on_top: bool,
    bubble_size: i32,
    bubble_opacity: f64,
    bubble_snap_to_edge: bool,
    bubble_expand_on_hover: bool,
    bubble_expand_delay_ms: i32,
    bubble_avoid_fullscreen: bool,
}

/// Runtime state that is safe to share between Tauri command handlers.
///
/// Database connections remain short lived so file scans and imports do not
/// hold a global connection lock. Settings are cached because a few window
/// lifecycle paths run frequently and must not open SQLite on every poll.
struct AppState {
    settings: RwLock<AppSettings>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSnapshot {
    items: Vec<OrbitItem>,
    groups: Vec<OrbitGroup>,
    commands: Vec<OrbitCommand>,
    plugins: Vec<PluginManifest>,
    themes: Vec<ThemeManifest>,
    settings: AppSettings,
    logs: Vec<PluginLog>,
}

/// The only catalog-derived state that changes when plugin availability or
/// safe mode changes.  Returning this instead of a CatalogSnapshot avoids
/// re-reading items, groups, themes and logs for a small settings mutation.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginStateUpdate {
    commands: Vec<OrbitCommand>,
    plugins: Vec<PluginManifest>,
    settings: AppSettings,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowAppearance {
    themes: Vec<ThemeManifest>,
    settings: AppSettings,
}

#[derive(Clone, Serialize)]
struct ItemDeletedEvent {
    id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogExport {
    version: u32,
    exported_at: String,
    items: Vec<OrbitItem>,
    #[serde(default)]
    groups: Vec<OrbitGroup>,
    #[serde(default)]
    trips: Vec<Trip>,
    #[serde(default)]
    plugins: Vec<PluginManifest>,
    #[serde(default)]
    active_theme_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Trip {
    id: String,
    item_id: String,
    title: String,
    content: String,
    category: String,
    status: Option<String>,
    tags: Vec<String>,
    pinned: bool,
    created_at: i64,
    updated_at: i64,
    last_viewed_at: Option<i64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TripSearchResult {
    trip: Trip,
    item_id: String,
    item_title: String,
    item_icon: String,
    item_kind: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianVaultConfig {
    id: String,
    name: String,
    path: String,
    enabled: bool,
    last_indexed_at: Option<String>,
    file_count: u32,
    task_count: u32,
    open_in_obsidian: bool,
    created_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianNoteIndex {
    id: String,
    vault_id: String,
    vault_name: String,
    title: String,
    file_path: String,
    relative_path: String,
    tags: Vec<String>,
    frontmatter: Option<HashMap<String, String>>,
    modified_at: String,
    indexed_at: String,
    task_count: u32,
    favorite: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianTask {
    id: String,
    vault_id: String,
    vault_name: String,
    note_id: String,
    note_title: String,
    file_path: String,
    relative_path: String,
    line_number: i64,
    raw_text: String,
    text: String,
    completed: bool,
    tags: Vec<String>,
    due_date: Option<String>,
    priority: Option<String>,
    completed_at: Option<String>,
    modified_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianSearchResult {
    kind: String,
    id: String,
    title: String,
    subtitle: String,
    icon: String,
    vault_id: String,
    vault_name: String,
    relative_path: String,
    line_number: Option<i64>,
    task: Option<ObsidianTask>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianScanResult {
    vault: ObsidianVaultConfig,
    note_count: u32,
    task_count: u32,
}

#[derive(Clone, Serialize)]
struct ExportResult {
    path: String,
    json: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    imported: usize,
    inserted: usize,
    updated: usize,
    skipped: usize,
    trips_imported: usize,
    item_ids: Vec<String>,
}

#[derive(Clone)]
struct ShortcutCacheEntry {
    shortcut_path: String,
    modified_at: i64,
    file_size: i64,
    title: String,
    target_path: String,
    arguments: String,
    working_directory: String,
    icon_location: String,
    icon_data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct IconHydrationInput {
    key: String,
    shortcut: String,
    source: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct IconHydrationOutput {
    key: String,
    icon: String,
}

fn now_string() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}

fn now_i64() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn app_data_dir() -> Result<PathBuf, String> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let executable = std::env::current_exe().ok();
    let directory = resolve_data_directory(executable.as_deref(), &base);
    prepare_data_directory(&directory)?;
    Ok(directory.path)
}

fn plugins_dir() -> Result<PathBuf, String> {
    let path = app_data_dir()?.join("plugins");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Failed to create plugin directory: {error}"))?;
    Ok(path)
}

fn themes_dir() -> Result<PathBuf, String> {
    let path = app_data_dir()?.join("themes");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Failed to create theme directory: {error}"))?;
    Ok(path)
}

fn db_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("orbit.db"))
}

fn resource_kind_supports_relative_paths(kind: &str) -> bool {
    matches!(kind, "app" | "file" | "folder" | "script")
}

fn normalize_item_path_fields(
    kind: &str,
    path_mode: ResourcePathMode,
    target: &str,
    base_path: Option<&str>,
) -> Result<(ResourcePathMode, Option<String>), String> {
    if path_mode != ResourcePathMode::Absolute && !resource_kind_supports_relative_paths(kind) {
        return Err(format!(
            "Path mode '{path_mode:?}' is only supported for app, file, folder, and script resources"
        ));
    }
    let normalized = normalize_resource_path_fields(path_mode, target, base_path)?;
    Ok((normalized.mode, normalized.base_path))
}

fn resolve_item_target(item: &OrbitItem) -> Result<String, String> {
    if item.path_mode == ResourcePathMode::Absolute {
        return Ok(item.target.clone());
    }
    if !resource_kind_supports_relative_paths(&item.kind) {
        return Err(format!(
            "Resource '{}' uses a relative path mode but its kind '{}' cannot resolve local paths",
            item.title, item.kind
        ));
    }
    let resolved = resolve_resource_path(
        &app_data_dir()?,
        item.path_mode,
        &item.target,
        item.base_path.as_deref(),
    )?;
    Ok(resolved.to_string_lossy().to_string())
}

fn item_path_status(item: &OrbitItem) -> Result<ResourcePathStatusReport, String> {
    if !resource_kind_supports_relative_paths(&item.kind) {
        return Err(format!(
            "Resource '{}' ({}) does not have a local path to inspect",
            item.title, item.kind
        ));
    }
    Ok(inspect_resource_path(
        &app_data_dir()?,
        item.path_mode,
        &item.target,
        item.base_path.as_deref(),
    ))
}

fn open_database_connection_at(path: &Path) -> Result<Connection, String> {
    let conn =
        Connection::open(path).map_err(|error| format!("Failed to open database: {error}"))?;
    // Set a bounded wait for concurrent short-lived command connections.
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("Failed to configure database busy timeout: {error}"))?;
    Ok(conn)
}

fn open_database_connection() -> Result<Connection, String> {
    let path = db_path()?;
    open_database_connection_at(&path)
}

/// Performs schema/bootstrap work exactly once during startup (or after an
/// explicit reset). Ordinary command paths must call `open_db` instead.
fn initialize_database() -> Result<AppSettings, String> {
    let path = db_path()?;
    let mut conn = open_database_connection_at(&path)?;
    run_migrations(&mut conn, Some(&path))?;
    bootstrap_database_data(&conn)?;
    ensure_local_templates()?;
    app_settings(&conn)
}

fn open_db() -> Result<Connection, String> {
    open_database_connection()
}

const CURRENT_SCHEMA_VERSION: i32 = 8;

#[derive(Clone, Copy)]
struct DatabaseMigration {
    version: i32,
    name: &'static str,
    apply: fn(&Connection) -> Result<(), String>,
}

const DATABASE_MIGRATIONS: [DatabaseMigration; 8] = [
    DatabaseMigration {
        version: 1,
        name: "initial_core_schema",
        apply: migration_001_initial_core_schema,
    },
    DatabaseMigration {
        version: 2,
        name: "trips",
        apply: migration_002_trips,
    },
    DatabaseMigration {
        version: 3,
        name: "obsidian_and_item_sort_order",
        apply: migration_003_obsidian_and_item_sort_order,
    },
    DatabaseMigration {
        version: 4,
        name: "group_sort_order",
        apply: migration_004_group_sort_order,
    },
    DatabaseMigration {
        version: 5,
        name: "item_arguments",
        apply: migration_005_item_arguments,
    },
    DatabaseMigration {
        version: 6,
        name: "item_sub_tag",
        apply: migration_006_item_sub_tag,
    },
    DatabaseMigration {
        version: 7,
        name: "shortcut_scan_cache",
        apply: migration_007_shortcut_scan_cache,
    },
    DatabaseMigration {
        version: 8,
        name: "resource_path_modes",
        apply: migration_008_resource_path_modes,
    },
];

fn schema_version(conn: &Connection) -> Result<i32, String> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("Failed to read database schema version: {error}"))
}

fn database_has_user_schema(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%')",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map(|exists| exists != 0)
    .map_err(|error| format!("Failed to inspect existing database schema: {error}"))
}

fn run_migrations(conn: &mut Connection, db_file: Option<&Path>) -> Result<(), String> {
    debug_assert_eq!(
        DATABASE_MIGRATIONS
            .last()
            .map(|migration| migration.version),
        Some(CURRENT_SCHEMA_VERSION)
    );
    run_migrations_with_plan(conn, db_file, &DATABASE_MIGRATIONS)
}

fn run_migrations_with_plan(
    conn: &mut Connection,
    db_file: Option<&Path>,
    migrations: &[DatabaseMigration],
) -> Result<(), String> {
    let current_version = schema_version(conn)?;
    let latest_version = migrations
        .last()
        .map(|migration| migration.version)
        .ok_or_else(|| "Database migration plan is empty".to_string())?;

    if current_version > latest_version {
        return Err(format!(
            "Database schema version {current_version} is newer than this OrbitStart build supports ({latest_version})."
        ));
    }
    if current_version == latest_version {
        return Ok(());
    }

    let backup_path = if database_has_user_schema(conn)? {
        if let Some(db_file) = db_file {
            Some(create_pre_migration_backup(conn, db_file, current_version)?)
        } else {
            None
        }
    } else {
        None
    };

    apply_migration_plan(conn, migrations).map_err(|error| {
        if let Some(path) = backup_path {
            format!(
                "{error}. The pre-migration backup was preserved at {}",
                path.display()
            )
        } else {
            error
        }
    })
}

fn apply_migration_plan(
    conn: &mut Connection,
    migrations: &[DatabaseMigration],
) -> Result<(), String> {
    let current_version = schema_version(conn)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Failed to begin database migration transaction: {error}"))?;

    for migration in migrations
        .iter()
        .filter(|migration| migration.version > current_version)
    {
        (migration.apply)(&transaction).map_err(|error| {
            format!(
                "Database migration {:03} ({}) failed: {error}",
                migration.version, migration.name
            )
        })?;
        transaction
            .pragma_update(None, "user_version", migration.version)
            .map_err(|error| {
                format!(
                    "Failed to record database migration {:03} ({}): {error}",
                    migration.version, migration.name
                )
            })?;
    }

    transaction
        .commit()
        .map_err(|error| format!("Failed to commit database migrations: {error}"))
}

fn create_pre_migration_backup(
    source: &Connection,
    db_file: &Path,
    from_version: i32,
) -> Result<PathBuf, String> {
    let parent = db_file.parent().ok_or_else(|| {
        format!(
            "Database path has no parent directory: {}",
            db_file.display()
        )
    })?;
    let backups_dir = parent.join("backups");
    fs::create_dir_all(&backups_dir)
        .map_err(|error| format!("Failed to create migration backup directory: {error}"))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let final_path = (0..100)
        .map(|attempt| {
            let suffix = if attempt == 0 {
                String::new()
            } else {
                format!("-{attempt}")
            };
            backups_dir.join(format!(
                "pre-migration-{from_version:03}-{timestamp}{suffix}.db"
            ))
        })
        .find(|candidate| !candidate.exists() && !candidate.with_extension("partial").exists())
        .ok_or_else(|| "Could not allocate a unique migration backup filename".to_string())?;
    let partial_path = final_path.with_extension("partial");

    let backup_result = (|| -> Result<(), String> {
        let mut destination = Connection::open(&partial_path)
            .map_err(|error| format!("Failed to create migration backup: {error}"))?;
        destination
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| format!("Failed to configure migration backup: {error}"))?;

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let backup = Backup::new(source, &mut destination)
            .map_err(|error| format!("Failed to start migration backup: {error}"))?;
        loop {
            match backup
                .step(100)
                .map_err(|error| format!("Failed to copy migration backup: {error}"))?
            {
                StepResult::Done => break,
                StepResult::More => {}
                StepResult::Busy | StepResult::Locked => {
                    if std::time::Instant::now() >= deadline {
                        return Err("Timed out while creating the migration backup".to_string());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                _ => return Err("Migration backup returned an unsupported state".to_string()),
            }
        }
        Ok(())
    })();

    if let Err(error) = backup_result {
        let _ = fs::remove_file(&partial_path);
        return Err(error);
    }
    fs::rename(&partial_path, &final_path)
        .map_err(|error| format!("Failed to finalize migration backup: {error}"))?;
    Ok(final_path)
}

fn bootstrap_database_data(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
        .map_err(|error| format!("Failed to count items: {error}"))?;

    if count == 0 {
        let mut seeds = seed_items();
        seeds.reverse();
        for item in seeds {
            insert_item(conn, &item)?;
        }
    }

    seed_groups(conn)?;
    seed_plugin_states(conn)?;
    ensure_default_settings(conn)?;
    Ok(())
}

fn ensure_table_column(
    conn: &Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Failed to inspect table {table}: {error}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Failed to read table info for {table}: {error}"))?;
    for row in rows {
        if row.map_err(|error| format!("Failed to map table info for {table}: {error}"))? == column
        {
            return Ok(());
        }
    }
    conn.execute(alter_sql, [])
        .map_err(|error| format!("Failed to migrate table {table}: {error}"))?;
    Ok(())
}

fn migration_001_initial_core_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL,
            kind TEXT NOT NULL,
            group_id TEXT NOT NULL,
            target TEXT NOT NULL UNIQUE,
            aliases_json TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            icon TEXT NOT NULL,
            accent TEXT NOT NULL,
            favorite INTEGER NOT NULL DEFAULT 0,
            launch_count INTEGER NOT NULL DEFAULT 0,
            last_launched_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            icon TEXT NOT NULL,
            description TEXT NOT NULL,
            custom INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plugin_states (
            id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL,
            manifest_json TEXT NOT NULL,
            builtin INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plugin_logs (
            id TEXT PRIMARY KEY,
            plugin_id TEXT NOT NULL,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| format!("Failed to create initial database schema: {error}"))
}

fn migration_002_trips(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS trips (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'note',
            status TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            pinned INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_viewed_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_trips_item_id ON trips(item_id);
        CREATE INDEX IF NOT EXISTS idx_trips_updated_at ON trips(updated_at DESC);
        "#,
    )
    .map_err(|error| format!("Failed to create trips schema: {error}"))
}

fn migration_003_obsidian_and_item_sort_order(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS obsidian_vaults (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_indexed_at TEXT,
            file_count INTEGER NOT NULL DEFAULT 0,
            task_count INTEGER NOT NULL DEFAULT 0,
            open_in_obsidian INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS obsidian_notes (
            id TEXT PRIMARY KEY,
            vault_id TEXT NOT NULL,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]',
            frontmatter_json TEXT,
            modified_at TEXT NOT NULL,
            indexed_at TEXT NOT NULL,
            FOREIGN KEY (vault_id) REFERENCES obsidian_vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS obsidian_tasks (
            id TEXT PRIMARY KEY,
            vault_id TEXT NOT NULL,
            note_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            raw_text TEXT NOT NULL,
            text TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            tags_json TEXT NOT NULL DEFAULT '[]',
            due_date TEXT,
            priority TEXT,
            completed_at TEXT,
            modified_at TEXT NOT NULL,
            FOREIGN KEY (vault_id) REFERENCES obsidian_vaults(id) ON DELETE CASCADE,
            FOREIGN KEY (note_id) REFERENCES obsidian_notes(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_obsidian_notes_vault ON obsidian_notes(vault_id);
        CREATE INDEX IF NOT EXISTS idx_obsidian_notes_modified ON obsidian_notes(modified_at DESC);
        CREATE INDEX IF NOT EXISTS idx_obsidian_tasks_vault ON obsidian_tasks(vault_id);
        CREATE INDEX IF NOT EXISTS idx_obsidian_tasks_completed ON obsidian_tasks(completed);
        CREATE INDEX IF NOT EXISTS idx_obsidian_tasks_due ON obsidian_tasks(due_date);
        "#,
    )
    .map_err(|error| format!("Failed to create Obsidian schema: {error}"))?;

    ensure_table_column(
        conn,
        "obsidian_notes",
        "favorite",
        "ALTER TABLE obsidian_notes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(
        conn,
        "items",
        "sort_order",
        "ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_items_sort_order ON items(sort_order)",
        [],
    )
    .map_err(|error| format!("Failed to create item sort-order index: {error}"))?;
    Ok(())
}

fn migration_004_group_sort_order(conn: &Connection) -> Result<(), String> {
    ensure_table_column(
        conn,
        "groups",
        "sort_order",
        "ALTER TABLE groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_groups_sort_order ON groups(sort_order)",
        [],
    )
    .map_err(|error| format!("Failed to create group sort-order index: {error}"))?;

    for (index, group) in default_groups().iter().enumerate() {
        conn.execute(
            "UPDATE groups SET sort_order = ?1 WHERE id = ?2 AND (sort_order = 0 OR sort_order IS NULL)",
            params![index as i64, &group.id],
        )
        .map_err(|error| format!("Failed to backfill group sort order: {error}"))?;
    }
    Ok(())
}

fn migration_005_item_arguments(conn: &Connection) -> Result<(), String> {
    ensure_table_column(
        conn,
        "items",
        "arguments",
        "ALTER TABLE items ADD COLUMN arguments TEXT NOT NULL DEFAULT ''",
    )
}

fn migration_006_item_sub_tag(conn: &Connection) -> Result<(), String> {
    ensure_table_column(
        conn,
        "items",
        "sub_tag",
        "ALTER TABLE items ADD COLUMN sub_tag TEXT NOT NULL DEFAULT ''",
    )
}

fn migration_007_shortcut_scan_cache(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS shortcut_scan_cache (
            shortcut_path TEXT PRIMARY KEY,
            modified_at INTEGER NOT NULL,
            file_size INTEGER NOT NULL,
            title TEXT NOT NULL,
            target_path TEXT NOT NULL DEFAULT '',
            arguments TEXT NOT NULL DEFAULT '',
            working_directory TEXT NOT NULL DEFAULT '',
            icon_location TEXT NOT NULL DEFAULT '',
            icon_data TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| format!("Failed to create shortcut scan cache schema: {error}"))
}

fn migration_008_resource_path_modes(conn: &Connection) -> Result<(), String> {
    ensure_table_column(
        conn,
        "items",
        "path_mode",
        "ALTER TABLE items ADD COLUMN path_mode TEXT NOT NULL DEFAULT 'absolute'",
    )?;
    ensure_table_column(
        conn,
        "items",
        "base_path",
        "ALTER TABLE items ADD COLUMN base_path TEXT",
    )?;
    conn.execute(
        "UPDATE items SET path_mode = 'absolute' WHERE path_mode IS NULL OR TRIM(path_mode) = ''",
        [],
    )
    .map_err(|error| format!("Failed to backfill resource path modes: {error}"))?;
    Ok(())
}

#[cfg(test)]
fn init_db(conn: &mut Connection) -> Result<(), String> {
    run_migrations(conn, None)?;
    bootstrap_database_data(conn)
}

#[cfg(test)]
mod database_migration_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIRECTORY_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TestDatabase {
        root: PathBuf,
        path: PathBuf,
    }

    impl TestDatabase {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default();
            let counter = TEST_DIRECTORY_COUNTER.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "orbitstart-migration-{label}-{}-{nonce}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("test database directory should be created");
            let path = root.join("orbit.db");
            Self { root, path }
        }
    }

    impl Drop for TestDatabase {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn test_connection(database: &TestDatabase) -> Connection {
        open_database_connection_at(&database.path)
            .expect("temporary test database should open successfully")
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
        let mut statement = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("table info query should prepare");
        let exists = statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("table info query should execute")
            .filter_map(Result::ok)
            .any(|name| name == column);
        exists
    }

    fn backup_files(database: &TestDatabase) -> Vec<PathBuf> {
        let backups = database.root.join("backups");
        let Ok(entries) = fs::read_dir(backups) else {
            return Vec::new();
        };
        let mut paths = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("db"))
            .collect::<Vec<_>>();
        paths.sort();
        paths
    }

    fn create_legacy_core_schema(conn: &Connection) {
        migration_001_initial_core_schema(conn).expect("legacy core schema should be created");
        conn.execute_batch(
            r#"
            INSERT INTO groups (id, title, icon, description, custom, created_at)
            VALUES ('apps', 'Apps', 'AppWindow', '', 0, '0');
            INSERT INTO items (
                id, title, subtitle, kind, group_id, target, aliases_json, tags_json,
                icon, accent, favorite, launch_count, last_launched_at, created_at, updated_at
            ) VALUES (
                'legacy-item', 'Legacy item', 'legacy', 'app', 'apps', 'C:/legacy.exe', '[]', '[]',
                'AppWindow', '#ffffff', 0, 3, NULL, '0', '0'
            );
            "#,
        )
        .expect("legacy data should be inserted");
    }

    #[test]
    fn initializes_an_empty_database_without_a_migration_backup() {
        let database = TestDatabase::new("empty");
        let mut conn = test_connection(&database);

        run_migrations(&mut conn, Some(&database.path)).expect("empty database should initialize");

        assert_eq!(
            schema_version(&conn).expect("schema version should read"),
            8
        );
        assert!(column_exists(&conn, "items", "arguments"));
        assert!(column_exists(&conn, "items", "sort_order"));
        assert!(column_exists(&conn, "items", "sub_tag"));
        assert!(column_exists(&conn, "items", "path_mode"));
        assert!(column_exists(&conn, "items", "base_path"));
        assert!(column_exists(&conn, "groups", "sort_order"));
        assert!(column_exists(&conn, "obsidian_notes", "favorite"));
        assert!(backup_files(&database).is_empty());
    }

    #[test]
    fn upgrades_a_legacy_database_and_preserves_its_data_in_a_backup() {
        let database = TestDatabase::new("legacy");
        let mut conn = test_connection(&database);
        create_legacy_core_schema(&conn);

        run_migrations(&mut conn, Some(&database.path)).expect("legacy database should migrate");

        assert_eq!(
            schema_version(&conn).expect("schema version should read"),
            8
        );
        let values: (String, String, i64, String, Option<String>) = conn
            .query_row(
                "SELECT arguments, sub_tag, launch_count, path_mode, base_path FROM items WHERE id = 'legacy-item'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .expect("legacy item should remain after migration");
        assert_eq!(values.0, "");
        assert_eq!(values.1, "");
        assert_eq!(values.2, 3);
        assert_eq!(values.3, "absolute");
        assert_eq!(values.4, None);

        let backups = backup_files(&database);
        assert_eq!(backups.len(), 1, "legacy upgrades should create one backup");
        let backup = Connection::open(&backups[0]).expect("migration backup should open");
        assert_eq!(
            schema_version(&backup).expect("backup version should read"),
            0
        );
        assert!(
            !column_exists(&backup, "items", "arguments"),
            "backup must preserve the pre-migration schema"
        );
        let legacy_count: i64 = backup
            .query_row(
                "SELECT COUNT(*) FROM items WHERE id = 'legacy-item'",
                [],
                |row| row.get(0),
            )
            .expect("backup should contain the legacy item");
        assert_eq!(legacy_count, 1);
    }

    #[test]
    fn upgrades_a_version_seven_database_with_absolute_path_defaults() {
        let database = TestDatabase::new("path-mode-v7");
        let mut conn = test_connection(&database);
        create_legacy_core_schema(&conn);
        for migration in DATABASE_MIGRATIONS
            .iter()
            .filter(|migration| migration.version <= 7)
        {
            (migration.apply)(&conn).expect("version seven migration should apply");
        }
        conn.pragma_update(None, "user_version", 7)
            .expect("test database should be marked as version seven");

        run_migrations(&mut conn, None).expect("version seven database should migrate");

        let values: (String, Option<String>) = conn
            .query_row(
                "SELECT path_mode, base_path FROM items WHERE id = 'legacy-item'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("legacy item should receive path defaults");
        assert_eq!(values.0, "absolute");
        assert_eq!(values.1, None);
        assert_eq!(
            schema_version(&conn).expect("schema version should read"),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn upgrades_an_unversioned_current_schema_without_column_conflicts() {
        let database = TestDatabase::new("current-v0");
        let mut conn = test_connection(&database);
        create_legacy_core_schema(&conn);
        run_migrations(&mut conn, None).expect("first migration should produce the current schema");
        conn.pragma_update(None, "user_version", 0)
            .expect("test database version should reset to zero");

        run_migrations(&mut conn, Some(&database.path))
            .expect("unversioned current schema should migrate idempotently");

        assert_eq!(
            schema_version(&conn).expect("schema version should read"),
            8
        );
        assert!(column_exists(&conn, "items", "arguments"));
        assert!(column_exists(&conn, "items", "sort_order"));
        assert!(column_exists(&conn, "items", "sub_tag"));
        assert!(column_exists(&conn, "items", "path_mode"));
        assert!(column_exists(&conn, "items", "base_path"));
        let item_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM items WHERE id = 'legacy-item'",
                [],
                |row| row.get(0),
            )
            .expect("current schema data should remain");
        assert_eq!(item_count, 1);
        assert_eq!(backup_files(&database).len(), 1);
    }

    #[test]
    fn latest_schema_does_not_repeat_migrations_or_create_backups() {
        let database = TestDatabase::new("latest");
        let mut conn = test_connection(&database);
        run_migrations(&mut conn, Some(&database.path)).expect("empty database should initialize");
        let schema_before: Vec<String> = {
            let mut statement = conn
                .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
                .expect("schema snapshot query should prepare");
            statement
                .query_map([], |row| row.get(0))
                .expect("schema snapshot query should execute")
                .collect::<Result<Vec<_>, _>>()
                .expect("schema snapshot should read")
        };

        run_migrations(&mut conn, Some(&database.path)).expect("latest schema should be a no-op");

        let schema_after: Vec<String> = {
            let mut statement = conn
                .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
                .expect("schema snapshot query should prepare");
            statement
                .query_map([], |row| row.get(0))
                .expect("schema snapshot query should execute")
                .collect::<Result<Vec<_>, _>>()
                .expect("schema snapshot should read")
        };
        assert_eq!(
            schema_version(&conn).expect("schema version should read"),
            8
        );
        assert_eq!(schema_after, schema_before);
        assert!(backup_files(&database).is_empty());
    }

    fn create_probe_table(conn: &Connection) -> Result<(), String> {
        conn.execute_batch("CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);")
            .map_err(|error| format!("Failed to create probe table: {error}"))
    }

    fn fail_migration(_conn: &Connection) -> Result<(), String> {
        Err("injected migration failure".to_string())
    }

    #[test]
    fn failed_migration_rolls_back_and_keeps_the_pre_migration_backup() {
        let database = TestDatabase::new("failure");
        let mut conn = test_connection(&database);
        conn.execute_batch(
            "CREATE TABLE legacy_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL); \
             INSERT INTO legacy_records (label) VALUES ('keep me');",
        )
        .expect("legacy test data should be created");
        let migrations = [
            DatabaseMigration {
                version: 1,
                name: "probe",
                apply: create_probe_table,
            },
            DatabaseMigration {
                version: 2,
                name: "injected_failure",
                apply: fail_migration,
            },
        ];

        let error = run_migrations_with_plan(&mut conn, Some(&database.path), &migrations)
            .expect_err("injected migration failure should abort startup");

        assert!(error.contains("injected migration failure"));
        assert_eq!(
            schema_version(&conn).expect("schema version should read"),
            0
        );
        let probe_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'",
                [],
                |row| row.get(0),
            )
            .expect("probe table query should run");
        assert_eq!(probe_exists, 0, "failed migration DDL must roll back");
        let source_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM legacy_records", [], |row| row.get(0))
            .expect("legacy source data should remain");
        assert_eq!(source_rows, 1);

        let backups = backup_files(&database);
        assert_eq!(
            backups.len(),
            1,
            "failed migration should retain its backup"
        );
        let backup = Connection::open(&backups[0]).expect("migration backup should open");
        let backup_rows: i64 = backup
            .query_row("SELECT COUNT(*) FROM legacy_records", [], |row| row.get(0))
            .expect("backup should preserve legacy source data");
        assert_eq!(backup_rows, 1);
    }
}

fn ensure_default_settings(conn: &Connection) -> Result<(), String> {
    for (key, value) in [
        ("active_theme_id", "local-galaxy"),
        ("safe_mode", "false"),
        ("density", "comfortable"),
        ("global_hotkey", "Ctrl+Alt+Space"),
        ("close_behavior", "tray"),
        ("auto_pinned_mode", "false"),
        ("display_mode", "simple"),
        ("resource_mode", "single"),
        ("workbench_visible", "true"),
        ("workbench_show_status", "true"),
        ("workbench_show_workspaces", "true"),
        ("workbench_show_actions", "true"),
        ("workbench_show_toast", "true"),
        ("workbench_show_statistics", "true"),
        ("hotkey_behavior", "command_bar"),
        ("bubble_enabled", "false"),
        ("bubble_show_when_main_hidden", "true"),
        ("bubble_always_on_top", "true"),
        ("bubble_size", "64"),
        ("bubble_opacity", "1.0"),
        ("bubble_snap_to_edge", "true"),
        ("bubble_expand_on_hover", "true"),
        ("bubble_expand_delay_ms", "200"),
        ("bubble_avoid_fullscreen", "false"),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|error| format!("Failed to initialize setting {key}: {error}"))?;
    }
    Ok(())
}

fn setting(conn: &Connection, key: &str, fallback: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("Failed to read setting {key}: {error}"))
    .map(|value| value.unwrap_or_else(|| fallback.to_string()))
}

fn set_setting_value(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|error| format!("Failed to update setting {key}: {error}"))?;
    Ok(())
}

fn app_settings(conn: &Connection) -> Result<AppSettings, String> {
    Ok(AppSettings {
        active_theme_id: setting(conn, "active_theme_id", "local-galaxy")?,
        safe_mode: setting(conn, "safe_mode", "false")? == "true",
        density: setting(conn, "density", "comfortable")?,
        global_hotkey: setting(conn, "global_hotkey", "Ctrl+Alt+Space")?,
        close_behavior: setting(conn, "close_behavior", "tray")?,
        data_dir: app_data_dir()?.to_string_lossy().to_string(),
        auto_pinned_mode: setting(conn, "auto_pinned_mode", "false")? == "true",
        display_mode: setting(conn, "display_mode", "simple")?,
        resource_mode: setting(conn, "resource_mode", "single")?,
        workbench_visible: setting(conn, "workbench_visible", "true")? == "true",
        workbench_show_status: setting(conn, "workbench_show_status", "true")? == "true",
        workbench_show_workspaces: setting(conn, "workbench_show_workspaces", "true")? == "true",
        workbench_show_actions: setting(conn, "workbench_show_actions", "true")? == "true",
        workbench_show_toast: setting(conn, "workbench_show_toast", "true")? == "true",
        workbench_show_statistics: setting(conn, "workbench_show_statistics", "true")? == "true",
        hotkey_behavior: setting(conn, "hotkey_behavior", "command_bar")?,
        bubble_enabled: setting(conn, "bubble_enabled", "false")? == "true",
        bubble_show_when_main_hidden: setting(conn, "bubble_show_when_main_hidden", "true")?
            == "true",
        bubble_always_on_top: setting(conn, "bubble_always_on_top", "true")? == "true",
        bubble_size: setting(conn, "bubble_size", "64")?
            .parse::<i32>()
            .unwrap_or(64),
        bubble_opacity: setting(conn, "bubble_opacity", "1.0")?
            .parse::<f64>()
            .unwrap_or(1.0),
        bubble_snap_to_edge: setting(conn, "bubble_snap_to_edge", "true")? == "true",
        bubble_expand_on_hover: setting(conn, "bubble_expand_on_hover", "true")? == "true",
        bubble_expand_delay_ms: setting(conn, "bubble_expand_delay_ms", "200")?
            .parse::<i32>()
            .unwrap_or(200),
        bubble_avoid_fullscreen: setting(conn, "bubble_avoid_fullscreen", "false")? == "true",
    })
}

fn cached_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "Runtime settings state is unavailable".to_string())?;
    state
        .settings
        .read()
        .map(|settings| settings.clone())
        .map_err(|_| "Runtime settings cache lock is poisoned".to_string())
}

fn replace_cached_settings(app: &tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "Runtime settings state is unavailable".to_string())?;
    let mut cached = state
        .settings
        .write()
        .map_err(|_| "Runtime settings cache lock is poisoned".to_string())?;
    *cached = settings;
    Ok(())
}

fn cache_settings_from_connection(
    app: &tauri::AppHandle,
    conn: &Connection,
) -> Result<AppSettings, String> {
    let settings = app_settings(conn)?;
    replace_cached_settings(app, settings.clone())?;
    Ok(settings)
}

fn settings_after_setting_update(
    app: &tauri::AppHandle,
    conn: &Connection,
) -> Result<AppSettings, String> {
    let settings = cache_settings_from_connection(app, conn)?;
    let _ = app.emit("orbit://settings-updated", settings.clone());
    Ok(settings)
}

fn plugin_state_update_after_setting_change(
    app: &tauri::AppHandle,
    conn: &Connection,
) -> Result<PluginStateUpdate, String> {
    let settings = cache_settings_from_connection(app, conn)?;
    let plugins = all_plugins(conn)?;
    let update = PluginStateUpdate {
        commands: default_commands(&plugins),
        plugins,
        settings,
    };
    let _ = app.emit("orbit://settings-updated", update.settings.clone());
    let _ = app.emit("orbit://plugin-state-updated", update.clone());
    Ok(update)
}

fn seed_items() -> Vec<OrbitItemInput> {
    vec![
        OrbitItemInput {
            title: "Notepad".to_string(),
            subtitle: "Windows text editor".to_string(),
            kind: "app".to_string(),
            group: "apps".to_string(),
            target: "C:\\Windows\\System32\\notepad.exe".to_string(),
            arguments: String::new(),
            aliases: vec!["text".to_string(), "txt".to_string(), "notepad".to_string()],
            tags: vec!["system".to_string(), "editor".to_string()],
            sub_tag: String::new(),
            icon: "NotebookText".to_string(),
            accent: "#5cc8ff".to_string(),
            favorite: true,
            path_mode: ResourcePathMode::Absolute,
            base_path: None,
        },
        OrbitItemInput {
            title: "OrbitStart workspace".to_string(),
            subtitle: "E:\\OrbitStart".to_string(),
            kind: "folder".to_string(),
            group: "work".to_string(),
            target: "E:\\OrbitStart".to_string(),
            arguments: String::new(),
            aliases: vec!["orbit".to_string(), "project".to_string()],
            tags: vec!["project".to_string()],
            sub_tag: String::new(),
            icon: "FolderKanban".to_string(),
            accent: "#8bd450".to_string(),
            favorite: true,
            path_mode: ResourcePathMode::Absolute,
            base_path: None,
        },
        OrbitItemInput {
            title: "GitHub".to_string(),
            subtitle: "https://github.com".to_string(),
            kind: "website".to_string(),
            group: "web".to_string(),
            target: "https://github.com".to_string(),
            arguments: String::new(),
            aliases: vec!["git".to_string(), "repo".to_string()],
            tags: vec!["web".to_string(), "dev".to_string()],
            sub_tag: String::new(),
            icon: "Github".to_string(),
            accent: "#ffffff".to_string(),
            favorite: false,
            path_mode: ResourcePathMode::Absolute,
            base_path: None,
        },
        OrbitItemInput {
            title: "Morning workspace".to_string(),
            subtitle: "Launches a small starter chain".to_string(),
            kind: "action_chain".to_string(),
            group: "work".to_string(),
            target: "C:\\Windows\\System32\\notepad.exe\nhttps://github.com\nE:\\OrbitStart"
                .to_string(),
            arguments: String::new(),
            aliases: vec!["chain".to_string(), "workspace".to_string()],
            tags: vec!["automation".to_string(), "template".to_string()],
            sub_tag: String::new(),
            icon: "Workflow".to_string(),
            accent: "#ff7a90".to_string(),
            favorite: false,
            path_mode: ResourcePathMode::Absolute,
            base_path: None,
        },
    ]
}

fn default_groups() -> Vec<OrbitGroup> {
    vec![
        OrbitGroup {
            id: "all".to_string(),
            title: "全部".to_string(),
            icon: "Orbit".to_string(),
            description: "所有资源".to_string(),
            custom: false,
        },
        OrbitGroup {
            id: "apps".to_string(),
            title: "应用".to_string(),
            icon: "AppWindow".to_string(),
            description: "程序和快捷方式".to_string(),
            custom: false,
        },
        OrbitGroup {
            id: "web".to_string(),
            title: "网址".to_string(),
            icon: "Globe".to_string(),
            description: "网站、书签和在线控制台".to_string(),
            custom: false,
        },
        OrbitGroup {
            id: "scripts".to_string(),
            title: "脚本".to_string(),
            icon: "TerminalSquare".to_string(),
            description: "脚本和自动化入口".to_string(),
            custom: false,
        },
        OrbitGroup {
            id: "plugins".to_string(),
            title: "插件".to_string(),
            icon: "Blocks".to_string(),
            description: "插件提供的资源".to_string(),
            custom: false,
        },
    ]
}

fn seed_groups(conn: &Connection) -> Result<(), String> {
    let now = now_string();
    for (index, group) in default_groups().iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO groups (id, title, icon, description, custom, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![group.id, group.title, group.icon, group.description, if group.custom { 1 } else { 0 }, index as i64, now],
        )
        .map_err(|error| format!("Failed to seed group: {error}"))?;
    }
    Ok(())
}

fn all_groups(conn: &Connection) -> Result<Vec<OrbitGroup>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, title, icon, description, custom
            FROM groups
            ORDER BY sort_order ASC, title COLLATE NOCASE ASC
            "#,
        )
        .map_err(|error| format!("Failed to prepare groups query: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            let custom: i64 = row.get(4)?;
            Ok(OrbitGroup {
                id: row.get(0)?,
                title: row.get(1)?,
                icon: row.get(2)?,
                description: row.get(3)?,
                custom: custom != 0,
            })
        })
        .map_err(|error| format!("Failed to query groups: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to map groups: {error}"))
}

fn permission(id: &str, label: &str, risk: &str) -> PluginPermission {
    PluginPermission {
        id: id.to_string(),
        label: label.to_string(),
        risk: risk.to_string(),
    }
}

fn contributes(commands: u32, search_providers: u32, themes: u32, views: u32) -> PluginContributes {
    PluginContributes {
        commands,
        search_providers,
        themes,
        views,
    }
}

fn plugin(
    id: &str,
    name: &str,
    description: &str,
    permissions: Vec<PluginPermission>,
    contributes: PluginContributes,
) -> PluginManifest {
    PluginManifest {
        id: id.to_string(),
        name: name.to_string(),
        version: "0.5.5".to_string(),
        description: description.to_string(),
        enabled: true,
        builtin: true,
        permissions,
        contributes,
    }
}

fn default_plugins() -> Vec<PluginManifest> {
    let mut list = vec![
        plugin(
            "core-command-palette",
            "Command Palette",
            "统一命令入口、资源搜索和插件结果聚合。",
            vec![permission("ui:overlay", "显示命令面板", "low")],
            contributes(1, 1, 0, 1),
        ),
        plugin(
            "core-items",
            "Items",
            "管理应用、文件、文件夹、脚本和动作链。",
            vec![permission("db:items", "读写本地资源目录", "medium")],
            contributes(2, 1, 0, 1),
        ),
        plugin(
            "core-websites",
            "Websites",
            "网址、浏览器书签和在线控制台入口。",
            vec![permission("shell:open-url", "打开网址", "medium")],
            contributes(2, 1, 0, 1),
        ),
        plugin(
            "core-shortcuts",
            "Windows Shortcuts",
            "扫描桌面和开始菜单快捷方式，并保留原始 .lnk 启动能力。",
            vec![permission("launcher:item", "启动已保存资源", "low")],
            contributes(1, 1, 0, 0),
        ),
        plugin(
            "core-bookmarks",
            "Browser Bookmarks",
            "从 Edge/Chrome 书签文件导入网站入口。",
            vec![permission(
                "fs:read-browser",
                "读取本机浏览器书签文件",
                "medium",
            )],
            contributes(1, 1, 0, 0),
        ),
        plugin(
            "core-actions",
            "Action Chains",
            "用一个入口顺序启动多个程序、文件夹和网址。",
            vec![permission("shell:chain", "批量启动多个目标", "high")],
            contributes(2, 1, 0, 1),
        ),
        plugin(
            "core-themes",
            "Themes",
            "主题变量、实时预览和本地主题包。",
            vec![permission("theme:write", "应用主题变量", "low")],
            contributes(1, 0, 6, 1),
        ),
        plugin(
            "core-backup",
            "Backup",
            "JSON 导入导出和本地备份。",
            vec![permission("fs:write", "写入备份文件", "medium")],
            contributes(2, 0, 0, 0),
        ),
        plugin(
            "core-plugin-dev",
            "Plugin Dev Kit",
            "本地插件模板、manifest 校验和开发文档入口。",
            vec![permission("fs:write-plugins", "写入本地插件模板", "medium")],
            contributes(2, 0, 0, 1),
        ),
        plugin(
            "core-clipboard",
            "Clipboard Quick Note",
            "前端读取剪贴板文本并可作为资源备注使用。",
            vec![permission("clipboard:read", "读取剪贴板文本", "medium")],
            contributes(1, 1, 0, 0),
        ),
        plugin(
            "core-window-switcher",
            "Window Switcher",
            "集中管理桌面窗口导航入口。",
            vec![permission("windows:enumerate", "枚举窗口标题", "high")],
            contributes(1, 1, 0, 0),
        ),
        plugin(
            "core-everything",
            "Everything Search",
            "提供统一的本地文件搜索入口，可连接 Everything 服务扩展索引范围。",
            vec![permission("fs:search", "搜索本地文件", "medium")],
            contributes(1, 1, 0, 0),
        ),
    ];
    #[cfg(not(feature = "lite"))]
    list.push(plugin(
        "core-obsidian",
        "Obsidian",
        "Read-only local vault indexing for Markdown notes and checkbox tasks.",
        vec![
            permission(
                "fs:read-obsidian",
                "Read selected Obsidian vaults",
                "medium",
            ),
            permission(
                "shell:open-obsidian",
                "Open notes through Obsidian protocol",
                "medium",
            ),
        ],
        contributes(1, 1, 0, 1),
    ));
    list
}

fn seed_plugin_states(conn: &Connection) -> Result<(), String> {
    let now = now_string();
    for plugin in default_plugins() {
        let manifest_json = serde_json::to_string(&plugin)
            .map_err(|error| format!("Failed to serialize plugin manifest: {error}"))?;
        conn.execute(
            r#"
            INSERT INTO plugin_states (id, enabled, manifest_json, builtin, updated_at)
            VALUES (?1, ?2, ?3, 1, ?4)
            ON CONFLICT(id) DO UPDATE SET
                manifest_json = excluded.manifest_json,
                builtin = excluded.builtin,
                updated_at = excluded.updated_at
            "#,
            params![
                plugin.id,
                if plugin.enabled { 1 } else { 0 },
                manifest_json,
                now
            ],
        )
        .map_err(|error| format!("Failed to seed plugin state: {error}"))?;
    }
    Ok(())
}

fn read_local_plugin_manifests() -> Result<Vec<PluginManifest>, String> {
    let mut manifests = Vec::new();
    let dir = plugins_dir()?;
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(manifests);
    };

    for entry in entries.flatten() {
        let path = entry.path().join("plugin.json");
        if !path.is_file() {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        match serde_json::from_str::<PluginManifest>(&text) {
            Ok(mut manifest) => {
                manifest.builtin = false;
                manifests.push(manifest);
            }
            Err(error) => {
                let _ = log_plugin_event_raw(
                    "plugin-loader",
                    "error",
                    &format!("Invalid plugin manifest {}: {error}", path.display()),
                );
            }
        }
    }
    Ok(manifests)
}

fn validated_plugin_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("Plugin id cannot be empty".to_string());
    }
    if trimmed.contains("..")
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
    {
        return Err(format!("Invalid plugin id: {trimmed}"));
    }
    Ok(trimmed.to_string())
}

fn local_plugin_dir(plugin_id: &str) -> Result<Option<PathBuf>, String> {
    let plugin_id = validated_plugin_id(plugin_id)?;
    let root = plugins_dir()?;
    let dir = root.join(plugin_id);
    if !dir.exists() {
        return Ok(None);
    }

    let root_canonical = fs::canonicalize(&root)
        .map_err(|error| format!("Failed to resolve plugin root: {error}"))?;
    let dir_canonical = fs::canonicalize(&dir)
        .map_err(|error| format!("Failed to resolve plugin directory: {error}"))?;
    if !dir_canonical.starts_with(root_canonical) {
        return Err("Plugin directory is outside the OrbitStart plugin root".to_string());
    }
    Ok(Some(dir_canonical))
}

#[tauri::command]
fn read_plugin_runtime(id: String) -> Result<Option<PluginRuntimeSource>, String> {
    let requested_id = validated_plugin_id(&id)?;
    let Some(dir) = local_plugin_dir(&id)? else {
        return Ok(None);
    };

    let manifest_path = dir.join("plugin.json");
    let manifest_text = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Failed to read plugin manifest: {error}"))?;
    let manifest: PluginManifest = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("Invalid plugin manifest: {error}"))?;
    let plugin_id = validated_plugin_id(&manifest.id)?;
    if plugin_id != requested_id {
        return Err(format!(
            "Plugin manifest id mismatch: requested {requested_id}, found {plugin_id}"
        ));
    }

    let entries = [
        ("main.js", dir.join("main.js")),
        ("main.ts", dir.join("main.ts")),
    ];
    let Some((entry, path)) = entries.iter().find(|(_, path)| path.is_file()) else {
        return Ok(None);
    };
    let size = fs::metadata(path)
        .map_err(|error| format!("Failed to inspect plugin runtime: {error}"))?
        .len();
    if size > 256 * 1024 {
        return Err(format!(
            "Plugin runtime {entry} is too large ({size} bytes, max 262144)"
        ));
    }
    let source = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read plugin runtime source: {error}"))?;
    Ok(Some(PluginRuntimeSource {
        id: plugin_id,
        entry: entry.to_string(),
        source,
        permissions: manifest
            .permissions
            .iter()
            .map(|permission| permission.id.clone())
            .collect(),
    }))
}

#[tauri::command]
fn record_plugin_runtime_event(
    plugin_id: String,
    level: String,
    message: String,
) -> Result<(), String> {
    let conn = open_db()?;
    let plugin_id =
        validated_plugin_id(&plugin_id).unwrap_or_else(|_| "plugin-runtime".to_string());
    let level = match level.as_str() {
        "info" | "warn" | "error" => level,
        _ => "info".to_string(),
    };
    let message = if message.chars().count() > 1000 {
        format!("{}...", message.chars().take(1000).collect::<String>())
    } else {
        message
    };
    log_plugin_event(&conn, &plugin_id, &level, &message)
}

fn all_plugins(conn: &Connection) -> Result<Vec<PluginManifest>, String> {
    let settings = app_settings(conn)?;
    let mut plugins = default_plugins();
    plugins.extend(read_local_plugin_manifests()?);

    #[cfg(feature = "lite")]
    {
        plugins.retain(|p| {
            p.id != "tips-search"
                && p.id != "obsidian-search"
                && p.id != "workspaces"
                && p.id != "core-obsidian"
        });
    }

    let mut merged = Vec::new();
    for mut plugin in plugins {
        let state: Option<(i64, String)> = conn
            .query_row(
                "SELECT enabled, manifest_json FROM plugin_states WHERE id = ?1",
                params![plugin.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| format!("Failed to read plugin state: {error}"))?;

        if let Some((enabled, _)) = state {
            plugin.enabled = enabled != 0;
        } else {
            let manifest_json = serde_json::to_string(&plugin)
                .map_err(|error| format!("Failed to serialize plugin manifest: {error}"))?;
            conn.execute(
                "INSERT INTO plugin_states (id, enabled, manifest_json, builtin, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![plugin.id, if plugin.enabled { 1 } else { 0 }, manifest_json, if plugin.builtin { 1 } else { 0 }, now_string()],
            )
            .map_err(|error| format!("Failed to save plugin manifest: {error}"))?;
        }

        if settings.safe_mode && !plugin.builtin {
            plugin.enabled = false;
        }
        merged.push(plugin);
    }
    merged.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(merged)
}

fn plugin_enabled(plugins: &[PluginManifest], id: &str) -> bool {
    plugins
        .iter()
        .any(|plugin| plugin.id == id && plugin.enabled)
}

fn default_commands(plugins: &[PluginManifest]) -> Vec<OrbitCommand> {
    let mut commands = Vec::new();
    let mut push =
        |plugin_id: &str, id: &str, title: &str, subtitle: &str, icon: &str, keywords: &[&str]| {
            if plugin_enabled(plugins, plugin_id) {
                commands.push(OrbitCommand {
                    id: id.to_string(),
                    title: title.to_string(),
                    subtitle: subtitle.to_string(),
                    plugin_id: plugin_id.to_string(),
                    icon: icon.to_string(),
                    keywords: keywords.iter().map(|keyword| keyword.to_string()).collect(),
                });
            }
        };

    push(
        "core-items",
        "core.addItem",
        "添加资源",
        "添加应用、文件、文件夹、网址、脚本或动作链",
        "PlusCircle",
        &["add", "new", "import"],
    );
    push(
        "core-actions",
        "core.addActionChain",
        "新建动作链",
        "用多行目标创建一个工作区启动链",
        "Workflow",
        &["chain", "workspace", "automation"],
    );
    push(
        "core-shortcuts",
        "core.scanShortcuts",
        "扫描桌面和开始菜单",
        "导入 Windows .lnk 快捷方式",
        "ScanSearch",
        &["scan", "shortcut"],
    );
    push(
        "core-bookmarks",
        "core.scanBookmarks",
        "导入浏览器书签",
        "扫描 Edge 和 Chrome 书签",
        "Bookmark",
        &["bookmark", "browser", "edge", "chrome"],
    );
    push(
        "core-backup",
        "core.exportJson",
        "导出 JSON",
        "导出本地资源、插件状态和主题设置",
        "Download",
        &["export", "backup"],
    );
    push(
        "core-themes",
        "core.themeStudio",
        "打开主题工作室",
        "选择主题并实时预览变量",
        "Palette",
        &["theme", "style"],
    );
    push(
        "core-plugin-dev",
        "core.createPluginTemplate",
        "创建插件模板",
        "在本地插件目录生成 Hello Command 模板",
        "FileCode2",
        &["plugin", "template", "sdk"],
    );
    push(
        "core-plugin-dev",
        "core.openDataDir",
        "打开数据目录",
        "查看数据库、插件、主题和备份文件",
        "FolderOpen",
        &["data", "plugins", "themes"],
    );
    push(
        "core-command-palette",
        "core.commandPalette",
        "打开命令面板",
        "统一搜索资源、命令和插件结果",
        "Search",
        &["search", "command"],
    );
    commands
}

fn default_theme(
    id: &str,
    name: &str,
    author: &str,
    description: &str,
    tokens: &[(&str, &str)],
) -> ThemeManifest {
    ThemeManifest {
        id: id.to_string(),
        name: name.to_string(),
        author: author.to_string(),
        description: description.to_string(),
        builtin: true,
        tokens: tokens
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect(),
    }
}

fn builtin_themes() -> Vec<ThemeManifest> {
    vec![
        default_theme(
            "local-galaxy",
            "Local Galaxy",
            "OrbitStart",
            "深空、暗金和青绿高光组成的默认桌面 GUI 主题。",
            &[
                ("--font-ui", "\"Segoe UI\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", system-ui, sans-serif"),
                ("--font-title", "\"Noto Serif SC\", \"Source Han Serif SC\", \"Microsoft YaHei UI\", serif"),
                ("--font-mono", "\"IBM Plex Mono\", \"Cascadia Mono\", \"Consolas\", monospace"),
                ("--bg-deep", "#050812"),
                ("--bg-space", "#080d1a"),
                ("--bg-panel", "rgba(12, 18, 34, 0.88)"),
                ("--bg-panel-soft", "rgba(17, 25, 45, 0.74)"),
                ("--bg-card", "rgba(13, 21, 38, 0.82)"),
                ("--text-main", "#f4ebd3"),
                ("--text-soft", "#c9bfa8"),
                ("--text-muted", "#8f9aaf"),
                ("--gold", "#d6a85c"),
                ("--gold-soft", "#b98d48"),
                ("--gold-dim", "rgba(214, 168, 92, 0.38)"),
                ("--teal", "#27d7c6"),
                ("--teal-soft", "#4fe7d8"),
                ("--teal-dim", "rgba(39, 215, 198, 0.28)"),
                ("--star", "#fff2c6"),
                ("--violet", "#7a6cff"),
                ("--nebula", "rgba(125, 96, 190, 0.22)"),
                ("--border-gold", "rgba(214, 168, 92, 0.42)"),
                ("--border-teal", "rgba(39, 215, 198, 0.36)"),
                ("--border-soft", "rgba(255, 242, 198, 0.12)"),
                ("--shadow-panel", "0 18px 60px rgba(0, 0, 0, 0.38)"),
                ("--shadow-glow-teal", "0 0 24px rgba(39, 215, 198, 0.20)"),
                ("--shadow-glow-gold", "0 0 24px rgba(214, 168, 92, 0.18)"),
                ("--bg", "#050812"),
                ("--surface", "rgba(12, 18, 34, 0.88)"),
                ("--surface-strong", "rgba(8, 13, 26, 0.96)"),
                ("--surface-soft", "rgba(255, 242, 198, 0.055)"),
                ("--line", "rgba(255, 242, 198, 0.12)"),
                ("--text", "#f4ebd3"),
                ("--soft", "#c9bfa8"),
                ("--muted", "#8f9aaf"),
                ("--accent", "#27d7c6"),
                ("--accent-2", "#d6a85c"),
                ("--accent-3", "#ff7a90"),
                ("--ok", "#80e6a7"),
            ],
        ),
        default_theme(
            "orbit-dark",
            "Zentou Wireframe",
            "OrbitStart",
            "手绘风格的线框草图，包含方格纸背景、多标签页变体、便签注释。",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-title", "\"Playfair Display\", Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#F5F2EB"),
                ("--bg", "#FAF6EE"),
                ("--app-bg", "#FAF6EE"),
                ("--rail", "#F5F2EB"),
                ("--surface", "#ffffff"),
                ("--surface-2", "#FAF6EE"),
                ("--surface-3", "#F5F2EB"),
                ("--surface-strong", "#ffffff"),
                ("--surface-soft", "#F5F2EB"),
                ("--field", "#ffffff"),
                ("--field-strong", "#ffffff"),
                ("--line", "#1a1a1a"),
                ("--line-strong", "#000000"),
                ("--line-focus", "#e0533c"),
                ("--text", "#1a1a1a"),
                ("--soft", "#444444"),
                ("--muted", "#777777"),
                ("--gold", "#f2c046"),
                ("--teal", "#27ae60"),
                ("--teal-soft", "#2ecc71"),
                ("--danger", "#e0533c"),
                ("--accent", "#e0533c"),
                ("--accent-2", "#f2c046"),
                ("--accent-3", "#fca1a1"),
                ("--ok", "#27ae60"),
                ("--warning", "#f2c046"),
                ("--radius-sm", "4px"),
                ("--radius", "6px"),
                ("--radius-md", "6px"),
                ("--radius-lg", "8px"),
                ("--shadow-card", "2px 2px 0px #1a1a1a"),
                ("--shadow-elevated", "5px 5px 0px #1a1a1a"),
                ("--focus-ring", "0 0 0 3px rgba(224, 83, 60, 0.2)"),
            ],
        ),
        default_theme(
            "ink-blue",
            "People's Platform",
            "OrbitStart",
            "人民平台：块状粗体风格，活动海报能量：奶油色背景上的蓝、橙、红配色。",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "\"Alfa Slab One\", Impact, sans-serif"),
                ("--font-mono", "\"Cascadia Mono\", monospace"),
                ("--bg-deep", "#ECE6D5"),
                ("--bg", "#F7F3E7"),
                ("--app-bg", "#F7F3E7"),
                ("--rail", "#ECE6D5"),
                ("--surface", "#2b3fd4"),
                ("--surface-2", "#3446DF"),
                ("--surface-3", "#F48B29"),
                ("--surface-strong", "#1e2cb0"),
                ("--surface-soft", "rgba(247, 243, 231, 0.08)"),
                ("--field", "#ffffff"),
                ("--field-strong", "#fdfdfd"),
                ("--line", "#18181A"),
                ("--line-strong", "#18181A"),
                ("--line-focus", "#F48B29"),
                ("--text", "#ffffff"),
                ("--soft", "#ECE6D5"),
                ("--muted", "#ECE6D5"),
                ("--accent", "#F48B29"),
                ("--accent-2", "#E33D2D"),
                ("--accent-3", "#2b3fd4"),
                ("--ok", "#26A65B"),
                ("--warning", "#F48B29"),
                ("--danger", "#E33D2D"),
                ("--radius-sm", "4px"),
                ("--radius", "4px"),
                ("--radius-md", "4px"),
                ("--radius-lg", "4px"),
                ("--shadow-card", "4px 4px 0px #18181A"),
                ("--shadow-elevated", "8px 8px 0px #E33D2D"),
                ("--focus-ring", "0 0 0 3px rgba(244, 139, 41, 0.25)"),
            ],
        ),
        default_theme(
            "creative-mode",
            "Creative Mode",
            "OrbitStart",
            "Bold Neo-Brutalist theme with confident multi-tone accents.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "\"Archivo Black\", Impact, sans-serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#e8e3d3"),
                ("--bg", "#f3efe0"),
                ("--app-bg", "#f3efe0"),
                ("--rail", "#f3efe0"),
                ("--surface", "#ffffff"),
                ("--surface-2", "#ece6d5"),
                ("--surface-3", "#dcd6c5"),
                ("--surface-strong", "#ffffff"),
                ("--surface-soft", "#efe8d4"),
                ("--field", "#ffffff"),
                ("--field-strong", "#ffffff"),
                ("--line", "#000000"),
                ("--line-strong", "#000000"),
                ("--line-focus", "#e05929"),
                ("--text", "#000000"),
                ("--soft", "#222222"),
                ("--muted", "#555555"),
                ("--accent", "#1a8f53"),
                ("--accent-2", "#ea5e98"),
                ("--accent-3", "#e05929"),
                ("--ok", "#1a8f53"),
                ("--warning", "#f5b041"),
                ("--danger", "#e05929"),
                ("--radius-sm", "4px"),
                ("--radius", "4px"),
                ("--radius-md", "4px"),
                ("--radius-lg", "4px"),
                ("--shadow-card", "4px 4px 0px #000000"),
                ("--shadow-elevated", "8px 8px 0px #000000"),
                ("--focus-ring", "0 0 0 4px rgba(224, 89, 41, 0.24)"),
            ],
        ),
        default_theme(
            "atelier-zero",
            "Atelier Zero",
            "OrbitStart",
            "Elegant paper-textured theme based on Warm Editorial.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#fbf6ee"),
                ("--bg", "#fbf6ee"),
                ("--app-bg", "#fbf6ee"),
                ("--rail", "#fbf6ee"),
                ("--surface", "#fffdf8"),
                ("--surface-2", "#f1e3cf"),
                ("--surface-3", "#ded2c3"),
                ("--surface-strong", "#fffdf8"),
                ("--surface-soft", "#eee4d7"),
                ("--field", "#fffdf8"),
                ("--field-strong", "#fffdf8"),
                ("--line", "#eee4d7"),
                ("--line-strong", "#ded2c3"),
                ("--line-focus", "#9b5b32"),
                ("--text", "#201914"),
                ("--soft", "#4c4037"),
                ("--muted", "#7a6d63"),
                ("--accent", "#9b5b32"),
                ("--accent-2", "#2f5b4f"),
                ("--accent-3", "#b33a3a"),
                ("--ok", "#4f8a4f"),
                ("--warning", "#c9822f"),
                ("--danger", "#b33a3a"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(32, 25, 20, 0.12)"),
                ("--focus-ring", "0 0 0 4px rgba(155, 91, 50, 0.24)"),
            ],
        ),
        default_theme(
            "atelier-charcoal",
            "Atelier Charcoal",
            "OrbitStart",
            "Elegant graphite and charcoal-toned grey theme.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#eceff3"),
                ("--bg", "#eceff3"),
                ("--app-bg", "#eceff3"),
                ("--rail", "#eceff3"),
                ("--surface", "#f5f7fa"),
                ("--surface-2", "#e2e8f0"),
                ("--surface-3", "#cbd5e1"),
                ("--surface-strong", "#ffffff"),
                ("--surface-soft", "#e2e8f0"),
                ("--field", "#ffffff"),
                ("--field-strong", "#ffffff"),
                ("--line", "#e2e8f0"),
                ("--line-strong", "#cbd5e1"),
                ("--line-focus", "#147d73"),
                ("--text", "#17191f"),
                ("--soft", "#475569"),
                ("--muted", "#64748b"),
                ("--accent", "#147d73"),
                ("--accent-2", "#b86b13"),
                ("--accent-3", "#c73f5c"),
                ("--ok", "#3d7f2e"),
                ("--warning", "#b86b13"),
                ("--danger", "#c73f5c"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(23, 25, 31, 0.08)"),
                ("--focus-ring", "0 0 0 4px rgba(20, 125, 115, 0.2)"),
            ],
        ),
        default_theme(
            "atelier-mint",
            "Atelier Mint",
            "OrbitStart",
            "Quiet and refreshing mint-green editorial layout.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#e3f8ec"),
                ("--bg", "#e3f8ec"),
                ("--app-bg", "#e3f8ec"),
                ("--rail", "#e3f8ec"),
                ("--surface", "#f2fcf7"),
                ("--surface-2", "#d1f2e1"),
                ("--surface-3", "#b4e3cb"),
                ("--surface-strong", "#ffffff"),
                ("--surface-soft", "#d1f2e1"),
                ("--field", "#f2fcf7"),
                ("--field-strong", "#ffffff"),
                ("--line", "#d1f2e1"),
                ("--line-strong", "#b4e3cb"),
                ("--line-focus", "#059669"),
                ("--text", "#102018"),
                ("--soft", "#2f4f3f"),
                ("--muted", "#507563"),
                ("--accent", "#059669"),
                ("--accent-2", "#a16207"),
                ("--accent-3", "#be3a58"),
                ("--ok", "#15803d"),
                ("--warning", "#a16207"),
                ("--danger", "#be3a58"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(16, 32, 24, 0.08)"),
                ("--focus-ring", "0 0 0 4px rgba(5, 150, 105, 0.2)"),
            ],
        ),
        default_theme(
            "atelier-sky",
            "Atelier Sky",
            "OrbitStart",
            "Crisp and clear paper-sky blue layout.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#dff2ff"),
                ("--bg", "#dff2ff"),
                ("--app-bg", "#dff2ff"),
                ("--rail", "#dff2ff"),
                ("--surface", "#f0f8ff"),
                ("--surface-2", "#cde7fc"),
                ("--surface-3", "#b2dafa"),
                ("--surface-strong", "#ffffff"),
                ("--surface-soft", "#cde7fc"),
                ("--field", "#f0f8ff"),
                ("--field-strong", "#ffffff"),
                ("--line", "#cde7fc"),
                ("--line-strong", "#b2dafa"),
                ("--line-focus", "#0284c7"),
                ("--text", "#0f172a"),
                ("--soft", "#334155"),
                ("--muted", "#475569"),
                ("--accent", "#0284c7"),
                ("--accent-2", "#b7791f"),
                ("--accent-3", "#dc4766"),
                ("--ok", "#15803d"),
                ("--warning", "#b7791f"),
                ("--danger", "#dc4766"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(15, 23, 42, 0.08)"),
                ("--focus-ring", "0 0 0 4px rgba(2, 132, 199, 0.2)"),
            ],
        ),
        default_theme(
            "atelier-pink",
            "Atelier Pink",
            "OrbitStart",
            "Warm soft pinkish paper with rose-terracotta highlights.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#fcf5f7"),
                ("--bg", "#fcf5f7"),
                ("--app-bg", "#fcf5f7"),
                ("--rail", "#fcf5f7"),
                ("--surface", "#fff9fb"),
                ("--surface-2", "#f2e1e5"),
                ("--surface-3", "#e6cbd0"),
                ("--surface-strong", "#ffffff"),
                ("--surface-soft", "#f0e2e5"),
                ("--field", "#fff9fb"),
                ("--field-strong", "#ffffff"),
                ("--line", "#f0e2e5"),
                ("--line-strong", "#e6cbd0"),
                ("--line-focus", "#c45873"),
                ("--text", "#2b1b20"),
                ("--soft", "#574046"),
                ("--muted", "#826b71"),
                ("--accent", "#c45873"),
                ("--accent-2", "#3c645c"),
                ("--accent-3", "#b53d3d"),
                ("--ok", "#4fa375"),
                ("--warning", "#cc8e35"),
                ("--danger", "#b53d3d"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(43, 27, 32, 0.08)"),
                ("--focus-ring", "0 0 0 4px rgba(196, 88, 115, 0.24)"),
            ],
        ),
        default_theme(
            "atelier-grey",
            "Atelier Grey",
            "OrbitStart",
            "Quiet cool card grey with deep graphite highlights.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#f1f3f5"),
                ("--bg", "#f1f3f5"),
                ("--app-bg", "#f1f3f5"),
                ("--rail", "#f1f3f5"),
                ("--surface", "#fafbfc"),
                ("--surface-2", "#e9ecef"),
                ("--surface-3", "#dee2e6"),
                ("--surface-strong", "#ffffff"),
                ("--surface-soft", "#e9ecef"),
                ("--field", "#fafbfc"),
                ("--field-strong", "#ffffff"),
                ("--line", "#e9ecef"),
                ("--line-strong", "#dee2e6"),
                ("--line-focus", "#495057"),
                ("--text", "#212529"),
                ("--soft", "#495057"),
                ("--muted", "#6c757d"),
                ("--accent", "#495057"),
                ("--accent-2", "#1e3a8a"),
                ("--accent-3", "#991b1b"),
                ("--ok", "#16a34a"),
                ("--warning", "#d97706"),
                ("--danger", "#dc2626"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(33, 37, 41, 0.08)"),
                ("--focus-ring", "0 0 0 4px rgba(73, 80, 87, 0.24)"),
            ],
        ),
        default_theme(
            "atelier-lavender",
            "Atelier Lavender",
            "OrbitStart",
            "Gentle pale lavender card paper with wisteria-purple accents.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#f5f3f9"),
                ("--bg", "#f5f3f9"),
                ("--app-bg", "#f5f3f9"),
                ("--rail", "#f5f3f9"),
                ("--surface", "#fcfbfe"),
                ("--surface-2", "#e8e4f0"),
                ("--surface-3", "#dad2e6"),
                ("--surface-strong", "#ffffff"),
                ("--surface-soft", "#e8e4f0"),
                ("--field", "#fcfbfe"),
                ("--field-strong", "#ffffff"),
                ("--line", "#e8e4f0"),
                ("--line-strong", "#dad2e6"),
                ("--line-focus", "#6b5ea8"),
                ("--text", "#201c2b"),
                ("--soft", "#484257"),
                ("--muted", "#78718a"),
                ("--accent", "#6b5ea8"),
                ("--accent-2", "#2f5b4f"),
                ("--accent-3", "#a83e3e"),
                ("--ok", "#3b82f6"),
                ("--warning", "#f59e0b"),
                ("--danger", "#ef4444"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(32, 28, 43, 0.08)"),
                ("--focus-ring", "0 0 0 4px rgba(107, 94, 168, 0.24)"),
            ],
        ),
        default_theme(
            "atelier-rust",
            "Atelier Rust",
            "OrbitStart",
            "Grove: Dark forest green canvas with warm rust-red highlights.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#0e1912"),
                ("--bg", "#142319"),
                ("--app-bg", "#142319"),
                ("--rail", "#0e1912"),
                ("--surface", "#1a2d20"),
                ("--surface-2", "#213928"),
                ("--surface-3", "#2a4833"),
                ("--surface-strong", "#1e3425"),
                ("--surface-soft", "rgba(230, 225, 213, 0.045)"),
                ("--field", "#18291d"),
                ("--field-strong", "#1e3425"),
                ("--line", "rgba(230, 225, 213, 0.12)"),
                ("--line-strong", "rgba(230, 225, 213, 0.2)"),
                ("--line-focus", "#bf4f36"),
                ("--text", "#ece8dd"),
                ("--soft", "#c2beaf"),
                ("--muted", "#8e8a7c"),
                ("--accent", "#bf4f36"),
                ("--accent-2", "#e2be8a"),
                ("--accent-3", "#bf4f36"),
                ("--ok", "#5ca873"),
                ("--warning", "#cc893b"),
                ("--danger", "#bf4f36"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(0, 0, 0, 0.45)"),
                ("--focus-ring", "0 0 0 4px rgba(191, 79, 54, 0.24)"),
            ],
        ),
        default_theme(
            "atelier-coal",
            "Atelier Coal",
            "OrbitStart",
            "Obsidian: Dark charcoal space with radiant gold-orange highlights.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#121214"),
                ("--bg", "#161619"),
                ("--app-bg", "#161619"),
                ("--rail", "#121214"),
                ("--surface", "#1e1e22"),
                ("--surface-2", "#2a2a2f"),
                ("--surface-3", "#3a3a41"),
                ("--surface-strong", "#25252a"),
                ("--surface-soft", "rgba(255, 255, 255, 0.045)"),
                ("--field", "#1a1a1e"),
                ("--field-strong", "#25252a"),
                ("--line", "#2a2a2f"),
                ("--line-strong", "#3a3a41"),
                ("--line-focus", "#e0533c"),
                ("--text", "#e5e5e7"),
                ("--soft", "#b2b2b6"),
                ("--muted", "#7e7e82"),
                ("--accent", "#e0533c"),
                ("--accent-2", "#e2be8a"),
                ("--accent-3", "#bf4f36"),
                ("--ok", "#5ca873"),
                ("--warning", "#cc893b"),
                ("--danger", "#bf4f36"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(0, 0, 0, 0.5)"),
                ("--focus-ring", "0 0 0 4px rgba(224, 83, 60, 0.24)"),
            ],
        ),
        default_theme(
            "atelier-abyss",
            "Atelier Abyss",
            "OrbitStart",
            "Abyss: Deep oceanic indigo with high-contrast sky-blue accents.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#0a0d14"),
                ("--bg", "#0f131a"),
                ("--app-bg", "#0f131a"),
                ("--rail", "#0a0d14"),
                ("--surface", "#161b24"),
                ("--surface-2", "#222935"),
                ("--surface-3", "#323b49"),
                ("--surface-strong", "#1b222f"),
                ("--surface-soft", "rgba(255, 255, 255, 0.04)"),
                ("--field", "#121721"),
                ("--field-strong", "#1b222f"),
                ("--line", "#222935"),
                ("--line-strong", "#323b49"),
                ("--line-focus", "#38bdf8"),
                ("--text", "#e2e8f0"),
                ("--soft", "#94a3b8"),
                ("--muted", "#64748b"),
                ("--accent", "#38bdf8"),
                ("--accent-2", "#34d399"),
                ("--accent-3", "#f87171"),
                ("--ok", "#34d399"),
                ("--warning", "#fbbf24"),
                ("--danger", "#f87171"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(0, 0, 0, 0.5)"),
                ("--focus-ring", "0 0 0 4px rgba(56, 189, 248, 0.24)"),
            ],
        ),
        default_theme(
            "atelier-amber",
            "Atelier Amber",
            "OrbitStart",
            "Amber: Cozy charcoal-tea brown with radiant golden highlights.",
            &[
                ("--font-ui", "Inter, system-ui, sans-serif"),
                ("--font-body", "Inter, system-ui, sans-serif"),
                ("--font-title", "Georgia, \"Times New Roman\", serif"),
                ("--font-mono", "\"SF Mono\", ui-monospace, Menlo, monospace"),
                ("--bg-deep", "#120e0a"),
                ("--bg", "#191410"),
                ("--app-bg", "#191410"),
                ("--rail", "#120e0a"),
                ("--surface", "#211b16"),
                ("--surface-2", "#2e2620"),
                ("--surface-3", "#3f352c"),
                ("--surface-strong", "#27201a"),
                ("--surface-soft", "rgba(255, 255, 255, 0.04)"),
                ("--field", "#1c1612"),
                ("--field-strong", "#27201a"),
                ("--line", "#2e2620"),
                ("--line-strong", "#3f352c"),
                ("--line-focus", "#f59e0b"),
                ("--text", "#f5f5f4"),
                ("--soft", "#d6d3d1"),
                ("--muted", "#a8a29e"),
                ("--accent", "#f59e0b"),
                ("--accent-2", "#10b981"),
                ("--accent-3", "#ef4444"),
                ("--ok", "#10b981"),
                ("--warning", "#f59e0b"),
                ("--danger", "#ef4444"),
                ("--radius-sm", "10px"),
                ("--radius", "16px"),
                ("--radius-md", "16px"),
                ("--radius-lg", "24px"),
                ("--shadow-card", "none"),
                ("--shadow-elevated", "0 20px 52px rgba(0, 0, 0, 0.5)"),
                ("--focus-ring", "0 0 0 4px rgba(245, 158, 11, 0.24)"),
            ],
        ),
    ]
}

fn read_local_themes() -> Result<Vec<ThemeManifest>, String> {
    let mut themes = Vec::new();
    let dir = themes_dir()?;
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(themes);
    };

    for entry in entries.flatten() {
        let path = entry.path().join("theme.json");
        if !path.is_file() {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(mut theme) = serde_json::from_str::<ThemeManifest>(&text) {
            theme.builtin = false;
            themes.push(theme);
        }
    }
    Ok(themes)
}

fn all_themes() -> Result<Vec<ThemeManifest>, String> {
    let mut themes = builtin_themes();
    themes.extend(read_local_themes()?);
    Ok(themes)
}

fn make_id(prefix: &str, target: &str) -> String {
    let mut hasher = DefaultHasher::new();
    target.hash(&mut hasher);
    format!("{prefix}-{:x}", hasher.finish())
}

fn extension_lower(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn display_title_from_path(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("Dropped resource")
        .to_string()
}

fn associated_icon_base64(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }

    #[cfg(target_os = "windows")]
    {
        let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$Path = '[PATH_PLACEHOLDER]'
if (-not (Test-Path -LiteralPath $Path)) { exit 0 }
$realPath = $Path
if ($Path.EndsWith('.lnk', [System.StringComparison]::OrdinalIgnoreCase)) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    if ($shortcut -and $shortcut.TargetPath) {
        $realPath = $shortcut.TargetPath
    }
}
if (-not (Test-Path -LiteralPath $realPath)) { exit 0 }
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($realPath)
if (-not $icon) { exit 0 }
$bitmap = $icon.ToBitmap()
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $stream.ToArray()
$stream.Dispose()
$bitmap.Dispose()
$icon.Dispose()
'data:image/png;base64,' + [Convert]::ToBase64String($bytes)
"#;
        let escaped_path = path.to_string_lossy().to_string().replace("'", "''");
        let final_script = script.replace("[PATH_PLACEHOLDER]", &escaped_path);

        let mut cmd = ProcessCommand::new("powershell");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let output = cmd
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &final_script,
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let icon = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if icon.starts_with("data:image/") {
            return Some(icon);
        }
    }

    None
}

fn run_sta_powershell(script: &str) -> Result<Option<String>, String> {
    let mut command = ProcessCommand::new("powershell");
    command.args([
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let output = command
        .output()
        .map_err(|error| format!("Failed to open picker: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Picker was closed before returning a value".to_string()
        } else {
            stderr
        });
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

/// Native file picker using tauri-plugin-dialog (replaces PowerShell-based picker).
/// The PowerShell OpenFileDialog was hidden behind the Tauri window and silently
/// failed for icon/resource selection. This version attaches to the Tauri window.
fn pick_file_path_dialog(
    app: &tauri::AppHandle,
    title: &str,
    extensions: &[&str],
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .add_filter(title, extensions)
        .blocking_pick_file()
        .map(|path| path.to_string());
    Ok(picked)
}

fn pick_folder_path_dialog(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.to_string());
    Ok(picked)
}

fn pick_file_path(filter: &str, title: &str) -> Result<Option<String>, String> {
    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '{title}'
$dialog.Filter = '{filter}'
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
  [Console]::Out.Write($dialog.FileName)
}}
"#
    );
    run_sta_powershell(&script)
}

fn pick_folder_path() -> Result<Option<String>, String> {
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a folder'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
"#;
    run_sta_powershell(script)
}

fn detect_image_mime_type(path: &Path, bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("image/x-icon");
    }

    let text_probe = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_lowercase();
    let text_probe = text_probe.trim_start_matches('\u{feff}').trim_start();
    if text_probe.starts_with("<svg") || text_probe.contains("<svg") {
        return Some("image/svg+xml");
    }

    match extension_lower(path).as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" | "jpe" | "jfif" | "jeng" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn raster_image_to_png_data_url(path: &Path) -> Option<String> {
    let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$Path = '[PATH_PLACEHOLDER]'
if (-not (Test-Path -LiteralPath $Path)) { exit 0 }
$source = $null
$icon = $null
try {
  $extension = [System.IO.Path]::GetExtension($Path).TrimStart('.').ToLowerInvariant()
  if ($extension -eq 'ico') {
    try {
      $icon = New-Object System.Drawing.Icon($Path, 256, 256)
    } catch {
      $icon = New-Object System.Drawing.Icon($Path)
    }
    $source = $icon.ToBitmap()
  } else {
    $source = [System.Drawing.Image]::FromFile($Path)
  }

  if (-not $source -or $source.Width -lt 1 -or $source.Height -lt 1) { exit 0 }
  $maxSize = 128.0
  $ratio = [Math]::Min($maxSize / [double]$source.Width, $maxSize / [double]$source.Height)
  if ($ratio -gt 1.0) { $ratio = 1.0 }
  $width = [Math]::Max(1, [int][Math]::Round($source.Width * $ratio))
  $height = [Math]::Max(1, [int][Math]::Round($source.Height * $ratio))

  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($source, 0, 0, $width, $height)

  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  [Console]::Out.Write('data:image/png;base64,' + [Convert]::ToBase64String($bytes))
} finally {
  if ($graphics) { $graphics.Dispose() }
  if ($bitmap) { $bitmap.Dispose() }
  if ($stream) { $stream.Dispose() }
  if ($source) { $source.Dispose() }
  if ($icon) { $icon.Dispose() }
}
"#;
    let escaped_path = path.to_string_lossy().to_string().replace("'", "''");
    let final_script = script.replace("[PATH_PLACEHOLDER]", &escaped_path);

    let mut cmd = ProcessCommand::new("powershell");
    cmd.creation_flags(0x08000000);
    let output = cmd
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &final_script,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let icon = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if icon.starts_with("data:image/png;base64,") {
        Some(icon)
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn raster_image_to_png_data_url(_path: &Path) -> Option<String> {
    None
}

fn image_file_to_data_url(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("Failed to read image: {error}"))?;
    let mime_type = detect_image_mime_type(path, &bytes).ok_or_else(|| {
        "Unsupported image format. Please choose PNG, JPEG, ICO, GIF, WebP, or SVG.".to_string()
    })?;

    if matches!(
        mime_type,
        "image/png" | "image/jpeg" | "image/gif" | "image/x-icon"
    ) {
        if let Some(data_url) = raster_image_to_png_data_url(path) {
            return Ok(data_url);
        }
    }

    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

#[cfg(test)]
mod image_icon_tests {
    use super::{detect_image_mime_type, image_file_to_data_url};
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn detects_image_mime_from_file_signatures() {
        assert_eq!(
            detect_image_mime_type(Path::new("icon.jeng"), &[0xFF, 0xD8, 0xFF, 0xE0]),
            Some("image/jpeg")
        );
        assert_eq!(
            detect_image_mime_type(
                Path::new("icon.png"),
                &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
            ),
            Some("image/png")
        );
        assert_eq!(
            detect_image_mime_type(Path::new("icon.ico"), &[0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
            Some("image/x-icon")
        );
    }

    #[test]
    fn detects_svg_from_text_payload() {
        assert_eq!(
            detect_image_mime_type(
                Path::new("icon.txt"),
                br#"<?xml version="1.0"?><svg viewBox="0 0 8 8"></svg>"#
            ),
            Some("image/svg+xml")
        );
    }

    #[test]
    fn converts_uploaded_png_to_data_url() {
        let mut path = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        path.push(format!("orbitstart-icon-test-{nonce}.png"));

        let png_1x1: &[u8] = &[
            0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, b'I', b'H',
            b'D', b'R', 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, b'I', b'D', b'A', b'T', 0x78,
            0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99,
            0x3D, 0x1D, 0x00, 0x00, 0x00, 0x00, b'I', b'E', b'N', b'D', 0xAE, 0x42, 0x60, 0x82,
        ];

        fs::write(&path, png_1x1).expect("test png should be writable");
        let data_url =
            image_file_to_data_url(&path).expect("test png should convert to a data URL");
        let _ = fs::remove_file(&path);

        assert!(data_url.starts_with("data:image/png;base64,"));
    }
}

fn item_input_from_dropped_path(path_text: &str) -> OrbitItemInput {
    let path = PathBuf::from(path_text);
    let extension = extension_lower(&path);
    let is_dir = fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false);
    let title = display_title_from_path(&path);
    let icon_base64 = associated_icon_base64(&path);
    let path_string = path.to_string_lossy().to_string();

    let (kind, group, icon, accent, category_tag) = if is_dir {
        ("folder", "work", "FolderOpen", "#8bd450", "folder")
    } else if ["ps1", "bat", "cmd", "sh", "py", "js", "ts", "vbs", "ahk"]
        .contains(&extension.as_str())
    {
        ("script", "scripts", "TerminalSquare", "#41e0a8", "script")
    } else if ["exe", "lnk", "appref-ms", "msi"].contains(&extension.as_str()) {
        ("app", "apps", "AppWindow", "#5cc8ff", "app")
    } else {
        ("file", "work", "FileText", "#f6b95b", "file")
    };

    let mut aliases = vec![title.clone(), path_string.clone()];
    if let Some(parent) = path.parent().and_then(|value| value.to_str()) {
        aliases.push(parent.to_string());
    }

    let mut tags = vec!["drag-drop".to_string(), category_tag.to_string()];
    if !extension.is_empty() {
        tags.push(extension.clone());
    }

    OrbitItemInput {
        title,
        subtitle: path_string.clone(),
        kind: kind.to_string(),
        group: group.to_string(),
        target: path_string,
        arguments: String::new(),
        aliases,
        tags,
        sub_tag: String::new(),
        icon: icon_base64.unwrap_or_else(|| icon.to_string()),
        accent: accent.to_string(),
        favorite: false,
        path_mode: ResourcePathMode::Absolute,
        base_path: None,
    }
}

fn unique_strings(values: Vec<String>) -> Vec<String> {
    let mut result = Vec::new();
    for value in values {
        let clean = value.trim();
        if !clean.is_empty() && !result.iter().any(|existing: &String| existing == clean) {
            result.push(clean.to_string());
        }
    }
    result
}

fn split_group_ids(value: &str) -> Vec<String> {
    unique_strings(value.split(',').map(|part| part.to_string()).collect())
}

fn default_group_for_kind(kind: &str) -> &'static str {
    match kind {
        "app" => "apps",
        "website" => "web",
        "script" => "scripts",
        "file" | "folder" | "action_chain" => "work",
        _ => "work",
    }
}

fn normalize_group_value(value: &str, kind: &str) -> String {
    let groups = split_group_ids(value);
    if groups.is_empty() {
        default_group_for_kind(kind).to_string()
    } else {
        groups.join(",")
    }
}

fn merge_group_values(existing: &str, incoming: &str, kind: &str) -> String {
    let mut groups = split_group_ids(existing);
    groups.extend(split_group_ids(incoming));
    let groups = unique_strings(groups);
    if groups.is_empty() {
        default_group_for_kind(kind).to_string()
    } else {
        groups.join(",")
    }
}

fn merge_string_lists(existing: &[String], incoming: &[String]) -> Vec<String> {
    let mut values = existing.to_vec();
    values.extend(incoming.iter().cloned());
    unique_strings(values)
}

fn insert_item(conn: &Connection, input: &OrbitItemInput) -> Result<OrbitItem, String> {
    if let Some(existing) = get_item_by_target(conn, &input.target)? {
        return merge_existing_item(conn, &existing, input, false);
    }

    let id = make_id(&input.kind, &input.target);
    let now = now_string();
    let group = normalize_group_value(&input.group, &input.kind);
    let (path_mode, base_path) = normalize_item_path_fields(
        &input.kind,
        input.path_mode,
        &input.target,
        input.base_path.as_deref(),
    )?;
    conn.execute(
        r#"
        INSERT OR IGNORE INTO items (
            id, title, subtitle, kind, group_id, target, arguments, aliases_json, tags_json,
            icon, accent, favorite, launch_count, last_launched_at, created_at, updated_at,
            sort_order, sub_tag, path_mode, base_path
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, NULL, ?13, ?13, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM items), ?14, ?15, ?16)
        "#,
        params![
            &id,
            input.title,
            input.subtitle,
            input.kind,
            group,
            input.target,
            input.arguments,
            serde_json::to_string(&input.aliases).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&input.tags).unwrap_or_else(|_| "[]".to_string()),
            input.icon,
            input.accent,
            if input.favorite { 1 } else { 0 },
            now,
            input.sub_tag.trim(),
            resource_path_mode_value(path_mode),
            base_path,
        ],
    )
    .map_err(|error| format!("Failed to insert item: {error}"))?;

    get_item(conn, &id)?.ok_or_else(|| "Failed to read inserted item".to_string())
}

fn upsert_scanned_item(conn: &Connection, input: &OrbitItemInput) -> Result<OrbitItem, String> {
    if let Some(existing) = get_item_by_target(conn, &input.target)? {
        return merge_existing_item(conn, &existing, input, true);
    }

    let id = make_id(&input.kind, &input.target);
    let now = now_string();
    let group = normalize_group_value(&input.group, &input.kind);
    let (path_mode, base_path) = normalize_item_path_fields(
        &input.kind,
        input.path_mode,
        &input.target,
        input.base_path.as_deref(),
    )?;
    conn.execute(
        r#"
        INSERT INTO items (
            id, title, subtitle, kind, group_id, target, arguments, aliases_json, tags_json,
            icon, accent, favorite, launch_count, last_launched_at, created_at, updated_at,
            sort_order, sub_tag, path_mode, base_path
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, NULL, ?13, ?13, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM items), ?14, ?15, ?16)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            subtitle = excluded.subtitle,
            group_id = excluded.group_id,
            aliases_json = excluded.aliases_json,
            tags_json = excluded.tags_json,
            icon = excluded.icon,
            accent = excluded.accent,
            arguments = excluded.arguments,
            sub_tag = CASE WHEN excluded.sub_tag != '' THEN excluded.sub_tag ELSE items.sub_tag END,
            updated_at = excluded.updated_at
        "#,
        params![
            &id,
            input.title,
            input.subtitle,
            input.kind,
            group,
            input.target,
            input.arguments,
            serde_json::to_string(&input.aliases).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&input.tags).unwrap_or_else(|_| "[]".to_string()),
            input.icon,
            input.accent,
            if input.favorite { 1 } else { 0 },
            now,
            input.sub_tag.trim(),
            resource_path_mode_value(path_mode),
            base_path,
        ],
    )
    .map_err(|error| format!("Failed to upsert scanned item: {error}"))?;

    get_item(conn, &id)?.ok_or_else(|| "Failed to read scanned item".to_string())
}

fn get_item(conn: &Connection, id: &str) -> Result<Option<OrbitItem>, String> {
    conn.query_row(
        r#"
        SELECT id, title, subtitle, kind, group_id, target, aliases_json, tags_json,
               icon, accent, favorite, launch_count, last_launched_at, sort_order, arguments, sub_tag,
               path_mode, base_path
        FROM items
        WHERE id = ?1
        "#,
        params![id],
        item_from_row,
    )
    .optional()
    .map_err(|error| format!("Failed to read item: {error}"))
}

fn get_item_by_target(conn: &Connection, target: &str) -> Result<Option<OrbitItem>, String> {
    conn.query_row(
        r#"
        SELECT id, title, subtitle, kind, group_id, target, aliases_json, tags_json,
               icon, accent, favorite, launch_count, last_launched_at, sort_order, arguments, sub_tag,
               path_mode, base_path
        FROM items
        WHERE target = ?1
        "#,
        params![target],
        item_from_row,
    )
    .optional()
    .map_err(|error| format!("Failed to read item by target: {error}"))
}

fn merge_existing_item(
    conn: &Connection,
    existing: &OrbitItem,
    input: &OrbitItemInput,
    update_metadata: bool,
) -> Result<OrbitItem, String> {
    let now = now_string();
    let title = if update_metadata || existing.title.trim().is_empty() {
        input.title.clone()
    } else {
        existing.title.clone()
    };
    let subtitle = if update_metadata || existing.subtitle.trim().is_empty() {
        input.subtitle.clone()
    } else {
        existing.subtitle.clone()
    };
    let kind = if update_metadata {
        input.kind.clone()
    } else {
        existing.kind.clone()
    };
    let incoming_icon_is_placeholder = matches!(
        input.icon.as_str(),
        "AppWindow" | "ExternalLink" | "CircleDot"
    );
    let icon =
        if (update_metadata && !incoming_icon_is_placeholder) || existing.icon.trim().is_empty() {
            input.icon.clone()
        } else {
            existing.icon.clone()
        };
    let accent = if update_metadata || existing.accent.trim().is_empty() {
        input.accent.clone()
    } else {
        existing.accent.clone()
    };
    let arguments = if update_metadata || existing.arguments.trim().is_empty() {
        input.arguments.clone()
    } else {
        existing.arguments.clone()
    };
    let group = merge_group_values(&existing.group, &input.group, &kind);
    let aliases = merge_string_lists(&existing.aliases, &input.aliases);
    let tags = merge_string_lists(&existing.tags, &input.tags);
    let sub_tag = if input.sub_tag.trim().is_empty() {
        existing.sub_tag.clone()
    } else {
        input.sub_tag.trim().to_string()
    };
    let favorite = existing.favorite || input.favorite;

    conn.execute(
        r#"
        UPDATE items
        SET title = ?2,
            subtitle = ?3,
            kind = ?4,
            group_id = ?5,
            aliases_json = ?6,
            tags_json = ?7,
            icon = ?8,
            accent = ?9,
            favorite = ?10,
            updated_at = ?11,
            arguments = ?12,
            sub_tag = ?13
        WHERE id = ?1
        "#,
        params![
            &existing.id,
            title,
            subtitle,
            kind,
            group,
            serde_json::to_string(&aliases).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string()),
            icon,
            accent,
            if favorite { 1 } else { 0 },
            now,
            arguments,
            sub_tag,
        ],
    )
    .map_err(|error| format!("Failed to merge existing item labels: {error}"))?;

    get_item(conn, &existing.id)?.ok_or_else(|| "Item not found after merge".to_string())
}

fn resource_path_mode_value(mode: ResourcePathMode) -> &'static str {
    match mode {
        ResourcePathMode::Absolute => "absolute",
        ResourcePathMode::DataRelative => "data-relative",
        ResourcePathMode::WorkspaceRelative => "workspace-relative",
    }
}

fn resource_path_mode_from_database(value: String) -> ResourcePathMode {
    match value.trim() {
        "data-relative" | "dataRelative" | "data_relative" => ResourcePathMode::DataRelative,
        "workspace-relative" | "workspaceRelative" | "workspace_relative" => {
            ResourcePathMode::WorkspaceRelative
        }
        _ => ResourcePathMode::Absolute,
    }
}

fn item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OrbitItem> {
    let aliases_json: String = row.get(6)?;
    let tags_json: String = row.get(7)?;
    let favorite: i64 = row.get(10)?;
    let launch_count: i64 = row.get(11)?;
    let sort_order: i64 = row.get(13)?;
    let arguments: String = row.get(14)?;
    let sub_tag: String = row.get(15)?;
    let path_mode = resource_path_mode_from_database(row.get::<_, String>(16)?);
    let base_path: Option<String> = row.get(17)?;

    Ok(OrbitItem {
        id: row.get(0)?,
        title: row.get(1)?,
        subtitle: row.get(2)?,
        kind: row.get(3)?,
        group: row.get(4)?,
        target: row.get(5)?,
        arguments,
        aliases: serde_json::from_str(&aliases_json).unwrap_or_default(),
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        icon: row.get(8)?,
        accent: row.get(9)?,
        favorite: favorite != 0,
        launch_count: launch_count.max(0) as u32,
        last_launched_at: row.get(12)?,
        sort_order,
        sub_tag,
        path_mode,
        base_path,
    })
}

fn all_items(conn: &Connection) -> Result<Vec<OrbitItem>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, title, subtitle, kind, group_id, target, aliases_json, tags_json,
                   icon, accent, favorite, launch_count, last_launched_at, sort_order, arguments, sub_tag,
                   path_mode, base_path
            FROM items
            ORDER BY sort_order ASC, title COLLATE NOCASE ASC
            "#,
        )
        .map_err(|error| format!("Failed to prepare item query: {error}"))?;

    let rows = stmt
        .query_map([], item_from_row)
        .map_err(|error| format!("Failed to query items: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to map items: {error}"))
}

fn plugin_logs(conn: &Connection, limit: usize) -> Result<Vec<PluginLog>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, plugin_id, level, message, created_at
            FROM plugin_logs
            ORDER BY CAST(created_at AS INTEGER) DESC
            LIMIT ?1
            "#,
        )
        .map_err(|error| format!("Failed to prepare plugin log query: {error}"))?;
    let rows = stmt
        .query_map(params![limit as i64], |row| {
            Ok(PluginLog {
                id: row.get(0)?,
                plugin_id: row.get(1)?,
                level: row.get(2)?,
                message: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|error| format!("Failed to query plugin logs: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to map plugin logs: {error}"))
}

fn log_plugin_event(
    conn: &Connection,
    plugin_id: &str,
    level: &str,
    message: &str,
) -> Result<(), String> {
    let now = now_string();
    let id = make_id("log", &format!("{plugin_id}:{level}:{message}:{now}"));
    conn.execute(
        "INSERT OR REPLACE INTO plugin_logs (id, plugin_id, level, message, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, plugin_id, level, message, now],
    )
    .map_err(|error| format!("Failed to write plugin log: {error}"))?;
    Ok(())
}

fn log_plugin_event_raw(plugin_id: &str, level: &str, message: &str) -> Result<(), String> {
    let conn = open_db()?;
    log_plugin_event(&conn, plugin_id, level, message)
}

#[tauri::command]
fn catalog_snapshot() -> Result<CatalogSnapshot, String> {
    let conn = open_db()?;
    let plugins = all_plugins(&conn)?;
    Ok(CatalogSnapshot {
        items: all_items(&conn)?,
        groups: all_groups(&conn)?,
        commands: default_commands(&plugins),
        plugins,
        themes: all_themes()?,
        settings: app_settings(&conn)?,
        logs: plugin_logs(&conn, 60)?,
    })
}

#[tauri::command]
fn window_appearance() -> Result<WindowAppearance, String> {
    let conn = open_db()?;
    Ok(WindowAppearance {
        themes: all_themes()?,
        settings: app_settings(&conn)?,
    })
}

fn normalize_trip_category(category: &str) -> String {
    match category {
        "shortcut" | "workflow" | "note" | "status" | "reference" => category.to_string(),
        _ => "note".to_string(),
    }
}

fn normalize_trip_status(category: &str, status: Option<String>) -> Option<String> {
    if category != "status" {
        return None;
    }
    match status.as_deref() {
        Some("todo") | Some("in-progress") | Some("done") | Some("needs-update") => status,
        _ => Some("todo".to_string()),
    }
}

fn normalize_trip_tags(tags: Vec<String>) -> Vec<String> {
    unique_strings(
        tags.into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .take(12)
            .collect(),
    )
}

fn trip_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Trip> {
    let tags_json: String = row.get(6)?;
    let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
    Ok(Trip {
        id: row.get(0)?,
        item_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        category: row.get(4)?,
        status: row.get(5)?,
        tags,
        pinned: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        last_viewed_at: row.get(10)?,
    })
}

fn get_trip(conn: &Connection, id: &str) -> Result<Option<Trip>, String> {
    conn.query_row(
        r#"
        SELECT id, item_id, title, content, category, status, tags, pinned, created_at, updated_at, last_viewed_at
        FROM trips
        WHERE id = ?1
        "#,
        params![id],
        trip_from_row,
    )
    .optional()
    .map_err(|error| format!("Failed to read trip: {error}"))
}

fn all_trips(conn: &Connection) -> Result<Vec<Trip>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, item_id, title, content, category, status, tags, pinned, created_at, updated_at, last_viewed_at
            FROM trips
            ORDER BY pinned DESC, updated_at DESC
            "#,
        )
        .map_err(|error| format!("Failed to prepare trips query: {error}"))?;
    let rows = stmt
        .query_map([], trip_from_row)
        .map_err(|error| format!("Failed to query trips: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to map trips: {error}"))
}

#[tauri::command]
fn list_trips(item_id: String) -> Result<Vec<Trip>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, item_id, title, content, category, status, tags, pinned, created_at, updated_at, last_viewed_at
            FROM trips
            WHERE item_id = ?1
            ORDER BY pinned DESC, updated_at DESC
            "#,
        )
        .map_err(|error| format!("Failed to prepare trip list: {error}"))?;
    let rows = stmt
        .query_map(params![item_id], trip_from_row)
        .map_err(|error| format!("Failed to list trips: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to map trips: {error}"))
}

#[tauri::command]
fn create_trip(
    app: tauri::AppHandle,
    item_id: String,
    title: String,
    content: String,
    category: String,
    status: Option<String>,
    tags: Vec<String>,
    pinned: Option<bool>,
) -> Result<Trip, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Trip title cannot be empty".to_string());
    }
    if title.chars().count() > 50 {
        return Err("Trip title is too long".to_string());
    }
    if content.chars().count() > 4000 {
        return Err("Trip content is too long".to_string());
    }

    let conn = open_db()?;
    let item = get_item(&conn, &item_id)?.ok_or_else(|| "Item not found".to_string())?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM trips WHERE item_id = ?1",
            params![item.id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to count trips: {error}"))?;
    if count >= 50 {
        return Err("Each resource can have at most 50 trips".to_string());
    }

    let category = normalize_trip_category(&category);
    let status = normalize_trip_status(&category, status);
    let tags = normalize_trip_tags(tags);
    let now = now_i64();
    let id = make_id("trip", &format!("{item_id}:{title}:{now}"));
    conn.execute(
        r#"
        INSERT INTO trips (id, item_id, title, content, category, status, tags, pinned, created_at, updated_at, last_viewed_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, NULL)
        "#,
        params![
            id,
            item_id,
            title,
            content,
            category,
            status,
            serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string()),
            if pinned.unwrap_or(false) { 1 } else { 0 },
            now,
        ],
    )
    .map_err(|error| format!("Failed to create trip: {error}"))?;
    log_plugin_event(
        &conn,
        "trips",
        "info",
        &format!("Trip created for {}", item.title),
    )?;
    let _ = app.emit("orbit://trips-changed", ());
    get_trip(&conn, &id)?.ok_or_else(|| "Trip not found after create".to_string())
}

#[tauri::command]
fn update_trip(
    app: tauri::AppHandle,
    id: String,
    title: String,
    content: String,
    category: String,
    status: Option<String>,
    tags: Vec<String>,
    pinned: bool,
) -> Result<Trip, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Trip title cannot be empty".to_string());
    }
    if title.chars().count() > 50 {
        return Err("Trip title is too long".to_string());
    }
    if content.chars().count() > 4000 {
        return Err("Trip content is too long".to_string());
    }
    let conn = open_db()?;
    let category = normalize_trip_category(&category);
    let status = normalize_trip_status(&category, status);
    let tags = normalize_trip_tags(tags);
    let now = now_i64();
    conn.execute(
        r#"
        UPDATE trips
        SET title = ?2,
            content = ?3,
            category = ?4,
            status = ?5,
            tags = ?6,
            pinned = ?7,
            updated_at = ?8
        WHERE id = ?1
        "#,
        params![
            id,
            title,
            content,
            category,
            status,
            serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string()),
            if pinned { 1 } else { 0 },
            now,
        ],
    )
    .map_err(|error| format!("Failed to update trip: {error}"))?;
    let _ = app.emit("orbit://trips-changed", ());
    get_trip(&conn, &id)?.ok_or_else(|| "Trip not found after update".to_string())
}

#[tauri::command]
fn mark_trip_viewed(id: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE trips SET last_viewed_at = ?2 WHERE id = ?1",
        params![&id, now_i64()],
    )
    .map_err(|error| format!("Failed to mark trip viewed: {error}"))?;
    Ok(())
}

#[tauri::command]
fn delete_trip(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM trips WHERE id = ?1", params![&id])
        .map_err(|error| format!("Failed to delete trip: {error}"))?;
    let _ = app.emit("orbit://trips-changed", ());
    Ok(())
}

#[tauri::command]
fn search_trips(query: String) -> Result<Vec<TripSearchResult>, String> {
    let conn = open_db()?;
    let trimmed = query.trim().to_lowercase();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                t.id, t.item_id, t.title, t.content, t.category, t.status, t.tags, t.pinned, t.created_at, t.updated_at, t.last_viewed_at,
                i.title, i.icon, i.kind
            FROM trips t
            LEFT JOIN items i ON i.id = t.item_id
            ORDER BY t.pinned DESC, t.updated_at DESC
            LIMIT 200
            "#,
        )
        .map_err(|error| format!("Failed to prepare trip search: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                trip_from_row(row)?,
                row.get::<_, Option<String>>(11)?
                    .unwrap_or_else(|| "Unknown resource".to_string()),
                row.get::<_, Option<String>>(12)?
                    .unwrap_or_else(|| "Lightbulb".to_string()),
                row.get::<_, Option<String>>(13)?
                    .unwrap_or_else(|| "file".to_string()),
            ))
        })
        .map_err(|error| format!("Failed to query trip search: {error}"))?;

    let mut results = Vec::new();
    for row in rows {
        let (trip, item_title, item_icon, item_kind) =
            row.map_err(|error| format!("Failed to map trip search result: {error}"))?;
        if !trimmed.is_empty() {
            let haystack = format!(
                "{} {} {} {} {}",
                trip.title,
                trip.content,
                trip.category,
                trip.status.clone().unwrap_or_default(),
                trip.tags.join(" ")
            )
            .to_lowercase();
            if !haystack.contains(&trimmed) {
                continue;
            }
        }
        results.push(TripSearchResult {
            item_id: trip.item_id.clone(),
            trip,
            item_title,
            item_icon,
            item_kind,
        });
        if results.len() >= 20 {
            break;
        }
    }
    Ok(results)
}

fn trip_count_for_items_blocking(item_ids: Vec<String>) -> Result<HashMap<String, i64>, String> {
    let conn = open_db()?;
    let mut counts = item_ids
        .iter()
        .map(|id| (id.clone(), 0))
        .collect::<HashMap<_, _>>();

    for chunk in item_ids.chunks(500) {
        if chunk.is_empty() {
            continue;
        }
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT item_id, COUNT(*) FROM trips WHERE item_id IN ({placeholders}) GROUP BY item_id"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|error| format!("Failed to prepare trip count query: {error}"))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|error| format!("Failed to count trips: {error}"))?;
        for row in rows {
            let (item_id, count) =
                row.map_err(|error| format!("Failed to read trip count: {error}"))?;
            counts.insert(item_id, count);
        }
    }
    Ok(counts)
}

#[tauri::command]
async fn trip_count_for_items(item_ids: Vec<String>) -> Result<HashMap<String, i64>, String> {
    tauri::async_runtime::spawn_blocking(move || trip_count_for_items_blocking(item_ids))
        .await
        .map_err(|error| format!("Trip count worker failed: {error}"))?
}

#[tauri::command]
fn reorder_items(app: tauri::AppHandle, ordered_ids: Vec<String>) -> Result<(), String> {
    let mut conn = open_db()?;
    let now = now_string();
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start transaction: {error}"))?;
    for (index, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE items SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
            params![index as i64, &now, id],
        )
        .map_err(|error| format!("Failed to update sort order of item {id}: {error}"))?;
    }
    tx.commit()
        .map_err(|error| format!("Failed to commit transaction: {error}"))?;
    let _ = app.emit("orbit://refresh-resources", ());
    Ok(())
}

fn get_custom_hotkeys(conn: &Connection) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings WHERE key LIKE 'hotkey_binder:%'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut res = Vec::new();
    for (key, value) in rows.flatten() {
        if let Some(group_id) = key.strip_prefix("hotkey_binder:") {
            res.push((group_id.to_string(), value));
        }
    }
    Ok(res)
}

#[tauri::command]
fn reorder_groups(
    app: tauri::AppHandle,
    ordered_ids: Vec<String>,
) -> Result<Vec<OrbitGroup>, String> {
    let mut conn = open_db()?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start transaction: {error}"))?;
    for (index, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE groups SET sort_order = ?1 WHERE id = ?2",
            params![index as i64, id],
        )
        .map_err(|error| format!("Failed to update sort order of group {id}: {error}"))?;
    }
    tx.commit()
        .map_err(|error| format!("Failed to commit transaction: {error}"))?;
    let _ = app.emit("orbit://refresh-resources", ());
    all_groups(&conn)
}

#[tauri::command]
fn get_group_hotkeys() -> Result<std::collections::HashMap<String, String>, String> {
    let conn = open_db()?;
    let items = get_custom_hotkeys(&conn)?;
    let mut map = std::collections::HashMap::new();
    for (group_id, hotkey) in items {
        map.insert(group_id, hotkey);
    }
    Ok(map)
}

#[tauri::command]
fn update_group_hotkey(
    app: tauri::AppHandle,
    group_id: String,
    new_hotkey: Option<String>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;

        let conn = open_db().map_err(|e| e.to_string())?;
        let setting_key = format!("hotkey_binder:{}", group_id);
        let old_hotkey = setting(&conn, &setting_key, "").unwrap_or_default();

        let shortcut_manager = app.global_shortcut();

        if !old_hotkey.is_empty() {
            if let Ok(old_shortcut) = old_hotkey
                .to_lowercase()
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
            {
                let _ = shortcut_manager.unregister(old_shortcut);
            }
        }

        if let Some(ref hotkey) = new_hotkey {
            if !hotkey.is_empty() {
                let new_shortcut = hotkey
                    .to_lowercase()
                    .parse::<tauri_plugin_global_shortcut::Shortcut>()
                    .map_err(|e| format!("解析快捷键失败，格式可能不正确: {}", e))?;

                shortcut_manager
                    .register(new_shortcut)
                    .map_err(|e| format!("快捷键冲突或注册失败: {}", e))?;
            }
        }

        if let Some(ref hotkey) = new_hotkey {
            if !hotkey.is_empty() {
                set_setting_value(&conn, &setting_key, hotkey)?;
            } else {
                conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                    .map_err(|e| e.to_string())?;
            }
        } else {
            conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                .map_err(|e| e.to_string())?;
        }

        let _ = app.emit("orbit://refresh-resources", ());
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let conn = open_db().map_err(|e| e.to_string())?;
        let setting_key = format!("hotkey_binder:{}", group_id);
        if let Some(ref hotkey) = new_hotkey {
            if !hotkey.is_empty() {
                set_setting_value(&conn, &setting_key, hotkey)?;
            } else {
                conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                    .map_err(|e| e.to_string())?;
            }
        } else {
            conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                .map_err(|e| e.to_string())?;
        }
        let _ = app.emit("orbit://refresh-resources", ());
        Ok(())
    }
}

#[tauri::command]
fn get_workspace_hotkeys() -> Result<std::collections::HashMap<String, String>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings WHERE key LIKE 'hotkey_workspace:%'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut map = std::collections::HashMap::new();
    for (key, value) in rows.flatten() {
        if let Some(ws_id) = key.strip_prefix("hotkey_workspace:") {
            map.insert(ws_id.to_string(), value);
        }
    }
    Ok(map)
}

#[tauri::command]
fn update_workspace_hotkey(
    app: tauri::AppHandle,
    workspace_id: String,
    new_hotkey: Option<String>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;

        let conn = open_db().map_err(|e| e.to_string())?;
        let setting_key = format!("hotkey_workspace:{}", workspace_id);
        let old_hotkey = setting(&conn, &setting_key, "").unwrap_or_default();

        let shortcut_manager = app.global_shortcut();

        if !old_hotkey.is_empty() {
            let normalized_old = normalize_hotkey(&old_hotkey);
            if let Ok(old_shortcut) =
                normalized_old.parse::<tauri_plugin_global_shortcut::Shortcut>()
            {
                let _ = shortcut_manager.unregister(old_shortcut);
            }
        }

        if let Some(ref hotkey) = new_hotkey {
            if !hotkey.is_empty() {
                let normalized_new = normalize_hotkey(hotkey);
                let new_shortcut = normalized_new
                    .parse::<tauri_plugin_global_shortcut::Shortcut>()
                    .map_err(|e| format!("解析快捷键失败，格式可能不正确: {}", e))?;

                let _ = shortcut_manager.register(new_shortcut);
            }
        }

        if let Some(ref hotkey) = new_hotkey {
            if !hotkey.is_empty() {
                set_setting_value(&conn, &setting_key, hotkey)?;
            } else {
                conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                    .map_err(|e| e.to_string())?;
            }
        } else {
            conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let conn = open_db().map_err(|e| e.to_string())?;
        let setting_key = format!("hotkey_workspace:{}", workspace_id);
        if let Some(ref hotkey) = new_hotkey {
            if !hotkey.is_empty() {
                set_setting_value(&conn, &setting_key, hotkey)?;
            } else {
                conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                    .map_err(|e| e.to_string())?;
            }
        } else {
            conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[tauri::command]
fn get_subtag_hotkeys() -> Result<std::collections::HashMap<String, String>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings WHERE key LIKE 'hotkey_subtag:%'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut map = std::collections::HashMap::new();
    for (key, value) in rows.flatten() {
        if let Some(subtag_path) = key.strip_prefix("hotkey_subtag:") {
            map.insert(subtag_path.to_string(), value);
        }
    }
    Ok(map)
}

#[tauri::command]
fn update_subtag_hotkey(
    app: tauri::AppHandle,
    subtag_path: String,
    new_hotkey: Option<String>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;

        let conn = open_db().map_err(|e| e.to_string())?;
        let setting_key = format!("hotkey_subtag:{}", subtag_path);
        let old_hotkey = setting(&conn, &setting_key, "").unwrap_or_default();

        let shortcut_manager = app.global_shortcut();

        if !old_hotkey.is_empty() {
            if let Ok(old_shortcut) = old_hotkey
                .to_lowercase()
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
            {
                let _ = shortcut_manager.unregister(old_shortcut);
            }
        }

        if let Some(ref hotkey) = new_hotkey {
            if !hotkey.is_empty() {
                let new_shortcut = hotkey
                    .to_lowercase()
                    .parse::<tauri_plugin_global_shortcut::Shortcut>()
                    .map_err(|e| format!("解析快捷键失败，格式可能不正确: {}", e))?;

                let _ = shortcut_manager.register(new_shortcut);
            }
        }

        if let Some(ref hotkey) = new_hotkey {
            if !hotkey.is_empty() {
                set_setting_value(&conn, &setting_key, hotkey)?;
            } else {
                conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                    .map_err(|e| e.to_string())?;
            }
        } else {
            conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                .map_err(|e| e.to_string())?;
        }

        let _ = app.emit("orbit://refresh-resources", ());
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let conn = open_db().map_err(|e| e.to_string())?;
        let setting_key = format!("hotkey_subtag:{}", subtag_path);
        if let Some(ref hotkey) = new_hotkey {
            if !hotkey.is_empty() {
                set_setting_value(&conn, &setting_key, hotkey)?;
            } else {
                conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                    .map_err(|e| e.to_string())?;
            }
        } else {
            conn.execute("DELETE FROM settings WHERE key = ?1", params![&setting_key])
                .map_err(|e| e.to_string())?;
        }
        let _ = app.emit("orbit://refresh-resources", ());
        Ok(())
    }
}

#[tauri::command]
fn create_item(app: tauri::AppHandle, input: OrbitItemInput) -> Result<OrbitItem, String> {
    let conn = open_db()?;
    let item = insert_item(&conn, &input)?;
    let _ = app.emit("orbit://item-created", item.clone());
    Ok(item)
}

fn create_items_from_paths_with_conn(
    conn: &Connection,
    paths: &[String],
    group: Option<&str>,
) -> Result<Vec<OrbitItem>, String> {
    let destination_group = group
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "all");
    if let Some(group_id) = &destination_group {
        let group_exists = conn
            .query_row(
                "SELECT 1 FROM groups WHERE id = ?1",
                params![group_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| format!("Failed to validate drop target group: {error}"))?
            .is_some();
        if !group_exists {
            return Err(format!("Drop target group does not exist: {group_id}"));
        }
    }

    let mut created = Vec::new();
    for path in paths
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let mut input = item_input_from_dropped_path(path);
        if let Some(group_id) = &destination_group {
            input.group = group_id.clone();
        }
        created.push(insert_item(conn, &input)?);
    }
    Ok(created)
}

#[tauri::command]
fn create_items_from_paths(
    app: tauri::AppHandle,
    paths: Vec<String>,
    group: Option<String>,
) -> Result<Vec<OrbitItem>, String> {
    let conn = open_db()?;
    let created = create_items_from_paths_with_conn(&conn, &paths, group.as_deref())?;
    if !created.is_empty() {
        log_plugin_event(
            &conn,
            "core-shortcuts",
            "info",
            &format!("Drag-drop import completed: {} resources", created.len()),
        )?;
        for item in &created {
            let _ = app.emit("orbit://item-created", item.clone());
        }
    }
    Ok(created)
}

#[cfg(test)]
mod dropped_resource_group_tests {
    use super::*;

    #[test]
    fn assigns_dropped_resources_to_the_requested_group() {
        let mut conn = Connection::open_in_memory().expect("in-memory database should open");
        init_db(&mut conn).expect("in-memory database should initialize");
        let paths = vec![r#"C:\DropTest\DroppedProjectFolder"#.to_string()];

        let created = create_items_from_paths_with_conn(&conn, &paths, Some("apps"))
            .expect("drop import should succeed");

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].group, "apps");
        assert_eq!(
            get_item_by_target(&conn, &paths[0])
                .expect("dropped resource query should succeed")
                .expect("dropped resource should exist")
                .group,
            "apps"
        );
    }

    #[test]
    fn rejects_unknown_drop_target_groups() {
        let mut conn = Connection::open_in_memory().expect("in-memory database should open");
        init_db(&mut conn).expect("in-memory database should initialize");
        let paths = vec![r#"C:\DropTest\UnknownGroupFolder"#.to_string()];

        let result = create_items_from_paths_with_conn(&conn, &paths, Some("missing-group"));
        assert!(result.is_err(), "unknown drop target should fail");
        let error = result.err().expect("drop target error should be present");

        assert!(error.contains("does not exist"));
    }
}

fn obsidian_vault_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ObsidianVaultConfig> {
    let enabled: i64 = row.get(3)?;
    let open_in_obsidian: i64 = row.get(7)?;
    Ok(ObsidianVaultConfig {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        enabled: enabled != 0,
        last_indexed_at: row.get(4)?,
        file_count: row.get::<_, i64>(5)? as u32,
        task_count: row.get::<_, i64>(6)? as u32,
        open_in_obsidian: open_in_obsidian != 0,
        created_at: row.get(8)?,
    })
}

fn get_obsidian_vault(conn: &Connection, id: &str) -> Result<Option<ObsidianVaultConfig>, String> {
    conn.query_row(
        r#"
        SELECT id, name, path, enabled, last_indexed_at, file_count, task_count, open_in_obsidian, created_at
        FROM obsidian_vaults
        WHERE id = ?1
        "#,
        params![id],
        obsidian_vault_from_row,
    )
    .optional()
    .map_err(|error| format!("Failed to get Obsidian vault: {error}"))
}

fn all_obsidian_vaults(conn: &Connection) -> Result<Vec<ObsidianVaultConfig>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, name, path, enabled, last_indexed_at, file_count, task_count, open_in_obsidian, created_at
            FROM obsidian_vaults
            ORDER BY name COLLATE NOCASE ASC
            "#,
        )
        .map_err(|error| format!("Failed to prepare Obsidian vault query: {error}"))?;
    let rows = stmt
        .query_map([], obsidian_vault_from_row)
        .map_err(|error| format!("Failed to query Obsidian vaults: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to map Obsidian vaults: {error}"))
}

fn obsidian_note_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ObsidianNoteIndex> {
    let tags_json: String = row.get(6)?;
    let frontmatter_json: Option<String> = row.get(7)?;
    let task_count: i64 = row.get(10)?;
    let favorite: i64 = row.get(11)?;
    Ok(ObsidianNoteIndex {
        id: row.get(0)?,
        vault_id: row.get(1)?,
        vault_name: row.get(2)?,
        title: row.get(3)?,
        file_path: row.get(4)?,
        relative_path: row.get(5)?,
        tags: serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default(),
        frontmatter: frontmatter_json.and_then(|value| serde_json::from_str(&value).ok()),
        modified_at: row.get(8)?,
        indexed_at: row.get(9)?,
        task_count: task_count.max(0) as u32,
        favorite: favorite != 0,
    })
}

fn obsidian_note_select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
          n.id, n.vault_id, v.name, n.title, n.file_path, n.relative_path,
          n.tags_json, n.frontmatter_json, n.modified_at, n.indexed_at,
          COALESCE(task_counts.task_count, 0), n.favorite
        FROM obsidian_notes n
        JOIN obsidian_vaults v ON v.id = n.vault_id
        LEFT JOIN (
          SELECT note_id, COUNT(*) AS task_count
          FROM obsidian_tasks
          GROUP BY note_id
        ) task_counts ON task_counts.note_id = n.id
        {where_clause}
        ORDER BY n.favorite DESC, n.modified_at DESC, n.title COLLATE NOCASE ASC
        "#
    )
}

fn query_obsidian_notes(
    conn: &Connection,
    vault_id: Option<&str>,
    query: &str,
    limit: usize,
) -> Result<Vec<ObsidianNoteIndex>, String> {
    let vault_filter = vault_id.unwrap_or_default();
    let sql = obsidian_note_select_sql("WHERE (?1 = '' OR n.vault_id = ?1)");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|error| format!("Failed to prepare Obsidian note query: {error}"))?;
    let rows = stmt
        .query_map(params![vault_filter], obsidian_note_from_row)
        .map_err(|error| format!("Failed to query Obsidian notes: {error}"))?;
    let q = query.trim().to_lowercase();
    let mut notes = Vec::new();
    for row in rows {
        let note = row.map_err(|error| format!("Failed to map Obsidian note: {error}"))?;
        if !q.is_empty() {
            let haystack = format!(
                "{} {} {} {}",
                note.title,
                note.relative_path,
                note.vault_name,
                note.tags.join(" ")
            )
            .to_lowercase();
            if !haystack.contains(&q) {
                continue;
            }
        }
        notes.push(note);
        if limit > 0 && notes.len() >= limit {
            break;
        }
    }
    Ok(notes)
}

fn get_obsidian_note(
    conn: &Connection,
    note_id: &str,
) -> Result<Option<ObsidianNoteIndex>, String> {
    let sql = obsidian_note_select_sql("WHERE n.id = ?1");
    conn.query_row(&sql, params![note_id], obsidian_note_from_row)
        .optional()
        .map_err(|error| format!("Failed to lookup Obsidian note: {error}"))
}

fn obsidian_task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ObsidianTask> {
    let completed: i64 = row.get(10)?;
    let tags_json: String = row.get(11)?;
    Ok(ObsidianTask {
        id: row.get(0)?,
        vault_id: row.get(1)?,
        vault_name: row.get(2)?,
        note_id: row.get(3)?,
        note_title: row.get(4)?,
        file_path: row.get(5)?,
        relative_path: row.get(6)?,
        line_number: row.get(7)?,
        raw_text: row.get(8)?,
        text: row.get(9)?,
        completed: completed != 0,
        tags: serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default(),
        due_date: row.get(12)?,
        priority: row.get(13)?,
        completed_at: row.get(14)?,
        modified_at: row.get(15)?,
    })
}

fn query_obsidian_tasks(
    conn: &Connection,
    include_completed: bool,
    query: &str,
    limit: usize,
) -> Result<Vec<ObsidianTask>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              t.id, t.vault_id, v.name, t.note_id, n.title, t.file_path, t.relative_path,
              t.line_number, t.raw_text, t.text, t.completed, t.tags_json, t.due_date,
              t.priority, t.completed_at, t.modified_at
            FROM obsidian_tasks t
            JOIN obsidian_vaults v ON v.id = t.vault_id
            LEFT JOIN obsidian_notes n ON n.id = t.note_id
            WHERE (?1 = 1 OR t.completed = 0)
            ORDER BY
              CASE WHEN t.due_date IS NULL OR t.due_date = '' THEN 1 ELSE 0 END ASC,
              t.due_date ASC,
              CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END ASC,
              t.modified_at DESC
            "#,
        )
        .map_err(|error| format!("Failed to prepare Obsidian task query: {error}"))?;
    let rows = stmt
        .query_map(
            params![if include_completed { 1 } else { 0 }],
            obsidian_task_from_row,
        )
        .map_err(|error| format!("Failed to query Obsidian tasks: {error}"))?;
    let q = query.trim().to_lowercase();
    let mut tasks = Vec::new();
    for row in rows {
        let task = row.map_err(|error| format!("Failed to map Obsidian task: {error}"))?;
        if !q.is_empty() {
            let haystack = format!(
                "{} {} {} {} {}",
                task.text,
                task.note_title,
                task.relative_path,
                task.vault_name,
                task.tags.join(" ")
            )
            .to_lowercase();
            if !haystack.contains(&q) {
                continue;
            }
        }
        tasks.push(task);
        if limit > 0 && tasks.len() >= limit {
            break;
        }
    }
    Ok(tasks)
}

fn normalize_obsidian_vault_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Obsidian vault path cannot be empty".to_string());
    }
    let path = PathBuf::from(trimmed);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve Obsidian vault path: {error}"))?;
    if !canonical.is_dir() {
        return Err("Obsidian vault path is not a folder".to_string());
    }
    Ok(canonical)
}

fn normalize_obsidian_note_relative_path(path: &str) -> Result<String, String> {
    let value = path.trim().replace('\\', "/");
    if value.is_empty() {
        return Ok(String::new());
    }

    let looks_like_windows_drive_path = value.as_bytes().get(1).is_some_and(|byte| *byte == b':')
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic);
    if value.starts_with('/') || looks_like_windows_drive_path || Path::new(&value).is_absolute() {
        return Err("Obsidian note path must be relative to its vault".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(&value).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir | Component::RootDir => {
                return Err("Obsidian note path cannot leave its vault".to_string())
            }
            _ => return Err("Obsidian note path must be relative to its vault".to_string()),
        }
    }

    Ok(normalized.to_string_lossy().replace('\\', "/"))
}

fn resolve_obsidian_note_path(
    vault_root: &Path,
    relative_path: &str,
) -> Result<(PathBuf, String), String> {
    let candidate = vault_root.join(relative_path);
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Obsidian note is unavailable; rescan the vault: {error}"))?;
    if !canonical.starts_with(vault_root) {
        return Err("Obsidian note path resolves outside its vault".to_string());
    }
    let relative = canonical
        .strip_prefix(vault_root)
        .map_err(|_| "Obsidian note path resolves outside its vault".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok((canonical, relative))
}

fn vault_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Obsidian Vault")
        .chars()
        .take(80)
        .collect()
}

fn collect_markdown_files(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skip = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| {
                    matches!(
                        name.to_ascii_lowercase().as_str(),
                        "node_modules" | "target" | "dist" | "build" | ".git" | ".obsidian"
                    )
                })
                .unwrap_or(false);
            if !skip {
                collect_markdown_files(&path, out);
            }
            continue;
        }
        if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}

fn relative_path_for(root: &Path, file: &Path) -> String {
    file.strip_prefix(root)
        .unwrap_or(file)
        .to_string_lossy()
        .replace('\\', "/")
}

fn file_modified_at(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(now_string)
}

fn extract_markdown_title(content: &str, fallback: &Path) -> String {
    for line in content.lines() {
        if let Some(title) = line.trim_start().strip_prefix("# ") {
            let title = title.trim();
            if !title.is_empty() {
                return title.chars().take(120).collect();
            }
        }
    }
    display_title_from_path(fallback)
}

fn extract_frontmatter(content: &str) -> Option<HashMap<String, String>> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let mut values = HashMap::new();
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if !key.is_empty() && !value.is_empty() {
                values.insert(key.to_string(), value.to_string());
            }
        }
    }
    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

fn is_tag_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == '/'
}

fn extract_tags(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut tags = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '#' {
            let before_ok = index == 0
                || chars[index - 1].is_whitespace()
                || matches!(chars[index - 1], '(' | '[' | '{');
            let mut end = index + 1;
            while end < chars.len() && is_tag_char(chars[end]) {
                end += 1;
            }
            if before_ok && end > index + 1 {
                tags.push(chars[index..end].iter().collect::<String>());
                index = end;
                continue;
            }
        }
        index += 1;
    }
    unique_strings(tags)
}

fn find_iso_date_after(text: &str, marker: &str) -> Option<String> {
    let start = text.find(marker)? + marker.len();
    for index in start..text.len().saturating_sub(9) {
        let Some(slice) = text.get(index..index + 10) else {
            continue;
        };
        if slice.chars().enumerate().all(|(i, ch)| {
            if i == 4 || i == 7 {
                ch == '-'
            } else {
                ch.is_ascii_digit()
            }
        }) {
            return Some(slice.to_string());
        }
    }
    None
}

fn extract_due_date(text: &str) -> Option<String> {
    find_iso_date_after(text, "due::").or_else(|| find_iso_date_after(text, "📅"))
}

fn extract_completed_at(text: &str) -> Option<String> {
    find_iso_date_after(text, "✅")
}

fn extract_priority(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    if text.contains("🔺") || lower.contains("priority:: high") {
        Some("high".to_string())
    } else if text.contains("🔼") || lower.contains("priority:: medium") {
        Some("medium".to_string())
    } else if text.contains("🔽") || lower.contains("priority:: low") {
        Some("low".to_string())
    } else {
        None
    }
}

fn clean_obsidian_task_text(text: &str) -> String {
    let due = extract_due_date(text);
    let completed = extract_completed_at(text);
    let mut cleaned = text
        .replace("🔺", "")
        .replace("🔼", "")
        .replace("🔽", "")
        .replace("✅", "")
        .replace("📅", "");
    if let Some(date) = due {
        cleaned = cleaned.replace(&date, "");
    }
    if let Some(date) = completed {
        cleaned = cleaned.replace(&date, "");
    }
    cleaned
        .split_whitespace()
        .filter(|part| {
            !part.starts_with('#') && !part.starts_with("due::") && !part.starts_with("priority::")
        })
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .chars()
        .take(500)
        .collect()
}

fn parse_obsidian_task_line(line: &str) -> Option<(bool, String)> {
    let trimmed = line.trim_start();
    let indent = line.len().saturating_sub(trimmed.len());
    if indent > 2 || trimmed.starts_with('>') {
        return None;
    }
    let rest = trimmed
        .strip_prefix("- [")
        .or_else(|| trimmed.strip_prefix("* ["))
        .or_else(|| trimmed.strip_prefix("-["))
        .or_else(|| trimmed.strip_prefix("*["))?;
    let mut chars = rest.chars();
    let status = chars.next()?;
    if chars.next()? != ']' {
        return None;
    }
    let text = chars.as_str().trim();
    if text.is_empty() {
        return None;
    }
    if !matches!(status, ' ' | 'x' | 'X') {
        return None;
    }
    Some((matches!(status, 'x' | 'X'), text.to_string()))
}

fn parse_obsidian_file(
    vault: &ObsidianVaultConfig,
    vault_root: &Path,
    file: &Path,
    indexed_at: &str,
) -> Result<(ObsidianNoteIndex, Vec<ObsidianTask>), String> {
    let content = fs::read_to_string(file)
        .map_err(|error| format!("Failed to read Markdown file {}: {error}", file.display()))?;
    let relative_path = relative_path_for(vault_root, file);
    let file_path = file.to_string_lossy().to_string();
    let modified_at = file_modified_at(file);
    let title = extract_markdown_title(&content, file);
    let tags = extract_tags(&content);
    let frontmatter = extract_frontmatter(&content);
    let note_id = make_id("obsnote", &format!("{}:{relative_path}", vault.id));
    let mut tasks = Vec::new();
    let mut in_code_block = false;

    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }
        let Some((completed, task_text)) = parse_obsidian_task_line(line) else {
            continue;
        };
        let task_tags = unique_strings([tags.clone(), extract_tags(&task_text)].concat());
        let line_number = (line_index + 1) as i64;
        tasks.push(ObsidianTask {
            id: make_id("obstask", &format!("{}:{line_number}:{task_text}", note_id)),
            vault_id: vault.id.clone(),
            vault_name: vault.name.clone(),
            note_id: note_id.clone(),
            note_title: title.clone(),
            file_path: file_path.clone(),
            relative_path: relative_path.clone(),
            line_number,
            raw_text: line.to_string(),
            text: clean_obsidian_task_text(&task_text),
            completed,
            tags: task_tags,
            due_date: extract_due_date(&task_text),
            priority: extract_priority(&task_text),
            completed_at: extract_completed_at(&task_text),
            modified_at: modified_at.clone(),
        });
    }

    Ok((
        ObsidianNoteIndex {
            id: note_id,
            vault_id: vault.id.clone(),
            vault_name: vault.name.clone(),
            title,
            file_path,
            relative_path,
            tags,
            frontmatter,
            modified_at,
            indexed_at: indexed_at.to_string(),
            task_count: tasks.len() as u32,
            favorite: false,
        },
        tasks,
    ))
}

fn insert_obsidian_note(conn: &Connection, note: &ObsidianNoteIndex) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT OR REPLACE INTO obsidian_notes
          (id, vault_id, title, file_path, relative_path, tags_json, frontmatter_json, modified_at, indexed_at, favorite)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
        params![
            note.id,
            note.vault_id,
            note.title,
            note.file_path,
            note.relative_path,
            serde_json::to_string(&note.tags).unwrap_or_else(|_| "[]".to_string()),
            note.frontmatter.as_ref().and_then(|value| serde_json::to_string(value).ok()),
            note.modified_at,
            note.indexed_at,
            if note.favorite { 1 } else { 0 },
        ],
    )
    .map_err(|error| format!("Failed to save Obsidian note index: {error}"))?;
    Ok(())
}

fn insert_obsidian_task(conn: &Connection, task: &ObsidianTask) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT OR REPLACE INTO obsidian_tasks
          (id, vault_id, note_id, file_path, relative_path, line_number, raw_text, text,
           completed, tags_json, due_date, priority, completed_at, modified_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        "#,
        params![
            task.id,
            task.vault_id,
            task.note_id,
            task.file_path,
            task.relative_path,
            task.line_number,
            task.raw_text,
            task.text,
            if task.completed { 1 } else { 0 },
            serde_json::to_string(&task.tags).unwrap_or_else(|_| "[]".to_string()),
            task.due_date,
            task.priority,
            task.completed_at,
            task.modified_at,
        ],
    )
    .map_err(|error| format!("Failed to save Obsidian task index: {error}"))?;
    Ok(())
}

fn percent_encode_url_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~') {
            encoded.push(ch);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[tauri::command]
fn pick_obsidian_vault_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    pick_folder_path_dialog(&app)
}

#[tauri::command]
fn list_obsidian_vaults() -> Result<Vec<ObsidianVaultConfig>, String> {
    let conn = open_db()?;
    all_obsidian_vaults(&conn)
}

#[tauri::command]
fn add_obsidian_vault(
    app: tauri::AppHandle,
    path: String,
    name: Option<String>,
) -> Result<ObsidianVaultConfig, String> {
    let conn = open_db()?;
    let path = normalize_obsidian_vault_path(&path)?;
    let path_text = path.to_string_lossy().to_string();
    let title = name
        .map(|value| value.trim().chars().take(80).collect::<String>())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| vault_name_from_path(&path));
    let id = make_id("obsvault", &path_text.to_lowercase());
    let now = now_string();
    conn.execute(
        r#"
        INSERT INTO obsidian_vaults
          (id, name, path, enabled, last_indexed_at, file_count, task_count, open_in_obsidian, created_at)
        VALUES (?1, ?2, ?3, 1, NULL, 0, 0, 1, ?4)
        ON CONFLICT(path) DO UPDATE SET
          name = excluded.name,
          enabled = 1
        "#,
        params![id, title, path_text, now],
    )
    .map_err(|error| format!("Failed to save Obsidian vault: {error}"))?;
    let _ = app.emit("orbit://obsidian-changed", ());
    get_obsidian_vault(&conn, &id)?.ok_or_else(|| "Obsidian vault not found after save".to_string())
}

#[tauri::command]
fn remove_obsidian_vault(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "DELETE FROM obsidian_tasks WHERE vault_id = ?1",
        params![&id],
    )
    .map_err(|error| format!("Failed to delete Obsidian task index: {error}"))?;
    conn.execute(
        "DELETE FROM obsidian_notes WHERE vault_id = ?1",
        params![&id],
    )
    .map_err(|error| format!("Failed to delete Obsidian note index: {error}"))?;
    conn.execute("DELETE FROM obsidian_vaults WHERE id = ?1", params![id])
        .map_err(|error| format!("Failed to delete Obsidian vault: {error}"))?;
    let _ = app.emit("orbit://obsidian-changed", ());
    Ok(())
}

#[tauri::command]
fn scan_obsidian_vault(
    app: tauri::AppHandle,
    vault_id: String,
) -> Result<ObsidianScanResult, String> {
    let conn = open_db()?;
    let vault = get_obsidian_vault(&conn, &vault_id)?
        .ok_or_else(|| "Obsidian vault not found".to_string())?;
    let root = normalize_obsidian_vault_path(&vault.path)?;
    let mut files = Vec::new();
    collect_markdown_files(&root, &mut files);
    let indexed_at = now_string();
    let mut note_count = 0_u32;
    let mut task_count = 0_u32;
    let mut note_favorites = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT relative_path, favorite FROM obsidian_notes WHERE vault_id = ?1")
            .map_err(|error| format!("Failed to prepare Obsidian note state query: {error}"))?;
        let rows = stmt
            .query_map(params![&vault.id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? != 0))
            })
            .map_err(|error| format!("Failed to query Obsidian note state: {error}"))?;
        for row in rows {
            let (relative_path, favorite) =
                row.map_err(|error| format!("Failed to map Obsidian note state: {error}"))?;
            note_favorites.insert(relative_path, favorite);
        }
    }
    conn.execute(
        "DELETE FROM obsidian_tasks WHERE vault_id = ?1",
        params![&vault.id],
    )
    .map_err(|error| format!("Failed to clear Obsidian task index: {error}"))?;
    conn.execute(
        "DELETE FROM obsidian_notes WHERE vault_id = ?1",
        params![&vault.id],
    )
    .map_err(|error| format!("Failed to clear Obsidian note index: {error}"))?;
    for file in files {
        let Ok((mut note, tasks)) = parse_obsidian_file(&vault, &root, &file, &indexed_at) else {
            continue;
        };
        note.favorite = note_favorites
            .get(&note.relative_path)
            .copied()
            .unwrap_or(false);
        insert_obsidian_note(&conn, &note)?;
        note_count += 1;
        for task in tasks {
            insert_obsidian_task(&conn, &task)?;
            task_count += 1;
        }
    }
    conn.execute(
        "UPDATE obsidian_vaults SET last_indexed_at = ?2, file_count = ?3, task_count = ?4 WHERE id = ?1",
        params![&vault.id, indexed_at, note_count, task_count],
    )
    .map_err(|error| format!("Failed to update Obsidian vault scan metadata: {error}"))?;
    let _ = app.emit("orbit://obsidian-changed", ());
    let vault = get_obsidian_vault(&conn, &vault.id)?
        .ok_or_else(|| "Obsidian vault not found after scan".to_string())?;
    Ok(ObsidianScanResult {
        vault,
        note_count,
        task_count,
    })
}

#[tauri::command]
fn list_obsidian_tasks(
    include_completed: Option<bool>,
    query: Option<String>,
) -> Result<Vec<ObsidianTask>, String> {
    let conn = open_db()?;
    query_obsidian_tasks(
        &conn,
        include_completed.unwrap_or(false),
        query.as_deref().unwrap_or_default(),
        0,
    )
}

#[tauri::command]
fn list_obsidian_notes(
    vault_id: Option<String>,
    query: Option<String>,
) -> Result<Vec<ObsidianNoteIndex>, String> {
    let conn = open_db()?;
    let vault_filter = vault_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "all");
    query_obsidian_notes(&conn, vault_filter, query.as_deref().unwrap_or_default(), 0)
}

#[tauri::command]
fn toggle_obsidian_note_favorite(
    app: tauri::AppHandle,
    id: String,
    favorite: bool,
) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE obsidian_notes SET favorite = ?2 WHERE id = ?1",
        params![id, if favorite { 1 } else { 0 }],
    )
    .map_err(|error| format!("Failed to update Obsidian note favorite: {error}"))?;
    let _ = app.emit("orbit://obsidian-changed", ());
    Ok(())
}

#[tauri::command]
fn list_obsidian_note_tasks(note_id: String) -> Result<Vec<ObsidianTask>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              t.id, t.vault_id, v.name, t.note_id, n.title, t.file_path, t.relative_path,
              t.line_number, t.raw_text, t.text, t.completed, t.tags_json, t.due_date,
              t.priority, t.completed_at, t.modified_at
            FROM obsidian_tasks t
            JOIN obsidian_vaults v ON v.id = t.vault_id
            LEFT JOIN obsidian_notes n ON n.id = t.note_id
            WHERE t.note_id = ?1
            ORDER BY t.line_number ASC
            "#,
        )
        .map_err(|error| format!("Failed to prepare Obsidian note task query: {error}"))?;
    let rows = stmt
        .query_map(params![note_id], obsidian_task_from_row)
        .map_err(|error| format!("Failed to query Obsidian note tasks: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to map Obsidian note tasks: {error}"))
}

#[tauri::command]
fn toggle_obsidian_task_completion(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<ObsidianTask, String> {
    let conn = open_db()?;
    let task =
        get_obsidian_task(&conn, &task_id)?.ok_or_else(|| "Obsidian task not found".to_string())?;
    let new_completed = !task.completed;
    let file_path = PathBuf::from(&task.file_path);

    // Read file content
    let content = std::fs::read_to_string(&file_path)
        .map_err(|error| format!("Failed to read Obsidian note: {error}"))?;

    // Modify the specific line's checkbox
    let lines: Vec<&str> = content.lines().collect();
    if task.line_number > 0 && (task.line_number as usize) <= lines.len() {
        let line_idx = (task.line_number - 1) as usize;
        let line = lines[line_idx];
        let new_line = if new_completed {
            // Mark as completed: - [ ] -> - [x] or - [ ] -> -[x]
            line.replace("- [ ]", "- [x]").replace("-[ ]", "-[x]")
        } else {
            // Mark as incomplete: - [x] -> - [ ] or -[x] -> -[ ]
            line.replace("- [x]", "- [ ]").replace("-[x]", "-[ ]")
        };

        if new_line != line {
            let mut new_lines = lines.to_vec();
            new_lines[line_idx] = &new_line;
            let new_content = new_lines.join("\n");
            std::fs::write(&file_path, &new_content)
                .map_err(|error| format!("Failed to write Obsidian note: {error}"))?;
        }
    }

    // Update database
    let now = now_string();
    conn.execute(
        "UPDATE obsidian_tasks SET completed = ?2, completed_at = ?3, modified_at = ?4 WHERE id = ?1",
        params![task_id, new_completed as i64, if new_completed { Some(now.clone()) } else { None }, now],
    ).map_err(|error| format!("Failed to update task completion status: {error}"))?;

    // Return updated task
    let updated = get_obsidian_task(&conn, &task_id)?
        .ok_or_else(|| "Task not found after update".to_string())?;

    // Emit change event
    let _ = app.emit("orbit://obsidian-changed", ());

    Ok(updated)
}

fn get_obsidian_task(conn: &Connection, id: &str) -> Result<Option<ObsidianTask>, String> {
    conn.query_row(
        r#"
        SELECT
          t.id, t.vault_id, v.name, t.note_id, n.title, t.file_path, t.relative_path,
          t.line_number, t.raw_text, t.text, t.completed, t.tags_json, t.due_date,
          t.priority, t.completed_at, t.modified_at
        FROM obsidian_tasks t
        JOIN obsidian_vaults v ON v.id = t.vault_id
        LEFT JOIN obsidian_notes n ON n.id = t.note_id
        WHERE t.id = ?1
        "#,
        params![id],
        obsidian_task_from_row,
    )
    .optional()
    .map_err(|error| format!("Failed to lookup Obsidian task: {error}"))
}

#[tauri::command]
fn search_obsidian(query: String) -> Result<Vec<ObsidianSearchResult>, String> {
    let conn = open_db()?;
    let tasks = query_obsidian_tasks(&conn, false, &query, 25)?;
    Ok(tasks
        .into_iter()
        .map(|task| ObsidianSearchResult {
            kind: "task".to_string(),
            id: task.id.clone(),
            title: task.text.clone(),
            subtitle: format!("{} · {}", task.vault_name, task.relative_path),
            icon: "NotebookText".to_string(),
            vault_id: task.vault_id.clone(),
            vault_name: task.vault_name.clone(),
            relative_path: task.relative_path.clone(),
            line_number: Some(task.line_number),
            task: Some(task),
        })
        .collect())
}

#[tauri::command]
fn open_obsidian_note(
    vault_id: String,
    relative_path: String,
    line_number: Option<i64>,
) -> Result<String, String> {
    let conn = open_db()?;
    let vault = get_obsidian_vault(&conn, &vault_id)?
        .ok_or_else(|| "Obsidian vault not found".to_string())?;
    let vault_root = normalize_obsidian_vault_path(&vault.path)?;
    let relative_path = normalize_obsidian_note_relative_path(&relative_path)?;
    if relative_path.is_empty() {
        return launch_target(vault_root.to_string_lossy().to_string());
    }
    let (note_path, relative_path) = resolve_obsidian_note_path(&vault_root, &relative_path)?;
    if vault.open_in_obsidian {
        let mut target = format!(
            "obsidian://open?vault={}&file={}",
            percent_encode_url_component(&vault.name),
            percent_encode_url_component(&relative_path)
        );
        if let Some(line) = line_number.filter(|value| *value > 0) {
            target.push_str("&line=");
            target.push_str(&line.to_string());
        }
        launch_target(target)
    } else {
        launch_target(note_path.to_string_lossy().to_string())
    }
}

#[cfg(desktop)]
#[derive(Debug)]
struct TodoDockState {
    docked: bool,
    suppress_next_move: bool,
}

#[cfg(desktop)]
static TODO_DOCK_STATE: OnceLock<Mutex<TodoDockState>> = OnceLock::new();

#[cfg(desktop)]
fn todo_dock_state() -> &'static Mutex<TodoDockState> {
    TODO_DOCK_STATE.get_or_init(|| {
        Mutex::new(TodoDockState {
            docked: true,
            suppress_next_move: false,
        })
    })
}

#[cfg(desktop)]
fn set_todo_panel_docked(docked: bool) {
    if let Ok(mut state) = todo_dock_state().lock() {
        state.docked = docked;
        state.suppress_next_move = false;
    }
}

#[cfg(desktop)]
fn dock_todo_panel_to_main(app: &tauri::AppHandle, force_docked: bool) {
    let should_dock = {
        let Ok(mut state) = todo_dock_state().lock() else {
            return;
        };
        if force_docked {
            state.docked = true;
        }
        state.docked
    };
    if !should_dock {
        return;
    }

    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    let Some(todo_window) = app.get_webview_window("todo-panel") else {
        return;
    };
    let (Ok(main_position), Ok(main_size)) =
        (main_window.outer_position(), main_window.outer_size())
    else {
        return;
    };

    let next_x = main_position.x + main_size.width as i32 + 8;
    let next_y = main_position.y;
    if let Ok(current_position) = todo_window.outer_position() {
        if (current_position.x - next_x).abs() <= 1 && (current_position.y - next_y).abs() <= 1 {
            return;
        }
    }

    if let Ok(mut state) = todo_dock_state().lock() {
        state.suppress_next_move = true;
    }
    let _ = todo_window.set_position(tauri::PhysicalPosition::new(next_x, next_y));
}

#[cfg(desktop)]
fn handle_todo_window_dock(window: &tauri::Window, event: &WindowEvent) {
    match window.label() {
        "main" => match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                dock_todo_panel_to_main(window.app_handle(), false);
            }
            _ => {}
        },
        "todo-panel" => match event {
            WindowEvent::Moved(_) => {
                if let Ok(mut state) = todo_dock_state().lock() {
                    if state.suppress_next_move {
                        state.suppress_next_move = false;
                    } else {
                        state.docked = false;
                    }
                }
            }
            WindowEvent::Destroyed | WindowEvent::CloseRequested { .. } => {
                set_todo_panel_docked(false);
            }
            _ => {}
        },
        _ => {}
    }
}

#[tauri::command]
async fn open_obsidian_todo_window(app: tauri::AppHandle, note_id: String) -> Result<(), String> {
    let conn = open_db()?;
    let note =
        get_obsidian_note(&conn, &note_id)?.ok_or_else(|| "Obsidian note not found".to_string())?;
    let payload = serde_json::json!({
        "noteId": note.id.clone(),
        "vaultId": note.vault_id.clone(),
        "vaultName": note.vault_name.clone(),
        "relativePath": note.relative_path.clone(),
        "title": note.title.clone()
    });
    if let Some(window) = app.get_webview_window("todo-panel") {
        let _ = window.emit("orbit://todo-note", payload);
        let _ = window.show();
        let _ = window.unminimize();
        #[cfg(desktop)]
        dock_todo_panel_to_main(&app, true);
        let _ = window.set_focus();
        return Ok(());
    }
    let url = format!(
        "index.html?panel=todo&noteId={}&vaultId={}&vaultName={}&relativePath={}&title={}",
        percent_encode_url_component(&note.id),
        percent_encode_url_component(&note.vault_id),
        percent_encode_url_component(&note.vault_name),
        percent_encode_url_component(&note.relative_path),
        percent_encode_url_component(&note.title),
    );
    let mut builder = WebviewWindowBuilder::new(&app, "todo-panel", WebviewUrl::App(url.into()))
        .title("OrbitStart - Todo")
        .inner_size(520.0, 740.0)
        .min_inner_size(400.0, 420.0)
        .max_inner_size(640.0, 1600.0)
        .decorations(false)
        .resizable(true);
    if let Some(main_window) = app.get_webview_window("main") {
        let scale_factor = main_window.scale_factor().unwrap_or(1.0);
        if let (Ok(position), Ok(size)) = (main_window.outer_position(), main_window.outer_size()) {
            builder = builder.position(
                (position.x as f64 + size.width as f64 + 8.0) / scale_factor,
                position.y as f64 / scale_factor,
            );
        } else {
            builder = builder.center();
        }
    } else {
        builder = builder.center();
    }
    builder
        .build()
        .map_err(|error| format!("Failed to open todo window: {error}"))?;
    #[cfg(desktop)]
    {
        set_todo_panel_docked(true);
        dock_todo_panel_to_main(&app, true);
    }
    Ok(())
}

#[tauri::command]
fn set_todo_window_always_on_top(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("todo-panel")
        .ok_or_else(|| "Todo window is not open".to_string())?;
    window
        .set_always_on_top(enabled)
        .map_err(|error| format!("Failed to update todo window pin state: {error}"))
}

#[tauri::command]
fn pick_resource_input(
    app: tauri::AppHandle,
    mode: String,
) -> Result<Option<OrbitItemInput>, String> {
    let picked = if mode == "folder" {
        pick_folder_path_dialog(&app)?
    } else {
        pick_file_path_dialog(
            &app,
            "Applications, shortcuts, scripts, files",
            &[
                "exe",
                "lnk",
                "msi",
                "appref-ms",
                "cmd",
                "bat",
                "ps1",
                "py",
                "js",
                "ts",
                "vbs",
                "ahk",
            ],
        )?
    };
    Ok(picked.map(|path| item_input_from_dropped_path(&path)))
}

#[tauri::command]
fn pick_icon_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = pick_file_path_dialog(
        &app,
        "Images",
        &["png", "jpg", "jpeg", "webp", "gif", "svg", "ico"],
    )?;
    match picked {
        Some(path) => Ok(Some(image_file_to_data_url(Path::new(&path))?)),
        None => Ok(None),
    }
}

#[tauri::command]
fn create_group(app: tauri::AppHandle, title: String) -> Result<Vec<OrbitGroup>, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Group title cannot be empty".to_string());
    }
    let conn = open_db()?;
    let id = make_id("group", title);
    conn.execute(
        "INSERT OR IGNORE INTO groups (id, title, icon, description, custom, sort_order, created_at) VALUES (?1, ?2, 'Bookmark', ?3, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM groups), ?4)",
        params![id, title, format!("自定义标签：{title}"), now_string()],
    )
    .map_err(|error| format!("Failed to create group: {error}"))?;
    let _ = app.emit("orbit://refresh-resources", ());
    all_groups(&conn)
}

#[tauri::command]
fn create_custom_group(
    app: tauri::AppHandle,
    id: String,
    title: String,
    icon: String,
    description: String,
) -> Result<Vec<OrbitGroup>, String> {
    let title = title.trim();
    let id = id.trim();
    if title.is_empty() || id.is_empty() {
        return Err("Group title and ID cannot be empty".to_string());
    }
    let conn = open_db()?;
    conn.execute(
        "INSERT OR IGNORE INTO groups (id, title, icon, description, custom, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM groups), ?5)",
        params![id, title, icon, description, now_string()],
    )
    .map_err(|error| format!("Failed to create custom group: {error}"))?;
    let _ = app.emit("orbit://refresh-resources", ());
    all_groups(&conn)
}

#[tauri::command]
fn delete_group(app: tauri::AppHandle, id: String) -> Result<Vec<OrbitGroup>, String> {
    let conn = open_db()?;
    let custom: i64 = conn
        .query_row(
            "SELECT custom FROM groups WHERE id = ?1",
            params![&id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to check group: {error}"))?;
    if custom == 0 {
        return Err("Built-in groups cannot be deleted".to_string());
    }

    let mut stmt = conn
        .prepare("SELECT id, kind, group_id FROM items")
        .map_err(|error| format!("Failed to prepare item group cleanup: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("Failed to query item groups: {error}"))?;
    let now = now_string();
    for row in rows {
        let (item_id, kind, group_value) =
            row.map_err(|error| format!("Failed to map item group cleanup: {error}"))?;
        let current_groups = split_group_ids(&group_value);
        if !current_groups.iter().any(|group_id| group_id == &id) {
            continue;
        }
        let mut next_groups = current_groups
            .into_iter()
            .filter(|group_id| group_id != &id)
            .collect::<Vec<_>>();
        if next_groups.is_empty() {
            next_groups.push(default_group_for_kind(&kind).to_string());
        }
        conn.execute(
            "UPDATE items SET group_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![item_id, next_groups.join(","), &now],
        )
        .map_err(|error| format!("Failed to remove group from item: {error}"))?;
    }

    conn.execute("DELETE FROM groups WHERE id = ?1", params![&id])
        .map_err(|error| format!("Failed to delete group: {error}"))?;
    let _ = app.emit("orbit://refresh-resources", ());
    all_groups(&conn)
}

#[tauri::command]
fn update_item(app: tauri::AppHandle, item: OrbitItem) -> Result<OrbitItem, String> {
    let conn = open_db()?;
    let id = item.id.clone();
    let now = now_string();
    let group = normalize_group_value(&item.group, &item.kind);
    let (path_mode, base_path) = normalize_item_path_fields(
        &item.kind,
        item.path_mode,
        &item.target,
        item.base_path.as_deref(),
    )?;
    conn.execute(
        r#"
        UPDATE items
        SET title = ?2,
            subtitle = ?3,
            kind = ?4,
            group_id = ?5,
            target = ?6,
            aliases_json = ?7,
            tags_json = ?8,
            icon = ?9,
            accent = ?10,
            favorite = ?11,
            launch_count = ?12,
            last_launched_at = ?13,
            updated_at = ?14,
            arguments = ?15,
            sub_tag = ?16,
            path_mode = ?17,
            base_path = ?18
        WHERE id = ?1
        "#,
        params![
            id,
            item.title,
            item.subtitle,
            item.kind,
            group,
            item.target,
            serde_json::to_string(&item.aliases).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".to_string()),
            item.icon,
            item.accent,
            if item.favorite { 1 } else { 0 },
            item.launch_count,
            item.last_launched_at,
            now,
            item.arguments,
            item.sub_tag.trim(),
            resource_path_mode_value(path_mode),
            base_path,
        ],
    )
    .map_err(|error| format!("Failed to update item: {error}"))?;
    let updated = get_item(&conn, &id)?.ok_or_else(|| "Item not found after update".to_string())?;
    let _ = app.emit("orbit://item-updated", updated.clone());
    Ok(updated)
}

#[tauri::command]
fn delete_item(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM trips WHERE item_id = ?1", params![&id])
        .map_err(|error| format!("Failed to cleanup trips: {error}"))?;
    conn.execute("DELETE FROM items WHERE id = ?1", params![&id])
        .map_err(|error| format!("Failed to delete item: {error}"))?;
    let _ = app.emit("orbit://item-deleted", ItemDeletedEvent { id });
    let _ = app.emit("orbit://trips-changed", ());
    Ok(())
}

#[tauri::command]
fn launch_item(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let conn = open_db()?;
    let item = get_item(&conn, &id)?.ok_or_else(|| "Item not found".to_string())?;
    if item.kind == "action_chain" {
        if item.path_mode != ResourcePathMode::Absolute {
            return Err("Action-chain resources must use the absolute path mode".to_string());
        }
        launch_action_chain(&item.target)?;
    } else {
        let target = resolve_item_target(&item)?;
        if !item.arguments.trim().is_empty() {
            launch_executable_with_args(&target, &item.arguments)?;
        } else {
            launch_target(target)?;
        }
    }
    let now = now_string();
    let settings = app_settings(&conn)?;
    if settings.auto_pinned_mode {
        conn.execute(
            "UPDATE items SET launch_count = launch_count + 1, last_launched_at = ?2, updated_at = ?2, sort_order = (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM items) WHERE id = ?1",
            params![id, now],
        )
        .map_err(|error| format!("Failed to update launch count and sort order: {error}"))?;
        let _ = app.emit("orbit://refresh-resources", ());
    } else {
        conn.execute(
            "UPDATE items SET launch_count = launch_count + 1, last_launched_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )
        .map_err(|error| format!("Failed to update launch count: {error}"))?;
    }
    Ok(format!("已启动：{}", item.title))
}

fn launch_action_chain(targets: &str) -> Result<(), String> {
    let mut launched = 0;
    for target in targets
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
    {
        launch_target(target.to_string())?;
        launched += 1;
    }
    if launched == 0 {
        return Err("Action chain is empty".to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn to_wide_chars(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: *mut std::ffi::c_void,
        lpOperation: *const u16,
        lpFile: *const u16,
        lpParameters: *const u16,
        lpDirectory: *const u16,
        nShowCmd: i32,
    ) -> *mut std::ffi::c_void;
}

#[cfg(target_os = "windows")]
fn resolve_lnk_target(lnk_path: &str) -> Option<String> {
    use lnk::ShellLink;
    let parsed =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ShellLink::open(lnk_path)))
            .ok()
            .and_then(Result::ok);
    if let Some(shortcut) = parsed {
        if let Some(info) = shortcut.link_info() {
            if let Some(path) = info.local_base_path() {
                if !path.trim().is_empty() {
                    return Some(path.clone());
                }
            }
        }
    }

    let escaped = lnk_path.replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}'); if ($s -and $s.TargetPath) {{ [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s.TargetPath }}",
        escaped
    );
    let mut cmd = ProcessCommand::new("powershell.exe");
    cmd.creation_flags(0x08000000);
    let output = cmd
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if resolved.is_empty() {
        None
    } else {
        Some(resolved)
    }
}

#[cfg(target_os = "windows")]
fn explorer_open_path(path: &Path) -> Result<(), String> {
    let mut path_str = path.to_string_lossy().into_owned();
    if path_str.starts_with(r"\\?\") {
        path_str = path_str[4..].to_string();
    }
    ProcessCommand::new("explorer.exe")
        .arg(&path_str)
        .spawn()
        .map_err(|error| format!("Failed to open folder: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn explorer_reveal_path(path: &Path) -> Result<(), String> {
    let display_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut path_str = display_path.to_string_lossy().into_owned();
    if path_str.starts_with(r"\\?\") {
        path_str = path_str[4..].to_string();
    }
    ProcessCommand::new("explorer.exe")
        .arg(format!("/select,{}", path_str))
        .spawn()
        .map_err(|error| format!("Failed to reveal target: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn reveal_existing_path(path: &Path) -> Result<String, String> {
    if path.is_file() {
        explorer_reveal_path(path)?;
        return Ok(format!("已打开所在位置：{}", path.to_string_lossy()));
    }
    if path.is_dir() {
        explorer_open_path(path)?;
        return Ok(format!("已打开文件夹：{}", path.to_string_lossy()));
    }
    Err(format!("Cannot reveal target: {}", path.to_string_lossy()))
}

#[cfg(target_os = "windows")]
fn win_shell_execute(
    target: &str,
    args: Option<&str>,
    working_dir: Option<&str>,
) -> Result<(), String> {
    let target_to_run = target.to_string();
    let target_wide = to_wide_chars(&target_to_run);
    let operation_wide = to_wide_chars("open");

    let args_wide = args.map(to_wide_chars);
    let args_ptr = match &args_wide {
        Some(w) => w.as_ptr(),
        None => std::ptr::null(),
    };

    let custom_dir = working_dir.map(std::path::Path::new);
    let parent_dir = std::path::Path::new(&target_to_run).parent();
    let dir_wide = custom_dir
        .or(parent_dir)
        .filter(|p| p.exists() && p.is_dir())
        .and_then(|p| p.to_str())
        .map(to_wide_chars);
    let dir_ptr = match &dir_wide {
        Some(w) => w.as_ptr(),
        None => std::ptr::null(),
    };

    unsafe {
        let result = ShellExecuteW(
            std::ptr::null_mut(),
            operation_wide.as_ptr(),
            target_wide.as_ptr(),
            args_ptr,
            dir_ptr,
            1, // SW_SHOWNORMAL
        );
        let status = result as usize;
        if status <= 32 {
            return Err(format!("启动失败，Windows 错误代码：{}", status));
        }
    }
    Ok(())
}

#[tauri::command]
fn launch_target(target: String) -> Result<String, String> {
    if target.starts_with("orbit://") {
        return Ok(format!("Orbit action acknowledged: {target}"));
    }

    #[cfg(target_os = "windows")]
    {
        win_shell_execute(&target, None, None)?;
        Ok(format!("已启动：{}", target))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(format!(
            "Launching is currently implemented on Windows only: {target}"
        ))
    }
}

#[tauri::command]
fn launch_target_with_args(
    target: String,
    arguments: Option<String>,
    working_directory: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        win_shell_execute(&target, arguments.as_deref(), working_directory.as_deref())?;
        Ok(format!("已启动：{}", target))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (arguments, working_directory);
        Err(format!(
            "Launching is currently implemented on Windows only: {target}"
        ))
    }
}

fn launch_executable_with_args(target: &str, args_str: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win_shell_execute(target, Some(args_str), None)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (target, args_str);
        Err("Launching with arguments is supported on Windows only".to_string())
    }
}

fn target_path_without_arguments(target: &str) -> String {
    let trimmed = target.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            return rest[..end].to_string();
        }
    }
    let lower = trimmed.to_lowercase();
    for marker in [".exe ", ".lnk ", ".appref-ms ", ".msi "] {
        if let Some(index) = lower.find(marker) {
            return trimmed[..index + marker.trim_end().len()].to_string();
        }
    }
    trimmed.to_string()
}

#[tauri::command]
fn reveal_target(target: String) -> Result<String, String> {
    if target.starts_with("http://") || target.starts_with("https://") || target.contains("://") {
        return launch_target(target);
    }

    // The UI historically supplies only a target string here.  Resolve it
    // through the catalog when it belongs to a stored relative-path resource,
    // while retaining the legacy direct-path behaviour for all other callers.
    let target = match open_db() {
        Ok(conn) => match get_item_by_target(&conn, &target)? {
            Some(item) => resolve_item_target(&item)?,
            None => target,
        },
        Err(_) => target,
    };

    #[cfg(target_os = "windows")]
    {
        let cleaned = target_path_without_arguments(&target);
        let mut candidates = Vec::new();
        if cleaned.to_lowercase().ends_with(".lnk") {
            if let Some(resolved) = resolve_lnk_target(&cleaned) {
                candidates.push(PathBuf::from(target_path_without_arguments(&resolved)));
            }
        }
        candidates.push(PathBuf::from(&cleaned));

        for path in &candidates {
            if path.exists() {
                return reveal_existing_path(path);
            }
        }

        if let Some(parent) = candidates.first().and_then(|path| path.parent()) {
            if parent.is_dir() {
                explorer_open_path(parent)?;
                return Ok(format!("已打开文件夹：{}", parent.to_string_lossy()));
            }
        }
    }

    Err(format!("Cannot reveal target: {target}"))
}

#[tauri::command]
fn get_item_path_status(id: String) -> Result<ResourcePathStatusReport, String> {
    let conn = open_db()?;
    let item = get_item(&conn, &id)?.ok_or_else(|| "Item not found".to_string())?;
    item_path_status(&item)
}

fn shortcut_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        roots.push(PathBuf::from(profile).join("Desktop"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(appdata).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
        roots.push(PathBuf::from(program_data).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    roots
}

fn collect_shortcut_paths(path: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_shortcut_paths(&path, out);
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("lnk"))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}

fn shortcut_signature(path: &Path) -> (i64, i64) {
    let Ok(metadata) = fs::metadata(path) else {
        return (0, 0);
    };
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs() as i64)
        .unwrap_or_default();
    (modified_at, metadata.len() as i64)
}

fn parse_shortcut_cache_entry(path: &Path, modified_at: i64, file_size: i64) -> ShortcutCacheEntry {
    let shortcut_path = path.to_string_lossy().to_string();
    let title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Shortcut")
        .to_string();
    let mut target_path = String::new();
    let mut arguments = String::new();
    let mut working_directory = String::new();
    let mut icon_location = String::new();

    #[cfg(target_os = "windows")]
    {
        use lnk::ShellLink;
        let parsed =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ShellLink::open(path)))
                .ok()
                .and_then(Result::ok);
        if let Some(shortcut) = parsed {
            if let Some(info) = shortcut.link_info() {
                if let Some(value) = info.local_base_path() {
                    target_path = value.clone();
                }
            }
            if target_path.trim().is_empty() {
                target_path = shortcut.relative_path().clone().unwrap_or_default();
            }
            arguments = shortcut.arguments().clone().unwrap_or_default();
            working_directory = shortcut.working_dir().clone().unwrap_or_default();
            icon_location = shortcut.icon_location().clone().unwrap_or_default();
        }
    }

    ShortcutCacheEntry {
        shortcut_path,
        modified_at,
        file_size,
        title,
        target_path,
        arguments,
        working_directory,
        icon_location,
        icon_data: String::new(),
    }
}

fn shortcut_cache_entry_to_input(entry: &ShortcutCacheEntry) -> OrbitItemInput {
    let subtitle = if entry.target_path.trim().is_empty() {
        entry.shortcut_path.clone()
    } else if entry.arguments.trim().is_empty() {
        entry.target_path.clone()
    } else {
        format!("{} {}", entry.target_path, entry.arguments)
    };
    OrbitItemInput {
        title: entry.title.clone(),
        subtitle,
        kind: "app".to_string(),
        group: "apps".to_string(),
        target: entry.shortcut_path.clone(),
        arguments: entry.arguments.clone(),
        aliases: unique_strings(vec![
            entry.target_path.clone(),
            entry.working_directory.clone(),
        ]),
        tags: vec!["shortcut".to_string(), "scan".to_string()],
        sub_tag: String::new(),
        icon: "AppWindow".to_string(),
        accent: "#5cc8ff".to_string(),
        favorite: false,
        path_mode: ResourcePathMode::Absolute,
        base_path: None,
    }
}

fn load_shortcut_scan_cache(
    conn: &Connection,
) -> Result<HashMap<String, ShortcutCacheEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT shortcut_path, modified_at, file_size, title, target_path, arguments, working_directory, icon_location, icon_data FROM shortcut_scan_cache",
        )
        .map_err(|error| format!("Failed to prepare shortcut cache query: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ShortcutCacheEntry {
                shortcut_path: row.get(0)?,
                modified_at: row.get(1)?,
                file_size: row.get(2)?,
                title: row.get(3)?,
                target_path: row.get(4)?,
                arguments: row.get(5)?,
                working_directory: row.get(6)?,
                icon_location: row.get(7)?,
                icon_data: row.get(8)?,
            })
        })
        .map_err(|error| format!("Failed to read shortcut cache: {error}"))?;
    let mut cache = HashMap::new();
    for row in rows {
        let entry = row.map_err(|error| format!("Failed to map shortcut cache: {error}"))?;
        cache.insert(entry.shortcut_path.clone(), entry);
    }
    Ok(cache)
}

fn scan_shortcuts_native_cached_with_conn(
    conn: &mut Connection,
) -> Result<Vec<OrbitItemInput>, String> {
    let mut paths = Vec::new();
    for root in shortcut_roots() {
        collect_shortcut_paths(&root, &mut paths);
    }
    paths.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));

    let cache = load_shortcut_scan_cache(conn)?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start shortcut cache update: {error}"))?;
    let updated_at = now_string();
    let mut found = Vec::with_capacity(paths.len());

    for path in paths {
        let shortcut_path = path.to_string_lossy().to_string();
        let (modified_at, file_size) = shortcut_signature(&path);
        let entry = cache
            .get(&shortcut_path)
            .filter(|entry| entry.modified_at == modified_at && entry.file_size == file_size)
            .cloned()
            .unwrap_or_else(|| parse_shortcut_cache_entry(&path, modified_at, file_size));

        if !cache
            .get(&shortcut_path)
            .map(|cached| cached.modified_at == modified_at && cached.file_size == file_size)
            .unwrap_or(false)
        {
            tx.execute(
                r#"
                INSERT INTO shortcut_scan_cache (
                    shortcut_path, modified_at, file_size, title, target_path, arguments,
                    working_directory, icon_location, icon_data, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '', ?9)
                ON CONFLICT(shortcut_path) DO UPDATE SET
                    modified_at = excluded.modified_at,
                    file_size = excluded.file_size,
                    title = excluded.title,
                    target_path = excluded.target_path,
                    arguments = excluded.arguments,
                    working_directory = excluded.working_directory,
                    icon_location = excluded.icon_location,
                    icon_data = '',
                    updated_at = excluded.updated_at
                "#,
                params![
                    entry.shortcut_path,
                    entry.modified_at,
                    entry.file_size,
                    entry.title,
                    entry.target_path,
                    entry.arguments,
                    entry.working_directory,
                    entry.icon_location,
                    &updated_at,
                ],
            )
            .map_err(|error| format!("Failed to update shortcut cache: {error}"))?;
        }
        found.push(shortcut_cache_entry_to_input(&entry));
    }

    tx.commit()
        .map_err(|error| format!("Failed to commit shortcut cache update: {error}"))?;
    found.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(found)
}

fn scan_shortcuts_native_cached() -> Result<Vec<OrbitItemInput>, String> {
    let mut conn = open_db()?;
    scan_shortcuts_native_cached_with_conn(&mut conn)
}

#[cfg(all(test, target_os = "windows"))]
mod shortcut_scan_tests {
    use super::*;
    use std::collections::HashSet;
    use std::time::Instant;

    #[test]
    fn native_shortcut_scan_uses_cache_and_defers_icons() {
        let mut conn = Connection::open_in_memory().expect("in-memory database should open");
        init_db(&mut conn).expect("in-memory database should initialize");

        let first_started = Instant::now();
        let first = scan_shortcuts_native_cached_with_conn(&mut conn)
            .expect("first native shortcut scan should succeed");
        let first_elapsed = first_started.elapsed();
        assert!(
            !first.is_empty(),
            "Windows shortcut roots should contain entries"
        );
        assert!(
            first
                .iter()
                .all(|item| !item.icon.starts_with("data:image/")),
            "preview scan must not eagerly embed image data"
        );

        let cached_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM shortcut_scan_cache", [], |row| {
                row.get(0)
            })
            .expect("shortcut cache should be queryable");
        let unique_shortcut_paths = first
            .iter()
            .map(|item| item.target.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(
            cached_rows as usize,
            unique_shortcut_paths.len(),
            "cache rows are keyed by shortcut path, while overlapping scan roots may yield duplicate previews"
        );

        let second_started = Instant::now();
        let second = scan_shortcuts_native_cached_with_conn(&mut conn)
            .expect("cached native shortcut scan should succeed");
        let second_elapsed = second_started.elapsed();
        assert_eq!(first.len(), second.len());

        let cache = load_shortcut_scan_cache(&conn).expect("shortcut cache should load");
        let icon_requests = cache
            .values()
            .filter(|entry| {
                !entry.target_path.trim().is_empty() && Path::new(&entry.target_path).is_file()
            })
            .take(12)
            .enumerate()
            .map(|(index, entry)| IconHydrationInput {
                key: format!("icon-test-{index}"),
                shortcut: entry.shortcut_path.clone(),
                source: entry.target_path.clone(),
            })
            .collect::<Vec<_>>();
        assert!(
            !icon_requests.is_empty(),
            "icon test requires a resolvable shortcut"
        );
        let icons = extract_shortcut_icons_batch(&icon_requests)
            .expect("background icon extraction should succeed");
        assert!(
            !icons.is_empty(),
            "at least one associated icon should be extracted"
        );
        println!(
            "native shortcut scan: entries={}, first_ms={}, cached_ms={}, sampled_icons={}",
            first.len(),
            first_elapsed.as_millis(),
            second_elapsed.as_millis(),
            icons.len()
        );
    }
}

fn scan_shortcuts_blocking() -> Result<Vec<OrbitItem>, String> {
    let found = scan_shortcuts_native_cached()?;
    import_scanned_items_blocking(found)?;
    let conn = open_db()?;
    log_plugin_event(&conn, "core-shortcuts", "info", "Shortcut scan completed")?;
    all_items(&conn)
}

#[tauri::command]
async fn scan_shortcuts() -> Result<Vec<OrbitItem>, String> {
    tauri::async_runtime::spawn_blocking(scan_shortcuts_blocking)
        .await
        .map_err(|error| format!("Shortcut scan worker failed: {error}"))?
}

fn bookmark_files() -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local);
        files.push(base.join("Microsoft\\Edge\\User Data\\Default\\Bookmarks"));
        files.push(base.join("Google\\Chrome\\User Data\\Default\\Bookmarks"));
    }
    files
}

fn collect_bookmarks(node: &serde_json::Value, out: &mut Vec<OrbitItemInput>) {
    if let Some(url) = node.get("url").and_then(|value| value.as_str()) {
        let title = node
            .get("name")
            .and_then(|value| value.as_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(url);
        out.push(OrbitItemInput {
            title: title.to_string(),
            subtitle: url.to_string(),
            kind: "website".to_string(),
            group: "web".to_string(),
            target: url.to_string(),
            arguments: String::new(),
            aliases: vec![title.to_string()],
            tags: vec!["bookmark".to_string(), "browser".to_string()],
            sub_tag: String::new(),
            icon: "Globe".to_string(),
            accent: "#37d6bf".to_string(),
            favorite: false,
            path_mode: ResourcePathMode::Absolute,
            base_path: None,
        });
    }

    if let Some(children) = node.get("children").and_then(|value| value.as_array()) {
        for child in children {
            collect_bookmarks(child, out);
        }
    }
}

fn scan_browser_bookmarks_blocking() -> Result<Vec<OrbitItem>, String> {
    let conn = open_db()?;
    let mut found = Vec::new();
    for path in bookmark_files() {
        if !path.is_file() {
            continue;
        }
        let text = fs::read_to_string(path).unwrap_or_default();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(roots) = value.get("roots").and_then(|roots| roots.as_object()) {
                for root in roots.values() {
                    collect_bookmarks(root, &mut found);
                }
            }
        }
    }

    for input in found {
        let _ = upsert_scanned_item(&conn, &input);
    }
    log_plugin_event(
        &conn,
        "core-bookmarks",
        "info",
        "Browser bookmark import completed",
    )?;
    all_items(&conn)
}

#[tauri::command]
async fn scan_browser_bookmarks() -> Result<Vec<OrbitItem>, String> {
    tauri::async_runtime::spawn_blocking(scan_browser_bookmarks_blocking)
        .await
        .map_err(|error| format!("Bookmark scan worker failed: {error}"))?
}

#[tauri::command]
fn update_global_hotkey(app: tauri::AppHandle, new_hotkey: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;

        let conn = open_db().map_err(|e| e.to_string())?;
        let old_hotkey = setting(&conn, "global_hotkey", "Ctrl+Alt+Space")?;

        let old_shortcut = old_hotkey
            .to_lowercase()
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .map_err(|e| format!("解析旧快捷键失败: {}", e))?;

        let new_shortcut = new_hotkey
            .to_lowercase()
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .map_err(|e| format!("解析新快捷键失败，格式可能不正确: {}", e))?;

        let shortcut_manager = app.global_shortcut();

        // 尝试注册新快捷键，看是否冲突或格式无效
        shortcut_manager
            .register(new_shortcut)
            .map_err(|e| format!("快捷键冲突或注册失败: {}", e))?;

        // 注册成功，注销老快捷键
        let _ = shortcut_manager.unregister(old_shortcut);

        // 保存新配置到数据库
        set_setting_value(&conn, "global_hotkey", &new_hotkey)?;
        cache_settings_from_connection(&app, &conn)?;
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let conn = open_db().map_err(|e| e.to_string())?;
        set_setting_value(&conn, "global_hotkey", &new_hotkey)?;
        cache_settings_from_connection(&app, &conn)?;
        Ok(())
    }
}

#[tauri::command]
async fn preview_scan_shortcuts() -> Result<Vec<OrbitItemInput>, String> {
    tauri::async_runtime::spawn_blocking(scan_shortcuts_native_cached)
        .await
        .map_err(|error| format!("Shortcut preview worker failed: {error}"))?
}

fn preview_scan_browser_bookmarks_blocking() -> Result<Vec<OrbitItemInput>, String> {
    let mut found = Vec::new();
    for path in bookmark_files() {
        if !path.is_file() {
            continue;
        }
        let text = fs::read_to_string(path).unwrap_or_default();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(roots) = value.get("roots").and_then(|roots| roots.as_object()) {
                for root in roots.values() {
                    collect_bookmarks(root, &mut found);
                }
            }
        }
    }
    found.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(found)
}

#[tauri::command]
async fn preview_scan_browser_bookmarks() -> Result<Vec<OrbitItemInput>, String> {
    tauri::async_runtime::spawn_blocking(preview_scan_browser_bookmarks_blocking)
        .await
        .map_err(|error| format!("Bookmark preview worker failed: {error}"))?
}

fn extract_shortcut_icons_batch(
    requests: &[IconHydrationInput],
) -> Result<HashMap<String, String>, String> {
    if requests.is_empty() {
        return Ok(HashMap::new());
    }
    let json = serde_json::to_vec(requests)
        .map_err(|error| format!("Failed to serialize icon requests: {error}"))?;
    let encoded = general_purpose::STANDARD.encode(json);
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_ICON_INPUT))
$requests = ConvertFrom-Json -InputObject $json
$output = foreach ($request in $requests) {
  try {
    $source = [string]$request.Source
    $shortcut = [string]$request.Shortcut
    if (-not $source -or -not (Test-Path -LiteralPath $source)) {
      $source = $shortcut
      if ($shortcut.EndsWith('.lnk', [System.StringComparison]::OrdinalIgnoreCase)) {
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut($shortcut)
        if ($link -and $link.TargetPath -and (Test-Path -LiteralPath $link.TargetPath)) {
          $source = [string]$link.TargetPath
        }
      }
    }
    if (-not $source -or -not (Test-Path -LiteralPath $source)) { continue }
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($source)
    if (-not $icon) { continue }
    $bitmap = $icon.ToBitmap()
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    $stream.Dispose()
    $bitmap.Dispose()
    $icon.Dispose()
    [pscustomobject]@{
      Key = [string]$request.Key
      Icon = 'data:image/png;base64,' + [Convert]::ToBase64String($bytes)
    }
  } catch {}
}
[Console]::Out.Write((ConvertTo-Json -InputObject @($output) -Compress -Depth 3))
"#;
    let mut cmd = ProcessCommand::new("powershell.exe");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let output = cmd
        .env("ORBIT_ICON_INPUT", encoded)
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(|error| format!("Failed to run icon worker: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let stdout_text = String::from_utf8_lossy(&output.stdout);
    let stdout = stdout_text.trim_start_matches('\u{feff}').trim();
    if stdout.is_empty() || stdout == "null" {
        return Ok(HashMap::new());
    }
    let value: serde_json::Value = serde_json::from_str(stdout)
        .map_err(|error| format!("Failed to parse icon worker output: {error}"))?;
    let values = match value {
        serde_json::Value::Array(values) => values,
        value => vec![value],
    };
    let mut icons = HashMap::new();
    for value in values {
        let item: IconHydrationOutput = serde_json::from_value(value)
            .map_err(|error| format!("Failed to map icon worker output: {error}"))?;
        if item.icon.starts_with("data:image/") {
            icons.insert(item.key, item.icon);
        }
    }
    Ok(icons)
}

fn hydrate_shortcut_icons_blocking(item_ids: Vec<String>) -> Result<usize, String> {
    if item_ids.is_empty() {
        return Ok(0);
    }
    let wanted = item_ids.into_iter().collect::<HashSet<_>>();
    let mut conn = open_db()?;
    let cache = load_shortcut_scan_cache(&conn)?;
    let items = all_items(&conn)?;
    let mut ready = Vec::<(String, String, String)>::new();
    let mut requests = Vec::<IconHydrationInput>::new();

    for item in items {
        if !wanted.contains(&item.id)
            || !item.target.to_lowercase().ends_with(".lnk")
            || item.icon.starts_with("data:image/")
        {
            continue;
        }
        if let Some(cached) = cache.get(&item.target) {
            if cached.icon_data.starts_with("data:image/") {
                ready.push((item.id, item.target, cached.icon_data.clone()));
                continue;
            }
            requests.push(IconHydrationInput {
                key: item.id,
                shortcut: item.target,
                source: cached.target_path.clone(),
            });
        } else {
            let source = resolve_lnk_target(&item.target).unwrap_or_default();
            requests.push(IconHydrationInput {
                key: item.id,
                shortcut: item.target,
                source,
            });
        }
    }

    let request_targets = requests
        .iter()
        .map(|request| (request.key.clone(), request.shortcut.clone()))
        .collect::<HashMap<_, _>>();
    for chunk in requests.chunks(64) {
        for (item_id, icon) in extract_shortcut_icons_batch(chunk)? {
            if let Some(shortcut_path) = request_targets.get(&item_id) {
                ready.push((item_id, shortcut_path.clone(), icon));
            }
        }
    }

    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start icon cache update: {error}"))?;
    let updated_at = now_string();
    let mut updated = 0;
    for (item_id, shortcut_path, icon) in ready {
        tx.execute(
            "UPDATE items SET icon = ?2, updated_at = ?3 WHERE id = ?1",
            params![item_id, icon, &updated_at],
        )
        .map_err(|error| format!("Failed to update resource icon: {error}"))?;
        tx.execute(
            "UPDATE shortcut_scan_cache SET icon_data = ?2, updated_at = ?3 WHERE shortcut_path = ?1",
            params![shortcut_path, icon, &updated_at],
        )
        .map_err(|error| format!("Failed to update shortcut icon cache: {error}"))?;
        updated += 1;
    }
    tx.commit()
        .map_err(|error| format!("Failed to commit icon cache update: {error}"))?;
    Ok(updated)
}

#[tauri::command]
async fn hydrate_shortcut_icons(item_ids: Vec<String>) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || hydrate_shortcut_icons_blocking(item_ids))
        .await
        .map_err(|error| format!("Icon hydration worker failed: {error}"))?
}

fn import_scanned_items_with_conn(
    conn: &mut Connection,
    items: Vec<OrbitItemInput>,
) -> Result<ImportResult, String> {
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start scanned item import: {error}"))?;
    let mut inserted = 0;
    let mut updated = 0;
    let mut skipped = 0;
    let mut item_ids = Vec::new();
    let mut seen_targets = HashSet::new();

    for input in items {
        if !seen_targets.insert(input.target.clone()) {
            skipped += 1;
            continue;
        }
        let existed = get_item_by_target(&tx, &input.target)?.is_some();
        let item = upsert_scanned_item(&tx, &input)?;
        if existed {
            updated += 1;
        } else {
            inserted += 1;
        }
        item_ids.push(item.id);
    }

    tx.commit()
        .map_err(|error| format!("Failed to commit scanned item import: {error}"))?;
    Ok(ImportResult {
        imported: inserted + updated,
        inserted,
        updated,
        skipped,
        trips_imported: 0,
        item_ids,
    })
}

fn import_scanned_items_blocking(items: Vec<OrbitItemInput>) -> Result<ImportResult, String> {
    let mut conn = open_db()?;
    import_scanned_items_with_conn(&mut conn, items)
}

#[cfg(test)]
mod import_batch_tests {
    use super::*;
    use std::time::Instant;

    fn scanned_input(index: usize) -> OrbitItemInput {
        OrbitItemInput {
            title: format!("Performance item {index}"),
            subtitle: format!(r#"C:\Performance\item-{index}.lnk"#),
            kind: "app".to_string(),
            group: "apps".to_string(),
            target: format!(r#"C:\Performance\item-{index}.lnk"#),
            arguments: String::new(),
            aliases: vec![format!("item-{index}")],
            tags: vec!["shortcut".to_string(), "scan".to_string()],
            sub_tag: String::new(),
            icon: "AppWindow".to_string(),
            accent: "#5cc8ff".to_string(),
            favorite: false,
            path_mode: ResourcePathMode::Absolute,
            base_path: None,
        }
    }

    #[test]
    fn imports_five_hundred_items_in_one_transaction() {
        let mut conn = Connection::open_in_memory().expect("in-memory database should open");
        init_db(&mut conn).expect("in-memory database should initialize");
        let inputs = (0..500).map(scanned_input).collect::<Vec<_>>();
        let started = Instant::now();
        let first = import_scanned_items_with_conn(&mut conn, inputs.clone())
            .expect("bulk insert should succeed");
        let insert_elapsed = started.elapsed();
        assert_eq!(first.inserted, 500);
        assert_eq!(first.updated, 0);
        assert_eq!(first.skipped, 0);

        let duplicate_started = Instant::now();
        let second =
            import_scanned_items_with_conn(&mut conn, inputs).expect("bulk update should succeed");
        let update_elapsed = duplicate_started.elapsed();
        assert_eq!(second.inserted, 0);
        assert_eq!(second.updated, 500);
        println!(
            "bulk import: items=500, insert_ms={}, update_ms={}",
            insert_elapsed.as_millis(),
            update_elapsed.as_millis()
        );
    }

    #[test]
    fn skips_duplicate_targets_inside_a_batch() {
        let mut conn = Connection::open_in_memory().expect("in-memory database should open");
        init_db(&mut conn).expect("in-memory database should initialize");
        let item = scanned_input(1);
        let result = import_scanned_items_with_conn(&mut conn, vec![item.clone(), item])
            .expect("duplicate batch import should succeed");
        assert_eq!(result.imported, 1);
        assert_eq!(result.skipped, 1);
    }
}

#[tauri::command]
async fn import_scanned_items(items: Vec<OrbitItemInput>) -> Result<ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || import_scanned_items_blocking(items))
        .await
        .map_err(|error| format!("Scanned item import worker failed: {error}"))?
}

#[tauri::command]
fn set_plugin_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<PluginStateUpdate, String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE plugin_states SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, if enabled { 1 } else { 0 }, now_string()],
    )
    .map_err(|error| format!("Failed to update plugin state: {error}"))?;
    log_plugin_event(
        &conn,
        &id,
        "info",
        if enabled {
            "Plugin enabled"
        } else {
            "Plugin disabled"
        },
    )?;
    plugin_state_update_after_setting_change(&app, &conn)
}

#[tauri::command]
fn set_active_theme(app: tauri::AppHandle, theme_id: String) -> Result<AppSettings, String> {
    let conn = open_db()?;
    set_setting_value(&conn, "active_theme_id", &theme_id)?;
    log_plugin_event(
        &conn,
        "core-themes",
        "info",
        &format!("Theme changed to {theme_id}"),
    )?;
    settings_after_setting_update(&app, &conn)
}

#[tauri::command]
fn set_density(app: tauri::AppHandle, density: String) -> Result<AppSettings, String> {
    let conn = open_db()?;
    set_setting_value(&conn, "density", &density)?;
    settings_after_setting_update(&app, &conn)
}

#[tauri::command]
fn set_close_behavior(app: tauri::AppHandle, behavior: String) -> Result<AppSettings, String> {
    let normalized = if behavior == "exit" { "exit" } else { "tray" };
    let conn = open_db()?;
    set_setting_value(&conn, "close_behavior", normalized)?;
    settings_after_setting_update(&app, &conn)
}

#[tauri::command]
fn set_safe_mode(app: tauri::AppHandle, enabled: bool) -> Result<PluginStateUpdate, String> {
    let conn = open_db()?;
    set_setting_value(&conn, "safe_mode", if enabled { "true" } else { "false" })?;
    log_plugin_event(
        &conn,
        "core-plugin-dev",
        "warn",
        if enabled {
            "Safe mode enabled"
        } else {
            "Safe mode disabled"
        },
    )?;
    plugin_state_update_after_setting_change(&app, &conn)
}

#[tauri::command]
fn set_auto_pinned_mode(app: tauri::AppHandle, enabled: bool) -> Result<AppSettings, String> {
    let conn = open_db()?;
    set_setting_value(
        &conn,
        "auto_pinned_mode",
        if enabled { "true" } else { "false" },
    )?;
    settings_after_setting_update(&app, &conn)
}

#[tauri::command]
fn set_display_mode(app: tauri::AppHandle, mode: String) -> Result<AppSettings, String> {
    let conn = open_db()?;
    set_setting_value(&conn, "display_mode", &mode)?;
    settings_after_setting_update(&app, &conn)
}

#[tauri::command]
fn set_resource_mode(app: tauri::AppHandle, mode: String) -> Result<AppSettings, String> {
    let normalized = if mode == "single" {
        "single"
    } else {
        "hierarchical"
    };
    let conn = open_db()?;
    set_setting_value(&conn, "resource_mode", normalized)?;
    settings_after_setting_update(&app, &conn)
}

#[tauri::command]
fn set_hotkey_behavior(app: tauri::AppHandle, behavior: String) -> Result<AppSettings, String> {
    let conn = open_db()?;
    set_setting_value(&conn, "hotkey_behavior", &behavior)?;
    settings_after_setting_update(&app, &conn)
}

#[tauri::command]
fn export_catalog_json() -> Result<ExportResult, String> {
    let conn = open_db()?;
    let export = CatalogExport {
        version: 4,
        exported_at: now_string(),
        items: all_items(&conn)?,
        groups: all_groups(&conn)?,
        trips: all_trips(&conn)?,
        plugins: all_plugins(&conn)?,
        active_theme_id: Some(setting(&conn, "active_theme_id", "local-galaxy")?),
    };
    let json = serde_json::to_string_pretty(&export)
        .map_err(|error| format!("Failed to serialize export: {error}"))?;
    let backup_dir = app_data_dir()?.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("Failed to create backup directory: {error}"))?;
    let path = backup_dir.join(format!("orbitstart-export-{}.json", export.exported_at));
    fs::write(&path, &json).map_err(|error| format!("Failed to write export: {error}"))?;
    Ok(ExportResult {
        path: path.to_string_lossy().to_string(),
        json,
    })
}

fn available_catalog_item_id(conn: &Connection, item: &OrbitItem) -> Result<String, String> {
    let preferred = if item.id.trim().is_empty() {
        make_id(&item.kind, &item.target)
    } else {
        item.id.trim().to_string()
    };
    if get_item(conn, &preferred)?.is_none() {
        return Ok(preferred);
    }

    let base = make_id(&item.kind, &item.target);
    if get_item(conn, &base)?.is_none() {
        return Ok(base);
    }
    for suffix in 1..=10_000 {
        let candidate = format!("{base}-import-{suffix}");
        if get_item(conn, &candidate)?.is_none() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "Failed to allocate an ID for imported resource: {}",
        item.target
    ))
}

fn restore_catalog_item(conn: &Connection, item: &OrbitItem) -> Result<(String, bool), String> {
    if item.target.trim().is_empty() {
        return Err(format!(
            "Imported resource '{}' has an empty target",
            item.title
        ));
    }

    let group = normalize_group_value(&item.group, &item.kind);
    let aliases = serde_json::to_string(&item.aliases).unwrap_or_else(|_| "[]".to_string());
    let tags = serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".to_string());
    let now = now_string();
    let (path_mode, base_path) = normalize_item_path_fields(
        &item.kind,
        item.path_mode,
        &item.target,
        item.base_path.as_deref(),
    )?;

    if let Some(existing) = get_item_by_target(conn, &item.target)? {
        conn.execute(
            r#"
            UPDATE items
            SET title = ?2,
                subtitle = ?3,
                kind = ?4,
                group_id = ?5,
                aliases_json = ?6,
                tags_json = ?7,
                icon = ?8,
                accent = ?9,
                favorite = ?10,
                launch_count = ?11,
                last_launched_at = ?12,
                updated_at = ?13,
                sort_order = ?14,
                arguments = ?15,
                sub_tag = ?16,
                path_mode = ?17,
                base_path = ?18
            WHERE id = ?1
            "#,
            params![
                &existing.id,
                &item.title,
                &item.subtitle,
                &item.kind,
                group,
                aliases,
                tags,
                &item.icon,
                &item.accent,
                if item.favorite { 1 } else { 0 },
                item.launch_count,
                &item.last_launched_at,
                now,
                item.sort_order,
                &item.arguments,
                item.sub_tag.trim(),
                resource_path_mode_value(path_mode),
                base_path,
            ],
        )
        .map_err(|error| format!("Failed to restore imported resource: {error}"))?;
        return Ok((existing.id, true));
    }

    let id = available_catalog_item_id(conn, item)?;
    conn.execute(
        r#"
        INSERT INTO items (
            id, title, subtitle, kind, group_id, target, arguments, aliases_json, tags_json,
            icon, accent, favorite, launch_count, last_launched_at, created_at, updated_at,
            sort_order, sub_tag, path_mode, base_path
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16, ?17, ?18, ?19)
        "#,
        params![
            &id,
            &item.title,
            &item.subtitle,
            &item.kind,
            group,
            &item.target,
            &item.arguments,
            aliases,
            tags,
            &item.icon,
            &item.accent,
            if item.favorite { 1 } else { 0 },
            item.launch_count,
            &item.last_launched_at,
            now,
            item.sort_order,
            item.sub_tag.trim(),
            resource_path_mode_value(path_mode),
            base_path,
        ],
    )
    .map_err(|error| format!("Failed to insert imported resource: {error}"))?;
    Ok((id, false))
}

fn parse_catalog_export(json: &str) -> Result<CatalogExport, String> {
    let normalized = json.trim_start_matches('\u{feff}').trim();
    serde_json::from_str(normalized).map_err(|error| format!("Invalid import JSON: {error}"))
}

fn import_catalog_export_with_conn(
    conn: &mut Connection,
    export: CatalogExport,
) -> Result<ImportResult, String> {
    let CatalogExport {
        items,
        groups,
        trips,
        plugins,
        active_theme_id,
        ..
    } = export;
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start catalog import: {error}"))?;

    for (index, group) in groups.into_iter().enumerate() {
        if !group.custom || group.id.trim().is_empty() {
            continue;
        }
        let existing_custom = tx
            .query_row(
                "SELECT custom FROM groups WHERE id = ?1",
                params![&group.id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| format!("Failed to inspect imported group: {error}"))?;
        if existing_custom == Some(0) {
            continue;
        }
        tx.execute(
            r#"
            INSERT INTO groups (id, title, icon, description, custom, sort_order, created_at)
            VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                icon = excluded.icon,
                description = excluded.description,
                sort_order = excluded.sort_order
            "#,
            params![
                group.id,
                group.title,
                group.icon,
                group.description,
                index as i64,
                now_string(),
            ],
        )
        .map_err(|error| format!("Failed to restore imported group: {error}"))?;
    }

    let mut referenced_group_ids = HashSet::new();
    let mut next_group_sort: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM groups",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to read imported group order: {error}"))?;
    for item in &items {
        for group_id in split_group_ids(&item.group) {
            if !referenced_group_ids.insert(group_id.clone()) {
                continue;
            }
            let exists = tx
                .query_row(
                    "SELECT 1 FROM groups WHERE id = ?1",
                    params![&group_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|error| format!("Failed to inspect imported resource group: {error}"))?
                .is_some();
            if exists {
                continue;
            }
            tx.execute(
                "INSERT INTO groups (id, title, icon, description, custom, sort_order, created_at) VALUES (?1, ?1, 'Bookmark', ?2, 1, ?3, ?4)",
                params![
                    &group_id,
                    "Recovered from an older JSON backup",
                    next_group_sort,
                    now_string(),
                ],
            )
            .map_err(|error| format!("Failed to recover imported resource group: {error}"))?;
            next_group_sort += 1;
        }
    }

    let mut inserted = 0;
    let mut updated = 0;
    let mut skipped = 0;
    let mut item_ids = Vec::new();
    let mut imported_id_map: HashMap<String, String> = HashMap::new();
    let mut imported_target_map: HashMap<String, String> = HashMap::new();
    for item in items {
        if let Some(actual_id) = imported_target_map.get(&item.target) {
            imported_id_map.insert(item.id.clone(), actual_id.clone());
            skipped += 1;
            continue;
        }

        let exported_id = item.id.clone();
        let target = item.target.clone();
        let (actual_id, existed) = restore_catalog_item(&tx, &item)?;
        if existed {
            updated += 1;
        } else {
            inserted += 1;
        }
        imported_id_map.insert(exported_id, actual_id.clone());
        imported_target_map.insert(target, actual_id.clone());
        item_ids.push(actual_id);
    }

    let mut trips_imported = 0;
    for trip in trips {
        let actual_item_id = if let Some(actual_id) = imported_id_map.get(&trip.item_id) {
            actual_id.clone()
        } else if get_item(&tx, &trip.item_id)?.is_some() {
            trip.item_id.clone()
        } else {
            return Err(format!(
                "Imported record '{}' references a missing resource: {}",
                trip.title, trip.item_id
            ));
        };
        let category = normalize_trip_category(&trip.category);
        let status = normalize_trip_status(&category, trip.status);
        let tags = normalize_trip_tags(trip.tags);
        tx.execute(
            r#"
            INSERT OR REPLACE INTO trips (id, item_id, title, content, category, status, tags, pinned, created_at, updated_at, last_viewed_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
            params![
                trip.id,
                actual_item_id,
                trip.title,
                trip.content,
                category,
                status,
                serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string()),
                if trip.pinned { 1 } else { 0 },
                trip.created_at,
                trip.updated_at,
                trip.last_viewed_at,
            ],
        )
        .map_err(|error| format!("Failed to import trip: {error}"))?;
        trips_imported += 1;
    }

    for plugin in plugins {
        tx.execute(
            "UPDATE plugin_states SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
            params![plugin.id, if plugin.enabled { 1 } else { 0 }, now_string(),],
        )
        .map_err(|error| format!("Failed to restore plugin state: {error}"))?;
    }

    if let Some(theme_id) = active_theme_id {
        set_setting_value(&tx, "active_theme_id", &theme_id)?;
    }
    log_plugin_event(&tx, "core-backup", "info", "Catalog import completed")?;
    tx.commit()
        .map_err(|error| format!("Failed to commit catalog import: {error}"))?;
    Ok(ImportResult {
        imported: inserted + updated,
        inserted,
        updated,
        skipped,
        trips_imported,
        item_ids,
    })
}

fn import_catalog_json_blocking(json: String) -> Result<ImportResult, String> {
    let export = parse_catalog_export(&json)?;
    let mut conn = open_db()?;
    import_catalog_export_with_conn(&mut conn, export)
}

#[tauri::command]
async fn import_catalog_json(app: tauri::AppHandle, json: String) -> Result<ImportResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || import_catalog_json_blocking(json))
        .await
        .map_err(|error| format!("Catalog import worker failed: {error}"))??;
    let conn = open_db()?;
    cache_settings_from_connection(&app, &conn)?;
    let _ = app.emit("orbit://refresh-resources", ());
    let _ = app.emit("orbit://trips-changed", ());
    Ok(result)
}

#[cfg(test)]
mod catalog_import_tests {
    use super::*;

    fn imported_item(id: &str, target: &str) -> OrbitItem {
        OrbitItem {
            id: id.to_string(),
            title: "Restored title".to_string(),
            subtitle: "Restored subtitle".to_string(),
            kind: "app".to_string(),
            group: "imported-group".to_string(),
            target: target.to_string(),
            arguments: "--restored".to_string(),
            aliases: vec!["restored-alias".to_string()],
            tags: vec!["restored-tag".to_string()],
            icon: "Rocket".to_string(),
            accent: "#123456".to_string(),
            favorite: true,
            launch_count: 17,
            last_launched_at: Some("123456789".to_string()),
            sort_order: -42,
            sub_tag: "Imported/Subtag".to_string(),
            path_mode: ResourcePathMode::Absolute,
            base_path: None,
        }
    }

    fn empty_catalog(items: Vec<OrbitItem>) -> CatalogExport {
        CatalogExport {
            version: 3,
            exported_at: "test".to_string(),
            items,
            groups: Vec::new(),
            trips: Vec::new(),
            plugins: Vec::new(),
            active_theme_id: None,
        }
    }

    #[test]
    fn restores_existing_resource_fields_groups_plugins_theme_and_trip_links() {
        let mut conn = Connection::open_in_memory().expect("in-memory database should open");
        init_db(&mut conn).expect("in-memory database should initialize");
        let target = r#"C:\CatalogImport\tool.exe"#;
        let existing = insert_item(
            &conn,
            &OrbitItemInput {
                title: "Current title".to_string(),
                subtitle: "Current subtitle".to_string(),
                kind: "app".to_string(),
                group: "apps".to_string(),
                target: target.to_string(),
                arguments: String::new(),
                aliases: vec!["current-alias".to_string()],
                tags: vec!["current-tag".to_string()],
                sub_tag: String::new(),
                icon: "AppWindow".to_string(),
                accent: "#ffffff".to_string(),
                favorite: false,
                path_mode: ResourcePathMode::Absolute,
                base_path: None,
            },
        )
        .expect("existing item should be inserted");

        let mut website_plugin = all_plugins(&conn)
            .expect("plugins should load")
            .into_iter()
            .find(|plugin| plugin.id == "core-websites")
            .expect("website plugin should exist");
        website_plugin.enabled = false;

        let imported_id = "foreign-resource-id";
        let trip_id = "imported-trip";
        let export = CatalogExport {
            version: 3,
            exported_at: "test".to_string(),
            items: vec![imported_item(imported_id, target)],
            groups: vec![OrbitGroup {
                id: "imported-group".to_string(),
                title: "Imported group".to_string(),
                icon: "Folder".to_string(),
                description: "Imported description".to_string(),
                custom: true,
            }],
            trips: vec![Trip {
                id: trip_id.to_string(),
                item_id: imported_id.to_string(),
                title: "Imported trip".to_string(),
                content: "Imported content".to_string(),
                category: "note".to_string(),
                status: None,
                tags: vec!["backup".to_string()],
                pinned: true,
                created_at: 1,
                updated_at: 2,
                last_viewed_at: Some(3),
            }],
            plugins: vec![website_plugin],
            active_theme_id: Some("paper".to_string()),
        };

        let result = import_catalog_export_with_conn(&mut conn, export)
            .expect("catalog restore should succeed");
        assert_eq!(result.inserted, 0);
        assert_eq!(result.updated, 1);
        assert_eq!(result.trips_imported, 1);

        let restored = get_item_by_target(&conn, target)
            .expect("restored item query should succeed")
            .expect("restored item should exist");
        assert_eq!(restored.id, existing.id);
        assert_eq!(restored.title, "Restored title");
        assert_eq!(restored.subtitle, "Restored subtitle");
        assert_eq!(restored.group, "imported-group");
        assert_eq!(restored.arguments, "--restored");
        assert_eq!(restored.aliases, vec!["restored-alias"]);
        assert_eq!(restored.tags, vec!["restored-tag"]);
        assert_eq!(restored.icon, "Rocket");
        assert_eq!(restored.accent, "#123456");
        assert!(restored.favorite);
        assert_eq!(restored.launch_count, 17);
        assert_eq!(restored.last_launched_at.as_deref(), Some("123456789"));
        assert_eq!(restored.sort_order, -42);
        assert_eq!(restored.sub_tag, "Imported/Subtag");

        let custom_group: i64 = conn
            .query_row(
                "SELECT custom FROM groups WHERE id = 'imported-group'",
                [],
                |row| row.get(0),
            )
            .expect("custom group should be restored");
        assert_eq!(custom_group, 1);
        let plugin_enabled: i64 = conn
            .query_row(
                "SELECT enabled FROM plugin_states WHERE id = 'core-websites'",
                [],
                |row| row.get(0),
            )
            .expect("plugin state should be restored");
        assert_eq!(plugin_enabled, 0);
        assert_eq!(
            setting(&conn, "active_theme_id", "missing").expect("theme should load"),
            "paper"
        );
        let trip_item_id: String = conn
            .query_row(
                "SELECT item_id FROM trips WHERE id = ?1",
                params![trip_id],
                |row| row.get(0),
            )
            .expect("trip should be restored");
        assert_eq!(trip_item_id, existing.id);
    }

    #[test]
    fn preserves_data_and_workspace_relative_path_fields_during_catalog_import() {
        let mut data_relative = imported_item("data-relative", r"resources\tools\tool.exe");
        data_relative.path_mode = ResourcePathMode::DataRelative;
        let mut workspace_relative = imported_item("workspace-relative", r"bin\tool.exe");
        workspace_relative.path_mode = ResourcePathMode::WorkspaceRelative;
        workspace_relative.base_path = Some(r"workspaces\demo".to_string());

        let mut conn = Connection::open_in_memory().expect("in-memory database should open");
        init_db(&mut conn).expect("in-memory database should initialize");
        import_catalog_export_with_conn(
            &mut conn,
            empty_catalog(vec![data_relative, workspace_relative]),
        )
        .expect("relative-path resources should import");

        let data_item = get_item_by_target(&conn, r"resources\tools\tool.exe")
            .expect("data-relative item query should succeed")
            .expect("data-relative item should be restored");
        assert_eq!(data_item.path_mode, ResourcePathMode::DataRelative);
        assert_eq!(data_item.base_path, None);

        let workspace_item = get_item_by_target(&conn, r"bin\tool.exe")
            .expect("workspace-relative item query should succeed")
            .expect("workspace-relative item should be restored");
        assert_eq!(
            workspace_item.path_mode,
            ResourcePathMode::WorkspaceRelative
        );
        assert_eq!(
            workspace_item.base_path.as_deref(),
            Some(r"workspaces\demo")
        );
    }

    #[test]
    fn accepts_bom_prefixed_version_two_exports_without_groups() {
        let export = empty_catalog(vec![imported_item(
            "legacy-id",
            r#"C:\CatalogImport\legacy.exe"#,
        )]);
        let mut value = serde_json::to_value(export).expect("catalog should serialize");
        value["version"] = serde_json::json!(2);
        value
            .as_object_mut()
            .expect("catalog should be an object")
            .remove("groups");
        value["items"][0]
            .as_object_mut()
            .expect("legacy item should be an object")
            .remove("pathMode");
        let json = format!(
            "\u{feff}{}",
            serde_json::to_string(&value).expect("legacy catalog should serialize")
        );
        let parsed = parse_catalog_export(&json).expect("legacy catalog should parse");
        assert_eq!(parsed.version, 2);
        assert!(parsed.groups.is_empty());
        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.items[0].path_mode, ResourcePathMode::Absolute);

        let mut conn = Connection::open_in_memory().expect("in-memory database should open");
        init_db(&mut conn).expect("in-memory database should initialize");
        import_catalog_export_with_conn(&mut conn, parsed).expect("legacy catalog should import");
        let recovered_group: i64 = conn
            .query_row(
                "SELECT custom FROM groups WHERE id = 'imported-group'",
                [],
                |row| row.get(0),
            )
            .expect("legacy group reference should be recovered");
        assert_eq!(recovered_group, 1);
    }
}

fn ensure_local_templates() -> Result<(), String> {
    let plugin_root = plugins_dir()?.join("hello-command");
    if !plugin_root.exists() {
        fs::create_dir_all(&plugin_root)
            .map_err(|error| format!("Failed to create hello plugin: {error}"))?;
        fs::write(plugin_root.join("plugin.json"), hello_plugin_manifest())
            .map_err(|error| format!("Failed to write hello plugin manifest: {error}"))?;
        fs::write(
            plugin_root.join("main.ts"),
            hello_plugin_source_for("hello-command"),
        )
        .map_err(|error| format!("Failed to write hello plugin source: {error}"))?;
        fs::write(
            plugin_root.join("orbitstart-plugin-api.d.ts"),
            hello_plugin_api_types(),
        )
        .map_err(|error| format!("Failed to write hello plugin API types: {error}"))?;
        fs::write(plugin_root.join("README.md"), hello_plugin_readme())
            .map_err(|error| format!("Failed to write hello plugin README: {error}"))?;
    }

    #[cfg(not(feature = "lite"))]
    {
        let tips_plugin_root = plugins_dir()?.join("tips-search");
        if !tips_plugin_root.exists() {
            fs::create_dir_all(&tips_plugin_root)
                .map_err(|error| format!("Failed to create tips plugin: {error}"))?;
            fs::write(tips_plugin_root.join("plugin.json"), tips_plugin_manifest())
                .map_err(|error| format!("Failed to write tips plugin manifest: {error}"))?;
            fs::write(tips_plugin_root.join("main.ts"), tips_plugin_source())
                .map_err(|error| format!("Failed to write tips plugin source: {error}"))?;
            fs::write(
                tips_plugin_root.join("orbitstart-plugin-api.d.ts"),
                hello_plugin_api_types(),
            )
            .map_err(|error| format!("Failed to write tips plugin API types: {error}"))?;
            fs::write(tips_plugin_root.join("README.md"), tips_plugin_readme())
                .map_err(|error| format!("Failed to write tips plugin README: {error}"))?;
        }

        let obsidian_plugin_root = plugins_dir()?.join("obsidian-search");
        if !obsidian_plugin_root.exists() {
            fs::create_dir_all(&obsidian_plugin_root)
                .map_err(|error| format!("Failed to create obsidian plugin: {error}"))?;
            fs::write(
                obsidian_plugin_root.join("plugin.json"),
                obsidian_plugin_manifest(),
            )
            .map_err(|error| format!("Failed to write obsidian plugin manifest: {error}"))?;
            fs::write(
                obsidian_plugin_root.join("main.ts"),
                obsidian_plugin_source(),
            )
            .map_err(|error| format!("Failed to write obsidian plugin source: {error}"))?;
            fs::write(
                obsidian_plugin_root.join("orbitstart-plugin-api.d.ts"),
                obsidian_plugin_api_types(),
            )
            .map_err(|error| format!("Failed to write obsidian plugin API types: {error}"))?;
            fs::write(
                obsidian_plugin_root.join("README.md"),
                obsidian_plugin_readme(),
            )
            .map_err(|error| format!("Failed to write obsidian plugin README: {error}"))?;
        }

        let hotkey_plugin_root = plugins_dir()?.join("hotkey-binder");
        if !hotkey_plugin_root.exists() {
            fs::create_dir_all(&hotkey_plugin_root)
                .map_err(|error| format!("Failed to create hotkey plugin: {error}"))?;
            fs::write(
                hotkey_plugin_root.join("plugin.json"),
                hotkey_binder_manifest(),
            )
            .map_err(|error| format!("Failed to write hotkey plugin manifest: {error}"))?;
            fs::write(hotkey_plugin_root.join("main.ts"), hotkey_binder_source())
                .map_err(|error| format!("Failed to write hotkey plugin source: {error}"))?;
            fs::write(
                hotkey_plugin_root.join("orbitstart-plugin-api.d.ts"),
                hello_plugin_api_types(),
            )
            .map_err(|error| format!("Failed to write hotkey plugin API types: {error}"))?;
            fs::write(hotkey_plugin_root.join("README.md"), hotkey_binder_readme())
                .map_err(|error| format!("Failed to write hotkey plugin README: {error}"))?;
        }

        let workspaces_plugin_root = plugins_dir()?.join("workspaces");
        fs::create_dir_all(&workspaces_plugin_root)
            .map_err(|error| format!("Failed to create workspaces plugin: {error}"))?;
        fs::write(
            workspaces_plugin_root.join("plugin.json"),
            workspaces_plugin_manifest(),
        )
        .map_err(|error| format!("Failed to write workspaces plugin manifest: {error}"))?;
        fs::write(
            workspaces_plugin_root.join("main.ts"),
            workspaces_plugin_source(),
        )
        .map_err(|error| format!("Failed to write workspaces plugin source: {error}"))?;
        fs::write(
            workspaces_plugin_root.join("orbitstart-plugin-api.d.ts"),
            workspaces_plugin_api_types(),
        )
        .map_err(|error| format!("Failed to write workspaces plugin API types: {error}"))?;
        fs::write(
            workspaces_plugin_root.join("README.md"),
            workspaces_plugin_readme(),
        )
        .map_err(|error| format!("Failed to write workspaces plugin README: {error}"))?;
    }

    let theme_root = themes_dir()?.join("aurora-focus");
    if !theme_root.exists() {
        fs::create_dir_all(&theme_root)
            .map_err(|error| format!("Failed to create sample theme: {error}"))?;
        fs::write(theme_root.join("theme.json"), sample_theme_manifest())
            .map_err(|error| format!("Failed to write sample theme: {error}"))?;
        fs::write(theme_root.join("theme.css"), sample_theme_css())
            .map_err(|error| format!("Failed to write sample theme CSS: {error}"))?;
    }
    Ok(())
}

fn hello_plugin_manifest() -> &'static str {
    r#"{
  "id": "hello-command",
  "name": "Hello Command",
  "version": "0.1.0",
  "description": "Minimal local OrbitStart command plugin template.",
  "enabled": true,
  "builtin": false,
  "permissions": [
    { "id": "ui:toast", "label": "Show toast messages", "risk": "low" }
  ],
  "contributes": { "commands": 1, "searchProviders": 1, "themes": 0, "views": 0 }
}
"#
}

fn tips_plugin_manifest() -> &'static str {
    r#"{
  "id": "tips-search",
  "name": "Tips Search",
  "version": "0.1.0",
  "description": "Search and open Tip notes attached to OrbitStart resources.",
  "enabled": true,
  "builtin": false,
  "permissions": [
    { "id": "ui:toast", "label": "Show toast messages", "risk": "low" },
    { "id": "trips:read", "label": "Search and open Tip notes", "risk": "medium" }
  ],
  "contributes": { "commands": 1, "searchProviders": 1, "themes": 0, "views": 0 }
}
"#
}

fn tips_plugin_source() -> &'static str {
    r#"import type { OrbitPlugin } from "./orbitstart-plugin-api";

const plugin: OrbitPlugin = {
  activate(ctx) {
    ctx.commands.registerCommand({
      id: "open",
      title: "打开 Tips",
      subtitle: "查看资源提示笔记、快捷键、流程 and 状态记录。",
      icon: "Lightbulb",
      keywords: ["tips", "notes", "usage", "提示", "笔记"],
      run: async () => {
        await ctx.trips.open("", "");
        ctx.ui.toast("已打开 Tips 页面");
      }
    });

    ctx.search.registerProvider("content", async (query) => {
      const q = query.trim();
      if (q.length < 2) return [];
      const results = await ctx.trips.search(q);
      return results.map((result) => {
        const preview = result.trip.content.replace(/[#*_`|>-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 88);
        return {
          id: `tips-search.${result.trip.id}`,
          title: `[Tip] ${result.itemTitle} · ${result.trip.title}`,
          subtitle: preview || result.trip.tags.join(", ") || "资源提示笔记",
          icon: "Lightbulb",
          source: "tips-search",
          actionLabel: "查看 Tip",
          run: () => ctx.trips.open(result.itemId, result.trip.id)
        };
      });
    });
  }
};

export default plugin;
"#
}

fn obsidian_plugin_manifest() -> &'static str {
    r#"{
  "id": "obsidian-search",
  "name": "Obsidian Search",
  "version": "0.1.0",
  "description": "Search local Obsidian task indexes and open source notes through OrbitStart.",
  "enabled": true,
  "builtin": false,
  "permissions": [
    { "id": "ui:toast", "label": "Show toast messages", "risk": "low" },
    { "id": "obsidian:read", "label": "Search and open indexed Obsidian tasks", "risk": "medium" }
  ],
  "contributes": { "commands": 1, "searchProviders": 1, "themes": 0, "views": 0 }
}
"#
}

fn obsidian_plugin_source() -> &'static str {
    r#"import type { OrbitPlugin } from "./orbitstart-plugin-api";

const plugin: OrbitPlugin = {
  activate(ctx) {
    ctx.commands.registerCommand({
      id: "open",
      title: "Open Obsidian todos",
      subtitle: "Open the local read-only Obsidian note index.",
      icon: "NotebookText",
      keywords: ["obsidian", "todo", "task", "notes"],
      run: async () => {
        await ctx.obsidian.open("", "");
        ctx.ui.toast("Opened Obsidian todo index");
      }
    });

    ctx.search.registerProvider("tasks", async (query) => {
      const q = query.trim();
      if (q.length < 2) return [];
      const results = await ctx.obsidian.search(q);
      return results.map((result) => ({
        id: `obsidian-search.${result.id}`,
        title: `[Obsidian] ${result.title}`,
        subtitle: result.subtitle,
        icon: "NotebookText",
        source: "obsidian-search",
        actionLabel: "Open note",
        run: () => ctx.obsidian.open(result.vaultId, result.relativePath, result.lineNumber ?? undefined)
      }));
    });
  }
};

export default plugin;
"#
}

fn obsidian_plugin_api_types() -> &'static str {
    r#"export interface OrbitPlugin {
  activate(ctx: OrbitPluginContext): void | Promise<void>;
}

export interface OrbitPluginContext {
  commands: { registerCommand(command: OrbitCommandContribution): void };
  search: { registerProvider(id: string, provider: (query: string) => Promise<SearchResult[]> | SearchResult[]): void };
  ui: { toast(message: string): void };
  obsidian: ObsidianApi;
}

export interface OrbitCommandContribution {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  keywords?: string[];
  run(): void | Promise<void>;
}

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  source: string;
  actionLabel: string;
  run(): void | Promise<void>;
}

export interface ObsidianApi {
  search(query: string): Promise<ObsidianSearchResult[]>;
  open(vaultId: string, relativePath: string, lineNumber?: number): Promise<void>;
}

export interface ObsidianTask {
  id: string;
  vaultId: string;
  vaultName: string;
  noteId: string;
  noteTitle: string;
  filePath: string;
  relativePath: string;
  lineNumber: number;
  text: string;
  completed: boolean;
  tags: string[];
  dueDate?: string | null;
  priority?: "low" | "medium" | "high" | null;
}

export interface ObsidianSearchResult {
  kind: string;
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  vaultId: string;
  vaultName: string;
  relativePath: string;
  lineNumber?: number | null;
  task?: ObsidianTask | null;
}
"#
}

fn hello_plugin_source_for(plugin_id: &str) -> String {
    hello_plugin_source().replace("hello-command", plugin_id)
}

fn hello_plugin_source() -> &'static str {
    r#"import type { OrbitPlugin } from "./orbitstart-plugin-api";

const plugin: OrbitPlugin = {
  activate(ctx) {
    ctx.commands.registerCommand({
      id: "hello-command.sayHello",
      title: "Hello from local plugin",
      subtitle: "This is the smallest useful OrbitStart plugin.",
      icon: "Sparkles",
      keywords: ["hello", "demo"],
      run: () => ctx.ui.toast("Hello from a local plugin")
    });

    ctx.search.registerProvider("hello-command.search", async (query) => {
      if (!query.toLowerCase().includes("hello")) return [];
      return [
        {
          id: "hello-command.searchResult",
          title: "Hello plugin search result",
          subtitle: "This result is produced by main.ts inside an isolated worker.",
          icon: "Sparkles",
          source: "hello-command",
          actionLabel: "Show toast",
          run: () => ctx.ui.toast(`Hello search matched: ${query}`)
        }
      ];
    });
  }
};

export default plugin;
"#
}

fn hello_plugin_api_types() -> &'static str {
    r#"export interface OrbitPlugin {
  activate(ctx: OrbitPluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export interface OrbitPluginContext {
  commands: {
    registerCommand(command: RegisteredCommand): () => void;
  };
  search: {
    registerProvider(id: string, provider: SearchProvider): () => void;
  };
  ui: {
    toast(message: string): void;
  };
  settings: PluginSettings;
  storage: PluginStorage;
  trips: TripsApi;
}

export interface RegisteredCommand {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  keywords: string[];
  run(): void | Promise<void>;
}

export type SearchProvider = (query: string) => SearchResult[] | Promise<SearchResult[]>;

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  source: string;
  actionLabel: string;
  run?(): void | Promise<void>;
}

export interface PluginSettings {
  get<T = unknown>(key: string, fallbackValue?: T): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<boolean>;
}

export interface PluginStorage {
  get<T = unknown>(key: string, fallbackValue?: T): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  list(): Promise<Array<{ key: string; value: unknown }>>;
}

export interface TripsApi {
  search(query: string): Promise<TripSearchResult[]>;
  open(itemId: string, tripId?: string): Promise<boolean>;
}

export interface TripSearchResult {
  trip: {
    id: string;
    itemId: string;
    title: string;
    content: string;
    category: string;
    status?: string | null;
    tags: string[];
    pinned: boolean;
    createdAt: number;
    updatedAt: number;
    lastViewedAt?: number | null;
  };
  itemId: string;
  itemTitle: string;
  itemIcon: string;
  itemKind: string;
}
"#
}

fn hello_plugin_readme() -> &'static str {
    r#"# Hello Command

This template is intentionally small. Edit `plugin.json`, implement `main.ts`, then restart OrbitStart or refresh the plugin manager.

Common OrbitStart plugin APIs:

- `ctx.commands.registerCommand`
- `ctx.search.registerProvider`
- `ctx.ui.toast`
- `ctx.settings` (requires `settings:plugin`)
- `ctx.storage` (requires `storage:plugin`)

Runtime notes:

- `main.ts` runs inside an isolated Web Worker.
- Keep runtime code self-contained; static imports are not supported yet.
- `import type` is allowed for local editor typings.
"#
}

fn tips_plugin_readme() -> &'static str {
    r#"# Tips Search

Adds command-palette search for Tip notes attached to OrbitStart resources.

- `ctx.trips.search(query)` reads Tip notes through OrbitStart's host bridge.
- `ctx.trips.open(itemId, tripId)` opens the Trips page or highlights a Trip for a resource.
- The plugin does not receive generic native invoke access.
"#
}

fn obsidian_plugin_readme() -> &'static str {
    r#"# Obsidian Search

Official local OrbitStart plugin for searching the read-only Obsidian task index.

- `ctx.obsidian.search(query)` searches indexed checkbox tasks.
- `ctx.obsidian.open(vaultId, relativePath, lineNumber)` opens the source note.
"#
}

fn hotkey_binder_manifest() -> &'static str {
    r#"{
  "id": "hotkey-binder",
  "name": "Hotkey Binder",
  "version": "0.1.0",
  "description": "为标签和常用页面绑定全局快捷键，一键直达特定功能区。",
  "enabled": true,
  "builtin": false,
  "permissions": [
    { "id": "ui:toast", "label": "Show toast messages", "risk": "low" },
    { "id": "hotkey:write", "label": "Register and update group hotkeys", "risk": "high" }
  ],
  "contributes": { "commands": 1, "searchProviders": 0, "themes": 0, "views": 0 }
}
"#
}

fn hotkey_binder_source() -> &'static str {
    r#"import type { OrbitPlugin } from "./orbitstart-plugin-api";

const plugin: OrbitPlugin = {
  activate(ctx) {
    ctx.commands.registerCommand({
      id: "bind-info",
      title: "热键绑定说明",
      subtitle: "在标签右上角点击键盘图标，即可为该功能区绑定唤出热键。",
      icon: "Keyboard",
      keywords: ["hotkey", "bind", "快捷键", "绑定"],
      run: async () => {
        ctx.ui.toast("请在标签右上角点击键盘图标进行快捷键绑定。");
      }
    });
  }
};

export default plugin;
"#
}

fn hotkey_binder_readme() -> &'static str {
    r#"# Hotkey Binder

Official local OrbitStart plugin to bind global shortcuts to groups.

- Click the Keyboard icon on group tabs to record a hotkey.
- Pressing the registered hotkey wakes up OrbitStart and switches to the group.
"#
}

fn sample_theme_manifest() -> &'static str {
    r##"{
  "id": "aurora-focus",
  "name": "Aurora Focus",
  "author": "OrbitStart",
  "description": "Grove: Dark forest green canvas with off-white typography and rust-red highlights.",
  "builtin": false,
  "tokens": {
    "--font-ui": "Inter, system-ui, sans-serif",
    "--font-body": "Inter, system-ui, sans-serif",
    "--font-title": "Georgia, \"Playfair Display\", serif",
    "--font-mono": "\"SF Mono\", ui-monospace, Menlo, monospace",
    "--bg": "#142319",
    "--bg-deep": "#0e1912",
    "--app-bg": "#142319",
    "--rail": "#0e1912",
    "--surface": "#1a2d20",
    "--surface-2": "#213928",
    "--surface-3": "#2a4833",
    "--surface-strong": "#1e3425",
    "--surface-soft": "rgba(230, 225, 213, 0.045)",
    "--field": "#18291d",
    "--field-strong": "#1e3425",
    "--line": "rgba(230, 225, 213, 0.12)",
    "--line-strong": "rgba(230, 225, 213, 0.2)",
    "--line-focus": "#bf4f36",
    "--text": "#ece8dd",
    "--soft": "#c2beaf",
    "--muted": "#8e8a7c",
    "--accent": "#bf4f36",
    "--accent-2": "#e2be8a",
    "--accent-3": "#bf4f36",
    "--ok": "#5ca873",
    "--warning": "#cc893b",
    "--danger": "#bf4f36",
    "--radius-sm": "6px",
    "--radius": "12px",
    "--radius-md": "12px",
    "--radius-lg": "16px",
    "--shadow-card": "0 8px 30px rgba(0, 0, 0, 0.3)",
    "--shadow-elevated": "0 20px 60px rgba(0, 0, 0, 0.5)",
    "--focus-ring": "0 0 0 3px rgba(191, 79, 54, 0.25)"
  }
}
"##
}

fn sample_theme_css() -> &'static str {
    r#"/* Optional CSS for future theme packages. OrbitStart currently reads theme.json tokens. */
"#
}

#[tauri::command]
fn create_plugin_template(name: String) -> Result<String, String> {
    let slug = name
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() {
        "orbit-plugin".to_string()
    } else {
        slug
    };
    let path = plugins_dir()?.join(&slug);
    fs::create_dir_all(&path)
        .map_err(|error| format!("Failed to create plugin template: {error}"))?;
    let manifest = hello_plugin_manifest()
        .replace("hello-command", &slug)
        .replace("Hello Command", &name);
    fs::write(path.join("plugin.json"), manifest)
        .map_err(|error| format!("Failed to write plugin manifest: {error}"))?;
    fs::write(path.join("main.ts"), hello_plugin_source_for(&slug))
        .map_err(|error| format!("Failed to write plugin source: {error}"))?;
    fs::write(
        path.join("orbitstart-plugin-api.d.ts"),
        hello_plugin_api_types(),
    )
    .map_err(|error| format!("Failed to write plugin API types: {error}"))?;
    fs::write(path.join("README.md"), hello_plugin_readme())
        .map_err(|error| format!("Failed to write plugin README: {error}"))?;

    let conn = open_db()?;
    log_plugin_event(
        &conn,
        "core-plugin-dev",
        "info",
        &format!("Created plugin template {slug}"),
    )?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn reset_software(app: tauri::AppHandle) -> Result<(), String> {
    // Clear auxiliary directories before deleting the database. If either
    // cleanup fails, the existing database remains usable instead of leaving
    // the running app with its schema removed.
    let plugins = plugins_dir()?;
    if plugins.exists() {
        fs::remove_dir_all(&plugins)
            .map_err(|error| format!("Failed to clear plugins directory: {error}"))?;
        fs::create_dir_all(&plugins)
            .map_err(|error| format!("Failed to recreate plugins directory: {error}"))?;
    }

    // 3. 清空主题目录
    let themes = themes_dir()?;
    if themes.exists() {
        fs::remove_dir_all(&themes)
            .map_err(|error| format!("Failed to clear themes directory: {error}"))?;
        fs::create_dir_all(&themes)
            .map_err(|error| format!("Failed to recreate themes directory: {error}"))?;
    }

    let db = db_path()?;
    if db.exists() {
        fs::remove_file(&db).map_err(|error| format!("Failed to delete database: {error}"))?;
    }

    let settings = initialize_database()?;
    replace_cached_settings(&app, settings)?;
    Ok(())
}

#[tauri::command]
fn open_data_directory() -> Result<String, String> {
    let path = app_data_dir()?.to_string_lossy().to_string();
    launch_target(path.clone())?;
    Ok(path)
}

#[tauri::command]
async fn open_aux_window(app: tauri::AppHandle, panel: String) -> Result<(), String> {
    let (label, title, width, height) = match panel.as_str() {
        "plugins" => ("plugins", "OrbitStart - Plugins", 980.0, 720.0),
        "themes" => ("themes", "OrbitStart - Themes", 980.0, 720.0),
        "about" => ("about", "About OrbitStart", 720.0, 560.0),
        _ => ("settings", "OrbitStart - Settings", 960.0, 700.0),
    };

    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let url = WebviewUrl::App(format!("index.html?label={}", label).into());
    WebviewWindowBuilder::new(&app, label, url)
        .title(title)
        .inner_size(width, height)
        .min_inner_size(680.0, 520.0)
        .decorations(false)
        .resizable(true)
        .center()
        .build()
        .map_err(|error| format!("Failed to open {label} window: {error}"))?;
    Ok(())
}

#[tauri::command]
fn get_autostart_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = ProcessCommand::new("reg");
        cmd.creation_flags(0x08000000);
        let output = cmd
            .args([
                "query",
                r#"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"#,
                "/v",
                "OrbitStart",
            ])
            .output()
            .map_err(|e| e.to_string())?;
        Ok(output.status.success())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("Failed to get current exe path: {e}"))?;
            let exe_str = exe_path.to_string_lossy().to_string();
            let exe_arg = format!("\"{}\"", exe_str);
            let mut cmd = ProcessCommand::new("reg");
            cmd.creation_flags(0x08000000);
            let status = cmd
                .args([
                    "add",
                    r#"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"#,
                    "/v",
                    "OrbitStart",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &exe_arg,
                    "/f",
                ])
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("Failed to write autostart registry".to_string());
            }
        } else {
            let mut cmd = ProcessCommand::new("reg");
            cmd.creation_flags(0x08000000);
            let _ = cmd
                .args([
                    "delete",
                    r#"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"#,
                    "/v",
                    "OrbitStart",
                    "/f",
                ])
                .status();
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

#[cfg(desktop)]
#[cfg(all(desktop, target_os = "windows"))]
mod win32 {
    use std::ffi::c_void;

    pub type HWND = *mut c_void;
    pub type BOOL = i32;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct RECT {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn GetWindowRect(hWnd: HWND, lpRect: *mut RECT) -> BOOL;
        pub fn GetForegroundWindow() -> HWND;
        pub fn MonitorFromWindow(hWnd: HWND, dwFlags: u32) -> HWND;
        pub fn GetMonitorInfoW(hMonitor: HWND, lpmi: *mut MONITORINFO) -> BOOL;
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct MONITORINFO {
        pub cb_size: u32,
        pub rc_monitor: RECT,
        pub rc_work: RECT,
        pub dw_flags: u32,
    }
}

#[cfg(all(desktop, target_os = "windows"))]
const MONITOR_DEFAULTTONEAREST: u32 = 2;

#[cfg(all(desktop, target_os = "windows"))]
#[derive(Default)]
struct BubbleFullscreenState {
    app: Option<tauri::AppHandle>,
    worker_started: bool,
    hidden_for_fullscreen: bool,
}

#[cfg(all(desktop, target_os = "windows"))]
static BUBBLE_FULLSCREEN_STATE: OnceLock<Mutex<BubbleFullscreenState>> = OnceLock::new();

#[cfg(all(desktop, target_os = "windows"))]
fn bubble_fullscreen_state() -> &'static Mutex<BubbleFullscreenState> {
    BUBBLE_FULLSCREEN_STATE.get_or_init(|| Mutex::new(BubbleFullscreenState::default()))
}

#[cfg(all(desktop, target_os = "windows"))]
fn is_foreground_fullscreen_window() -> bool {
    let foreground = unsafe { win32::GetForegroundWindow() };
    if foreground.is_null() {
        return false;
    }

    let mut process_id = 0;
    unsafe {
        GetWindowThreadProcessId(foreground, &mut process_id);
    }
    if process_id == 0 || unsafe { GetCurrentProcessId() } == process_id {
        return false;
    }

    let mut window_rect = win32::RECT::default();
    if unsafe { win32::GetWindowRect(foreground, &mut window_rect) == 0 } {
        return false;
    }
    let monitor = unsafe { win32::MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return false;
    }
    let mut monitor_info = win32::MONITORINFO {
        cb_size: std::mem::size_of::<win32::MONITORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { win32::GetMonitorInfoW(monitor, &mut monitor_info) == 0 } {
        return false;
    }

    const TOLERANCE: i32 = 2;
    let monitor_rect = monitor_info.rc_monitor;
    window_rect.left <= monitor_rect.left + TOLERANCE
        && window_rect.top <= monitor_rect.top + TOLERANCE
        && window_rect.right >= monitor_rect.right - TOLERANCE
        && window_rect.bottom >= monitor_rect.bottom - TOLERANCE
}

#[cfg(all(desktop, target_os = "windows"))]
fn bubble_should_avoid_fullscreen(app: &tauri::AppHandle) -> bool {
    let settings_enabled = cached_settings(app)
        .map(|settings| settings.bubble_enabled && settings.bubble_avoid_fullscreen)
        .unwrap_or(false);
    if !settings_enabled || app.get_webview_window("floating-bubble").is_none() {
        return false;
    }
    app.get_webview_window("main")
        .and_then(|main| main.is_visible().ok())
        .map(|visible| !visible)
        .unwrap_or(true)
}

#[cfg(all(desktop, target_os = "windows"))]
fn activate_bubble_fullscreen_watcher(app: &tauri::AppHandle) {
    if !cached_settings(app)
        .map(|settings| settings.bubble_enabled && settings.bubble_avoid_fullscreen)
        .unwrap_or(false)
    {
        return;
    }

    let mut should_start = false;
    if let Ok(mut state) = bubble_fullscreen_state().lock() {
        state.app = Some(app.clone());
        if !state.worker_started {
            state.worker_started = true;
            should_start = true;
        }
    }
    if should_start {
        std::thread::spawn(bubble_fullscreen_worker);
    }
}

#[cfg(all(desktop, target_os = "windows"))]
fn deactivate_bubble_fullscreen_watcher() {
    if let Ok(mut state) = bubble_fullscreen_state().lock() {
        state.app = None;
        state.hidden_for_fullscreen = false;
    }
}

#[cfg(all(desktop, target_os = "windows"))]
fn bubble_fullscreen_worker() {
    loop {
        let app = bubble_fullscreen_state()
            .lock()
            .ok()
            .and_then(|state| state.app.clone());

        let Some(app) = app else {
            let should_exit = bubble_fullscreen_state()
                .lock()
                .map(|mut state| {
                    if state.app.is_none() {
                        state.worker_started = false;
                        true
                    } else {
                        false
                    }
                })
                .unwrap_or(true);
            if should_exit {
                return;
            }
            continue;
        };

        let should_hide = bubble_should_avoid_fullscreen(&app) && is_foreground_fullscreen_window();
        if should_hide {
            let hide_windows = bubble_fullscreen_state()
                .lock()
                .map(|mut state| {
                    if state.hidden_for_fullscreen {
                        false
                    } else {
                        state.hidden_for_fullscreen = true;
                        true
                    }
                })
                .unwrap_or(false);
            if hide_windows {
                if let Some(menu) = app.get_webview_window("floating-bubble-menu") {
                    let _ = menu.hide();
                }
                if let Some(bubble) = app.get_webview_window("floating-bubble") {
                    let _ = bubble.hide();
                }
            }
        } else {
            let restore = bubble_fullscreen_state()
                .lock()
                .map(|mut state| {
                    if state.hidden_for_fullscreen {
                        state.hidden_for_fullscreen = false;
                        true
                    } else {
                        false
                    }
                })
                .unwrap_or(false);
            if restore {
                let app_for_main = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(bubble) = app_for_main.get_webview_window("floating-bubble") {
                        let _ = bubble.show();
                        let _ = bubble.unminimize();
                        refresh_bubble_shapes(&app_for_main);
                    }
                });
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

#[cfg(all(desktop, not(target_os = "windows")))]
fn activate_bubble_fullscreen_watcher(_app: &tauri::AppHandle) {}

#[cfg(all(desktop, not(target_os = "windows")))]
fn deactivate_bubble_fullscreen_watcher() {}

#[cfg(desktop)]
fn refresh_bubble_shapes(_app: &tauri::AppHandle) {
    // WebView2 honors CSS alpha for transparent Tauri windows. Native
    // SetWindowRgn clipping has DPI-dependent coordinates and can slice the
    // bubble artwork or its menu glow, so the frontend owns the visual shape.
}

#[cfg(desktop)]
fn schedule_bubble_shape_refresh(app: &tauri::AppHandle) {
    for delay_ms in [120_u64, 360, 900] {
        let app_for_thread = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            let app_for_main = app_for_thread.clone();
            let _ = app_for_thread.run_on_main_thread(move || {
                refresh_bubble_shapes(&app_for_main);
            });
        });
    }
}

#[cfg(desktop)]
fn is_bubble_enabled_and_show_on_hide(app: &tauri::AppHandle) -> bool {
    cached_settings(app)
        .map(|settings| settings.bubble_enabled && settings.bubble_show_when_main_hidden)
        .unwrap_or(false)
}

// The menu needs a transparent envelope around the visible pill so that its
// glow and shadow are never cut off by the native Windows window region.
const BUBBLE_MENU_CONTENT_WIDTH: f64 = 340.0;
const BUBBLE_MENU_CONTENT_HEIGHT: f64 = 72.0;
const BUBBLE_MENU_BLEED: f64 = 16.0;
const BUBBLE_MENU_OUTER_WIDTH: f64 = BUBBLE_MENU_CONTENT_WIDTH + BUBBLE_MENU_BLEED * 2.0;
const BUBBLE_MENU_OUTER_HEIGHT: f64 = BUBBLE_MENU_CONTENT_HEIGHT + BUBBLE_MENU_BLEED * 2.0;

#[cfg(desktop)]
fn create_bubble_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(bubble) = app.get_webview_window("floating-bubble") {
        return Ok(bubble);
    }

    let settings = cached_settings(app)?;
    let always_on_top = settings.bubble_always_on_top;
    let size = (settings.bubble_size as f64).clamp(48.0, 96.0);
    // `WebviewUrl::App` accepts only an app-relative path. Passing a query
    // string here makes WebView2 resolve a non-existent `index.html?…` asset
    // and leaves the transparent bubble window on about:blank. The frontend
    // loads its own minimal Vite entry instead of the main application bundle.
    let url = WebviewUrl::App("floating-bubble.html".into());
    WebviewWindowBuilder::new(app, "floating-bubble", url)
        .title("OrbitStart Bubble")
        .inner_size(size, size)
        .min_inner_size(48.0, 48.0)
        .max_inner_size(96.0, 96.0)
        .decorations(false)
        .resizable(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(always_on_top)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|error| format!("Failed to create floating bubble window: {error}"))
}

#[cfg(desktop)]
fn create_bubble_menu_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(menu) = app.get_webview_window("floating-bubble-menu") {
        return Ok(menu);
    }

    let always_on_top = cached_settings(app)?.bubble_always_on_top;
    // The menu uses its own entry and does not parse the main application.
    let url = WebviewUrl::App("floating-bubble-menu.html".into());
    WebviewWindowBuilder::new(app, "floating-bubble-menu", url)
        .title("OrbitStart Bubble Menu")
        .inner_size(BUBBLE_MENU_OUTER_WIDTH, BUBBLE_MENU_OUTER_HEIGHT)
        .decorations(false)
        .resizable(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(always_on_top)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|error| format!("Failed to create floating bubble menu: {error}"))
}

#[cfg(desktop)]
fn show_bubble_window(app: &tauri::AppHandle) -> Result<(), String> {
    let bubble = if let Some(bubble) = app.get_webview_window("floating-bubble") {
        bubble
    } else {
        create_bubble_window(app)?
    };
    bubble
        .show()
        .map_err(|error| format!("Failed to show floating bubble: {error}"))?;
    bubble
        .unminimize()
        .map_err(|error| format!("Failed to restore floating bubble: {error}"))?;
    refresh_bubble_shapes(app);
    schedule_bubble_shape_refresh(app);
    activate_bubble_fullscreen_watcher(app);
    Ok(())
}

#[cfg(desktop)]
fn show_bubble_window_in_background(app: tauri::AppHandle) {
    // WebView2 can deadlock or create an empty about:blank view when a new
    // webview is built inside a synchronous Tauri command or window event.
    // Keep window construction off that call stack; this is the pattern
    // required by Tauri on Windows.
    std::thread::spawn(move || {
        if let Err(error) = show_bubble_window(&app) {
            report_bubble_error(&app, &error);
            // Do not leave the user without a reachable window if WebView2
            // fails to initialize the bubble.
            show_and_focus_main(&app);
        }
    });
}

#[cfg(desktop)]
fn hide_bubble_window(app: &tauri::AppHandle) {
    deactivate_bubble_fullscreen_watcher();
    if let Some(menu) = app.get_webview_window("floating-bubble-menu") {
        let _ = menu.destroy();
    }
    if let Some(bubble) = app.get_webview_window("floating-bubble") {
        let _ = bubble.destroy();
    }
}

#[tauri::command]
fn refresh_bubble_native_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        refresh_bubble_shapes(&app);
        schedule_bubble_shape_refresh(&app);
    }
    Ok(())
}

#[cfg(desktop)]
fn close_behavior_setting(app: &tauri::AppHandle) -> String {
    cached_settings(app)
        .map(|settings| settings.close_behavior)
        .unwrap_or_else(|_| "tray".to_string())
}

#[cfg(desktop)]
fn hide_main_and_maybe_show_bubble(app: &tauri::AppHandle) -> Result<(), String> {
    if is_bubble_enabled_and_show_on_hide(app) {
        if let Some(main) = app.get_webview_window("main") {
            main.hide()
                .map_err(|error| format!("Failed to hide main window: {error}"))?;
        }
        show_bubble_window_in_background(app.clone());
    } else {
        hide_bubble_window(app);
        if let Some(main) = app.get_webview_window("main") {
            main.hide()
                .map_err(|error| format!("Failed to hide main window: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn close_or_hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if close_behavior_setting(&app) == "exit" {
        app.exit(0);
        return Ok(());
    }
    hide_main_and_maybe_show_bubble(&app)
}

#[tauri::command]
fn close_current_window(window: tauri::Window, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() == "main" {
        return close_or_hide_main_window(app);
    }
    window
        .close()
        .map_err(|error| format!("Failed to close window: {error}"))
}

#[tauri::command]
fn minimize_current_window(window: tauri::Window) -> Result<(), String> {
    window
        .minimize()
        .map_err(|error| format!("Failed to minimize window: {error}"))
}

#[tauri::command]
fn toggle_maximize_current_window(window: tauri::Window) -> Result<(), String> {
    let is_maximized = window
        .is_maximized()
        .map_err(|error| format!("Failed to read window maximized state: {error}"))?;
    if is_maximized {
        window
            .unmaximize()
            .map_err(|error| format!("Failed to restore window: {error}"))
    } else {
        window
            .maximize()
            .map_err(|error| format!("Failed to maximize window: {error}"))
    }
}

#[tauri::command]
fn log_frontend_error(message: String) {
    eprintln!("FRONTEND ERROR: {}", message);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("frontend_errors.log")
    {
        use std::io::Write;
        let _ = writeln!(file, "{}", message);
    }
}

#[cfg(desktop)]
fn report_bubble_error(app: &tauri::AppHandle, error: &str) {
    let message = format!("Floating bubble error: {error}");
    eprintln!("{message}");
    if let Ok(path) = app_data_dir().map(|dir| dir.join("bubble_errors.log")) {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            use std::io::Write;
            let _ = writeln!(file, "{message}");
        }
    }
    let _ = app.emit("orbit://bubble-error", message);
}

#[tauri::command]
fn exit_floating_mode_and_show_main(
    app: tauri::AppHandle,
    action: Option<String>,
) -> Result<(), String> {
    hide_bubble_window(&app);
    show_and_focus_main(&app);
    if let Some(main) = app.get_webview_window("main") {
        if let Some(act) = action {
            let _ = main.emit("orbit://bubble-action", act);
        }
    }
    Ok(())
}

#[tauri::command]
fn begin_bubble_drag(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(bubble) = app.get_webview_window("floating-bubble") {
            let _ = bubble.start_dragging();
        }
    }
    Ok(())
}

#[tauri::command]
async fn show_bubble_menu_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let bubble = app.get_webview_window("floating-bubble").ok_or_else(|| {
            "Cannot open the bubble menu before the floating bubble exists.".to_string()
        })?;
        if !bubble
            .is_visible()
            .map_err(|error| format!("Failed to read floating bubble visibility: {error}"))?
        {
            return Err(
                "Cannot open the bubble menu while the floating bubble is hidden.".to_string(),
            );
        }

        let menu = if let Some(m) = app.get_webview_window("floating-bubble-menu") {
            refresh_bubble_shapes(&app);
            schedule_bubble_shape_refresh(&app);
            m
        } else {
            let m = create_bubble_menu_window(&app)?;
            refresh_bubble_shapes(&app);
            schedule_bubble_shape_refresh(&app);
            m
        };

        if let Ok(bubble_pos) = bubble.outer_position() {
            if let Ok(bubble_size) = bubble.outer_size() {
                if let Ok(Some(monitor)) = bubble.current_monitor() {
                    let scale_factor = monitor.scale_factor();
                    let monitor_pos = monitor.position();
                    let monitor_size = monitor.size();

                    // Position by the visible pill rather than its larger
                    // transparent shadow envelope. This keeps the menu close
                    // to the bubble while preserving room for a clean glow.
                    let logical_gap = 4.0;
                    let physical_gap = (logical_gap * scale_factor).round() as i32;
                    let physical_menu_width =
                        (BUBBLE_MENU_OUTER_WIDTH * scale_factor).round() as u32;
                    let physical_menu_height =
                        (BUBBLE_MENU_OUTER_HEIGHT * scale_factor).round() as u32;
                    let physical_menu_bleed = (BUBBLE_MENU_BLEED * scale_factor).round() as i32;

                    let monitor_center_x = monitor_pos.x + (monitor_size.width as i32) / 2;
                    let bubble_center_x = bubble_pos.x + (bubble_size.width as i32) / 2;
                    let bubble_visual_diameter = bubble_size.width.min(bubble_size.height) as i32;
                    let bubble_horizontal_inset =
                        ((bubble_size.width as i32 - bubble_visual_diameter) / 2).max(0);
                    let bubble_visual_left = bubble_pos.x + bubble_horizontal_inset;
                    let bubble_visual_right = bubble_visual_left + bubble_visual_diameter;
                    let is_left = bubble_center_x < monitor_center_x;

                    let raw_menu_x = if is_left {
                        bubble_visual_right + physical_gap - physical_menu_bleed
                    } else {
                        bubble_visual_left - physical_menu_width as i32 + physical_menu_bleed
                            - physical_gap
                    };
                    let min_x =
                        monitor_pos.x + (10.0 * scale_factor).round() as i32 - physical_menu_bleed;
                    let max_x = monitor_pos.x + monitor_size.width as i32
                        - (10.0 * scale_factor).round() as i32
                        - physical_menu_width as i32
                        + physical_menu_bleed;
                    let menu_x = raw_menu_x.clamp(min_x, max_x);

                    let bubble_center_y = bubble_pos.y + (bubble_size.height as i32) / 2;
                    let menu_y = bubble_center_y - (physical_menu_height as i32) / 2;

                    let min_y =
                        monitor_pos.y + (10.0 * scale_factor).round() as i32 - physical_menu_bleed;
                    let max_y = monitor_pos.y + monitor_size.height as i32
                        - (10.0 * scale_factor).round() as i32
                        - physical_menu_height as i32
                        + physical_menu_bleed;
                    let menu_y = menu_y.clamp(min_y, max_y);

                    menu.set_position(tauri::PhysicalPosition::new(menu_x, menu_y))
                        .map_err(|error| format!("Failed to position bubble menu: {error}"))?;
                }
            }
        }
        menu.show()
            .map_err(|error| format!("Failed to show bubble menu: {error}"))?;
        menu.unminimize()
            .map_err(|error| format!("Failed to restore bubble menu: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn hide_bubble_menu_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(menu) = app.get_webview_window("floating-bubble-menu") {
            let _ = menu.hide();
        }
    }
    Ok(())
}

#[tauri::command]
fn set_bubble_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<AppSettings, String> {
    let conn = open_db()?;
    set_setting_value(&conn, &key, &value)?;
    let settings = cache_settings_from_connection(&app, &conn)?;

    if key == "bubble_enabled" && !settings.bubble_enabled {
        hide_bubble_window(&app);
    }

    // Apply immediately to bubble window if it exists
    if let Some(bubble) = app.get_webview_window("floating-bubble") {
        if key == "bubble_always_on_top" {
            let _ = bubble.set_always_on_top(value == "true");
        }
        if key == "bubble_size" {
            if let Ok(size) = value.parse::<f64>() {
                let size = size.clamp(48.0, 96.0);
                bubble
                    .set_size(tauri::LogicalSize::new(size, size))
                    .map_err(|error| format!("Failed to resize floating bubble: {error}"))?;
                refresh_bubble_shapes(&app);
                schedule_bubble_shape_refresh(&app);
            }
        }
    }
    if let Some(menu) = app.get_webview_window("floating-bubble-menu") {
        if key == "bubble_always_on_top" {
            let _ = menu.set_always_on_top(value == "true");
        }
    }

    if key == "bubble_avoid_fullscreen" {
        if settings.bubble_enabled && settings.bubble_avoid_fullscreen {
            activate_bubble_fullscreen_watcher(&app);
        } else {
            deactivate_bubble_fullscreen_watcher();
        }
        if settings.bubble_enabled && !settings.bubble_avoid_fullscreen {
            if let Some(bubble) = app.get_webview_window("floating-bubble") {
                if app
                    .get_webview_window("main")
                    .and_then(|main| main.is_visible().ok())
                    .map(|visible| !visible)
                    .unwrap_or(false)
                {
                    let _ = bubble.show();
                    let _ = bubble.unminimize();
                }
            }
        }
    }

    let _ = app.emit("orbit://bubble-settings-changed", settings.clone());
    let _ = app.emit("orbit://settings-updated", settings.clone());
    Ok(settings)
}

#[cfg(desktop)]
fn show_and_focus_main(app: &tauri::AppHandle) {
    hide_bubble_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let behavior = cached_settings(app)
            .map(|settings| settings.hotkey_behavior)
            .unwrap_or_else(|_| "command_bar".to_string());
        if behavior == "open_only" {
            let _ = window.emit("orbit://focus-search", ());
        } else {
            let _ = window.emit("orbit://open-command-bar", ());
        }
    }
}

#[cfg(desktop)]
fn emit_main(app: &tauri::AppHandle, event: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(event, ());
    } else {
        let _ = app.emit(event, ());
    }
}

#[cfg(desktop)]
fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false) {
            let _ = window.hide();
            if is_bubble_enabled_and_show_on_hide(app) {
                show_bubble_window_in_background(app.clone());
            } else {
                hide_bubble_window(app);
            }
        } else {
            hide_bubble_window(app);
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

#[cfg(desktop)]
fn handle_main_window_close(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    api.prevent_close();
    if close_behavior_setting(window.app_handle()) == "exit" {
        window.app_handle().exit(0);
    } else if let Err(error) = hide_main_and_maybe_show_bubble(window.app_handle()) {
        eprintln!("Failed to hide main window for floating bubble: {error}");
    }
}

#[cfg(desktop)]
fn show_navigate_to_group(app: &tauri::AppHandle, group_id: &str) {
    hide_bubble_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("orbit://focus-group", group_id);
    }
}

#[cfg(desktop)]
fn show_navigate_to_subtag(app: &tauri::AppHandle, subtag_path: &str) {
    hide_bubble_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("orbit://focus-subtag", subtag_path);
    }
}

#[cfg(desktop)]
fn normalize_hotkey(hotkey: &str) -> String {
    hotkey.to_lowercase().replace("win", "super")
}

#[cfg(desktop)]
fn handle_global_shortcut_press(
    app: &tauri::AppHandle,
    shortcut: &tauri_plugin_global_shortcut::Shortcut,
) {
    let main_hotkey_str = cached_settings(app)
        .map(|settings| settings.global_hotkey)
        .unwrap_or_else(|_| "Ctrl+Alt+Space".to_string());

    let main_shortcut =
        normalize_hotkey(&main_hotkey_str).parse::<tauri_plugin_global_shortcut::Shortcut>();

    if let Ok(main_sh) = main_shortcut {
        if shortcut == &main_sh {
            show_and_focus_main(app);
            return;
        }
    }

    if let Ok(conn) = open_db() {
        if let Ok(custom_hotkeys) = get_custom_hotkeys(&conn) {
            for (group_id, hotkey_str) in custom_hotkeys {
                if !hotkey_str.is_empty() {
                    if let Ok(sh) = normalize_hotkey(&hotkey_str)
                        .parse::<tauri_plugin_global_shortcut::Shortcut>()
                    {
                        if shortcut == &sh {
                            show_navigate_to_group(app, &group_id);
                            return;
                        }
                    }
                }
            }
        }

        // 动态检查工作区绑定快捷键并触发运行
        if let Ok(mut stmt) =
            conn.prepare("SELECT key, value FROM settings WHERE key LIKE 'hotkey_workspace:%'")
        {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for (key, value) in rows.flatten() {
                    if !value.is_empty() {
                        if let Ok(sh) = normalize_hotkey(&value)
                            .parse::<tauri_plugin_global_shortcut::Shortcut>()
                        {
                            if shortcut == &sh {
                                if let Some(workspace_id) = key.strip_prefix("hotkey_workspace:") {
                                    let _ =
                                        app.emit("orbit://run-workspace", workspace_id.to_string());
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 动态检查子目录绑定快捷键并触发运行
        if let Ok(mut stmt) =
            conn.prepare("SELECT key, value FROM settings WHERE key LIKE 'hotkey_subtag:%'")
        {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for (key, value) in rows.flatten() {
                    if !value.is_empty() {
                        if let Ok(sh) = normalize_hotkey(&value)
                            .parse::<tauri_plugin_global_shortcut::Shortcut>()
                        {
                            if shortcut == &sh {
                                if let Some(subtag_path) = key.strip_prefix("hotkey_subtag:") {
                                    show_navigate_to_subtag(app, subtag_path);
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(desktop)]
fn setup_global_shortcut(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // 从数据库中读取当前热键设置，如果没有，则默认使用 "Ctrl+Alt+Space"
    let hotkey_str = cached_settings(app.handle())
        .map(|settings| settings.global_hotkey)
        .unwrap_or_else(|_| "Ctrl+Alt+Space".to_string());
    let hotkey_str = hotkey_str.to_lowercase();

    let builder =
        tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed {
                handle_global_shortcut_press(app, shortcut);
            }
        });

    if let Err(e) = app.handle().plugin(builder.build()) {
        eprintln!("Failed to register global shortcut plugin: {e}");
    } else {
        // 动态注册从数据库读取的快捷键
        if let Ok(shortcut) =
            normalize_hotkey(&hotkey_str).parse::<tauri_plugin_global_shortcut::Shortcut>()
        {
            if let Err(e) = app.global_shortcut().register(shortcut) {
                eprintln!(
                    "Failed to register initial global shortcut '{}': {}",
                    hotkey_str, e
                );
            }
        }

        // 动态注册从数据库读取的分组绑定快捷键
        if let Ok(conn) = open_db() {
            if let Ok(custom_hotkeys) = get_custom_hotkeys(&conn) {
                for (group_id, hotkey_str) in custom_hotkeys {
                    if !hotkey_str.is_empty() {
                        if let Ok(sh) = normalize_hotkey(&hotkey_str)
                            .parse::<tauri_plugin_global_shortcut::Shortcut>()
                        {
                            if let Err(e) = app.global_shortcut().register(sh) {
                                eprintln!(
                                    "Failed to register group shortcut '{}' for group '{}': {}",
                                    hotkey_str, group_id, e
                                );
                            }
                        }
                    }
                }
            }

            // 动态注册从数据库读取的工作区绑定快捷键
            if let Ok(mut stmt) =
                conn.prepare("SELECT key, value FROM settings WHERE key LIKE 'hotkey_workspace:%'")
            {
                if let Ok(rows) = stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }) {
                    for (key, value) in rows.flatten() {
                        if !value.is_empty() {
                            if let Ok(sh) = normalize_hotkey(&value)
                                .parse::<tauri_plugin_global_shortcut::Shortcut>()
                            {
                                if let Err(e) = app.global_shortcut().register(sh) {
                                    eprintln!(
                                        "Failed to register workspace shortcut '{}' for workspace '{}': {}",
                                        value, key, e
                                    );
                                }
                            }
                        }
                    }
                }
            }

            // 动态注册从数据库读取的子目录绑定快捷键
            if let Ok(mut stmt) =
                conn.prepare("SELECT key, value FROM settings WHERE key LIKE 'hotkey_subtag:%'")
            {
                if let Ok(rows) = stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }) {
                    for (key, value) in rows.flatten() {
                        if !value.is_empty() {
                            if let Ok(sh) = normalize_hotkey(&value)
                                .parse::<tauri_plugin_global_shortcut::Shortcut>()
                            {
                                if let Err(e) = app.global_shortcut().register(sh) {
                                    eprintln!(
                                        "Failed to register subtag shortcut '{}' for subtag '{}': {}",
                                        value, key, e
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(desktop)]
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = MenuBuilder::new(app)
        .text("show", "显示 / 隐藏 OrbitStart")
        .text("settings", "打开设置")
        .text("refresh", "刷新资源索引")
        .text("safe-mode", "切换安全模式")
        .separator()
        .text("data", "打开数据目录")
        .separator()
        .text("quit", "退出")
        .build()?;

    let mut builder = TrayIconBuilder::with_id("orbitstart")
        .tooltip("OrbitStart")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

#[tauri::command]
async fn run_script(
    script_type: String,
    path: Option<String>,
    content: Option<String>,
) -> Result<bool, String> {
    use std::fs;
    use std::process::Command as ProcessCommand;

    let is_temp_file = content.is_some();
    let script_file_path = if let Some(p) = path {
        p
    } else if let Some(c) = content {
        let temp_dir = std::env::temp_dir();
        let extension =
            if script_type.to_lowercase() == "powershell" || script_type.to_lowercase() == "ps1" {
                "ps1"
            } else {
                "bat"
            };
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let file_name = format!("orbitstart_ws_{}.{}", timestamp, extension);
        let file_path = temp_dir.join(file_name);
        fs::write(&file_path, c).map_err(|e| format!("Failed to write temp script file: {}", e))?;
        file_path.to_string_lossy().to_string()
    } else {
        return Err("No path or content provided for script execution".to_string());
    };

    let script_type_lower = script_type.to_lowercase();
    let mut cmd = if script_type_lower == "powershell" || script_type_lower == "ps1" {
        let mut c = ProcessCommand::new("powershell.exe");
        c.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script_file_path,
        ]);
        c
    } else {
        let mut c = ProcessCommand::new("cmd.exe");
        c.args(["/c", &script_file_path]);
        c
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    match cmd.status() {
        Ok(status) => {
            if is_temp_file {
                let _ = fs::remove_file(script_file_path);
            }
            Ok(status.success())
        }
        Err(e) => {
            if is_temp_file {
                let _ = fs::remove_file(script_file_path);
            }
            Err(format!("Failed to execute script: {}", e))
        }
    }
}

#[tauri::command]
fn check_process_running(process_name: String) -> Result<bool, String> {
    use std::process::Command as ProcessCommand;
    let mut cmd = ProcessCommand::new("tasklist.exe");
    cmd.args(["/nh", "/fi", &format!("imagename eq {}", process_name)]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run tasklist: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
    Ok(stdout.contains(&process_name.to_lowercase()))
}

#[tauri::command]
fn check_port_open(address: String) -> Result<bool, String> {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    let addr = if !address.contains(':') {
        format!("{}:80", address)
    } else {
        address.clone()
    };
    match addr.to_socket_addrs() {
        Ok(mut addrs) => {
            if let Some(socket_addr) = addrs.next() {
                match TcpStream::connect_timeout(&socket_addr, Duration::from_millis(500)) {
                    Ok(_) => Ok(true),
                    Err(_) => Ok(false),
                }
            } else {
                Err("No valid socket address found".to_string())
            }
        }
        Err(e) => Err(format!("Invalid address format: {}", e)),
    }
}

#[tauri::command]
fn check_path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn check_url_accessible(url: String) -> bool {
    let Some(parsed) = parse_accessible_http_url(&url) else {
        return false;
    };

    let mut cmd = build_url_check_command(&parsed);
    match cmd.status() {
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

fn build_url_check_command(url: &Url) -> ProcessCommand {
    // Keep the command text constant and pass the user-controlled URL through the child
    // environment. Interpolating it into `-Command` permits PowerShell injection.
    let script = r#"
$ErrorActionPreference = 'Stop'
try {
  $response = Invoke-WebRequest -Uri $env:ORBITSTART_URL_TO_CHECK -UseBasicParsing -TimeoutSec 2
  $status = [int]$response.StatusCode
  if ($status -ge 200 -and $status -lt 400) { exit 0 }
} catch {}
exit 1
"#;
    let mut cmd = ProcessCommand::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    cmd.env("ORBITSTART_URL_TO_CHECK", url.as_str());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

fn parse_accessible_http_url(value: &str) -> Option<Url> {
    let parsed = Url::parse(value.trim()).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    Some(parsed)
}

#[cfg(test)]
mod input_validation_tests {
    use super::*;

    #[test]
    fn accepts_only_plain_http_and_https_urls_for_accessibility_checks() {
        assert!(parse_accessible_http_url("https://example.com/path?q=1").is_some());
        assert!(parse_accessible_http_url("http://127.0.0.1:8080/health").is_some());
        assert!(parse_accessible_http_url("file:///C:/Windows/System32").is_none());
        assert!(parse_accessible_http_url("javascript:alert(1)").is_none());
        assert!(parse_accessible_http_url("https://user:secret@example.com").is_none());
        assert!(parse_accessible_http_url("https://example.com/' ; Write-Output pwned").is_some());
    }

    #[test]
    fn keeps_url_payload_out_of_the_powershell_command_text_and_arguments() {
        let payload = "https://example.com/'%3BWrite-Output-pwned";
        let url = parse_accessible_http_url(payload).expect("payload is a valid URL");
        let command = build_url_check_command(&url);
        assert!(
            command
                .get_args()
                .all(|argument| !argument.to_string_lossy().contains(payload)),
            "untrusted URL must not be an argument to PowerShell -Command"
        );
        let target = command.get_envs().find_map(|(key, value)| {
            (key.to_string_lossy() == "ORBITSTART_URL_TO_CHECK")
                .then(|| value.map(|value| value.to_string_lossy().into_owned()))
                .flatten()
        });
        assert_eq!(target.as_deref(), Some(url.as_str()));
    }

    #[test]
    fn normalizes_note_paths_without_allowing_vault_escapes() {
        assert_eq!(
            normalize_obsidian_note_relative_path("notes\\daily.md")
                .expect("path should normalize"),
            "notes/daily.md"
        );
        assert_eq!(
            normalize_obsidian_note_relative_path("./notes/daily.md")
                .expect("path should normalize"),
            "notes/daily.md"
        );
        for path in [
            "../outside.md",
            "notes/../../outside.md",
            "/outside.md",
            "C:/outside.md",
            "\\\\server\\share\\outside.md",
        ] {
            assert!(
                normalize_obsidian_note_relative_path(path).is_err(),
                "{path} must not be accepted as a vault-relative note path"
            );
        }
    }
}

#[tauri::command]
fn workspaces_pick_file(filter: String, title: String) -> Result<Option<String>, String> {
    pick_file_path(&filter, &title)
}

#[tauri::command]
fn workspaces_pick_folder() -> Result<Option<String>, String> {
    pick_folder_path()
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowLayout {
    pub process_name: String,
    pub window_title: Option<String>,
    pub executable_path: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub is_maximized: Option<bool>,
    pub captured_at: String,
    pub always_on_top: Option<bool>,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct RECT {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct POINT {
    x: i32,
    y: i32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct WINDOWPLACEMENT {
    length: u32,
    flags: u32,
    show_cmd: u32,
    min_position: POINT,
    max_position: POINT,
    normal_position: RECT,
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn EnumWindows(
        lpEnumFunc: unsafe extern "system" fn(*mut std::ffi::c_void, isize) -> i32,
        lParam: isize,
    ) -> i32;
    fn IsWindowVisible(hwnd: *mut std::ffi::c_void) -> i32;
    fn GetWindowTextW(hwnd: *mut std::ffi::c_void, lpString: *mut u16, nMaxCount: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: *mut std::ffi::c_void, lpdwProcessId: *mut u32) -> u32;
    fn GetWindowRect(hwnd: *mut std::ffi::c_void, lpRect: *mut RECT) -> i32;
    fn GetWindowPlacement(hwnd: *mut std::ffi::c_void, lpwndpl: *mut WINDOWPLACEMENT) -> i32;
    fn GetWindowLongW(hwnd: *mut std::ffi::c_void, nIndex: i32) -> i32;
    fn GetClassNameW(hwnd: *mut std::ffi::c_void, lpClassName: *mut u16, nMaxCount: i32) -> i32;
    fn SetWindowPos(
        hwnd: *mut std::ffi::c_void,
        hwndInsertAfter: *mut std::ffi::c_void,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        uFlags: u32,
    ) -> i32;
    fn ShowWindow(hwnd: *mut std::ffi::c_void, nCmdShow: i32) -> i32;
    fn MonitorFromPoint(pt: POINT, dwFlags: u32) -> *mut std::ffi::c_void;
    fn SetForegroundWindow(hwnd: *mut std::ffi::c_void) -> i32;
    fn SetActiveWindow(hwnd: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(
        dwDesiredAccess: u32,
        bInheritHandle: i32,
        dwProcessId: u32,
    ) -> *mut std::ffi::c_void;
    fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
    fn QueryFullProcessImageNameW(
        hProcess: *mut std::ffi::c_void,
        dwFlags: u32,
        lpExeName: *mut u16,
        lpdwSize: *mut u32,
    ) -> i32;
    fn GetCurrentProcessId() -> u32;
}

#[cfg(target_os = "windows")]
struct WindowMatchQuery {
    process_name: String,
    window_title: Option<String>,
    executable_path: Option<String>,
    found_hwnd: Option<*mut std::ffi::c_void>,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_windows_callback(hwnd: *mut std::ffi::c_void, lparam: isize) -> i32 {
    let list = &mut *(lparam as *mut Vec<WorkspaceWindowLayout>);

    if IsWindowVisible(hwnd) == 0 {
        return 1;
    }

    let mut title_buf = [0u16; 512];
    let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
    if len <= 0 {
        return 1;
    }
    let window_title = String::from_utf16_lossy(&title_buf[..len as usize]);

    let style = GetWindowLongW(hwnd, -16);
    if (style & 0x40000000) != 0 {
        // WS_CHILD
        return 1;
    }
    let ex_style = GetWindowLongW(hwnd, -20);
    if (ex_style & 0x00000080) != 0 {
        // WS_EX_TOOLWINDOW
        return 1;
    }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == 0 {
        return 1;
    }

    let h_process = OpenProcess(0x1000, 0, pid);
    let mut exe_path = "unknown".to_string();
    let mut process_name = "unknown.exe".to_string();

    if !h_process.is_null() {
        let mut path_buf = [0u16; 1024];
        let mut size: u32 = 1024;
        let success = QueryFullProcessImageNameW(h_process, 0, path_buf.as_mut_ptr(), &mut size);
        CloseHandle(h_process);

        if success != 0 {
            exe_path = String::from_utf16_lossy(&path_buf[..size as usize]);
            process_name = std::path::Path::new(&exe_path)
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_else(|| "unknown.exe".to_string());
        }
    }

    let exe_path_lower = exe_path.to_lowercase();
    if exe_path_lower.contains("explorer.exe") {
        let mut class_buf = [0u16; 256];
        let class_len = GetClassNameW(hwnd, class_buf.as_mut_ptr(), 256);
        let class_name = if class_len > 0 {
            String::from_utf16_lossy(&class_buf[..class_len as usize])
        } else {
            "".to_string()
        };
        if class_name != "CabinetWClass" {
            return 1;
        }
    } else if exe_path_lower.contains("searchhost.exe")
        || exe_path_lower.contains("shellexperiencehost.exe")
        || exe_path_lower.contains("startmenuexperiencehost.exe")
        || exe_path_lower.contains("taskmgr.exe")
        || exe_path_lower.contains("systemsettings.exe")
    {
        return 1;
    }

    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if GetWindowRect(hwnd, &mut rect) == 0 {
        return 1;
    }

    let mut placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        flags: 0,
        show_cmd: 0,
        min_position: POINT { x: 0, y: 0 },
        max_position: POINT { x: 0, y: 0 },
        normal_position: RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
    };

    let is_maximized = if GetWindowPlacement(hwnd, &mut placement) != 0 {
        Some(placement.show_cmd == 3)
    } else {
        Some(false)
    };

    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;

    if width < 100 || height < 100 {
        return 1;
    }

    list.push(WorkspaceWindowLayout {
        process_name,
        window_title: Some(window_title),
        executable_path: Some(exe_path),
        x: rect.left,
        y: rect.top,
        width,
        height,
        is_maximized,
        captured_at: "".to_string(),
        always_on_top: Some(false),
    });

    1
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_windows_match_callback(
    hwnd: *mut std::ffi::c_void,
    lparam: isize,
) -> i32 {
    let query = &mut *(lparam as *mut WindowMatchQuery);

    if IsWindowVisible(hwnd) == 0 {
        return 1;
    }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == 0 {
        return 1;
    }

    let h_process = OpenProcess(0x1000, 0, pid);
    let mut path_buf = [0u16; 1024];
    let mut size: u32 = 1024;
    let success = if !h_process.is_null() {
        let ok = QueryFullProcessImageNameW(h_process, 0, path_buf.as_mut_ptr(), &mut size);
        CloseHandle(h_process);
        ok
    } else {
        0
    };

    if success != 0 {
        let exe_path = String::from_utf16_lossy(&path_buf[..size as usize]);
        let process_name = std::path::Path::new(&exe_path)
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default();

        let is_proc_match = if let Some(ref target_path) = query.executable_path {
            target_path.to_lowercase() == exe_path.to_lowercase()
        } else {
            query.process_name.to_lowercase() == process_name.to_lowercase()
        };

        if is_proc_match {
            if let Some(ref target_title) = query.window_title {
                let mut title_buf = [0u16; 512];
                let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
                if len > 0 {
                    let title = String::from_utf16_lossy(&title_buf[..len as usize]);
                    if !title.to_lowercase().contains(&target_title.to_lowercase()) {
                        return 1;
                    }
                } else {
                    return 1;
                }
            }

            query.found_hwnd = Some(hwnd);
            return 0;
        }
    }

    1
}

#[tauri::command]
fn workspaces_capture_active_windows() -> Result<Vec<WorkspaceWindowLayout>, String> {
    let mut list: Vec<WorkspaceWindowLayout> = Vec::new();
    #[cfg(target_os = "windows")]
    unsafe {
        EnumWindows(
            enum_windows_callback,
            &mut list as *mut Vec<WorkspaceWindowLayout> as isize,
        );

        let mut log = String::new();
        log.push_str(&format!("Captured Windows Count: {}\n", list.len()));
        for (i, win) in list.iter().enumerate() {
            log.push_str(&format!(
                "[{}] Process: '{}', Title: '{:?}', Path: '{:?}', Rect: ({}, {}, {}, {})\n",
                i,
                win.process_name,
                win.window_title,
                win.executable_path,
                win.x,
                win.y,
                win.width,
                win.height
            ));
        }
        let temp_path = std::env::temp_dir().join("orbitstart_capture_debug.log");
        let _ = std::fs::write(temp_path, log);
    }
    Ok(list)
}

#[tauri::command]
fn workspaces_apply_window_layout(layout: WorkspaceWindowLayout) -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        let mut query = WindowMatchQuery {
            process_name: layout.process_name.clone(),
            window_title: layout.window_title.clone(),
            executable_path: layout.executable_path.clone(),
            found_hwnd: None,
        };

        EnumWindows(
            enum_windows_match_callback,
            &mut query as *mut WindowMatchQuery as isize,
        );

        if let Some(hwnd) = query.found_hwnd {
            ShowWindow(hwnd, 9); // SW_RESTORE
            SetForegroundWindow(hwnd);
            SetActiveWindow(hwnd);

            let hwnd_insert_after = if layout.always_on_top.unwrap_or(false) {
                -1_isize as *mut std::ffi::c_void // HWND_TOPMOST
            } else {
                -2_isize as *mut std::ffi::c_void // HWND_NOTOPMOST
            };

            if layout.is_maximized.unwrap_or(false) {
                ShowWindow(hwnd, 3); // SW_SHOWMAXIMIZED
            } else {
                let h_monitor = MonitorFromPoint(
                    POINT {
                        x: layout.x,
                        y: layout.y,
                    },
                    0,
                );
                let (final_x, final_y) = if h_monitor.is_null() {
                    (100, 100)
                } else {
                    (layout.x, layout.y)
                };

                SetWindowPos(
                    hwnd,
                    hwnd_insert_after,
                    final_x,
                    final_y,
                    layout.width,
                    layout.height,
                    0x0040 | 0x0004 | 0x0010,
                );
            }
            return true;
        }
    }
    false
}

pub fn run() {
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            log_frontend_error,
            catalog_snapshot,
            window_appearance,
            create_item,
            reorder_items,
            reorder_groups,
            get_group_hotkeys,
            update_group_hotkey,
            get_subtag_hotkeys,
            update_subtag_hotkey,
            create_items_from_paths,
            pick_resource_input,
            pick_icon_image,
            create_group,
            create_custom_group,
            delete_group,
            list_trips,
            create_trip,
            update_trip,
            mark_trip_viewed,
            delete_trip,
            search_trips,
            trip_count_for_items,
            pick_obsidian_vault_path,
            list_obsidian_vaults,
            add_obsidian_vault,
            remove_obsidian_vault,
            scan_obsidian_vault,
            list_obsidian_tasks,
            list_obsidian_notes,
            toggle_obsidian_note_favorite,
            list_obsidian_note_tasks,
            search_obsidian,
            open_obsidian_note,
            open_obsidian_todo_window,
            set_todo_window_always_on_top,
            toggle_obsidian_task_completion,
            update_item,
            delete_item,
            launch_item,
            launch_target,
            launch_target_with_args,
            reveal_target,
            get_item_path_status,
            scan_shortcuts,
            scan_browser_bookmarks,
            update_global_hotkey,
            preview_scan_shortcuts,
            preview_scan_browser_bookmarks,
            import_scanned_items,
            hydrate_shortcut_icons,
            set_plugin_enabled,
            set_active_theme,
            set_density,
            set_close_behavior,
            set_safe_mode,
            set_auto_pinned_mode,
            set_display_mode,
            set_resource_mode,
            set_hotkey_behavior,
            read_plugin_runtime,
            record_plugin_runtime_event,
            export_catalog_json,
            import_catalog_json,
            create_plugin_template,
            open_data_directory,
            reset_software,
            open_aux_window,
            get_autostart_enabled,
            set_autostart_enabled,
            refresh_bubble_native_window,
            close_or_hide_main_window,
            close_current_window,
            minimize_current_window,
            toggle_maximize_current_window,
            exit_floating_mode_and_show_main,
            set_bubble_setting,
            begin_bubble_drag,
            show_bubble_menu_window,
            hide_bubble_menu_window,
            run_script,
            check_process_running,
            check_port_open,
            check_path_exists,
            check_url_accessible,
            workspaces_pick_file,
            workspaces_pick_folder,
            workspaces_capture_active_windows,
            workspaces_apply_window_layout,
            get_workspace_hotkeys,
            update_workspace_hotkey
        ])
        .setup(|app| {
            let settings = initialize_database().map_err(std::io::Error::other)?;
            app.manage(AppState {
                settings: RwLock::new(settings),
            });
            #[cfg(desktop)]
            setup_global_shortcut(app)?;
            #[cfg(desktop)]
            setup_tray(app)?;
            #[cfg(desktop)]
            {
                if let Err(error) = app
                    .handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())
                {
                    let message = format!("Updater plugin initialization failed: {error}");
                    eprintln!("{message}");
                    if let Err(log_error) = log_plugin_event_raw("updater", "error", &message) {
                        eprintln!("Failed to persist updater initialization error: {log_error}");
                    }
                }
                let _ = app.handle().plugin(tauri_plugin_process::init());
                let _ = app.handle().plugin(tauri_plugin_dialog::init());
                let _ =
                    app.handle()
                        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                            show_and_focus_main(app);
                        }));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            handle_main_window_close(window, event);
            #[cfg(desktop)]
            handle_todo_window_dock(window, event);
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                app.exit(0);
            } else if event.id() == "show" {
                toggle_main_window(app);
            } else if event.id() == "settings" {
                show_and_focus_main(app);
                emit_main(app, "orbit://open-settings");
            } else if event.id() == "refresh" {
                emit_main(app, "orbit://refresh-resources");
            } else if event.id() == "safe-mode" {
                emit_main(app, "orbit://toggle-safe-mode");
            } else if event.id() == "data" {
                let _ = open_data_directory();
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("failed to run OrbitStart");
}

fn main() {
    run();
}

fn workspaces_plugin_manifest() -> &'static str {
    r#"{
  "id": "workspaces",
  "name": "Workspaces",
  "version": "0.1.0",
  "description": "用于 Windows 桌面管理的工作区实用工具，一键按顺序启动相关应用与配置。",
  "enabled": true,
  "builtin": false,
  "permissions": [
    { "id": "catalog:read", "label": "读取已有资源列表", "risk": "low" },
    { "id": "launcher:item", "label": "启动已保存资源", "risk": "low" },
    { "id": "launcher:target", "label": "启动配置目标", "risk": "high" },
    { "id": "shell:script-file", "label": "运行选定脚本文件", "risk": "high" },
    { "id": "shell:inline-script", "label": "运行内联脚本内容", "risk": "critical" },
    { "id": "filesystem:exists", "label": "检查路径是否存在", "risk": "medium" },
    { "id": "network:probe", "label": "探测端口和网址", "risk": "medium" },
    { "id": "process:read", "label": "检查进程运行状态", "risk": "medium" },
    { "id": "window:layout", "label": "恢复窗口布局", "risk": "high" },
    { "id": "ui:toast", "label": "显示通知消息", "risk": "low" },
    { "id": "storage:plugin", "label": "读写本插件的本地存储数据", "risk": "low" }
  ],
  "contributes": {
    "commands": 20,
    "searchProviders": 1,
    "themes": 0,
    "views": 1
  }
}
"#
}

fn workspaces_plugin_source() -> &'static str {
    include_str!("../../plugins/workspaces/main.ts")
}

fn workspaces_plugin_api_types() -> &'static str {
    r#"export interface OrbitPlugin {
  activate(ctx: OrbitPluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export interface OrbitPluginContext {
  commands: { registerCommand(command: RegisteredCommand): () => void };
  search: { registerProvider(id: string, provider: SearchProvider): () => void };
  ui: { toast(message: string): void };
  storage: PluginStorage;
  launcher: WorkspaceLauncher;
}

export interface RegisteredCommand {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  keywords: string[];
  run(): void | Promise<void>;
}

export type SearchProvider = (query: string) => SearchResult[] | Promise<SearchResult[]>;

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  source: string;
  actionLabel: string;
  run?(): void | Promise<void>;
}

export interface PluginStorage {
  get<T = unknown>(key: string, fallbackValue?: T): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  list(): Promise<Array<{ key: string; value: unknown }>>;
}

export interface WorkspaceLauncher {
  launchItem(id: string): Promise<boolean>;
  launchTarget(target: string, arguments?: string, workingDirectory?: string): Promise<boolean>;
  runScript(scriptType: string, path?: string | null, content?: string | null): Promise<boolean>;
  checkProcessRunning(processName: string): Promise<boolean>;
  checkPortOpen(address: string): Promise<boolean>;
  checkPathExists(path: string): Promise<boolean>;
  checkUrlAccessible(url: string): Promise<boolean>;
  applyWindowLayout(layout: WorkspaceWindowLayout): Promise<boolean>;
}

export interface WorkspaceWindowLayout {
  processName: string;
  windowTitle?: string | null;
  executablePath?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized?: boolean | null;
  capturedAt: string;
  alwaysOnTop?: boolean | null;
}
"#
}

fn workspaces_plugin_readme() -> &'static str {
    "Workspaces plugin for OrbitStart. Its launch, script, probe, process, path, and window-layout permissions are intentionally granted separately."
}

#[cfg(test)]
mod workspaces_plugin_manifest_tests {
    use super::*;
    use std::collections::BTreeSet;

    fn permission_ids(manifest: &PluginManifest) -> BTreeSet<String> {
        manifest
            .permissions
            .iter()
            .map(|permission| permission.id.clone())
            .collect()
    }

    #[test]
    fn workspaces_manifest_uses_only_the_granular_launcher_permissions() {
        let generated: PluginManifest = serde_json::from_str(workspaces_plugin_manifest())
            .expect("generated workspaces manifest should be valid JSON");
        let checked_in: PluginManifest =
            serde_json::from_str(include_str!("../../plugins/workspaces/plugin.json"))
                .expect("checked-in workspaces manifest should be valid JSON");
        let expected = [
            "catalog:read",
            "launcher:item",
            "launcher:target",
            "shell:script-file",
            "shell:inline-script",
            "filesystem:exists",
            "network:probe",
            "process:read",
            "window:layout",
            "ui:toast",
            "storage:plugin",
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<BTreeSet<_>>();

        assert_eq!(permission_ids(&generated), expected);
        assert_eq!(permission_ids(&checked_in), expected);
        assert!(!permission_ids(&generated).contains("shell:open"));
        assert!(generated
            .permissions
            .iter()
            .any(|permission| permission.id == "shell:inline-script"
                && permission.risk == "critical"));
    }

    #[test]
    fn workspaces_generated_api_types_cover_its_launcher_calls() {
        let api_types = workspaces_plugin_api_types();
        for method in [
            "launchItem",
            "launchTarget",
            "runScript",
            "checkProcessRunning",
            "checkPortOpen",
            "checkPathExists",
            "checkUrlAccessible",
            "applyWindowLayout",
        ] {
            assert!(
                api_types.contains(method),
                "missing launcher API type: {method}"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_print_windows() {
        unsafe {
            unsafe extern "system" fn test_callback(
                hwnd: *mut std::ffi::c_void,
                _lparam: isize,
            ) -> i32 {
                let visible = IsWindowVisible(hwnd);
                let mut title_buf = [0u16; 512];
                let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
                let window_title = if len > 0 {
                    String::from_utf16_lossy(&title_buf[..len as usize])
                } else {
                    "".to_string()
                };

                let style = GetWindowLongW(hwnd, -16);
                let ex_style = GetWindowLongW(hwnd, -20);

                let mut pid = 0;
                GetWindowThreadProcessId(hwnd, &mut pid);

                let h_process = OpenProcess(0x1000, 0, pid);
                let mut process_name = "unknown.exe".to_string();
                if !h_process.is_null() {
                    let mut path_buf = [0u16; 1024];
                    let mut size = 1024;
                    if QueryFullProcessImageNameW(h_process, 0, path_buf.as_mut_ptr(), &mut size)
                        != 0
                    {
                        let exe_path = String::from_utf16_lossy(&path_buf[..size as usize]);
                        if let Some(f) = std::path::Path::new(&exe_path).file_name() {
                            process_name = f.to_string_lossy().into_owned();
                        }
                    }
                    CloseHandle(h_process);
                }

                if visible != 0 || len > 0 {
                    println!(
                        "HWND: {:?}, Title: '{}', Proc: '{}', Visible: {}, Style: 0x{:X}, ExStyle: 0x{:X}, PID: {}",
                        hwnd, window_title, process_name, visible, style, ex_style, pid
                    );
                }
                1
            }
            EnumWindows(test_callback, 0);
        }
    }
}
