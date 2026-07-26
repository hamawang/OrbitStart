# 性能与可靠性基线（2026-07-26）

## 范围与方法

本基线在 `main` 分支、提交 `19cd667`（`0.8.1`）上采集。开始采集时工作区无未提交改动。

- 构建模式：Vite production build；Rust `dev` profile `cargo check`。
- 浏览器测试：Microsoft Edge headless，由 Playwright 驱动。
- 桌面性能数据：需在目标 Windows 机器启动实际 Tauri 包后，用 [`tools/measure-processes.ps1`](../tools/measure-processes.ps1) 采集。阶段 0 检测到一个既有 OrbitStart 会话（1 个 OrbitStart 进程、6 个关联 WebView2 进程、合计 Working Set 443.19 MiB、Private Memory 432.43 MiB），但其窗口状态与前台使用情况未知，因此不把它作为任一受控场景的性能基线。

示例：

```powershell
.\tools\measure-processes.ps1 -SampleSeconds 30
```

## 版本快照

| 位置 | 记录值 | 状态 |
| --- | --- | --- |
| `package.json` | `0.8.1` | 一致 |
| `package-lock.json` 根包 | `0.7.4` | 不一致，见优化发现 P0-REL-01 |
| `src-tauri/Cargo.toml` | `0.8.1` | 一致 |
| `src-tauri/tauri.conf.json` | `0.8.1` | 一致 |
| `latest.json` | `0.8.1` | 内嵌签名备注不一致，见优化发现 P0-REL-02 |

## 自动检查

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run build` | 通过 | TypeScript 检查和 Vite 构建均通过。 |
| `npm run test:custom` | 通过 | 使用临时 Vite 服务；首次未启动服务的运行按预期失败，重跑后通过。 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 | `dev` profile。 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 通过 | 11/11 通过；保留 `src-tauri/src/main.rs:8979` 的既有 unused-assignment 警告。 |
| `npm run test:e2e` | 通过 | 12 个用例全部通过，耗时 3.9 分钟；首次 184 秒的执行环境超时已保留为测试时长限制记录。 |
| `npm run test:e2e:themes` | 未通过（超时） | 23 个用例的套件在 15 分钟诊断预算内未返回 Playwright 汇总；保留为待定位的既有验证问题，见 P1-TEST-01。 |
| `npm install` | 未作为基线验收 | 该命令会自动将 lockfile 根版本改为 `0.8.1`；为保持阶段 0 不修改发布元数据，已还原并记录版本漂移。 |

## 构建产物基线

`npm run build`（Vite 5.4.21）输出：

| 产物 | 原始大小 | gzip |
| --- | ---: | ---: |
| 主 JavaScript `index-*.js` | 584.23 kB | 169.75 kB |
| 主 CSS `index-*.css` | 187.02 kB | 27.64 kB |
| 动态 `webviewWindow-*.js` | 4.80 kB | 1.42 kB |

构建仅产生一个主应用 JS chunk，且 Vite 报告主 chunk 超过 500 kB。这是后续“多入口 / 懒加载”阶段的比较基线，不能单独证明桌面内存占用。

## Windows 人工测量清单

下列数据必须在同一台 Windows 测试机、同一构建模式下记录，并在优化后写入 `PERFORMANCE_AFTER_OPTIMIZATION.md` 进行差值和百分比比较。

| 场景 | 冷启动 / 操作 | Working Set / Private Memory | CPU | WebView2 数 | 状态 |
| --- | --- | --- | --- | --- | --- |
| A：仅主窗口 | 需人工测量 | 需人工测量 | 需人工测量 | 需人工测量 | 未采集 |
| B：隐藏到托盘 30 秒 | 不适用 | 需人工测量 | 需人工测量 | 需人工测量 | 未采集 |
| C：悬浮球 60 秒 | 不适用 | 需人工测量 | 需人工测量 | 需人工测量 | 未采集 |
| D：主窗口 + 设置 + Todo + 悬浮球 + 菜单 | 不适用 | 需人工测量 | 需人工测量 | 需人工测量 | 未采集 |
| E：100 个资源 | 首屏 / 搜索 / 拖拽 / 保存需人工测量 | 需人工测量 | 需人工测量 | 需人工测量 | 未采集 |
| E：500 个资源 | 首屏 / 搜索 / 拖拽 / 保存需人工测量 | 需人工测量 | 需人工测量 | 需人工测量 | 未采集 |
| E：2000 个资源 | 首屏 / 搜索 / 拖拽 / 保存需人工测量 | 需人工测量 | 需人工测量 | 需人工测量 | 未采集 |

## 已知限制

- 浏览器 Playwright 测试不覆盖真实 Tauri IPC、SQLite、WebView2 进程数、托盘或自动更新。
- 不能在没有实际安装包、签名私钥和升级测试路径的情况下修复或验证 updater 签名。
- 所有未采集的桌面指标均明确标为“需人工测量”，不作性能提升声明。
