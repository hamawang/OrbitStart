# OrbitStart UI 动画升级实施报告

最后更新：2026-07-29  
实施依据：[UI_ANIMATION_OPTIMIZATION_PLAN.md](./UI_ANIMATION_OPTIMIZATION_PLAN.md)

## 1. 结论

动画规范和代码升级已落地，自动化可验证部分已完成。真实 Tauri/WebView2 的视觉手感、多窗口行为和 A–E 性能数据仍必须按验收清单在发布候选包上人工验证；在这些数据采集完成前，不对内存、CPU、冷启动或 GPU 占用作定量改善声明。

本轮没有接入 Lottie、Rive、在线素材市场或新的持续播放位图素材。评估结论是：现阶段已有 CSS/React 语义反馈足够，增加动画 runtime 或第三方素材无法证明收益，且会扩大包体、许可证和后台解码成本。

## 2. 已实施范围

### 2.1 统一动效策略

- 建立 `full / standard / minimal / off` 四档策略。
- OS `prefers-reduced-motion` 对用户设置作硬上限：除 `off` 外统一限制为 `minimal`。
- React 挂载前写入根节点策略属性，避免首帧先播放标准动画再降级。
- 主窗口、辅助窗口、Todo 和轻量悬浮球入口使用同一 requested/effective 语义。
- 页面隐藏、失焦、最小化或原生窗口不可见时暂停持续动画。

### 2.2 统一 token 和职责边界

- 时长、缓动、距离、缩放和弹簧参数集中在 `src/motion` 与 motion CSS token。
- Motion 使用 `LazyMotion + domAnimation`，功能包单独懒加载。
- dnd-kit 独占 sortable 外层的 `transform`；主题视觉放在内层。
- Presence wrapper 独占 overlay 的 opacity；子面板只负责方向性 transform。
- Onboarding 进度使用 `scaleX`，不再逐帧动画 `width`。
- 标准模式不播放非必要持续动画；Local Galaxy 持续背景仅在完整模式启用。

### 2.3 交互反馈

- 资源新增、启动中、成功、失败、删除、删除失败和收藏均有局部状态。
- 新增/删除/收藏收口使用 `animationend`，不依赖与 CSS 脱节的固定卸载时间。
- 批量选择禁用逐卡片 transition、阴影和伪元素效果；批量删除不制造动画风暴。
- 2000 条资源仍按分页渐进渲染，不执行全量 stagger。
- Tooltip 单例挂载、240ms hover intent、键盘焦点即时显示、边界翻转和真实尺寸钳制已实现。

### 2.4 Overlay、页面与 Onboarding

- 命令面板、普通弹窗、设置抽屉、右键菜单和工作区进度具有可控退出阶段。
- 退出阶段立即 `inert` 且禁止 pointer events，避免透明 backdrop 残留交互。
- 页面切换保留 App shell，仅切换内容层。
- Onboarding 使用 presence 状态完成步骤切换和关闭；模板双击不会重复创建。

### 2.5 悬浮球和工作区

- 悬浮球使用独立轻量入口，不加载 Motion runtime。
- 拖拽写入合并、吸附取消、菜单 show/hide/action-hide 协议和关闭握手已有测试。
- 工作区进度改为 storage event + heartbeat，不做 UI 轮询。
- 多 renderer 使用 `Web Locks + launchId + ownerRuntimeId + lease`：
  - 同一窗口防重入；
  - 其他窗口不能覆盖 fresh launch；
  - 非 owner 可转发取消；
  - stale owner 被 fencing 后不能复活旧状态；
  - 合法长命令和搜索动作可声明超时，不再被宿主固定 10 秒误报失败。

## 3. 构建产物对比

对比条件：

- 基线：提交 `686d40016b3dc90a0172983e0c6ae4e18400158f`
- 当前：同一台机器、同一份 `node_modules`、同一 Vite 配置
- gzip：Node `zlib.gzipSync(..., { level: 9 })`

| 产物 | 基线 | 当前 | 增量 |
| --- | ---: | ---: | ---: |
| 全部 JS 原始大小 | 644,996 B | 775,269 B | +130,273 B（+20.2%） |
| 全部 JS gzip | 186,785 B | 231,755 B | +44,970 B（+24.1%） |
| 全部 CSS 原始大小 | 189,596 B | 231,446 B | +41,850 B（+22.1%） |
| 全部 CSS gzip | 28,218 B | 34,449 B | +6,231 B（+22.1%） |
| 懒加载 `motionFeatures` | 无 | 37,935 B / 14,246 B gzip | +14,246 B gzip |

解释边界：

- `motionFeatures` 没有进入轻量悬浮球入口。
- JS 总增量还包含交互状态、工作区可靠性协议和可访问性逻辑，不能把 44,970 B 全部归因于 Motion runtime。
- 构建大小不能推导 WebView2 内存、CPU、冷启动或交互耗时。

## 4. 自动验证记录

| 验证 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `npx tsc --noEmit` | 通过 |
| 动效 Playwright 专项 | 17/17 通过 |
| Plugin host lifecycle / multi-renderer workspace / >10s Worker command | 通过 |
| Plugin worker runtime | 28/28 通过 |
| Plugin security contract | 通过 |
| Rust tests | 33/33 通过 |
| `cargo fmt --check` | 通过 |
| 版本一致性 | 0.8.6，通过 |
| `git diff --check` | 通过 |
| 完整 Playwright 回归 | 42/42 通过 |
| Atelier Zero 主题回归 | 6/6 通过 |

`npm run test:custom` 的 HTML/静态检查通过，但该 harness 的独立浏览器阶段在当前桌面会话中 `page.goto` 超时；它不计作浏览器通过证据，浏览器行为由正式 Playwright runner 覆盖。

## 5. 尚未由自动化证明的事项

- 真实 Tauri 窗口之间是否共享预期的 Web Locks 行为。
- WebView2 进程数、Private Memory、Working Set、CPU 和 GPU 活动。
- 冷启动到首屏可操作时间。
- 鼠标、触控板和高 DPI 下的主观节奏与位置连续性。
- 真正隐藏到托盘、原生最小化、全屏避让和跨显示器吸附。
- 发布构建下 100/500/2000 数据集的搜索与拖拽耗时。

以上项目均已进入 [UI_ANIMATION_ACCEPTANCE_CHECKLIST.md](./UI_ANIMATION_ACCEPTANCE_CHECKLIST.md)。
