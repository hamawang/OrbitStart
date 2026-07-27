# 性能与可靠性基线

最后更新：2026-07-27

## 结论边界

本文件区分三类证据，避免把构建产物变化或未受控进程快照误报为桌面性能提升：

| 证据类型 | 可以说明什么 | 不能说明什么 |
| --- | --- | --- |
| 构建产物快照 | 前端资源大小、是否产生懒加载 chunk | WebView2 内存、冷启动时间、交互流畅度 |
| 受控桌面场景采样 | 同机、同构建、同数据集下的进程内存、CPU、关联 WebView2 数 | 不同机器或不同窗口状态之间的绝对比较 |
| 未受控会话采样 | 脚本可运行、数据字段是否可信 | 任意 A–E 场景的基线或优化结论 |

当前尚未完成 A–E 的受控前后对照。因此本项目**没有桌面内存、冷启动或交互性能提升的定量声明**。

## 可复现采样工具

[`tools/measure-processes.ps1`](../tools/measure-processes.ps1) 现在具备以下行为：

- `-ProcessId` 锁定一个受控 OrbitStart 实例，避免多个会话混在一起；不指定时按进程名采样。
- 优先用 `Win32_Process` 父子关系归因 OrbitStart 的 WebView2 子进程。
- 若当前权限不允许读取父进程关系，则退回为**仅 OrbitStart 根进程**；不会猜测或合计全局 WebView2。
- `-IncludeAllWebView2` 仅用于故障排查，输出会明确标记 `UnattributedWebView2`；不得用该模式得出 OrbitStart 专属内存结论。
- CPU 取相邻样本的累计 CPU 时间差。首个样本没有 CPU 百分比，且多核机器上总值可能超过 100%。
- `-OutputPath` 可保存原始样本、聚合摘要、采样配置与主机信息为 JSON；若目标已存在则拒绝覆盖。

PowerShell 5.1 在某些中文 Windows 环境对无 BOM 的 UTF-8 脚本兼容性不稳定；该脚本已以 UTF-8 BOM 保存。若执行策略阻止本地脚本，可仅对本次子进程使用 `-ExecutionPolicy Bypass`，不会修改系统或用户策略。

## 前后对比报告

`tools/compare-performance-measurements.mjs` 读取两份由 `measure-processes.ps1` 生成的 JSON，并拒绝比较不同场景的数据。它会输出 Working Set、Private Memory、CPU 和受归因 WebView2 进程数的前后值、绝对差值和百分比，同时标记机器、采样配置或进程归因条件不一致的情况。

```powershell
node .\tools\compare-performance-measurements.mjs `
  --before .\artifacts\performance\0.8.3-A-run-01.json `
  --after .\artifacts\performance\0.8.4-A-run-01.json `
  --output .\docs\PERFORMANCE_AFTER_OPTIMIZATION.md
```

输出文件不得覆盖已有报告；正式对比前仍需人工确认两个文件使用同一安装方式和相同测试数据集。

## 2026-07-27 非受控验证快照

下列数据用于验证采样工具的最小权限回退，不是 A–E 场景，也不参与前后比较。

| 字段 | 事实记录 |
| --- | --- |
| 被测进程 | `E:\OrbitStart\src-tauri\target\release\orbitstart.exe`，PID `37164` |
| 启动时间 | 2026-07-27 15:48:49（Asia/Shanghai） |
| 采样窗口 | 2026-07-27 16:20:28–16:20:32，4 个样本，约 1 秒间隔 |
| 构建标签 | `0.8.3-no-bundle` |
| 进程归因方式 | `Get-Process fallback`；当前执行环境拒绝 `Win32_Process` 查询 |
| 进程数 | 1 个 OrbitStart 根进程；关联 WebView2 数未知，故记录为 0 而非猜测 |
| Working Set | 40.45 MiB（最小 / 平均 / 最大均为 40.45 MiB） |
| Private Memory | 9.56 MiB（最小 / 平均 / 最大均为 9.56 MiB） |
| CPU | 后 3 个差分样本均为 0%；首样本按定义为空 |

窗口状态、前台操作、数据库规模和 WebView2 关联均未受控。上述数字只能证明根进程测量正常，不能代表应用总内存。

## 当前构建产物快照

以下为 2026-07-27 16:17（Asia/Shanghai）已有 `dist/assets` 的直接读数；gzip 使用 Node `zlib.gzipSync` 计算。该快照与当时仍在进行的工作区变更绑定，发布验收应在最终 0.8.3 构建后重新生成并附上产物哈希。

| 资源 | 原始大小 | gzip |
| --- | ---: | ---: |
| `index-Da5zHEkW.js` | 504,365 B | 148,267 B |
| `index-BPPZQN0O.css` | 184,312 B | 27,093 B |
| `Workspaces-sy9jZJcH.js` | 85,742 B | 19,151 B |
| `FloatingBubble-lXOmI264.js` | 10,548 B | 3,681 B |
| `TripPanel-DF64YFff.js` | 10,001 B | 3,729 B |
| `OnboardingWizard-CKXtQF9f.js` | 5,394 B | 2,211 B |
| `webviewWindow-Z4LnffRg.js` | 4,799 B | 1,424 B |

这表明按页面拆分的 chunk 已存在，但资源大小变化本身不构成桌面运行时性能结论。

## 受控测量操作规程

每次发布候选版本使用同一台 Windows 测试机、同一 WebView2 Runtime、同一显示缩放、同一安装方式和同一数据集。不要将开发模式、`--no-bundle` 可执行文件和已安装的签名包混为一组数据。

1. 记录版本、Git 提交、安装包文件名/哈希、Windows 版本、WebView2 Runtime 版本、CPU 核数、内存、显示缩放，以及测试数据集版本。
2. 用应用自身的退出操作结束此前 OrbitStart 会话；不要为了测量终止无关的 WebView2 或其他应用。
3. 启动一个目标安装包，取得其 PID。每个场景至少独立重复 3 次；冷启动时间从进程启动到“首屏可操作”应以同一人工判定点或自动化标记记录，并单独取中位数。
4. 场景进入稳定状态后再采样。A、D、E 建议采样 30 秒；B 在隐藏到托盘后采样 30 秒；C 在悬浮球状态采样 60 秒。
5. 保存每次 JSON 原始样本，不覆盖旧文件。对外报告使用同一场景的中位数，并同时保留最小/最大值和任何异常原因。

示例（从项目根目录运行）：

```powershell
$orbitStart = Get-Process -Name OrbitStart |
  Sort-Object StartTime -Descending |
  Select-Object -First 1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\measure-processes.ps1 `
  -ProcessId $orbitStart.Id `
  -SampleSeconds 30 `
  -Scenario 'A-main-window-idle' `
  -BuildLabel '0.8.3-signed-nsis' `
  -OutputPath .\artifacts\performance\0.8.3-A-run-01.json
```

若脚本报告无法读取 `Win32_Process`，仍可记录根进程数值，但需在结果中写明“WebView2 未归因”；不要以 `-IncludeAllWebView2` 替代。

## 场景定义与记录模板

| 场景 | 固定操作 | 稳定后采样 | 额外记录 |
| --- | --- | --- | --- |
| A：仅主窗口 | 冷启动后停在资源主页 | 30 秒 | 首屏可操作时间 |
| B：隐藏到托盘 | 从 A 隐藏主窗口并等待 | 30 秒 | 托盘状态是否可恢复 |
| C：悬浮球 | 打开悬浮球并停留 | 60 秒 | 悬浮球可见、无活动交互 |
| D：多窗口 | 主窗口 + 设置 + Todo + 悬浮球 + 菜单 | 30 秒 | 每个窗口标签和实际可见性 |
| E：100 资源 | 固定 100 条 fixture；首屏、搜索、拖拽、保存 | 30 秒 | 4 个操作的耗时与结果 |
| E：500 资源 | 固定 500 条 fixture；同上 | 30 秒 | 4 个操作的耗时与结果 |
| E：2000 资源 | 固定 2000 条 fixture；同上 | 30 秒 | 4 个操作的耗时与结果 |

每次运行在发布记录中填写：

| 版本/提交 | 场景与运行号 | 安装包/构建模式 | 数据集 | PID | 父进程归因 | WS（min/avg/max） | Private（min/avg/max） | CPU（avg/max） | 冷启动或操作耗时 | 异常/备注 | 原始 JSON |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| 待采集 | 待采集 | 待采集 | 待采集 | 待采集 | 待采集 | 待采集 | 待采集 | 待采集 | 待采集 | 待采集 | 待采集 |

## 历史阶段 0 参考（不可直接与 0.8.3 对比）

2026-07-26 曾在提交 `19cd667`（0.8.1）记录过一个未受控的既有会话：1 个 OrbitStart 进程、6 个“关联” WebView2 进程，合计 Working Set 443.19 MiB、Private Memory 432.43 MiB。由于窗口状态、前台使用情况与数据规模未知，它不是任何受控场景的基线。

同期 Vite 产物快照为主 JavaScript 584.23 kB（gzip 169.75 kB）、主 CSS 187.02 kB（gzip 27.64 kB）、`webviewWindow` 4.80 kB（gzip 1.42 kB）。它仅保留作历史构建资源参考。

## 已知限制

- Playwright 浏览器测试不覆盖真实 Tauri IPC、SQLite、WebView2 进程关联、托盘和自动更新，因此测试通过不能替代本规程。
- 仅有根进程的内存数据时，绝不能推断 OrbitStart 的完整桌面内存占用。
- 构建大小、运行内存、冷启动和交互耗时分别需要独立证据；不得由其中一项推导另一项。
- 正式 0.8.3 安装包完成后，仍需按上述 A–E 规程采集并保存受控数据，才能产出前后对照报告。
