# codex-eyes-hands · Codex 能力分身技能

> **主要为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 打造**：
> 让 Harness 里「没有视觉、不能操作界面」的纯文本模型（如 DeepSeek-V4-Pro）
> 调用本机 **Codex CLI** 当**眼睛和手**——看图 / 读文件 / 画图 / 监督执行 / 双通道容灾。

技能本体零依赖，也可独立用于任何能调本机 Codex CLI 的 agent（Codex 桌面版、其他框架）。

## 能力一览

| 模式 | 作用 | 实测状态 |
|---|---|---|
| `see` | 看图 / OCR / 多图对比 / 图片 URL | ✅ |
| `read` | 压缩包 / 文件夹 / 特殊格式解读（支持多目标） | ✅ |
| `ask` | 按会话号追问，图不重发，省 token | ✅ |
| `gen` | 生成图片并落盘 | ✅ |
| `watch` | 监督者模式：下任务 + 盯执行 + 喊停纠正 | ✅ |
| `shot` | 截屏当前屏幕并分析 | ✅ |
| `fetch` / `search` | 抓网页正文 / 联网搜索 | ✅ |
| `hands` | 浏览器 / GUI 操作（browser_use / computer_use） | ⚠️ 权限受限 |
| `type` / `key` | 向指定窗口发按键 | ⚠️ 实验性 |
| 备用通道 | 主通道失败自动切 Claude | ✅ |

## 前置要求

- Windows + Node.js ≥ 18（推荐 24，脚本用到了 `node:sqlite`）
- [Codex CLI](https://github.com/openai/codex)（npm 全局安装，实测 v0.145.0）
- （可选）CC Switch：备用通道的密钥在运行时从它的数据库读取（`~/.cc-switch/cc-switch.db`）

## 安装

1. 把本仓库放到你的技能目录，最终结构：
   `C:\Users\<你的用户名>\.codex\skills\codex-bridge\`（含 `SKILL.md` 与 `scripts\bridge.js`）
2. 打开 `SKILL.md`，把示例命令里的 `C:\Users\Administrator\...` 换成你自己的路径。
3. （可选）配置 Claude 备用通道：
   - 复制 `examples/claude.config.toml.example` → `C:\Users\<你>\.codex\claude.config.toml`，
     把 `base_url` 换成你的中转地址、`model` 换成中转支持的 Claude 模型。
   - 同时把同名的 `[model_providers.claude]` 注册进 `~/.codex/config.toml`
     （`codex exec resume` 不加载 profile 文件，需要主配置里有 provider 定义）。
   - 备用通道的密钥不落盘：脚本运行时从 CC Switch 数据库读取「非 codex 通道共用的」Claude key。

## 快速开始

```powershell
node "C:\Users\<你>\.codex\skills\codex-bridge\scripts\bridge.js" see "C:\图.png" --ask "图里写了什么"
node "C:\Users\<你>\.codex\skills\codex-bridge\scripts\bridge.js" read "C:\某压缩包.zip" "C:\某文件夹"
node "C:\Users\<你>\.codex\skills\codex-bridge\scripts\bridge.js" watch "把某文件夹里的 txt 打包成 zip，不要删原文件"
node "C:\Users\<你>\.codex\skills\codex-bridge\scripts\bridge.js" shot "屏幕上有什么"
```

完整参数与各模式细节见 `SKILL.md`。

## 在 DeepSeek Harness 里使用（主要场景）

Harness 的 agent 若用无视觉模型（如 DeepSeek-V4-Pro），默认在 Web 里发图片会被网关拒绝
（弹「当前模型不支持图片」），图片根本到不了 agent。
仓库里的 [patches/dsh-image-gateway.md](patches/dsh-image-gateway.md) 说明如何给
`@deepseek-ai/dsh-host-apiproxy` 打一个小补丁：把图片**落地成文件**、把**绝对路径以文本**
注入 agent 消息，之后 agent 就能用本技能的 `see` 模式调 Codex 看图了。

## 安全说明

- 本仓库不含任何密钥；备用通道密钥在运行时从本机 CC Switch 数据库读取，不落盘。
- `type` / `key` 会向真实窗口发按键：必须先经用户确认、必须指定 `--window`、
  聚焦失败会自动取消发送、全屏游戏抢焦点时禁用（详见 `SKILL.md` 模式八）。
- `watch` 监督模式自带红线：只动指定范围、不删不覆盖、危险操作先报告等批准。

## License

MIT
