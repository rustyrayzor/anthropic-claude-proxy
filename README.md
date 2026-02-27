# OpenClaw Anthropic Max Proxy Plugin

Proxy-only Claude provider for OpenClaw using a local Anthropic-compatible proxy (e.g. `opencode-claude-max-proxy`). Routes all Claude model traffic through a local proxy that uses your Claude Code (`claude login`) credentials — no direct Anthropic API calls.

## Why This Plugin?

- **Compliance**: Traffic goes through Claude Code credentials only — no Anthropic API key needed.
- **Fail-closed**: If the proxy is down, requests fail instead of falling back to direct Anthropic.
- **Native UX**: Provider appears in OpenClaw's `/model`, `/model status`, and auth flows like any other provider.
- **Auto-start**: Plugin can auto-start the proxy when Gateway starts.

## Architecture

```
OpenClaw Gateway
       |
       v
anthropic-max-proxy provider (this plugin)
       |
       v
Local proxy (opencode-claude-max-proxy)
       |
       v
Claude Code credentials (claude login)
       |
       v
Anthropic API (via Claude Code)
```

## Requirements

Run on the same machine/container as OpenClaw Gateway:

1. **Claude CLI installed** and authenticated:
   ```bash
   claude login
   ```
2. **Proxy command available** (default: `bunx opencode-claude-max-proxy`)
3. **OpenClaw** installed and running

## Install

### Option 1: From GitHub (recommended)

```bash
openclaw plugins install @rustyrayzor/anthropic-max-proxy
openclaw plugins enable anthropic-max-proxy
```

### Option 2: From local source

```bash
openclaw plugins install /path/to/anthropic-max-proxy
openclaw plugins enable anthropic-max-proxy
```

### Option 3: From npm (if published)

```bash
openclaw plugins install openclaw-anthropic-max-proxy
openclaw plugins enable anthropic-max-proxy
```

Then restart the Gateway:

```bash
openclaw gateway restart
```

## Authenticate

Run the interactive auth flow:

```bash
openclaw models auth login --provider anthropic-max-proxy --set-default
```

You'll be prompted for:

| Prompt | Default | Description |
|--------|---------|-------------|
| Proxy host | `127.0.0.1` | Where the proxy runs |
| Proxy port | `3456` | Proxy HTTP port |
| Model IDs | `claude-opus-4.6, claude-sonnet-4.5, claude-3.7-sonnet` | Which models to register |

This writes to your config:

- Provider config → `models.providers.anthropic-max-proxy`
- Default model → `anthropic-max-proxy/claude-opus-4.6`
- Alias → `claude-max-proxy` points to the first model
- **Fail-closed**: `fallbacks: []` (no direct Anthropic fallback)

## Verify

```bash
# Check model status
openclaw models status

# Should show:
# - Default: anthropic-max-proxy/claude-opus-4.6
# - Fallbacks: (none)
# - Aliases: claude-max-proxy -> anthropic-max-proxy/claude-opus-4.6
```

## Fail-Closed Guarantee

This plugin enforces **proxy-only routing**. The default model has no fallbacks:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic-max-proxy/claude-opus-4.6",
        "fallbacks": []
      }
    }
  }
}
```

**Behavior:**
- Proxy running + Claude logged in → requests work
- Proxy down → requests **fail** (no bypass to direct Anthropic)
- To allow fallback, explicitly add one in config (not recommended for compliance)

## Plugin Configuration (Optional)

Customize in `openclaw.json`:

```json5
{
  "plugins": {
    "entries": {
      "anthropic-max-proxy": {
        "enabled": true,
        "config": {
          // Auto-start proxy when Gateway starts (default: true)
          "autoStart": true,
          // Auto-restart proxy if it crashes (default: true)
          "autoRestart": true,
          // Delay before restarting after crash (default: 3000ms)
          "restartDelayMs": 3000,
          // Proxy host (default: 127.0.0.1)
          "host": "127.0.0.1",
          // Proxy port (default: 3456)
          "port": 3456,
          // Command to start proxy (default: ["bunx", "opencode-claude-max-proxy"])
          "command": ["bunx", "opencode-claude-max-proxy"],
          // Models to register (default: ["claude-opus-4.6", "claude-sonnet-4.5", "claude-3.7-sonnet"])
          "models": ["claude-opus-4.6", "claude-sonnet-4.5", "claude-3.7-sonnet"]
        }
      }
    }
  }
}
```

## Troubleshooting

### Proxy not starting?

Check Gateway logs:
```bash
openclaw gateway run --verbose
```

Look for: `anthropic-max-proxy: starting proxy...`

### "Connection refused" errors?

1. Ensure proxy is running:
   ```bash
   bunx opencode-claude-max-proxy
   ```

2. Check port is open:
   ```bash
   curl http://127.0.0.1:3456/health
   ```

### Claude not authenticated?

Re-run:
```bash
claude login
```

Then restart the proxy:
```bash
# Kill existing proxy, Gateway will auto-restart if enabled
pkill -f opencode-claude-max-proxy
```

### Want to disable fail-closed?

Add a fallback in your config (not recommended for compliance):

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic-max-proxy/claude-opus-4.6",
        "fallbacks": ["openai-codex/gpt-5.3-codex"]
      }
    }
  }
}
```

## Notes

- This plugin does **not** modify the built-in `anthropic` provider — it's a separate provider.
- Built-in `anthropic` remains untouched for direct API access if needed.
- Designed for users who need strict compliance boundaries (proxy-only, no direct Anthropic calls).

## License

MIT
