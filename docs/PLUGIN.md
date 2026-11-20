# DSH 插件 v2.2 使用说明

## 一次安装

在 DSH 插件页的添加插件入口选择本项目目录，或安装 GitHub 源码包。加载的是一个 bundle；其中两条内部配置分别负责 Codex 适配器和官方通用委派工具，不需要分别安装两个 DSH 插件。本项目没有新增 npm 运行依赖，也不下载第二份 Codex。

安装会修改当前 DSH profile 的包清单和补丁配置；先备份。不要手工覆盖 profile 配置，不要改安装包 app.asar。

## 前提

测试目标：官方 DSH 0.2.2-rc.5，Windows，Node 24+；本机已有能工作的 Codex 登录/模型配置。默认自动查找已有 codex.exe 或 @openai/codex/bin/codex.js；可在插件设置中填写绝对路径。模型留空继承 Codex 配置。

电脑操作依赖 Codex 自己已经接入且实际可用的 MCP（优先 agent-desktop），不是安装本插件就自动安装全部工具。

## 入口

- /codex doctor：无模型请求的入口检查。
- /codex 看这张图：在同一条命令中附上图片或文件；结果返回原 DSH 会话。
- codex_task：模型侧的一次性任务委派；工具参数遵循 DSH 的原生工具说明。

默认 900 秒超时，workspace-write，拒绝额外权限请求；完全权限必须用户自己选择。插件不会向子进程附加私有 API 密钥，也不读取 CC Switch 数据库。

插件提供更高优先级的同名 codex-bridge 技能以覆盖旧入口的指导，但不删除磁盘上的旧 Skill；项目级技能仍可按 DSH 规则覆盖。停用插件后旧技能会重新可见。

## 数据与限制

Codex 在本机工作目录运行，任务内容、文件和工具输出可能通过用户自己的 Codex 配置发送到模型提供方。请只交接允许处理的内容。图片通过官方附件命令准入并映射为只读本机路径；文字模型并不会因此拥有视觉。

每项任务使用 ephemeral thread；不支持原 Codex 线程跨次继续，也不复制旧 watch/ask 的全局状态。结果在 DSH 原生子任务系统里显示，不提供自制的第二个任务面板。

离线测试验证了宿主库兼容、协议流、失败、空结果、取消、超时与附件交接；真实模型看图、真实桌面控制和安装后的界面仍需要端到端验收，不能由 doctor 或模拟测试代替。

## 回退

在 DSH 插件页停用或移除此 bundle；旧 Skill 与 Codex 配置不受本插件自动改写。配置文件的恢复使用安装前备份目录里的恢复脚本。不要通过复制旧 app.asar 回退。

## 许可与复用

官方源码固定为 DeepSeek Harness dsh-v0.2.2-rc.5，提交 9c2670d3bce5275e0d1610272958121af87787bb。原始 index.ts/run.ts/wire.ts、MIT 许可证及来源保存在 vendor/deepseek-subagent-codex；构建脚本只适配已有 CLI 定位、权限默认值、超时、诊断保密和防递归指导。DSH 公共服务复用宿主，不复制整个 DSH。


## 2.1.0 — 视觉增强（按第一批、第二批顺序实现）

### 第一批
- 新增 codex_vision 和 /codex see、ocr：纯视觉分析与电脑执行分离。
- 使用 Codex 原生 localImage 与结构化 outputSchema；关闭视觉线程中的 shell、MCP、浏览器、应用、代码执行和图像生成入口，read-only 沙箱，禁止隐式转为动作任务。
- 按会话、图片内容 SHA-256、模型/CLI 配置指纹、问题、模式、裁剪、放大和分块参数缓存。
- 结构化结果保留概况、原文、控件、原图坐标、不确定项、原图摘要与裁剪产物。
- cache.hit 和 codexRunsStarted 明确区分缓存与本次调用，不声称“免费”。
- 缓存默认24小时、128条、16 MiB；并发相同识别合并，取消单个调用不误停其他调用。

### 第二批
- 支持 --crop x,y,width,height、--zoom 1..4、--chunk-height；长图最多16块，默认重叠128px（小块自动缩小重叠），坐标还原并按位置去除重叠重复字。
- /codex diff 接收两张同尺寸图片，返回差异图、变化像素比例和包围框，不把像素相同当功能通过。
- /codex ocr-local 为可选已有 Tesseract，按 TSV 返回文字、坐标与低置信度提醒；不自动安装、不调用云兜底。
- 视觉命令将有界结果注入当前 DSH 待用上下文，不自动唤醒主模型增加一次回答。
- 保持一个 bundle，无新增 npm 运行依赖；裁剪与像素处理复用宿主 sharp。

## 使用示例

在 DSH 输入下面一条命令，并在同条消息附图：

~~~text
/codex see 这张图的报错是什么？
/codex see --crop 100,150,600,300 --zoom 2 逐字读出这块报错
/codex ocr --chunk-height 1600 按原顺序识别长图文字
/codex see --no-cache 重新检查数字
/codex diff
/codex ocr-local
~~~

diff 要附两张图片；其他视觉命令附一张。普通 /codex <任务> 和 codex_task 仍执行完整任务，不使用识图缓存。

## 本地 OCR 配置

插件设置中填写 ocrPath（已经安装好的 Tesseract 可执行文件绝对路径），ocrLanguage 默认 eng；中文通常需要 chi_sim，语言包必须事先存在。未配置时明确报错；不会自动下载任何程序或语言包。可选本地 OCR 只提取文字，不能替代画面理解。

## 缓存与隐私

缓存和裁剪结果默认保存在 DSH home/cache/codex-eyes-hands，也可通过 visionDataDir 指定绝对路径。识别记录可能包含账户、聊天或屏幕文字，不要上传此目录。设置 visionCacheEnabled=false 可停用结果复用；--no-cache 仅绕过本次结果缓存，裁剪产物仍会按预算短期保存。产物默认上限256 MiB，识别条目默认16 MiB；按下次写入/初始化清理过期内容，不启动常驻定时器。缓存命中不意味着 DSH 主聊天的后续模型回答不计费。

## 已验证与限制

以当前 DSH 0.2.2-rc.5 的实际库完成41项离线测试（17项独立测试、24项宿主/图像集成测试）。真实 PNG 像素处理、裁剪、长图覆盖、坐标还原、像素差异、Codex JSON-RPC 帧、结构化图片交接与缓存命中均在本地样例中验证；模型输出由模拟执行端提供，不能据此声称真实 OCR/视觉识别准确率。

未启动收费模型任务，未安装 Tesseract；OCR 验证覆盖 TSV 解析、缺引擎拒绝和失败子进程，不代表真实 Tesseract 引擎已验收。未在正在运行的 DSH profile 中安装新版本，插件 UI 和真实桌面仍未验收。结构化识别输出可能出错，重要数字和坐标需回查原图。缓存按配置指纹和TTL失效；模型提供方在配置不变时更换实际模型的情况不能自动检测，请用 --no-cache。

真实 Codex 0.170.0 零任务预检已完成：只建只读视觉线程，不发 turn/start；逐项MCP覆盖导致的invalid transport已通过纯视觉空注册表修复，普通任务原配置对照也已通过。未修改用户全局Codex配置。


## v2.2 插件内管理与上游提醒

安装后在聊天输入框下方展开“codex-eyes-hands 设置”。面板由DSH原生Client slot承载，通信走现有认证RPC；不另开端口、不读取其他插件DOM、不创建Codex自动化。

### 四个官方组件

查看终端、会话搜索、Forge、自动标题。版本须与当前Host严格一致，缺包时不自动安装；“已选择但未确认运行”与“运行中”分开。用户点击启用/停用会要求明确确认，操作影响整个profile所有会话。先在E盘备份package.json与cordis.patch.yml，并生成ASCII/ANSI的一键恢复BAT，再调用DSH官方setBundleEnabled。已处于目标状态则不重复加载。原生管理结果若是restart-required，不能说已生效；请按官方提示重启。

也可使用：

~~~text
/codex features
/codex features enable terminal
/codex features enable search
/codex features enable forge
/codex features enable titles
/codex features disable titles
~~~

只有用户命令/经过确认的面板按钮拥有写入口。模型只得到只读codex_status工具。该入口不复制四套源码，也不卸载现有依赖。环境没有DSH_PROFILE_DIR时拒绝写入，避免备份错配置。

### 更新提醒（指借鉴上游，不是自动更新插件本体）

默认启用：启动30秒后检查一次，到期后按默认168小时周期复查；每小时醒来仅检查是否到期。插件必须在DSH中启用且DSH正在运行；离线/停机时不会运行，也没有系统定时任务。

设置可在面板中关闭或改为1至720小时；“立即检查”仍有60秒冷却并合并同时请求。网络访问仅为两个固定公开GitHub仓库，读取版本、默认分支commit、相关文件差异。不读取GitHub token，不发送用户文件或会话，不使用Codex模型。

界面显示上次成功检查、失败原因、待复查变化、相关文件与GitHub compare链接。确认已读跨重启保留，采用基线不会随检查自动改变。失败保留上次成功状态并退避；连续3次失败在折叠标题标记提示。

~~~text
/codex updates
/codex updates check
/codex updates off
/codex updates on 24
/codex updates ack
~~~

状态使用DSH原生storageDomain：codex_eyes_hands_maintenance。禁用/卸载插件清理定时器、RPC和在途请求，存储记录保留。不会向DSH聊天历史持续写检查日志。GitHub的compare文件数达到300时明确提示不完整，不把截断当作无变化。

本轮测试覆盖后端逻辑、备份、owner认证、调度释放和Client注册结构；没有把结构测试说成运行中DSH面板渲染已验收。

面板启停后会提示操作结果；若官方管理服务返回restart-required，会明确提示需要重启DSH，不把写入配置当作已经运行。
