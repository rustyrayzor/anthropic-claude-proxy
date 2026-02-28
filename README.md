# OpenClaw Anthropic Claude Proxy Plugin

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
anthropic-claude-proxy provider (this plugin)
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

Run on any Linux machine/container/VPS where OpenClaw Gateway runs:

1. **Claude CLI installed** and authenticated (see auth options below)
2. **Bun or Node.js** installed (for running the proxy)
3. **OpenClaw** installed and running
4. **Port accessible** (default `3456`, configurable)

### Authentication Methods

#### Option A: OAuth Token (Recommended for containers/headless)

For headless environments (containers, VPS, remote servers):

```bash
# Create a long-lived token
claude setup-token

# This gives you a token like:
# sk-ant-oat01-us7xtRfbocBr__Zgb_sZJYe0DA-...

# Set it as an environment variable
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
```

The token is valid for 1 year and works in headless environments where browser OAuth isn't possible.

#### Option B: Interactive Login (Local machines only)

For machines with a browser:

```bash
claude login
```

This opens a browser for OAuth. Works on your local machine but NOT in containers/VPS without browser access.

## Install

### Option 1: From GitHub (recommended)

```bash
openclaw plugins install @rustyrayzor/anthropic-claude-proxy
openclaw plugins enable anthropic-claude-proxy
```

### Option 2: From local source

```bash
openclaw plugins install /path/to/anthropic-claude-proxy
openclaw plugins enable anthropic-claude-proxy
```

### Option 3: From npm (if published)

```bash
openclaw plugins install openclaw-anthropic-claude-proxy
openclaw plugins enable anthropic-claude-proxy
```

Then restart the Gateway:

```bash
openclaw gateway restart
```

## Authenticate

Run the interactive auth flow:

```bash
openclaw models auth login --provider anthropic-claude-proxy --set-default
```

You'll be prompted for:

| Prompt | Default | Description |
|--------|---------|-------------|
| Proxy host | `127.0.0.1` | Where the proxy runs |
| Proxy port | `3456` | Proxy HTTP port (easy to change) |
| Model IDs | `claude-opus-4.6, claude-opus-4-6-thinking, claude-sonnet-4.6, claude-sonnet-4-6-thinking, claude-haiku-4` | Which models to register |

### Quick Port Change

The easiest way to change the port:

1. **Re-run auth flow** (it will pre-fill previous values):
   ```bash
   openclaw models auth login --provider anthropic-claude-proxy
   ```
   Just press Enter through the host, then change the port when prompted.

2. **Or edit config manually**:
   ```bash
   # Edit the provider config
   openclaw models auth edit --provider anthropic-claude-proxy
   ```
   Or directly in `openclaw.json`:
   ```json
   {
     "models": {
       "providers": {
         "anthropic-claude-proxy": {
           "baseUrl": "http://127.0.0.1:9999"
         }
       }
     }
   }
   ```

This writes to your config:

- Provider config → `models.providers.anthropic-claude-proxy`
- Default model → `anthropic-claude-proxy/claude-opus-4.6`
- Alias → `claude-max-proxy` points to the first model
- **Fail-closed**: `fallbacks: []` (no direct Anthropic fallback)

## Verify

```bash
# Check model status
openclaw models status

# Should show:
# - Default: anthropic-claude-proxy/claude-opus-4.6
# - Fallbacks: (none)
# - Aliases: claude-max-proxy -> anthropic-claude-proxy/claude-opus-4.6
```

## Fail-Closed Guarantee

This plugin enforces **proxy-only routing**. The default model has no fallbacks:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic-claude-proxy/claude-opus-4.6",
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
      "anthropic-claude-proxy": {
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

### "OAuth error: Invalid code" in container/VPS

Browser-based OAuth (`claude login`) doesn't work in headless containers because:
- Claude redirects to `platform.claude.com` which can't call back to your container

**Solution:** Use token-based authentication instead:
```bash
# Create token (one time)
claude setup-token

# Set environment variable before starting proxy
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
bunx opencode-claude-max-proxy
```

### Proxy not starting?

Check Gateway logs:
```bash
openclaw gateway run --verbose
```

Look for: `anthropic-claude-proxy: starting proxy...`

### "Connection refused" errors?

1. Ensure proxy is running:
   ```bash
   # With token auth
   CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..." bunx opencode-claude-max-proxy
   
   # Or with interactive login
   bunx opencode-claude-max-proxy
   ```

2. Check port is open:
   ```bash
   curl http://127.0.0.1:3456/health
   ```

### Claude not authenticated?

Check auth status:
```bash
claude auth status
```

If not logged in:
- **Local machine:** Run `claude login`
- **Container/VPS:** Use `claude setup-token` for token-based auth

### Want to disable fail-closed?

Add a fallback in your config (not recommended for compliance):

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic-claude-proxy/claude-opus-4.6",
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

## Comparison with Manual Setup

There's also an [official OpenClaw guide](https://docs.openclaw.ai/providers/claude-max-api-proxy) using the npm package. This plugin vs manual:

| Feature | This Plugin | Manual Setup |
|---------|-------------|--------------|
| Auto-start proxy | ✅ | ❌ |
| Provider in /model flows | ✅ | ❌ |
| Fail-closed routing | ✅ | ❌ |
| Easy install | ✅ | ❌ |
| Works in containers | ✅ (with token) | ✅ (with token) |

The plugin automates everything — manual setup requires more config.

## License

MIT
