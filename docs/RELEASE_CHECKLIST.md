# OrbitStart 发布验收清单

每个 Windows 版本发布前，先在干净的工作区执行：

~~~powershell
npm.cmd run version:check -- --expect-version <version>
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:e2e:themes
npm.cmd run test:custom
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
~~~

## 签名与更新清单

- [ ] 仅从受保护的密钥位置读取 TAURI_SIGNING_PRIVATE_KEY 和口令；密钥或口令不写入仓库、日志或 Release。
- [ ] 关闭正在运行的 OrbitStart 后执行 npm.cmd run tauri:build -- --ci。
- [ ] 确认 NSIS 安装包和同名 .sig 均由本次构建生成。
- [ ] 使用 tools/create-updater-manifest.mjs 从该安装包和同名 .sig 生成 latest.json，不复制旧签名。
- [ ] 执行 npm.cmd run release:verify -- --expect-version <version>。
- [ ] 上传安装包、同名 .sig 和 latest.json 到 GitHub Release v<version>。
- [ ] 不将 `--no-sign` 或 `createUpdaterArtifacts: false` 生成的手动安装包作为 GitHub Release 或自动更新资产。
- [ ] 若私钥无法恢复，不直接替换线上 updater 公钥；先制定并验证一次手动安装的信任迁移方案。

## Windows 人工验收

- [ ] 覆盖安装上一版本，确认资源、分组、主题、插件和设置仍存在。
- [ ] 验证启动、托盘隐藏/退出、全局快捷键、开机启动和悬浮球。
- [ ] 验证自动更新检查能读取 Release 中的 latest.json，签名失败时不会替换现有安装。
- [ ] 验证卸载后按产品约定保留或清理用户数据。
- [ ] 在 SmartScreen 出现时记录签名与信誉状态，不绕过系统安全提示。
- [ ] 若使用便携模式，复制包含 portable.flag 或 OrbitStart.Data 的完整目录后，确认数据和 data-relative 资源仍可用。

## 发布后

- [ ] 从 GitHub Release 下载一次安装包，确认文件完整且版本正确。
- [ ] 确认 https://github.com/xuxinxi14/OrbitStart/releases/latest/download/latest.json 可访问并引用当前 Release 的安装包。
- [ ] 记录未完成的人工性能测量或兼容性验证，不以构建通过替代实际验收。
