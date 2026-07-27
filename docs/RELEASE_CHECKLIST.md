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
- [ ] 将私钥、口令和 `.pub` 保存于 Git 忽略的 `release-secrets-local/`，并保留加密备份；确认 `.pub` 的 Base64 文本与 `tauri.conf.json` 的 updater 公钥完全一致，不能再次编码。
- [ ] 执行 `powershell -ExecutionPolicy Bypass -File tools/build-signed-release.ps1`；脚本会隔离 Cargo 目标目录，因此不受运行中默认 release 输出锁定影响。
- [ ] 确认 `release-artifacts/signed-<version>/` 中的 NSIS 安装包、同名 `.sig` 和 `latest.json` 均由本次脚本生成；脚本必须先通过独立 minisign 验签和 release 校验。
- [ ] 上传安装包、同名 .sig 和 latest.json 到 GitHub Release v<version>。
- [ ] 不将 `--no-sign` 或 `createUpdaterArtifacts: false` 生成的手动安装包作为 GitHub Release 或自动更新资产。
- [ ] 若需要轮换 updater 公钥，先记录迁移原因、更新公告和手动安装路径；不要期望旧版本自动验证新密钥。

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
