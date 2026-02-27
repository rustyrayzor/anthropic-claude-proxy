# OpenClaw Anthropic Max Proxy Plugin

Proxy-only Claude provider for OpenClaw using a local Anthropic-compatible proxy (for example `opencode-claude-max-proxy`).

## Goals

- Separate provider (`anthropic-max-proxy`) so built-in `anthropic` stays untouched.
- Fail-closed behavior support (no fallback required).
- Auto-start proxy service when Gateway starts.
- Provider appears in OpenClaw model auth/model status flows.

## Requirements

Run on the same machine/container as OpenClaw Gateway:

- `claude` CLI installed and authenticated (`claude login`)
- proxy command available (default command used here: `bunx opencode-claude-max-proxy`)

## Install

```bash
openclaw plugins install /path/to/openclaw-anthropic-max-proxy
openclaw plugins enable anthropic-max-proxy
openclaw gateway restart
```

## Authenticate provider

```bash
openclaw models auth login --provider anthropic-max-proxy --set-default
```

During auth, it asks for:

- proxy host/port
- model IDs

It writes:

- provider config under `models.providers.anthropic-max-proxy`
- default model + aliases under `agents.defaults.models`
- default model route with `fallbacks: []`

## Fail-closed guarantee

Keep model routing with no fallback:

```json5
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

If the proxy is down, requests fail (no direct Anthropic fallback through this provider).

## Plugin config (optional)

`openclaw.json`:

```json5
{
  "plugins": {
    "entries": {
      "anthropic-max-proxy": {
        "enabled": true,
        "config": {
          "autoStart": true,
          "autoRestart": true,
          "restartDelayMs": 3000,
          "host": "127.0.0.1",
          "port": 3456,
          "command": ["bunx", "opencode-claude-max-proxy"],
          "models": ["claude-opus-4.6", "claude-sonnet-4.5", "claude-3.7-sonnet"]
        }
      }
    }
  }
}
```

## Notes

- This plugin does **not** modify the built-in `anthropic` provider.
- Keep direct Anthropic keys/profiles disabled if you want strict compliance boundaries.
- Designed to be distributable as a standalone plugin repo.
