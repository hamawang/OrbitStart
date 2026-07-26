# OrbitStart

<p align="center">
  <img width="220" alt="OrbitStart Logo" src="https://github.com/user-attachments/assets/489ebaf1-20fa-4a70-8b8d-988bbfec3044" />
</p>

<div align="center">

**A local-first resource workspace for Windows.**

把应用、网址、文件、文件夹、脚本和工作区集中到一个围绕真实任务组织的 Windows 本地工作台。

[![Version](https://img.shields.io/badge/version-0.8.2-2f81f7)](https://github.com/xuxinxi14/OrbitStart/releases)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)
![Tauri](https://img.shields.io/badge/Tauri-2.x-24c8db)
![React](https://img.shields.io/badge/React-18-61dafb)
![License](https://img.shields.io/badge/license-MIT-green)

[下载最新版](https://github.com/xuxinxi14/OrbitStart/releases) · [查看更新日志](#080-更新内容) · [开发者构建](#本地开发)

</div>

---

## OrbitStart 是什么？

OrbitStart 是一个面向 Windows 的本地资源工作台。

它不只是一个应用启动器，也不只是浏览器书签管理器。OrbitStart 希望把日常任务中分散在桌面、开始菜单、浏览器、文件夹和脚本目录里的入口，统一整理成一个可搜索、可分组、可扩展的个人工作空间。

你可以在 OrbitStart 中管理：

* Windows 应用和快捷方式
* 本地文件与文件夹
* 网站和在线工具
* PowerShell、批处理等脚本
* 常用命令和动作入口
* 由多个步骤组成的工作区
* 与资源关联的说明、状态和操作记录
* Obsidian 笔记与任务索引

OrbitStart 的核心目标不是简单地“打开一个程序”，而是帮助你快速进入一个完整的任务环境。

例如：

* 开始剪辑时，同时打开 Premiere Pro、素材目录、音效网站和项目文件夹。
* 开始编程时，同时打开 VS Code、项目仓库、API 文档和本地服务。
* 开始学习时，快速进入课件、笔记、题库、翻译工具和课程网页。
* 开始科研时，打开文献管理器、数据库网站、论文目录和分析脚本。


<img width="959" height="614" alt="image" src="https://github.com/user-attachments/assets/3871c37a-e099-406a-b8f4-dcdcc9271b17" />

---

## 为什么开发 OrbitStart？

Windows 已经提供了桌面、开始菜单、任务栏和文件资源管理器，浏览器也提供了书签系统，但这些入口彼此独立。

长期使用后，常见的问题包括：

* 桌面快捷方式越来越多，难以长期整理。
* 开始菜单适合启动应用，但不适合围绕项目组织资源。
* 浏览器书签只能管理网页，无法统一管理本地文件和程序。
* 文件夹可以存放文件，却不能直接表达一个任务需要启动哪些应用和网站。
* 普通启动器更强调即时搜索，不一定适合维护长期工作流。
* 同一个任务往往需要多个应用、文件夹、网页和脚本配合使用。

OrbitStart 尝试提供一个统一入口，让资源围绕“我要完成什么任务”来组织，而不是继续分散在不同系统中。

---

## 下载与安装

普通用户可以直接从 GitHub Releases 下载 Windows 安装包。

### 安装步骤

1. 打开 [GitHub Releases](https://github.com/xuxinxi14/OrbitStart/releases)。

2. 下载最新版 Windows x64 安装包：

   ```text
   OrbitStart_0.8.2_x64-setup.exe
   ```

3. 运行安装程序并按提示完成安装。

普通用户不需要预先安装 Node.js、Rust、Tauri 或其他开发环境。

### 自动更新

OrbitStart 已接入 Tauri 自动更新机制。

安装正式版本后，应用可以通过仓库中的更新清单检查新版本，并获取对应的 Windows 安装包。

---

## 核心功能

### 统一资源管理

OrbitStart 使用统一的资源模型管理不同类型的入口：

| 类型  | 示例                         |
| --- | -------------------------- |
| 应用  | VS Code、Excel、Photoshop、微信 |
| 文件  | 表格、课件、论文、项目文件              |
| 文件夹 | 项目目录、素材库、数据目录              |
| 网站  | GitHub、ChatGPT、PubMed、课程平台 |
| 脚本  | PowerShell、BAT 等本地脚本       |
| 动作链 | 按顺序执行多个启动步骤                |

每个资源都可以设置：

* 标题和说明
* 目标路径或网址
* 启动参数
* 别名
* 标签
* 所属分组
* 子目录
* 图标与强调色
* 收藏状态


---

### 搜索与快速启动

OrbitStart 支持从统一搜索入口查找本地资源和插件结果。

搜索范围包括：

* 资源名称
* 路径和网址
* 别名
* 标签
* 分组
* 子目录
* 插件提供的搜索结果

搜索系统包含匹配评分、最近使用权重和拼音首字母等辅助逻辑，方便在资源数量较多时快速定位目标。

<p align="center">
  <img width="493" alt="OrbitStart Workspace Graph" src="https://github.com/user-attachments/assets/c43d33ef-4615-45a0-9c67-3749f5720a52" />
</p>

---

### 分组与层级子目录

除了普通分组外，OrbitStart 还支持在分组内部建立多层子目录。

例如：

```text
开发工具
├── 编辑器
│   ├── VS Code
│   └── WebStorm
├── 数据库
│   ├── DBeaver
│   └── RedisInsight
└── 调试工具
    ├── Postman
    └── DevTools
```

当前支持：

* 多层子目录
* 子目录折叠和展开
* 子目录搜索与选择
* 子目录排序
* 层级之间拖拽调整
* 将资源拖入指定分组或子目录
* 为分组和子目录设置快捷键
* 批量选择和批量管理资源

这种设计保留了 OrbitStart 原有的标签式管理体验，同时提供比单层标签更清晰的收纳能力。

---

### 拖拽导入

你可以将 Windows 文件或文件夹直接拖入 OrbitStart。

拖入时，OrbitStart 会根据目标区域将资源添加到对应分组，减少手动填写路径的操作。

同时支持扫描和导入：

* 桌面快捷方式
* 开始菜单快捷方式
* Chrome 书签
* Edge 书签

导入流程支持预览、筛选和批量提交。

对于大量资源，界面会采用渐进式渲染，避免一次性加载过多项目造成明显阻塞。

---

### 收藏、最近使用与启动统计

资源可以被标记为收藏，并记录启动行为。

OrbitStart 可以保存：

* 收藏状态
* 启动次数
* 最近启动时间
* 自定义排序

这些信息可以用于快速访问常用资源，也可以辅助搜索结果排序。

---

## 工作区系统

工作区是 OrbitStart 当前最重要的能力之一。

一个工作区可以包含多个启动步骤，用来描述完成某个任务时需要打开的全部资源。

例如，一个“视频剪辑”工作区可以包含：

```text
启动视频剪辑工作区
├── 打开 Premiere Pro
├── 打开 Photoshop
├── 打开项目素材文件夹
├── 打开音效网站
└── 恢复应用窗口位置
```

### 支持的步骤类型

工作区步骤可以是：

* OrbitStart 已有资源
* 应用
* 网站
* 文件夹
* 文件
* 脚本
* 等待步骤

### 启动控制

每个步骤可以配置：

* 启动顺序
* 启动参数
* 工作目录
* 启动延时
* 是否启用
* 失败后继续或停止
* 前置依赖
* 防止重复启动

### 等待条件

等待步骤可以用于处理应用启动速度不同的问题。

当前可配置的等待条件包括：

* 等待指定时间
* 等待进程出现
* 等待端口可用
* 等待文件或路径出现
* 等待网址可访问
* 设置超时时间

### 脚本步骤

工作区支持添加：

* BAT 脚本
* PowerShell 脚本
* 内联脚本内容
* 外部脚本文件

---

## 图形化工作区编辑器

OrbitStart 提供图形化工作区编辑模式，用节点和连接关系展示启动流程。

图形模式以“启动工作区”为根节点，各个步骤可以根据依赖关系形成不同分支。

当前支持：

* 图形视图
* 卡片视图
* 列表视图
* 节点依赖关系
* 自动布局
* 缩放
* 平移
* 一键适应画布
* 画布锁定
* 全屏编辑
* 节点右键操作
* 节点复制与粘贴
* 明暗主题自动适配

相比单纯的线性步骤列表，图形模式更适合表达：

* 多条并行启动路径
* 前后依赖关系
* 脚本与应用之间的关系
* 复杂工作流的整体结构

<img width="957" height="612" alt="image" src="https://github.com/user-attachments/assets/d257a01b-292d-4279-8802-4878764c2031" />


---

## 窗口布局捕获

工作区可以读取当前正在运行的应用窗口，并记录窗口位置和大小。

可记录的信息包括：

* 进程名称
* 窗口标题
* 可执行文件路径
* 窗口横纵坐标
* 窗口宽度与高度
* 最大化状态
* 窗口置顶状态

你可以把当前桌面上的应用布局导入工作区，在下次启动工作区时尝试恢复对应的窗口排列。

---

## 全局快捷键

OrbitStart 支持全局快捷键。

可以用于：

* 唤醒 OrbitStart
* 打开命令搜索
* 切换到指定分组
* 打开指定子目录
* 启动指定工作区

即使 OrbitStart 主窗口处于隐藏状态，也可以通过已注册的快捷键快速进入任务环境。

默认全局快捷键为：

```text
Ctrl + Alt + Space
```

快捷键可以在设置中修改。

---

## 悬浮球

OrbitStart 提供独立的桌面悬浮球模式。

悬浮球可以长期停留在桌面边缘，用来快速打开 OrbitStart 或执行常用操作。

当前支持：

* 窗口置顶
* 拖拽移动
* 自动吸附屏幕边缘
* 多显示器位置适配
* 自定义尺寸
* 自定义透明度
* 鼠标悬停展开
* 自定义展开延时
* 主窗口隐藏时显示
* 快捷操作菜单
* 全屏环境规避选项
* 记忆上次位置

悬浮球快捷菜单可用于进入：

* 搜索
* 工作区
* 最近使用
* 添加资源
* 设置

---

## 右侧工作台

OrbitStart 主界面提供可展开和收起的右侧工作台。

工作台可以展示：

* 当前状态
* 常用工作区
* 常用操作
* 通知信息
* 资源统计

用户可以在设置中分别控制这些区域是否显示。

---

## Trip：与资源关联的说明和状态

OrbitStart 支持为资源附加 Trip 信息。

Trip 可以理解为与某个资源直接关联的短笔记、操作说明、状态记录或参考内容。

例如，你可以为一个项目文件夹记录：

* 启动项目需要先执行的命令
* 当前开发进度
* 常见问题
* 服务器地址
* 下次需要处理的事项

Trip 支持以下分类：

* 快捷说明
* 工作流
* 普通笔记
* 状态
* 参考资料

也支持以下状态：

* 待处理
* 进行中
* 已完成
* 需要更新

Trip 可以被固定，也可以跨资源搜索。

---

## Obsidian 集成

OrbitStart 可以索引本地 Obsidian Vault 中的 Markdown 笔记和复选框任务。

当前支持：

* 添加本地 Vault
* 扫描 Markdown 笔记
* 建立笔记索引
* 提取复选框任务
* 搜索笔记和任务
* 查看笔记标签
* 收藏笔记
* 通过 Obsidian 协议打开原始笔记
* 修改任务完成状态
* 将任务状态同步回 Markdown 文件
* 使用独立 Todo 窗口查看任务
* Todo 窗口置顶

所有索引和配置均保存在本地。

<img width="962" height="613" alt="image" src="https://github.com/user-attachments/assets/c0c85799-1990-4fd1-96a1-eb9126d3d13e" />


---

## 插件系统

OrbitStart 使用 Manifest 驱动的插件结构。

插件通过 `plugin.json` 声明：

* 插件 ID
* 名称
* 版本
* 描述
* 权限
* 命令数量
* 搜索 Provider
* 主题
* 自定义视图

示例：

```json
{
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "0.1.0",
  "description": "An OrbitStart plugin.",
  "enabled": true,
  "permissions": [
    {
      "id": "ui:toast",
      "label": "显示通知",
      "risk": "low"
    }
  ],
  "contributes": {
    "commands": 1,
    "searchProviders": 0,
    "themes": 0,
    "views": 0
  }
}
```

### 当前插件能力

插件目前可以贡献：

* 命令
* 搜索结果
* 通知
* 本地插件存储
* 自定义视图
* 与 OrbitStart 资源目录交互的受限能力

插件运行事件会写入本地日志。

当前仓库包含的插件示例包括：

* Hello Command
* Tips Search
* Obsidian Search
* Workspaces

插件系统仍在持续完善中。目前已经具备 Manifest、权限声明、启用与停用、Worker 运行时和日志等基础结构，但还不能等同于成熟的第三方插件生态。

---

## 主题系统

OrbitStart 使用主题 Token 管理：

* 背景色
* 面板颜色
* 文字颜色
* 强调色
* 边框
* 圆角
* 阴影
* 状态样式
* 字体

当前内置主题包括：

* Local Galaxy
* Zentou Wireframe
* People's Platform
* Creative Mode
* Atelier Zero
* Atelier Charcoal
* Atelier Mint
* Atelier Sky
* Atelier Pink
* Atelier Grey
* Atelier Lavender
* Atelier Rust
* Atelier Coal
* Atelier Abyss
* Atelier Amber

### Local Galaxy

Local Galaxy 是 OrbitStart 的默认主题。

它使用深蓝、暗金和青绿色高光，并结合本地位图素材构建桌面化的星系视觉。

<p align="center">
  <img width="712" alt="OrbitStart Resource Workspace" src="https://github.com/user-attachments/assets/c1b1466c-b30e-4464-a105-94b0bf63300c" />
</p>

### Theme Studio

主题可以在设置中切换，界面组件通过统一 Token 自动适配不同主题。

<p align="center">
  <img width="900" alt="OrbitStart Themes" src="https://github.com/user-attachments/assets/e0eeb14e-0080-4fbf-92b2-4927b943cc23" />
</p>

0.8.0 中，工作区图形编辑器也已经接入主题 Token，可以自动适配亮色和暗色主题。

---

## 导入流程

OrbitStart 可以扫描 Windows 中已有的程序快捷方式和浏览器书签。

<p align="center">
  <img width="420" alt="OrbitStart Import Flow" src="https://github.com/user-attachments/assets/ead9c276-3c63-4275-8fda-4524d3928bdf" />
</p>

导入前可以：

* 预览扫描结果
* 选择需要导入的项目
* 排除无效或不需要的项目
* 指定目标分组
* 批量完成导入

快捷方式扫描采用增量处理方式，批量数据通过事务写入。应用图标可以在导入完成后继续于后台补全，避免大量资源同时导入时长时间阻塞界面。

---

## 常见使用场景

### 视频剪辑

将以下资源放进同一个工作区：

* Premiere Pro
* Photoshop
* DaVinci Resolve
* 项目素材目录
* 字体网站
* 音效库
* 输出目录

通过工作区一次打开，并恢复应用窗口布局。

### 编程开发

集中管理：

* VS Code
* 本地项目目录
* GitHub 仓库
* API 文档
* 数据库工具
* 本地服务地址
* PowerShell 启动脚本

### 学习与课程

整理：

* 课程课件
* 教材 PDF
* Obsidian 笔记
* 网课链接
* 题库
* 翻译工具
* 文献检索网站

### 科研与文献

组合：

* Zotero
* Obsidian Vault
* PubMed
* Google Scholar
* 论文目录
* 数据目录
* 分析脚本
* 实验记录

### 数据分析

快速进入：

* Excel
* Python 或 R 环境
* 数据文件夹
* 分析脚本
* 作图软件
* 报告文档
* 数据库控制台

### 日常工具中心

将常用工具设为收藏：

* 微信
* 浏览器
* Everything
* ChatGPT
* 常用文件夹
* 网络工具
* 系统设置入口

---

## 数据与隐私

OrbitStart 采用本地优先设计。

默认数据目录为：

```text
%APPDATA%\OrbitStart
```

主要内容包括：

```text
orbit.db        SQLite 数据库
plugins\        本地插件目录
themes\         本地主题目录
backups\        JSON 备份目录
```

WebView2 的部分界面状态和插件数据可能保存在：

```text
%LOCALAPPDATA%\local.orbitstart\EBWebView\
```

当前版本没有内置云同步逻辑。

资源目录、插件状态、主题设置、工作区配置和 Obsidian 索引默认保存在用户本机。

---

## 备份与迁移

OrbitStart 支持导出和导入资源目录数据。

可以使用 JSON 文件备份：

* 资源
* 分组
* 标签
* 部分设置和目录信息

建议在进行大规模整理、测试新版本或迁移设备前先导出备份。

---

## 0.8.0 更新内容

OrbitStart 0.8.0 主要包含以下更新：

1. 工作区插件图形模式接入统一主题 Token。
2. 工作区图形编辑器支持自动适配亮色与暗色主题。
3. 修复工作区全局快捷键录制不灵敏的问题。
4. 修复工作区快捷键在应用隐藏后无法正常唤醒的问题。
5. 修复主界面标签页快捷键角标被遮挡的问题。
6. 修复标签页快捷键角标的层级和遮罩问题。
7. 同步更新前端、Rust、Tauri 配置和自动更新清单至 0.8.0。
8. 增加 Lite 构建相关基础配置。

---

## 当前边界

OrbitStart 仍处于持续开发阶段。

当前需要注意：

* 主要支持 Windows 10 和 Windows 11。
* 工作区窗口恢复依赖目标应用和窗口状态，不同程序的恢复效果可能不同。
* 插件系统仍处于早期阶段，第三方插件生态尚未成熟。
* 插件权限展示不等同于完整的系统级沙箱。
* Everything 和窗口切换等高级能力仍在继续完善。
* Obsidian 集成主要面向本地 Markdown Vault。
* 当前没有云同步和多设备实时同步。
* macOS 和 Linux 尚不是主要支持平台。

---

## Roadmap

后续计划包括：

* 更完整的工作区依赖和错误恢复机制
* 更直观的工作区图形编辑交互
* 工作区模板与分享机制
* 更完善的窗口布局匹配和恢复
* 更强的拼音、缩写和模糊搜索
* Everything 深度集成
* Obsidian 更完整的双向联动
* 浏览器多 Profile 支持
* 插件 API 扩展
* 插件隔离与包验证
* 插件市场或 Registry
* 主题包导入、导出与分享
* 新手引导和示例资源包
* 更稳定的自动更新与发布通道
* 安装包代码签名
* 数据迁移和备份管理改进

---

## 技术架构

| 模块    | 技术                          |
| ----- | --------------------------- |
| 桌面框架  | Tauri 2                     |
| 前端    | React 18                    |
| 开发语言  | TypeScript + Rust           |
| 构建工具  | Vite                        |
| 本地存储  | SQLite                      |
| 拖拽排序  | dnd-kit                     |
| 图标    | Lucide React + 本地应用图标       |
| 自动更新  | Tauri Updater               |
| 全局快捷键 | Tauri Global Shortcut       |
| 测试    | Playwright + Custom Harness |
| 安装包   | NSIS                        |
| 许可证   | MIT                         |

### 基础结构

```text
OrbitStart/
├── src/                         React 前端
│   ├── components/              功能组件
│   ├── desktop/                 桌面外壳与窗口交互
│   ├── lib/                     搜索、原生桥接和业务逻辑
│   ├── plugin/                  插件宿主和 Worker 运行时
│   ├── theme/                   主题资源
│   ├── App.tsx                  主应用
│   ├── types.ts                 TypeScript 类型
│   └── styles.css               全局样式与主题
├── src-tauri/                   Rust / Tauri 后端
│   ├── src/main.rs              原生命令与数据库逻辑
│   ├── Cargo.toml
│   └── tauri.conf.json
├── plugins/                     本地插件和示例插件
├── themes/                      主题包
├── docs/                        设计与开发文档
├── tests/                       自动化测试
├── tools/                       构建和打包脚本
├── latest.json                  自动更新清单
└── package.json
```

---

## 本地开发

### 环境要求

* Windows 10 或 Windows 11
* Node.js
* npm
* Rust
* Tauri 2 所需的 Windows 构建环境
* Microsoft Edge WebView2

### 克隆仓库

```bash
git clone https://github.com/xuxinxi14/OrbitStart.git
cd OrbitStart
```

### 安装依赖

```bash
npm install
```

### 启动前端开发服务器

```bash
npm run dev
```

前端开发服务器默认运行在：

```text
http://127.0.0.1:1420
```

在浏览器模式下，部分原生能力会使用 localStorage 降级实现，方便进行界面预览和基础测试。

### 启动 Tauri 开发模式

```bash
npm run tauri:dev
```

### 构建前端

```bash
npm run build
```

### 构建 Windows 桌面应用

```bash
npm run tauri:build
```

构建后的安装包通常位于：

```text
src-tauri\target\release\bundle\nsis\
```

---

## Lite 构建

0.8.0 加入了 Lite 构建的基础配置。

Lite 模式用于构建更精简的 OrbitStart 版本，可以排除部分扩展功能和本地插件，例如工作区、Tips Search 和 Obsidian 相关模块。

该模式目前主要面向开发与实验用途，不代表单独维护的稳定发行通道。

---

## 测试

### 基础 E2E 测试

```bash
npm run test:e2e
```

覆盖内容包括：

* 主界面加载
* 悬浮球窗口路由
* 多层子目录
* 资源右键菜单
* 右侧工作台
* 大量资源渐进渲染
* 拖拽导入
* 版本信息
* 子目录选择

### 主题测试

```bash
npm run test:e2e:themes
```

### 自定义测试

```bash
npm run test:custom
```

---

## 插件开发

仓库中提供了插件开发文档和示例插件。

相关内容可查看：

* `docs/PLUGIN_API.md`
* `docs/PLUGIN_DEVELOPMENT.md`
* `plugins/hello-command`
* `plugins/tips-search`
* `plugins/obsidian-search`
* `plugins/workspaces`

打包插件可以使用：

```bash
npm run package:plugin
```

---

## 参与项目

欢迎通过以下方式参与 OrbitStart：

* 提交 Issue
* 报告 Bug
* 提出功能建议
* 改进文档
* 开发插件
* 设计主题
* 提交 Pull Request

在提交问题时，建议附上：

* OrbitStart 版本
* Windows 版本
* 问题复现步骤
* 截图或录屏
* 相关日志
* 是否可以稳定复现

---

## License

OrbitStart 使用 [MIT License](LICENSE) 发布。

你可以在遵守 MIT License 的前提下使用、修改和分发本项目。

---

<div align="center">

**OrbitStart**

Organize resources around real tasks.

[Releases](https://github.com/xuxinxi14/OrbitStart/releases) · [Issues](https://github.com/xuxinxi14/OrbitStart/issues) · [Source Code](https://github.com/xuxinxi14/OrbitStart)

</div>

## 请我喝杯咖啡？

如果您愿意，可以请我喝一杯咖啡

<img width="612" height="667" alt="862835ac21cc063610bd86c2e274579" src="https://github.com/user-attachments/assets/0f695fe7-d493-4691-8a1d-11f7e36fc67d" />   <img width="1372" height="1959" alt="1a576ac6bfa0998080478d7c736d0c2" src="https://github.com/user-attachments/assets/0a3b5d05-8fd5-44be-91ed-cc5396fcff80" />

