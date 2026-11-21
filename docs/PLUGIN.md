## 2.5.0 图片交互

新消息在不改变source.kind=user、已有来源字段和消息id的前提下，增加本插件codexEyesHands图片组元数据（仅编号和状态）。原生conversation.chat.user.before负责正文外整组状态，conversation.user.text只隐藏该消息的内部识图标记；原生附件画廊、聊天文字和消息动作继续由DSH提供，没有替换官方Factory/用户消息Renderer，也没有DOM扫描或位置挪动脚本。

已有2.4.x消息没有该来源元数据，仍用原生user-text兼容显示：连续图片标记合成一个入口，不改写存档。夹在图片标记之间的用户正文不跨越合并，保证原话不会丢失。旧网关临时图片仍可在详情中恢复预览；新图片保留DSH原生缩略图。

成功只显示一条低干扰的“图片已读取·2/2”，失败明确第几张，重试按钮仅对该图片调用识图。详情打开才加载完整结果，按图片选择；概述、识别文字、不确定项是普通文本，技术信息使用默认关闭的原生details。不是自动重跑主任务，不伪造“检查设置”等无法确认的阶段；后续工具进度继续由DSH原生显示。

# codex-eyes-hands 2.5.0

## 独立页面

左侧导航点击 **codex-eyes-hands**，在主区域打开Codex能力与上游提醒页。聊天输入框下方没有入口。页面显示插件版本、更新检查状态、待复查数量、Codex命令与安全边界，不编造Token、费用或成功率。

## 不管理四项DSH功能

按用户要求取消终端、会话搜索、Forge/工作树、自动标题的内置配置、模块、状态读取和开关。由DSH官方设置管理；本包不再注册它们，不覆盖session-title-llm，不修改它们的选择。安装或停用本包不应改变四项原生功能的开关。

/codex features及其旧启停命令只返回“已取消，请使用DSH官方设置”，不进入Codex任务委派。维护API不注册features/set；codex_status仅支持updates。

## Codex入口

- /codex doctor：仅检查入口，不调用模型。
- /codex see、/codex ocr：附图识别，支持--crop、--zoom、--chunk-height、--no-cache。
- /codex ocr-local：仅用配置的已有Tesseract，不自动安装或云兜底。
- /codex diff：像素差异检查，不代替语义理解。
- codex_task：原生子任务委派。codex_vision：只读图片分析。codex_status：只读上游检查结果。

默认900秒总超时、workspace-write；不替用户宣称额外授权，不静默完全权限。识图子线程关闭执行工具，与电脑操作分开。电脑操作依赖已有Codex工具，优先agent-desktop。Skill独立名称codex-eyes-hands；旧codex-bridge不由插件自动删除。

## 更新提醒

默认168小时，启动30秒后核对是否到期；可设1到720小时或关闭。DSH关闭时不运行，不创建Codex自动化。仅只读检查DeepSeek Harness和dsh-vision-router的发行/相关文件；不读取token、不传会话/图片、不调用模型、不自动下载安装或合并。手动检查有60秒冷却，失败保留旧成功状态并退避。

/codex updates、/codex updates check、/codex updates on 24、/codex updates off、/codex updates ack。

## 存储与回退

维护状态存于原生storageDomain codex_eyes_hands_maintenance。视觉缓存与裁剪产物可能含敏感文字，默认在DSH home/cache/codex-eyes-hands，可用visionDataDir指定绝对路径，勿上传。

通过DSH插件页停用或移除本bundle；不影响四项原生功能。用迁移前配置备份恢复本插件配置，不覆盖app.asar。宿主依赖显式声明为optional peer，由DSH官方解析器提供，不安装第二套DSH。

## 验证

自动测试包含原生linked依赖解析、维护API认证/清理、旧组件管理API不可用、旧features命令不派任务、补丁仅贡献两个Codex条目、上游检查、附件/协议/视觉缓存/裁剪/像素检查。真实页面与官方开关恢复以本机部署记录为准；未运行真实模型任务时不作视觉准确率或电脑操作保证。

## 图片消息体验（2.4.0）

默认autoVisionEnabled=true：文本模型遇到图片时后台调用已有Codex，可能产生模型用量；支持视觉的模型不重复识图。可在官方插件配置中关闭该字段。识图只读，不执行图片内的指令。

本机旧网关把图片转成路径文字，本插件通过agent/pre-step把新消息恢复成持久图片附件；不修改app.asar，也不重写历史会话。历史路径文字仅做显示折叠与受限预览，不自动重新识图；原临时文件丢失时提示重传，不捏造原图。

正文保留用户原话；图片详情使用原生user-text扩展呈现，默认折叠。主模型得到概览、最多3条关键文字与不确定项；完整结构化结果保存到visionDataDir/messages。工具codex_vision_details按会话隔离分页读取，不重新调用模型。浏览器详情接口仅允许已认证owner。失败可重试识图，但不会擅自重跑整个主任务。

详情和小预览最多保留约128份，新增记录时清理超过30天的旧记录；包含隐私，勿同步到GitHub。新消息图片由DSH原生附件库保存。旧临时图片预览只允许读取dsh-incoming-images目录内UUID命名的普通图片，并拒绝符号链接越界。

## 上下文插件兼容（2.4.1）

保留DSH原生消息id与source，通过agent/pre-step处理本轮新用户图片，不改llm/stream、不写压缩检查点、不包装全局fetch。billion-context负责其请求层压缩，Mnemon负责其记忆View。本插件不禁用/替换它们。压缩后id遗失时，codex_vision_details省略id列当前会话记录，list_offset分页；得到id再按字符offset/limit读取全文。没有编号不必重新识图。

默认保留期限仍为30天/约128份，并非永久档案。跨会话/分叉会话不能仅凭回忆的id读取旧会话全文，须重新提供原图或显式另做安全迁移。检测/回归范围见CONTEXT-COMPATIBILITY.md。

## 显示修复（2.4.2）

真实DSH聊天会把多个文字块直接拼接，识图标记可能紧挨用户文字。新版折叠器能识别这一情况，只替换完整的内部识图记录，后面的用户文字不被吞掉。该修复同样作用于已有聊天的显示，不要求重传图片或重新识图；不会清洗或重写历史消息存档。

## Windows后台识图不弹控制台（2.4.3）

DSH的原生子进程服务已经隐藏其直接子进程；npm Codex的JS启动器会再spawn原生程序，第二层未指定windowsHide而弹控制台。插件现在从同一官方npm安装布局定位codex.exe，直接交给DSH的隐藏、进程树管理服务；不修改全局安装，不轮询关闭用户窗口，不换另一套进程管理。

自定义JS入口与非Windows行为不变。若官方npm原生文件缺失，明确报错而不偷偷回退到会弹窗的入口。真实安装的app-server初始化及64次可见窗口采样通过，未发起模型任务；不代表任意第三方CLI或旧codex-bridge启动路径也被修改。
