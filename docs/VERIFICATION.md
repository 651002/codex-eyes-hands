# v2.1.0 验证结果

日期：2026-11-20（Asia/Shanghai）。目标：Windows 官方 DSH Desktop 0.2.2-rc.5，已有 Codex CLI 0.170.0。

- 第一批先测试缓存和结构化接口失败，再实现并验证通过；本地提交 fcb09f6 保存该阶段。
- 第二批先测试图像处理接口失败，再实现；修复默认重叠和宿主 schema 格式错误后通过。
- 17项独立测试 + 24项宿主/图像集成测试，共41项。
- 真实PNG样例验证裁剪放大、长图覆盖、原图坐标、像素变化比例与差异图；Codex输出由本地假app-server提供。
- 结构化JSON schema、native localImage、read-only、关闭MCP/执行工具的参数在模拟协议边界断言。
- OCR用TSV已知样例与失败子进程验证，不依赖安装真实引擎。
- 命令结果有界放入原会话待用上下文；不自动唤醒DSH主模型。
- 未调用收费模型、未进行桌面操作、未自动下载OCR或模型、未修改活跃DSH配置或旧会话。

## 仍未验收

运行中的DSH安装/插件界面、真实Codex视觉准确率、真实Tesseract引擎与语言包、真实电脑控制。缓存命中只表示省去新的Codex识别任务，不承诺主聊天免费。

## 可复现

npm run build；npm test。宿主测试设置DSH_TEST_INSTALL_DIR为实际DSH包根目录、DSH_TEST_EXECUTABLE为其Electron/Node运行时，再npm run test:host。可设置CODEX_EYES_HANDS_TEST_ROOT到E盘测试临时目录。

## 真实 Codex 零任务预检

真实 CLI 0.170.0 完成 initialize 和只读视觉 thread/start；没有发送 turn/start，所以没有发起模型识别任务。首版逐项禁用 MCP 的覆盖方式导致 invalid transport，已改为纯视觉进程与线程使用空 MCP 注册表修复；普通任务在原配置下的真实线程创建也通过；修复后线程创建成功，并观察到该预检子进程树关闭、退出码0。此项仅验证协议/配置启动，不证明模型识图准确性。
