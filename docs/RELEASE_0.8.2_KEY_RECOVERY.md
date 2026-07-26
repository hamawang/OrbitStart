# OrbitStart 0.8.2：发布签名密钥恢复记录

记录日期：2026-07-26

## 已完成

- 旧 updater 私钥已确认丢失；原先提供的内容是旧安装包的签名，不是私钥，因此不能用于重新签名。
- 已生成一套新的、带随机口令的 Tauri updater 密钥对，并已将公钥写入 `src-tauri/tauri.conf.json`。
- 私钥、口令、公钥和保管说明存放在本机受限目录：`C:\Users\19701\Documents\OrbitStart-Release-Secrets`。该目录不属于 Git 仓库，不应提交、上传或通过聊天发送私钥和口令。
- 已生成并签名 Windows 安装包 `OrbitStart_0.8.2_x64-setup.exe`，并以其实际 `.sig` 更新 `latest.json`。

## 兼容性结论

由于 0.8.2 使用新的公钥，已安装的旧版本仍信任旧公钥，无法验证 0.8.2 的新签名。因此旧版本用户必须先手动安装 0.8.2；从 0.8.2 开始，后续版本可以继续使用新私钥签名并恢复自动更新。

## 发布前操作

1. 将 NSIS 安装包和同名 `.sig` 上传到 GitHub Release `v0.8.2`。
2. 将本仓库的 `latest.json` 与版本及公钥配置一并提交并推送到 `main`。
3. 确认 `https://github.com/xuxinxi14/OrbitStart/releases/download/v0.8.2/OrbitStart_0.8.2_x64-setup.exe` 可访问后，再将更新清单对外发布。
4. 将口令文件移到独立的密码管理器或离线备份；至少保留两份受控备份的私钥和口令，且不要放入同一个公开仓库。

## 产物校验

- 安装包：`src-tauri/target/release/bundle/nsis/OrbitStart_0.8.2_x64-setup.exe`
- SHA-256：`241B1E1B4A582E70F03126D88A07C02947C164FCDB6D4844019111BB09D6D605`
- 签名可信备注：`file:OrbitStart_0.8.2_x64-setup.exe`
