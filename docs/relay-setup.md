[English](relay-setup.en.md) | 中文

# 中转接入教程（Codex / CC Switch）

> 本教程面向需要 OpenAI / Claude 中转的同学。
> 还没有中转？可以用项目维护者的邀请链接注册：
> 👉 https://ai-zjl.cc/register?aff=HVUNFKHSEATR

## 1. 注册并获取密钥

1. 打开上方邀请链接注册账号并登录。
2. 在控制台创建 **API 密钥**（形如 `sk-...`），并记下 **API 地址**（形如 `https://xxx`，有的中转写 `https://xxx/v1`，按控制台显示为准）。
3. 记下中转**支持的模型列表**（例如 `gpt-5.6-sol`、`claude-sonnet-5` 等）。

## 2. 直接在 Codex 里用（最简方式）

编辑 `~/.codex/config.toml`：

```toml
model_provider = "custom"
model = "gpt-5.6-sol"            # 换成中转支持的模型名

[model_providers.custom]
name = "中转"
base_url = "https://你的API地址"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
```

设置环境变量（PowerShell）：

```powershell
$env:OPENAI_API_KEY = "sk-你的密钥"
```

验证：

```powershell
codex exec "回复 OK"
```

## 3. 在 CC Switch 里用（多通道一键切换）

1. 打开 CC Switch，在 **Codex**（或 **Claude**）分区添加通道（Provider）。
2. 填入名称、API 地址、密钥；模型填中转支持的（如 `gpt-5.6-sol`）。
3. 把该通道设为**当前通道**：CC Switch 会重写 `~/.codex/config.toml`，
   并把请求代理到 `127.0.0.1:15721`（本机代理模式）。
4. 建议打开 CC Switch 的「**自动故障转移**」，把备用通道加入故障转移队列，
   主通道挂掉时自动切换。

## 4. 搭配 codex-eyes-hands 的 Claude 备用通道

参考 `examples/claude.config.toml.example`：

- `base_url` 填中转的 API 地址（要求支持 **responses** 格式的 Claude 模型）。
- `model` 填中转支持的 Claude 模型（本技能实测 `claude-sonnet-5`，含视觉）。
- 把同名 `[model_providers.claude]` 也注册进主配置 `~/.codex/config.toml`
  （`codex exec resume` 不加载 profile 文件）。
- 密钥无需写进文件：脚本运行时自动从 CC Switch 数据库读取。

## 5. 常见报错

| 报错 | 原因 | 处理 |
|---|---|---|
| `401 INVALID_API_KEY` | 密钥不对或已失效 | 重新复制密钥 |
| `403 ... does not allow ... dispatch` | 套餐不包含该模型类型 | 换套餐或换模型 |
| `404 Model ... is not supported` | 模型名不在支持列表 | 用 `GET /v1/models` 查支持列表 |
| `502 上游错误` | 中转上游繁忙/挂掉 | 稍后重试、换通道、或用备用通道 |
| 流断连 `Reconnecting...` | 长请求被中断 | 降低 effort、换通道、或 `--backup only` |

## 6. 反馈

遇到问题可到仓库提 Issue：https://github.com/651002/codex-eyes-hands
