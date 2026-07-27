# 插件权限与 CSP 策略

适用版本：OrbitStart 0.8.3。

本策略把本地插件视为不可信扩展代码。插件可以贡献命令和搜索结果，但不能得到通用 Tauri `invoke` 能力，也不能通过一个宽泛权限获得多种高风险宿主操作。

## 能力清单

插件的 `plugin.json` 必须使用以下精确能力 ID。未知 ID、旧的宽泛 ID（例如 `shell:open`）和只出现在运行时文件中的 ID 都不会授予访问权。

| 能力 ID | 风险 | 允许的宿主操作 |
| --- | --- | --- |
| `ui:toast` | 低 | 显示应用内短提示 |
| `storage:plugin` | 低 | 读写该插件 ID 命名空间内的存储 |
| `settings:plugin` | 低 | 读写该插件 ID 命名空间内的设置 |
| `catalog:read` | 低 | 读取资源目录快照 |
| `trips:read` | 中 | 搜索或打开 Tip 记录 |
| `obsidian:read` | 中 | 搜索已索引的 Obsidian 待办并请求打开 |
| `launcher:item` | 低 | 仅按已有资源 ID 启动资源 |
| `launcher:target` | 中 | 启动插件提供的路径或 URL |
| `filesystem:exists` | 中 | 检查本地路径是否存在 |
| `network:probe` | 中 | 通过宿主探测端口或 URL；不是任意网络访问 |
| `process:read` | 中 | 检查指定进程是否运行 |
| `window:layout` | 高 | 应用已保存的桌面窗口布局 |
| `shell:script-file` | 高 | 执行已有本地脚本文件 |
| `shell:inline-script` | 严重 | 执行插件直接提供的脚本文本 |

`launcher:run_script` 要求在脚本文件和内联脚本两种模式中二选一。宿主会分别检查 `shell:script-file` 或 `shell:inline-script`；不得以空路径、同时提供路径和内容等方式绕过该选择。

## 强制规则

1. 宿主只接受固定的 host API 白名单；未知 API 默认拒绝。
2. 一个能力必须同时存在于应用已加载的插件清单和运行时重新读取的 `plugin.json` 中，才会授予。这样，运行期间被替换的插件文件不能静默增加能力。
3. Worker 发出的命令和搜索提供者必须使用 `<plugin-id>.` 前缀，并且不能超过清单中声明的贡献数量。
4. Worker 没有 DOM、通用 Tauri `invoke` 或任意文件系统入口。直接 `fetch`、WebSocket、EventSource、XMLHttpRequest、`importScripts` 和动态 import 都被禁止；网络探测必须走受控的 `network:probe` 桥接接口。
5. 插件关闭或运行失败时，Worker 和其 Blob URL 都会被释放，避免残留运行时继续接收消息。
6. 启用后获得高风险或严重风险能力的插件会写入一条警告级运行日志，便于在插件管理页追溯。

## 已有插件迁移

旧的 `shell:open` 不再是兼容别名。需要启动工作区的第一方 `workspaces` 插件应显式声明：

```json
[
  "catalog:read",
  "storage:plugin",
  "ui:toast",
  "launcher:item",
  "launcher:target",
  "filesystem:exists",
  "network:probe",
  "process:read",
  "window:layout",
  "shell:script-file",
  "shell:inline-script"
]
```

只在插件实际使用相应接口时保留该能力。尤其是 `shell:inline-script`，应当只在用户明确需要内联脚本步骤时声明，并在插件管理页审阅后再启用。

## CSP

桌面应用现在使用范围明确的 Content Security Policy：

- `script-src` 只允许应用自身脚本，且不包含 `unsafe-eval`；插件 Worker 不再使用 `new Function`。
- `worker-src` 只允许应用自身和受控 Blob Worker，以支持隔离插件运行时。
- `connect-src` 仅保留应用自身和 Tauri IPC (`ipc:`、`http://ipc.localhost`)；前端不会直接向任意网络主机发起请求。
- 图片和字体仅允许本地资源、`data:`，并为 Worker/本地预览保留必要的 `blob:` 图片源。
- 应用当前有大量 React 内联样式，因此仅在 `style-src-attr` 中保留 `unsafe-inline`。它不放宽脚本执行。
- 开发态 CSP 只额外允许 Vite 的本机 HMR 地址 `ws://127.0.0.1:1420`；该来源不进入发行包 CSP。

在 Windows 发行包中应至少手工验证：主窗口、主题资源、浮动球、辅助窗口、Tauri IPC、内置插件和 Worker 插件均可工作，并检查控制台没有 CSP 拒绝。

## 信任边界与后续工作

这套策略限制的是**运行时宿主 API**，不能把用户可写插件目录当作可信软件源。当前本地插件的 `plugin.json` 仍由安装者控制；安装不明来源插件前应审阅其代码和权限。

在引入外部插件分发前，应增加以下发布链路：

1. 为插件包生成内容哈希，并将哈希与版本绑定。
2. 对清单和内容哈希进行签名验证；签名失败、清单变更或哈希变更时默认禁用。
3. 将用户授予的高风险能力单独持久化，并与插件 ID、版本和内容哈希绑定；升级或新增高风险能力时重新确认。
4. 在后端再次校验每个宿主命令的插件身份和能力，避免未来新增桥接路径绕过前端宿主。

在上述签名和独立授权机制完成前，`shell:inline-script` 应被视为需要人工审阅的严重风险能力。
