[中文](relay-setup.md) | English

# Relay Setup Guide (Codex / CC Switch)

> This guide is for anyone who needs an OpenAI / Claude relay.
> No relay yet? Register via the project maintainer's invite link:
> 👉 https://ai-zjl.cc/register?aff=HVUNFKHSEATR

## 1. Register and get your key

1. Open the invite link above, sign up and log in.
2. In the console, create an **API key** (looks like `sk-...`) and note the **API base URL**
   (looks like `https://xxx`, sometimes `https://xxx/v1` — use exactly what the console shows).
3. Note the **supported model list** (e.g. `gpt-5.6-sol`, `claude-sonnet-5`).

## 2. Use it directly in Codex (simplest way)

Edit `~/.codex/config.toml`:

```toml
model_provider = "custom"
model = "gpt-5.6-sol"            # use a model your relay supports

[model_providers.custom]
name = "relay"
base_url = "https://YOUR-API-BASE"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
```

Set the environment variable (PowerShell):

```powershell
$env:OPENAI_API_KEY = "sk-your-key"
```

Verify:

```powershell
codex exec "Reply OK"
```

## 3. Use it in CC Switch (one-click channel switching)

1. Open CC Switch, and in the **Codex** (or **Claude**) section add a channel (Provider).
2. Fill in name, API base URL and key; use a model your relay supports (e.g. `gpt-5.6-sol`).
3. Set that channel as the **current channel**: CC Switch rewrites `~/.codex/config.toml`
   and proxies requests through `127.0.0.1:15721` (local proxy mode).
4. Recommended: enable CC Switch's **auto failover** and add backup channels to the
   failover queue so traffic moves automatically when the primary channel dies.

## 4. Claude backup channel for codex-eyes-hands

See `examples/claude.config.toml.example`:

- Set `base_url` to your relay's API base (must support Claude models via the **responses** wire format).
- Set `model` to a Claude model your relay supports (verified with `claude-sonnet-5`, vision included).
- Register the same `[model_providers.claude]` block in the main config `~/.codex/config.toml`
  (`codex exec resume` does not load profile files).
- No key needed in any file: the script reads it from the CC Switch database at runtime.

## 5. Common errors

| Error | Cause | Fix |
|---|---|---|
| `401 INVALID_API_KEY` | Wrong or expired key | Re-copy the key |
| `403 ... does not allow ... dispatch` | Plan doesn't cover that model type | Change plan or model |
| `404 Model ... is not supported` | Model name not on the relay's list | Query `GET /v1/models` for the list |
| `502 upstream error` | Relay upstream busy/down | Retry later, switch channel, or use the backup |
| Stream disconnects `Reconnecting...` | Long requests interrupted | Lower the effort, switch channel, or `--backup only` |

## 6. Feedback

Open an issue in the repo: https://github.com/651002/codex-eyes-hands
