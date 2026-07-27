# OrbitStart 0.8.3 更新公告

发布日期：2026-07-27

OrbitStart 0.8.3 延续本轮稳定性、可维护性和发布可靠性优化，重点是明确资源目录、便携数据、插件宿主和发布流程的边界，同时保持已有主界面布局和基本操作方式。

## 本次更新

- 将导入过滤、分组规范化、子标签树和资源输入转换集中到 `features/catalog/model.ts`，便于单独维护和测试。
- 将悬浮球与悬浮菜单的标签解析、主题外观加载和窗口挂载集中到 `app/WindowRouter.tsx`。
- 将资源分组标签、资源卡片、子标签区和根目录放置区集中到 `features/catalog/ResourceList.tsx`。
- 资源展示组件通过类型化回调调用编辑、删除、收藏、Trips 和选择逻辑，不直接拥有应用状态或调用原生 IPC。

## 本轮扩展

- 资源编辑器和导入预览拆为独立组件，降低 App.tsx 中表单和扫描流程的耦合。
- 支持可执行文件同级的 portable.flag 或 OrbitStart.Data 便携数据模式；旧安装模式不会自动迁移或复制数据。
- 本地 app、file、folder、script 资源可选择 absolute、data-relative、workspace-relative 路径。相对路径会拒绝上级目录、盘符、UNC 与 URL 前缀，并可检查已保存路径状态。
- 插件宿主改为细粒度能力授权，移除宽泛 shell:open；高风险插件启用前需明确确认，插件 Worker 不再可直接使用网络、脚本加载或通用 Tauri bridge。
- 增加版本同步、真实签名清单生成、Windows CI 和 tag 发布工作流。Release 附件中的 latest.json 成为后续更新源。

## 用户影响

本版本不引入新的产品功能，也不调整主题、布局或导航。资源拖放、子标签折叠、批量选择、资源编辑和悬浮球路由均保持原有行为。

0.8.2 已使用的新 updater 公钥可验证 0.8.3 的签名。0.8.1 及更早版本仍信任旧公钥，需手动安装 0.8.3 一次，之后才能进入新的自动更新链路。

便携模式不会自动改写现有资源路径；批量路径修复预览仍将在后续版本提供。选择相对路径时，请先确认目标文件已经放入对应的数据目录或工作区根目录。

## 发布校验

- Rust 单元测试 30/30 通过，前端构建通过。
- Playwright 基础回归 15/15、主题回归 6/6，均正常退出；自定义浏览器检查通过。
- 已生成本地手动安装包 `release-artifacts/OrbitStart_0.8.3_x64-setup.exe`；其 ProductVersion 和 FileVersion 均为 0.8.3，SHA-256 为 `CA3306AE9AC300A049B2CBC4DBACE321C730E356119C29C803F2AAB77D303036`。
- 该安装包刻意不含 Authenticode 签名、updater `.sig` 或 `latest.json`，不可上传为 Release 更新资产。正式 0.8.3 发布仍需要受保护的 signing key 与口令；隔离构建目录已消除正在运行旧版本对构建输出的锁定，但安装和人工验收前仍应正常退出旧实例。
