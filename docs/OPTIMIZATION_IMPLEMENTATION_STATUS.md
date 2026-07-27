# 优化实施状态（2026-07-27）

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
- 阶段 6（前端文件拆分）：已将导入过滤、分组规范化、子标签树与资源输入转换抽离至 `src/features/catalog/model.ts`；将窗口标签解析、悬浮球主题加载和悬浮窗口挂载抽离至 `src/app/WindowRouter.tsx`；将资源分组标签、资源行、子标签区和根目录拖放区抽离至 `src/features/catalog/ResourceList.tsx`；将窗口边框缩放控件抽离至 `src/components/layout/WindowResizeEdges.tsx`；将扫描结果过滤、勾选、分页与预览对话框抽离至 `src/features/catalog/ImportPreviewDialog.tsx`。主应用组合逻辑仍保留在 `App.tsx`。
- 测试基础设施：基础 E2E 改为 `tools/run-e2e.mjs` 显式管理专用 Vite 进程，避免 Playwright `webServer` 在 Windows 上完成断言后无法退出的问题。
- 主题 E2E：运行器将实际测试地址经 `ORBITSTART_E2E_BASE_URL` 传给 Playwright 配置和 storage state，消除了 1420/1422 不一致；主题套件现只覆盖主题目录、切换、token、持久化、非法值回退和清理，不再把资源或插件工作流重复塞入主题验证。

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
| 阶段 6 导入预览拆分后的 `npm.cmd run test:e2e` | 通过 | 15/15，新增扫描预览的过滤和选择覆盖；测试进程在 72 秒内正常退出。 |
| 主题 E2E 收敛后的 `npm.cmd run test:e2e:themes` | 通过 | 6/6，20.3 秒内完成并以退出码 0 正常退出。 |

## 历史未实施项与原因

- 多入口构建第二轮：已于本轮完成。悬浮球及其菜单使用独立 HTML/Vite 入口和窄 bridge，不再挂载完整 `App.tsx`；保留此条仅作为此前决策背景。
- 大文件拆分：`App.tsx` 已完成两次小范围抽离，但仍然较大；`src-tauri/src/main.rs` 和全局 CSS 也仍然较大。后续应继续按功能边界拆分，避免与正确性修复混合。
- Portable mode：数据根目录、插件/主题携带范围、绝对路径如何转为 workspace 相对路径属于用户数据兼容策略，未在无明确策略时假定行为。
- 插件权限与 CSP：本地插件可自声明权限并默认启用的模型仍须改造。CSP 还受 worker 的 `unsafe-eval`、Google Fonts 和 blob URL 约束；需要先确定签名、默认拒绝和网络范围策略。
- 正式 updater 发布：0.8.2 已使用新的 updater 密钥生成真实签名并更新清单；仍需将 NSIS 安装包与同名 `.sig` 上传到 GitHub Release `v0.8.2`。旧版因信任旧公钥，必须先手动安装 0.8.2，随后版本才能恢复自动更新。
- 主题 E2E：已单独收敛并通过；后续新增主题时，应在同一套件中补充相应 token 与交互断言，而不是恢复与主题无关的资源或插件工作流。

## 当前收敛状态（2026-07-27，以本节为准）

### 阶段 6：模块边界

- 资源目录模型、列表、导入预览和资源编辑器已经从 App.tsx 拆出；窗口路由与边框缩放控件也已独立。
- App.tsx 现约 6,280 行，main.rs 约 9,533 行，`Workspaces.tsx` 已降至约 2,547 行；本轮没有为了追求文件行数而做高风险的大搬迁，后续应继续按页面、命令和数据库边界拆分。

### 阶段 7：便携模式与相对资源路径

- 可执行文件同级存在 portable.flag 或 OrbitStart.Data 时才启用便携数据目录；普通安装继续使用标准数据目录，绝不自动迁移或复制旧数据。
- schema v8 为资源增加 pathMode 与 basePath；旧数据库和旧 JSON 导入默认为 absolute。
- app、file、folder、script 可使用 data-relative 或 workspace-relative。路径解析拒绝上级目录、盘符、UNC 和 URL 前缀；启动、定位和编辑器中的路径检查均使用同一解析规则。
- 已提供 available、missing、permission-denied、network-unavailable、invalid 状态。数据设置页提供“检查并预览路径修复”：先分批检查本地资源，再仅对 `missing` 的绝对 app/file/folder/script 路径按用户填写的前缀生成逐项预览；相对路径、可用路径、权限错误和网络暂不可用路径不会自动替换，前端可直接转到资源编辑器进行手动修复。保存前必须选择条目并确认；确认后会先在数据目录的 `backups/` 创建 catalog JSON 备份，备份失败则不更新，再只更新已选资源的目录记录，不移动、删除或覆盖目标磁盘文件。

### 阶段 8：插件权限与 CSP

- 插件宿主改为能力白名单与双声明交集，移除 shell:open 宽泛兼容权限；脚本文件与内联脚本分别授权。
- Worker 禁止直接网络、脚本加载和通用 Tauri bridge；贡献 ID 与数量受插件 manifest 限制。高风险插件启用前需要显式确认。
- 生产和开发 CSP 已收紧且不含 unsafe-eval；插件签名或包哈希验证仍是下一阶段工作，详见 docs/PLUGIN_SECURITY.md。

### 阶段 9：发布与 CI

- 新增 version:set 与 updater:manifest 命令：前者同步应用版本字段，后者只从真实安装包及同名签名生成更新清单，避免复制旧签名。
- Windows CI 运行版本检查、构建、cargo fmt、cargo clippy、Rust 测试、无 bundle 桌面编译、基础 E2E、主题 E2E 与自定义浏览器检查。
- 新增 tag 触发的 release.yml：使用 GitHub Secrets 签名、生成 latest.json、验证后将安装包、.sig 与清单上传到 GitHub Release。更新端点改为 GitHub Release 的 latest.json 附件。
- 最新本地验证：npm run build 通过；npm run test:plugin-security、test:performance、version:check 和 test:custom 通过；npm run test:e2e 为 21/21；npm run test:e2e:themes 为 6/6；cargo fmt 通过；cargo test 为 30/30；隔离目标目录中的 cargo build --release 通过。
- cargo clippy 可正常执行，已从 20 条降为 9 条既有 main.rs lint warning：2 条公开 Tauri 命令参数过多提示，以及 7 条 Windows FFI 大写类型名提示。CI 继续以报告而非 -D warnings 方式运行，避免为消除提示而破坏公开 IPC 参数或 Windows ABI 命名。

### 本轮追加推进

- 阶段 4：新增 `floating-bubble.html` 与 `floating-bubble-menu.html` 两个 Vite 入口；Tauri 悬浮窗直接加载对应入口，入口只预加载悬浮窗 UI、设置外观和错误上报共享代码，不再加载主应用壳。
- 阶段 5：插件启用和安全模式改为返回最小 `PluginStateUpdate` 并发出定向事件，前端只更新 commands/plugins/settings，不再为这些设置拉取完整 `CatalogSnapshot`。
- 阶段 6：工作区页面继续拆分为列表视图、模态框、右键菜单、图模型、图标和类型模块；增加工作区编辑、资源选择、图/列表切换、右键编辑的浏览器回归覆盖。
- 阶段 7：数据设置页的“检查并预览路径修复”已接入实际备份和逐项更新流程；只允许用户确认的缺失绝对路径前缀替换，绝不移动或删除磁盘文件。
- 阶段 8：核心快捷方式权限改为最小 `launcher:item`；能力风险级别、插件 manifest、文档与 `test:plugin-security` 由同一契约检查器校验；废弃的禁用 updater 打包配置已删除。
- 阶段 9：CI 与 release 就绪流程增加插件安全和性能比较工具测试；`tools/compare-performance-measurements.mjs` 可比较同场景优化前后进程采样，拒绝不同场景或不完整数据。
- E2E 运行器只清理自己启动的 Vite 进程，并在受限时间内回收进程树和验证端口可再次绑定，避免“断言已通过但 webServer 清理超时”的 CI 误报。

### 0.8.3 打包状态

- 已在隔离 `CARGO_TARGET_DIR` 中完成签名桌面构建，正式资产位于 `release-artifacts/signed-0.8.3/`：NSIS 安装包、同名 updater `.sig` 与 `latest.json` 均已生成；ProductVersion 与 FileVersion 均为 0.8.3，SHA-256 记录在同目录 `.sha256` 文件。
- 独立 `verify_updater_signature` 已使用 `tauri.conf.json` 的公钥完成 minisign 验签；`release:verify` 已验证版本、签名文件名和更新清单 URL 一致。
- Tauri updater 签名不是 Windows Authenticode 签名。GitHub Release 附件尚未上传，且应在上传前完成覆盖安装与更新检查的人工验收；隔离构建目录已绕开运行中旧实例对默认输出路径的锁定。

### 0.8.4 打包状态

- 0.8.4 已使用受保护目录中的现有 updater 密钥重新生成 NSIS 安装包、同名 `.sig`、`latest.json` 和 SHA-256 文件，正式资产位于 `release-artifacts/signed-0.8.4/`。
- 安装包 ProductVersion 和 FileVersion 均为 0.8.4；独立 minisign 验签、更新清单版本/URL/签名文件名校验及 SHA-256 复核均已通过。
- 发现并修复了额外 `verify_updater_signature` Cargo 二进制被 Tauri 误选的打包风险：`default-run` 与本地/CI 构建命令现均显式固定为 `orbitstart`。错误的约 440 KB 本地产物被移入 `release-artifacts/signed-0.8.4-invalid-aux-binary/`，不得分发。
- GitHub Release 附件尚未上传；仍需先提交这些版本与构建脚本改动，再发布 `v0.8.4` 的安装包、同名 `.sig` 和 `latest.json`。
- “检查更新”按钮修订在不提升版本号的前提下另存为 `release-artifacts/signed-0.8.4-update-button-r1/`；它适用于手动覆盖安装验证，但已运行 0.8.4 的客户端不会把同版本清单视为可更新版本。

## 性能测量边界

bundle 变化不等同于 WebView2 总内存变化。Windows 场景 A–E 仍须在同一台机器、同一安装包、相同窗口组合下，使用 `tools/measure-processes.ps1` 采集优化前后数据。现有运行中的未知窗口会话不作为受控性能结论。
