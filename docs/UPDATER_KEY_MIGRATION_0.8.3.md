# 0.8.3 updater 签名记录

日期：2026-07-27

## 密钥核验

0.8.3 使用当前受保护发布目录中保存的 `orbitstart-updater-private.key` 及其配对公钥。`.pub` 文件已经是 Tauri 配置所需的 Base64 文本，必须与 `tauri.conf.json` 的 `plugins.updater.pubkey` 完全一致，不能再次进行 Base64 编码。

已核验这套私钥、公钥与配置一致；本次没有轮换 updater 公钥，因此保留已有的 0.8.2 自动更新信任链。

## 发布约束

- 不得复用旧 `.sig`、伪造 `latest.json`，或把 `.pub` 文件再次编码后写入配置。
- 若未来确实需要轮换公钥，必须先记录迁移原因、公告和手动安装路径；旧版本不能自动验证新密钥。

## 密钥保管与后续发布

- 私钥和口令只保存在被 Git 忽略的 `release-secrets-local/`，不写入源代码、文档、日志、Release 附件或环境配置文件。
- 该目录应包含 `orbitstart-updater-private.key`、`orbitstart-updater-password.txt` 与配对的 `.pub` 文件；建议将其加密备份到用户可恢复的位置。`.pub` 是公开信息，私钥和口令不是。
- 以 `powershell -ExecutionPolicy Bypass -File tools/build-signed-release.ps1` 构建。脚本会读取上述文件、在隔离的 Cargo 目标目录中构建、生成 NSIS 安装包与 `.sig`，再用 `verify_updater_signature` 对安装包执行独立 minisign 验签，之后才创建 `latest.json` 并运行 release 校验；脚本退出后会清除其设置的签名环境变量。
- Tauri updater `.sig` 不等同于 Windows Authenticode 证书签名。若需要改善 SmartScreen 信誉，需另行配置受信任的代码签名证书。
