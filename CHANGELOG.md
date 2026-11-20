# 更新记录

## 2.0.0 — 2026-11-20

- 升级为单个 DSH bundle，沿用官方 Codex app-server 协议、子任务生命周期和取消/错误处理。
- 内置官方适配器源码，固定 upstream commit 并保留 DeepSeek MIT 许可证，不要求再装官方 Codex 子智能体插件。
- 复用已有 Codex CLI，不下载重复 Codex，不新增 npm 运行依赖。
- 增加 /codex doctor、/codex 图片/文件交接，以及 codex_task 模型工具。
- 通过官方命令附件入口服务文字模型会话，不再默认安装旧图片/任意文件网关补丁。
- 默认 workspace-write，不伪造用户授权；Codex 模型留空时继承现有配置。
- 增加 900 秒默认超时和可调终止宽限；子进程原始 stderr 不转发到插件日志。
- 插件提供安全的 codex-bridge Skill，不修改或删除磁盘上的旧 Skill；停用后旧入口恢复可见。
- 保留旧 CLI，版本升为 2.0.0，并移除监督提示中的虚构全权授权。
- 真实模型、桌面操作和已安装界面不属于离线测试结论；本版不提供同一 Codex 线程跨次继续。
