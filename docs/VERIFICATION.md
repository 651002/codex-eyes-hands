# v2.0.0 验证结果

日期：2026-11-20。目标：官方 DSH Desktop 0.2.2-rc.5 / Windows。

- 7 项独立参数与附件测试通过。
- 10 项使用安装版 DSH 公共库的离线协议与宿主接口测试通过。
- Codex 执行端使用本地模拟 app-server；没有收费模型请求、桌面点击或真实任务。
- 已有 Codex CLI 的 --version 返回 0.170.0；未安装另一份 Codex。
- npm pack 成功，22 个打包条目，包含运行模块、清单、图标、中英文说明、单一 Skill、官方来源和 MIT 许可证。
- bridge.js 基线 --version 为 v1.2.1，修改后为 v2.0.0；对单独副本执行回退后恢复 v1.2.1，SHA-256 与原件一致；统一补丁逐字节重建通过。
- 未修改当前 DSH profile、旧 Skill、API 密钥或会话。

## 尚未验证

插件尚未在正在运行的 DSH profile 中安装、启用；没有验证真实模型看图、真实桌面操作、MCP 连接成功和插件页的实际显示。离线通过不能替代这些验收。本版仍是一次性 Codex 子任务，不提供跨任务恢复同一线程。

## 可复现

先运行 npm run build 和 npm test。宿主兼容测试需将 DSH_TEST_INSTALL_DIR 设置为实际 DSH 包根目录，并将 DSH_TEST_EXECUTABLE 设置为其 Node/Electron 运行时，再运行 npm run test:host。测试不修改宿主安装。
