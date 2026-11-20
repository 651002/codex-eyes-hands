# v2.2.0 验证记录

目标：Windows，官方DSH 0.2.2-rc.5；日期2026-11-21。

## 最终自动测试结果

69项通过、0失败：独立Node测试35项；使用安装版DSH宿主依赖和Electron Node的测试34项。界面含一次VM模拟点击验证，确保官方返回restart-required时提示重启；不等于真实浏览器渲染。

## 保留功能

此前41项缓存视觉、裁剪长图、像素差异、附件交接、Codex协议/取消/超时等回归保持通过。

## 新增检查范围

- 官方组件：只读兼容检查、不重复加载、版本/缺包拒绝、先备份、保留restart-required、未知参数拒绝。
- 上游：成功与失败基线、相关文件过滤、冷却、并发合并、开关/周期、已读去重。
- 宿主：原生Domain schema、owner认证、插件卸载清理、配置字节保留及ANSI恢复BAT、Client注册结构。
- 不创建Codex定时任务；定时器属于DSH插件，默认168小时，启动30秒后检查。

## 实际网络验证

直接运行插件UpdateMonitor只读检查两个固定GitHub仓库，成功写入内存状态，退出码0；检测到主分支相关改动，发布仍为dsh-v0.2.2-rc.5和v3.4.0。DeepSeek比较文件数达到300时明确标记不完整，不误报无变化。未运行Codex、未调用模型、未下载安装上游，也未持久写入本机DSH状态。

## 验收限制

Client测试只验证工厂/locale/slot注册及结构，不是运行中DSH的真实界面验收。新插件尚未安装到运行中profile，未实际切换用户的四个组件，恢复BAT只在测试副本生成核对。视觉准确率、真实OCR引擎、真实桌面操作仍未验收。

## 复现

npm run build；npm test。设置DSH_TEST_INSTALL_DIR与DSH_TEST_EXECUTABLE为本机安装，再npm run test:host。测试临时目录可用CODEX_EYES_HANDS_TEST_ROOT指定到E盘。
