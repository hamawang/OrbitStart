# OrbitStart UI 动画优化方案

> 方案日期：2026-07-29  
> 适用版本：0.8.5 起  
> 目标平台：Windows 10/11，Tauri 2 + React 18 + WebView2  
> 方案性质：设计与实施指导，不包含本次代码改动

## 1. 结论

OrbitStart 不缺少动画，而是缺少统一的动画系统。

当前代码已经包含背景漂移、按钮过渡、弹窗进入、右键菜单、首次引导、拖拽排序、工作区启动进度和悬浮球吸附等效果。主要问题是：

1. 动画时长、缓动和命名分散，存在大量 `transition: all`。
2. 多数弹窗只有进入动画，React 卸载时没有退出动画。
3. `prefers-reduced-motion` 只覆盖 Local Galaxy 的少数组件，没有覆盖引导、工作区、悬浮球和其他主题。
4. 持续动画没有统一的窗口失焦、隐藏和省电暂停策略。
5. 资源启动、保存、失败等关键操作主要依赖文字状态，局部反馈不足。
6. dnd-kit、CSS transform 和未来动画库之间缺少明确的职责边界。

因此建议采用：

```text
CSS Motion Tokens
    └── 按钮、focus、hover、主题光效

Motion for React（按需加载）
    └── 弹窗退出、页面切换、引导步骤、条件渲染

dnd-kit
    └── 资源、分组、工作台模块的拖拽位移

原生 Tauri 窗口动画
    └── 悬浮球吸附和跨窗口显示/隐藏
```

第一阶段不接入 Lottie、Rive、GSAP 或粒子库。先把已有动画收敛成稳定系统，再评估少量品牌动画。

## 2. 设计目标

动画要帮助用户理解：

- 我点中了什么；
- 操作正在发生还是已经完成；
- 一个元素从哪里来到哪里；
- 当前界面的主要焦点在哪里；
- 工作区、资源、弹窗和悬浮球处于什么状态。

最终气质保持 Local Galaxy 的“深邃、复古、唯美”，但运动语言应更接近成熟桌面软件：

- 短；
- 稳；
- 可打断；
- 不弹跳过度；
- 不让内容位置产生不安感；
- 不依赖持续发光证明“高级感”。

## 3. 当前实现依据

### 3.1 已具备的良好基础

- 悬浮球与菜单已经使用独立 Vite 入口，不再加载完整 `App.tsx`。
- Workspaces、FloatingBubble、TripPanel 和 OnboardingWizard 已按需分块。
- 资源写操作已开始使用定向更新，减少全量快照带来的动画中断。
- 资源网格使用 dnd-kit，拖拽位移已有 transform 动画。
- Local Galaxy 背景素材和用途已有清晰的 Usage Map。
- 当前已经有 `prefers-reduced-motion` 的初步实现。

### 3.2 需要收敛的问题

- `src/styles.css` 同时存在 100、120、140、150、160、180、190、200、220、250、280、300、350、400 和 600ms 等多套时长。
- 多处使用 `transition: all`，难以判断实际发生了哪些布局和绘制工作。
- `spin` 关键帧存在重复命名。
- `galaxy-silk-drift`、`hotkey-pulse` 和旋转类动画缺少统一暂停策略。
- `.palette-backdrop`、`.command-palette`、`.modal-panel` 只有进入动画。
- Onboarding 通过 `setTimeout(280)` 人工等待，与减少动态效果设置不联动。
- 工作台收起直接改变网格结构，资源区和右侧面板缺少有序的状态交接。
- 资源启动使用全局 `busy`，无法给被点击的单个资源准确反馈。

## 4. 动画原则

### 4.1 先反馈，后装饰

优先顺序：

1. 点击、保存、启动、失败、拖拽反馈；
2. 弹窗、抽屉、折叠与页面切换；
3. Local Galaxy 品牌动效；
4. 素材动画。

### 4.2 默认只动画 transform 和 opacity

可直接使用：

- `opacity`
- `translateX/Y`
- `scale`
- `rotate`

谨慎使用：

- `background-color`
- `border-color`
- 小面积 `box-shadow`

避免在大区域逐帧动画：

- `width` / `height`
- `top` / `left`
- `padding` / `margin`
- `grid-template-columns`
- `backdrop-filter`
- 大面积 blur 和 box-shadow

Motion 官方性能指南也建议优先使用 transform 和 opacity；布局动画应限制在确实需要表达位置变化的局部区域。  
参考：[Motion performance](https://motion.dev/docs/performance)、[Motion layout animation](https://motion.dev/docs/react-layout-animations)。

### 4.3 不能阻塞操作

- 按钮点击后立即更新视觉状态。
- 普通动画不应阻止再次点击或键盘输入。
- 页面切换动画可以被下一次导航打断。
- 关闭弹窗时允许短退出动画，但总时长不超过 140ms。
- 数据操作不等待动画完成才开始。

### 4.4 不给大列表做逐项入场

在 100、500、2000 个资源场景中：

- 搜索和筛选结果立即更新；
- 不给每张卡片 stagger；
- 不对全部卡片同时执行模糊、阴影或缩放；
- 只动画选中项、拖拽项、新增项或被删除项；
- 一次最多为前 8 个新导入资源显示轻量淡入。

### 4.5 主题只改变质感，不改变节奏

所有主题共享同一套时长、缓动和状态语义。Local Galaxy 可以增加低强度光晕，但不能另建一套更慢、更重的交互时序。

## 5. 动画等级

新增设置：

```ts
type MotionMode = "full" | "standard" | "minimal" | "off";
```

建议默认值为 `standard`。

| 等级 | 操作反馈 | 弹窗/页面 | 布局动画 | 持续品牌动画 |
| --- | --- | --- | --- | --- |
| 完整 | 完整 | 完整 | 局部开启 | 允许低频背景漂移 |
| 标准 | 完整 | 完整 | 只保留必要位置变化 | 默认关闭持续背景漂移 |
| 精简 | 只保留颜色与透明度 | 仅短淡入淡出 | 关闭 | 关闭 |
| 关闭 | 状态立即切换 | 立即显示/移除 | 关闭 | 关闭 |

系统开启“减少动态效果”时，应用的有效等级最高只能是“精简”。这应同时作用于 CSS 和 React 动画，而不是只关闭 Local Galaxy 背景。Motion 的 `MotionConfig reducedMotion="user"` 可以作为 React 层兜底。  
参考：[MotionConfig](https://www.motion.dev/docs/react-motion-config)、[useReducedMotion](https://motion.dev/docs/react-use-reduced-motion)。

根节点统一输出：

```html
<html data-motion="standard" data-window-state="visible">
```

独立的 bubble、bubble-menu、todo 和 aux 入口也必须设置相同属性。

## 6. Motion Tokens

建议新增 `src/styles/motion-tokens.css`：

```css
:root {
  --motion-instant: 80ms;
  --motion-fast: 120ms;
  --motion-base: 160ms;
  --motion-panel: 200ms;
  --motion-emphasis: 240ms;

  --ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);

  --motion-distance-xs: 2px;
  --motion-distance-sm: 6px;
  --motion-distance-md: 12px;
}

:root[data-motion="minimal"] {
  --motion-instant: 60ms;
  --motion-fast: 80ms;
  --motion-base: 100ms;
  --motion-panel: 120ms;
  --motion-emphasis: 120ms;
  --motion-distance-xs: 0px;
  --motion-distance-sm: 0px;
  --motion-distance-md: 0px;
}

:root[data-motion="off"] *,
:root[data-motion="off"] *::before,
:root[data-motion="off"] *::after {
  animation-duration: 1ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 1ms !important;
  scroll-behavior: auto !important;
}
```

禁止新增裸写的 `0.2s ease`、`all 160ms`。新增动画必须使用 token，并明确列出属性。

## 7. React 动画层

### 7.1 推荐目录

```text
src/motion/
├── MotionProvider.tsx
├── motionFeatures.ts
├── policy.ts
├── transitions.ts
├── variants.ts
└── components/
    ├── MotionDialog.tsx
    ├── MotionPage.tsx
    ├── MotionCollapse.tsx
    └── MotionStatusSwap.tsx
```

### 7.2 依赖策略

使用 `motion` 包，但只在主入口按需加载：

```tsx
<LazyMotion features={loadMotionFeatures} strict>
  <MotionConfig reducedMotion="user">
    {children}
  </MotionConfig>
</LazyMotion>
```

第一轮使用 `domAnimation`，覆盖进入、退出、hover、tap 和 variants。暂不引入 Motion drag；拖拽继续由 dnd-kit 负责。若以后确实需要共享布局动画，再单独评估 `domMax`。

Motion 官方建议通过 `LazyMotion` 和 `m` 组件延迟加载特性，避免把完整 `motion` 组件能力放进主包。  
参考：[Reduce Motion bundle size](https://motion.dev/docs/react-reduce-bundle-size)。

### 7.3 职责边界

| 场景 | 负责方 |
| --- | --- |
| 按钮、focus、光晕 | CSS |
| 条件渲染和退出动画 | Motion `AnimatePresence` |
| 资源/分组拖拽位移 | dnd-kit |
| 悬浮球窗口吸附 | Tauri window API |
| 进度数值 | React state + CSS transform |

不要让 Motion 和 dnd-kit 同时写同一个 `.resource-row` 的 `transform`。资源拖拽节点由 dnd-kit 独占 transform；新增、删除和收藏反馈作用于内部子层或独立伪元素。

## 8. 核心场景规范

### 8.1 通用按钮

| 状态 | 效果 | 时长 |
| --- | --- | ---: |
| hover | 背景/边框提亮，最多上移 1px | 120ms |
| press | `scale(0.985)` | 80ms |
| focus-visible | focus ring 透明度变化，不缩放 | 120ms |
| disabled | 立即进入禁用态，不播放动画 | — |

圆形图标按钮不做上浮，只做背景、边框和颜色变化，避免侧栏和标题栏图标抖动。

### 8.2 Tooltip

替换原生 `title` 的交互说明：

- 鼠标停留 240ms 后出现；
- 键盘 focus 时立即出现；
- `opacity 0 → 1` + `translateY(2px → 0)`，90ms；
- 退出 70ms；
- 同一时间只显示一个；
- 精简模式只淡入淡出，关闭模式立即显示。

### 8.3 资源卡片

#### 点击启动

```text
pointer down
→ 卡片内容 scale 0.985（80ms）
→ 松开后恢复
→ 图标进入 launching 状态
→ 成功：青绿色状态环单次扩散 + 状态点停留 1.2s
→ 失败：边框短暂转 danger + 水平 3px 的两次轻微偏移
```

实现上增加单项状态：

```ts
type ResourceLaunchState = "idle" | "launching" | "success" | "error";
```

资源启动不应继续只依赖全局 `busy`。全局导入、迁移和批处理可以保留 busy；单项启动使用按资源 id 的状态。

#### 收藏

- 星标 `scale 1 → 1.18 → 1`；
- 160ms；
- 只动画星标图标和小范围光晕；
- 不改变卡片位置。

#### 新增与删除

- 新增：内部内容 `opacity 0 → 1`、`translateY(6px → 0)`，160ms；
- 删除：确认后先 `opacity 1 → 0`，120ms，再从 state 移除；
- 删除失败时恢复卡片并显示错误状态；
- 批量导入不对全部条目做逐项动画。

### 8.4 拖拽排序

保留 dnd-kit，调整为更克制的桌面质感：

- 拿起：scale 从当前 1.04 降至 1.02–1.025；
- 阴影通过伪元素淡入，不在拖拽过程中持续插值大阴影；
- 占位卡保持可见轮廓，透明度不低于 0.45；
- 其他卡片让位由 dnd-kit transform 负责；
- 放下后 200–260ms settle；
- 拖拽中禁用卡片内部按钮；
- 精简模式不缩放，只保留轮廓与透明度；
- 不使用 Motion 的 `layout` 或 drag 包裹同一资源节点。

### 8.5 分组标签和子目录

- 分组切换：选中背景、图标和边框 140ms；
- 资源结果不逐项入场，只对资源面板做 80ms 的轻微透明度恢复；
- 子目录折叠使用单个 Chevron 图标旋转 90°，160ms；
- 子目录内容只做 160ms 的 opacity + clip/height 容器过渡；
- 资源数超过阈值时折叠立即完成，不为大量子元素做动画；
- 拖拽目标高亮在 100ms 内出现，离开后 80ms 消失。

### 8.6 搜索和命令面板

#### 搜索框

- focus 边缘素材继续使用，但只动画伪元素 opacity；
- 不动画 blur；
- 清空按钮出现时 80ms 淡入；
- 搜索结果每次输入立即更新，不 stagger。

#### 命令面板

- backdrop：进入 140ms，退出 100ms；
- panel：进入 `opacity 0 → 1`、`y -6px → 0`、`scale .985 → 1`，180ms；
- panel 退出：120ms；
- 键盘选中项只动画背景和边框，不让整行移动；
- 结果滚动跟随键盘选择，但不使用平滑滚动；
- 通过 `AnimatePresence` 保留 DOM 直到退出完成。  
参考：[AnimatePresence](https://motion.dev/docs/react-animate-presence)。

### 8.7 弹窗、抽屉和右键菜单

统一替换分散的 `.palette-backdrop + .modal-panel` 进入动画：

| 组件 | 进入 | 退出 |
| --- | --- | --- |
| 普通弹窗 | opacity + y 6px + scale .985，180ms | opacity + y 4px + scale .99，120ms |
| 设置大面板 | opacity + x 12px，200ms | opacity + x 8px，140ms |
| 右键菜单 | 从鼠标锚点 scale .98 + fade，100ms | fade，70ms |
| 删除确认 | 不使用弹簧，不抖动 | 同普通弹窗 |

退出动画期间立即禁用内部按钮，防止重复提交。

### 8.8 页面切换

- Sidebar、标题栏和 Local Galaxy 背景保持挂载；
- 只动画主内容根容器；
- `opacity 0.96 → 1` + `translateY(4px → 0)`，160ms；
- 初次应用启动 `initial={false}`，避免冷启动时整页漂入；
- 快速连续导航时允许新动画覆盖旧动画；
- Workspaces 图编辑器不做整页模糊或缩放。

### 8.9 工作台展开/收起

右侧工作台收起时：

1. 面板内部先淡出并向右移动 12px，160–180ms；
2. 完成后提交网格列变化；
3. 资源列表不逐卡片动画；
4. 展开时先恢复布局，再让工作台淡入；
5. 2000 资源场景直接切换布局，只动画工作台本身。

不要逐帧动画 `grid-template-columns`，否则资源网格会在每帧重新布局。

### 8.10 工作区

#### 工作区列表

- 启动按钮使用通用 press；
- 当前启动的卡片出现局部状态环；
- 其他卡片不进入 disabled 淡化状态。

#### 图编辑器

- 节点新增：opacity + scale .98，160ms；
- 节点选中：边框/小范围光晕，120ms；
- 详情抽屉：x 12px + opacity，180ms；
- 连线不做持续流光；
- 启动时只高亮当前执行节点和已完成节点；
- 不在整张图上播放粒子。

#### 启动进度

当前弹簧式 `scaleIn` 改成标准面板进入：

- overlay 140ms；
- panel 180ms，不使用 overshoot；
- 进度条使用 `scaleX` 和 `transform-origin: left`，避免动画 width；
- 当前步骤文字交替使用 100ms fade；
- 旋转图标仅在任务进行时存在；
- 完成后显示一次成功状态，再退出。

### 8.11 首次引导

- 移除 `setTimeout(280)` 驱动的人工过渡；
- 使用 `AnimatePresence` 按 step key 切换；
- 旧步骤退出 100ms，新步骤进入 160ms；
- 进度条宽度 160ms；
- 模板卡 hover 与通用卡片一致；
- 选中模板后立即开始数据操作，动画不阻塞；
- 扫描成功只播放一次 check pop；
- 系统减少动态效果时只做 80ms 淡入淡出。

### 8.12 悬浮球

悬浮球是独立轻量入口，不加载主应用 Motion 特性包。

- hover 图片切换继续使用 CSS；
- hover 可增加最多 `scale(1.025)`，120ms；
- press `scale(.96)`，80ms；
- 拖拽期间无滤镜和光晕动画；
- 吸附边缘保留 160ms，但 Motion Off 时立即定位；
- 新的吸附请求必须取消旧动画；
- `setPosition` 同一时间最多一个请求在途；
- 菜单窗口内部 140ms fade + scale，不做五个按钮的长 stagger；
- 需要退出动画时，由菜单入口与 Tauri hide 流程握手，最多等待 100ms；
- 禁止悬浮球空闲呼吸、持续旋转或持续改变阴影。

### 8.13 Local Galaxy 品牌动效

完整模式允许：

- 背景丝绸层 48–60 秒的极慢位移；
- 单次状态环、搜索高光和局部轨道转动；
- 同屏最多一个持续品牌动画。

标准、精简和关闭模式：

- 背景保持静态；
- 素材只通过 opacity 响应 hover/focus；
- 禁止无限 `hotkey-pulse`；
- spinner 只在真实任务运行时出现。

页面隐藏、窗口最小化或 WebView 不可见时暂停全部持续动画。可监听 `visibilitychange`，独立窗口还应结合 Tauri 窗口焦点/可见性事件。  
参考：[Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)。

## 9. 素材库策略

动画优化第一版不把在线素材库接入应用运行时。

建议边界：

- 现有 Local Galaxy PNG 素材保持静态；
- 通过容器 transform 和伪元素 opacity 产生反馈；
- 后续若引入 `.lottie`，只用于首次引导、空状态、导入完成和工作区完成；
- 列表页显示静态首帧；
- 窗口隐藏时销毁或暂停播放器；
- 悬浮球入口不加载 Lottie/Rive runtime；
- 每个素材保留来源、作者、许可证、文件哈希和 reduced-motion fallback。

只有在基础动画系统完成并通过性能验收后，才建立 `AnimationAssetProvider`。

## 10. 文件级实施建议

| 文件 | 建议改动 |
| --- | --- |
| `src/styles.css` | 移除裸时长、重复 keyframes 和关键 `transition: all`；逐步迁出动画规则 |
| `src/styles/motion-tokens.css` | 新增全局时长、缓动、距离和 motion mode |
| `src/styles/motion-components.css` | 新增按钮、tooltip、状态反馈等通用规则 |
| `src/motion/*` | 新增 MotionProvider、策略、variants 和通用容器 |
| `src/App.tsx` | 接入 provider；页面、弹窗、命令面板和工作台使用统一 motion primitives |
| `src/features/catalog/ResourceList.tsx` | 增加单项启动状态；保持 dnd-kit transform 独占 |
| `src/components/OnboardingWizard.tsx` | 移除 setTimeout 过渡，改为基于 step 的 presence |
| `src/components/FloatingBubble/*` | 接入 motion mode、动画取消和窗口隐藏策略 |
| `src/components/Workspaces/*` | 节点、抽屉和启动状态按场景接入 |
| `src/types.ts` | 增加 `motionMode` |
| `src-tauri/src/main.rs` | 增加 `motion_mode` 默认设置和读写命令 |
| `src/app/WindowRouter.tsx` | 每个入口应用统一 data-motion/data-window-state |
| `tests/*` | 增加 motion mode、退出动画、减少动态效果和拖拽回归 |

## 11. 实施顺序

### 阶段 0：基线与清理

- 输出现有 keyframes、transition 和持续动画清单；
- 修复重复 `spin` 命名；
- 标出 `transition: all`；
- 记录命令面板、弹窗、拖拽、工作区和悬浮球的视频基线；
- 不改变视觉结果。

验收：动画清单完整，现有构建和 E2E 通过。

### 阶段 1：Motion Policy

- 新增 motion tokens；
- 新增四档 motion mode；
- 适配系统减少动态效果；
- 接入 Page Visibility/Tauri window pause；
- 所有窗口入口输出统一属性。

验收：标准、精简、关闭三种状态可人工切换；窗口隐藏后无持续动画。

### 阶段 2：关键操作反馈

- 通用按钮；
- Tooltip；
- 资源启动、收藏、成功和失败；
- 搜索 focus；
- 工作台状态文字 crossfade；
- 拖拽视觉收敛。

验收：用户不看右侧状态文字也能判断当前资源是否被点击、正在启动和是否失败。

### 阶段 3：弹窗与命令面板

- 按需接入 Motion；
- 建立 MotionDialog；
- 命令面板、普通弹窗、设置面板和右键菜单具有退出动画；
- 关闭和重复提交行为受控。

验收：所有 overlay 的进入/退出节奏一致，Esc、背景点击和关闭按钮行为不回退。

### 阶段 4：结构过渡

- 页面根容器；
- 子目录折叠；
- 工作台展开/收起；
- Onboarding 步骤切换；
- 工作区抽屉与启动进度。

验收：结构变化可理解，但 2000 个资源场景没有逐项动画。

### 阶段 5：悬浮球与多窗口

- motion mode 传递；
- 吸附取消；
- 菜单 enter/exit；
- 所有独立窗口的隐藏暂停。

验收：悬浮球拖拽、吸附、菜单和主窗口恢复没有位置跳变或残留窗口。

### 阶段 6：品牌动效和素材评估

- 只在完整模式恢复极慢背景漂移；
- 评估一到两个语义明确的本地动画素材；
- 验证安装包体积、WebView2 进程内存和 GPU 活动。

验收：不因品牌动画增加新的长期 CPU/GPU 占用。

## 12. 测试方案

### 12.1 自动测试

- `prefers-reduced-motion: reduce` 时 transform/layout 动画关闭；
- `data-motion="off"` 时动画在一个 frame 内完成；
- 弹窗关闭后在退出完成时才卸载；
- 快速连续打开/关闭弹窗不残留 backdrop；
- 命令面板键盘选择不丢焦点；
- 资源拖拽后顺序持久化；
- Motion 不覆盖 dnd-kit transform；
- Onboarding 切换步骤不再依赖固定 timeout；
- Bubble Off 模式直接吸附。

Playwright 可使用 reduced motion media 模拟做确定性验证，但真实 Tauri/WebView2 仍需单独验收。

### 12.2 人工场景

| 编号 | 场景 |
| --- | --- |
| M1 | 主窗口冷启动，不播放整页入场 |
| M2 | 连续打开/关闭命令面板 10 次 |
| M3 | 资源启动成功、失败和连续点击 |
| M4 | 100/500/2000 资源搜索和分组切换 |
| M5 | 资源、分组、子目录和工作台模块拖拽 |
| M6 | 工作台展开/收起和页面快速切换 |
| M7 | 工作区执行成功、失败、取消 |
| M8 | 悬浮球拖拽、吸附、菜单和恢复主窗口 |
| M9 | 完整/标准/精简/关闭四档 |
| M10 | Windows 减少动态效果开启 |

### 12.3 性能验收

- 交互反馈在 100ms 内可见；
- 普通弹窗进入不超过 200ms，退出不超过 140ms；
- 标准模式窗口空闲时没有非必要无限动画；
- 页面隐藏后持续动画全部暂停；
- 2000 资源场景不执行逐卡片入场；
- 不因动画新增主窗口之外的 WebView；
- Motion 主入口增量 gzip 记录在构建报告中；
- 使用现有 A–E 性能场景复测内存、CPU 和 WebView2 进程数；
- 动画前后必须在同一安装包模式、数据集和窗口组合下比较。

## 13. 完成标准

方案落地后应满足：

1. 动画时长和缓动来自统一 token。
2. 所有弹窗和菜单都有可控退出动画。
3. 资源启动、成功、失败和收藏具有局部明确反馈。
4. dnd-kit 与 Motion 不争用同一 transform。
5. 四档动画等级对所有主题和窗口生效。
6. 系统减少动态效果能覆盖 React、CSS、悬浮球和工作区。
7. 标准模式没有非必要的持续动画。
8. 大列表不做逐项动画。
9. 页面隐藏后动画暂停。
10. 构建、E2E、真实 Tauri 交互和 A–E 性能场景均通过。

## 14. 明确不做

- 不为了动画重写 UI 架构；
- 不把所有组件改成 Motion 组件；
- 不用 GSAP 接管 React 页面；
- 不给资源列表增加全量 stagger；
- 不给工作区图增加粒子流；
- 不让悬浮球持续呼吸；
- 不在第一阶段接入在线动画素材市场；
- 不用“动画更炫”替代数据层和响应速度优化。

