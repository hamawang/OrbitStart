# Environment Notes

## 2026-06-10 Windows Rust/Tauri check

Status: fixed.

Installed Visual Studio Build Tools 2022 with the C++ workload and Windows 10/11 SDK through winget.

Frontend validation passes:

```powershell
npm.cmd install
npm.cmd run build
```

Tauri/Rust validation now passes:

```powershell
cargo check
npm.cmd run tauri:build
```

To refresh the directly runnable production executable at
`src-tauri\target\release\orbitstart.exe`, use:

```powershell
npm.cmd run build:release-exe
```

Do not substitute a bare `cargo build --release` command here. Tauri requires
the `custom-protocol` feature for a standalone production executable; without
it, the executable intentionally loads the development URL
`http://127.0.0.1:1420` and will fail when the Vite server is not running.

The signed-release script synchronizes its verified standalone executable back
to this default target after packaging. If OrbitStart is running and Windows
locks the file, the release remains valid and the script emits a warning; close
the app, then run `npm.cmd run build:release-exe` to complete the local sync.

Build outputs:

```text
src-tauri/target/release/orbitstart.exe
src-tauri/target/release/bundle/msi/OrbitStart_0.1.0_x64_en-US.msi
src-tauri/target/release/bundle/nsis/OrbitStart_0.1.0_x64-setup.exe
```

Original issue:

Tauri/Rust validation was blocked by the local Windows native toolchain, not by OrbitStart source code.

Observed facts:

- `where.exe link` resolves to `E:\sx\Git\usr\bin\link.exe`.
- That `link.exe` is not the MSVC linker and rejects MSVC linker arguments.
- The project includes `.cargo/config.toml` to use Rust's bundled `rust-lld.exe` instead of the wrong Git `link.exe`.
- `rust-lld.exe` then reports missing Windows SDK import libraries such as `kernel32.lib`, `ntdll.lib`, `userenv.lib`, `ws2_32.lib`, and `dbghelp.lib`.
- No `kernel32.lib` was found under `C:\Program Files (x86)\Windows Kits`.

Applied fix:

Installed:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools
```

In the installer, include:

- Desktop development with C++
- MSVC v143 build tools
- Windows 10 or Windows 11 SDK

After installation, verified:

```powershell
Get-ChildItem -Recurse 'C:\Program Files (x86)\Windows Kits' -Filter kernel32.lib -ErrorAction SilentlyContinue | Select-Object -First 5 FullName
cargo check
```

The project also pins the installed MSVC linker and SDK library paths in `.cargo/config.toml`, so Cargo does not accidentally pick up `E:\sx\Git\usr\bin\link.exe`.
