# 优化实施状态（2026-07-26）

本文件记录本次按优化指导完成的改动、验证结果与未在没有额外决策时擅自推进的事项。

## 已完成

- 原生调用：Tauri bridge 存在时，IPC 失败会作为 `NativeCommandError` 传回调用方并写入原生日志；只有无 bridge 的浏览器预览模式保留 localStorage fallback。
- 数据库生命周期：schema 初始化和默认数据 bootstrap 仅在启动或显式重置时执行；普通命令保持短连接，窗口生命周期读取已缓存设置。
- 数据库迁移：使用 `PRAGMA user_version`、`BEGIN IMMEDIATE` 事务和迁移前在线备份；覆盖空库、旧库、重复迁移和失败回滚的 Rust 测试。
- 前端加载：悬浮球使用仅包含主题与设置的 `window_appearance` 接口；工作区、悬浮球、行程与引导页拆成按需 chunk。
- 定向更新：资源 create/update/delete 使用定向事件和按 id 的幂等状态更新；常用设置命令返回 `AppSettings`，不再返回完整 `CatalogSnapshot`。
- URL 安全：`check_url_accessible` 只接受无凭据的 HTTP(S) URL，并通过子进程环境变量传入固定 PowerShell 脚本，消除命令字符串插值；脚本同时兼容 Windows PowerShell 5.1。
- Obsidian 路径安全：打开笔记前会 canonicalize vault 和目标文件，拒绝绝对路径、盘符/UNC、`..` 越界和解析到 vault 外的链接目标；丢失笔记会提示重新扫描。
- 发布防回归：lockfile 根版本已同步；新增 `npm run version:check` 与 `npm run release:verify`；前端版本由 `src/appVersion.ts` 统一读取；updater 插件初始化失败会写入本地插件日志。
- CI 与测试：新增 Windows CI 和 tag/手动触发的发布就绪校验；后者不签名或发布，但会拒绝 tag 与 updater 清单不一致的版本。`npm run test:custom` 在端口空闲时会启动并回收自己的 Vite 进程。
- 阶段 6（前端文件拆分）：已将导入过滤、分组规范化、子标签树与资源输入转换抽离至 `src/features/catalog/model.ts`；将窗口标签解析、悬浮球主题加载和悬浮窗口挂载抽离至 `src/app/WindowRouter.tsx`；将资源分组标签、资源行、子标签区和根目录拖放区抽离至 `src/features/catalog/ResourceList.tsx`；将窗口边框缩放控件抽离至 `src/components/layout/WindowResizeEdges.tsx`。主应用组合逻辑仍保留在 `App.tsx`。

## 验证结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run build` | 通过 | 主 JS gzip 从基线 169.75 kB 降为 145.00 kB。 |
| 按需 chunks | 通过 | `Workspaces` 82.23 kB，`FloatingBubble` 10.44 kB，`TripPanel` 9.72 kB，`OnboardingWizard` 4.91 kB。 |
| `cargo fmt --check` | 通过 | Rust 格式检查通过。 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 | 含迁移、缓存、定向事件和输入校验改动。 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 通过 | 19/19，无 Rust 编译警告。 |
| `npm run test:e2e` | 通过 | 14/14，约 1.9 分钟。 |
| `npm run test:custom` | 通过 | 验证自动启动及回收 Vite。 |
| `npm run version:check` | 通过 | npm、lockfile、Cargo 与 Tauri 配置版本一致。 |
| `npm run release:verify -- --expect-version 0.8.2` | 通过 | 0.8.2 的更新清单、安装包 URL 和真实签名备注一致。 |
| `npm run tauri:build -- --ci` | 通过 | 已生成并签名 0.8.2 的 NSIS 和 MSI 安装包。 |
| 阶段 6 两个前端拆分小步后的 `npm run build` | 通过 | TypeScript 检查和 Vite 构建通过；未将 bundle 体积的微小波动作为性能结论。 |
| 阶段 6 第二小步后的 `npm run test:e2e` | 通过 | 14/14，包括悬浮球 URL 路由和 Tauri 窗口标签路由。 |
| 阶段 6 第三小步后的 `npm run test:e2e` | 通过 | 14/14，包括子标签、外部拖放、批量选择和资源操作。 |
| 关闭桌面应用后的 `npm.cmd run tauri:build -- --no-bundle --ci` | 通过 | release 可执行文件成功编译，已验证原先的输出文件锁不再存在。 |

## 未实施项与原因

- 多入口构建第二轮：当前已完成按需加载和窄接口，但悬浮球仍共享主应用入口代码。实现独立入口需要先整理窗口路由和共享 UI 边界。
- 大文件拆分：`App.tsx` 已完成两次小范围抽离，但仍然较大；`src-tauri/src/main.rs` 和全局 CSS 也仍然较大。后续应继续按功能边界拆分，避免与正确性修复混合。
- Portable mode：数据根目录、插件/主题携带范围、绝对路径如何转为 workspace 相对路径属于用户数据兼容策略，未在无明确策略时假定行为。
- 插件权限与 CSP：本地插件可自声明权限并默认启用的模型仍须改造。CSP 还受 worker 的 `unsafe-eval`、Google Fonts 和 blob URL 约束；需要先确定签名、默认拒绝和网络范围策略。
- 正式 updater 发布：0.8.2 已使用新的 updater 密钥生成真实签名并更新清单；仍需将 NSIS 安装包与同名 `.sig` 上传到 GitHub Release `v0.8.2`。旧版因信任旧公钥，必须先手动安装 0.8.2，随后版本才能恢复自动更新。
- 主题 E2E：既有 `npm run test:e2e:themes` 超时问题未被删除或放宽；在其单独收敛前，不将主题套件标为通过。

## 性能测量边界

bundle 变化不等同于 WebView2 总内存变化。Windows 场景 A–E 仍须在同一台机器、同一安装包、相同窗口组合下，使用 `tools/measure-processes.ps1` 采集优化前后数据。现有运行中的未知窗口会话不作为受控性能结论。
