import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  type OpenClawPluginApi,
  type OpenClawPluginService,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from "openclaw/plugin-sdk";

const PROVIDER_ID = "anthropic-claude-proxy";
const PROVIDER_LABEL = "Claude Proxy Proxy";
const PLACEHOLDER_TOKEN = "proxy-local";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3456;
const DEFAULT_RESTART_DELAY_MS = 3_000;
const DEFAULT_COMMAND = ["bunx", "opencode-claude-max-proxy"];

const DEFAULT_MODEL_IDS = [
  "claude-opus-4.6",
  "claude-opus-4-6-thinking",
  "claude-sonnet-4.6",
  "claude-sonnet-4-6-thinking",
  "claude-haiku-4",
] as const;

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 8_192;

type PluginConfig = {
  autoStart?: boolean;
  autoRestart?: boolean;
  restartDelayMs?: number;
  host?: string;
  port?: number;
  command?: string[];
  models?: string[];
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function uniqueModelIds(input: string): string[] {
  const list = input
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(list));
}

function buildModelDefinition(modelId: string) {
  return {
    id: modelId,
    name: modelId,
    reasoning: true,
    input: ["text", "image"] as Array<"text" | "image">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

function normalizeHost(input: string | undefined): string {
  const value = (input ?? "").trim();
  return value || DEFAULT_HOST;
}

function normalizePort(input: unknown): number {
  const value = asNumber(input, DEFAULT_PORT);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return DEFAULT_PORT;
  }
  return value;
}

function normalizeCommand(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_COMMAND];
  }
  const tokens = input.map((item) => asString(item).trim()).filter(Boolean);
  return tokens.length > 0 ? tokens : [...DEFAULT_COMMAND];
}

function parsePluginConfig(raw: unknown): Required<PluginConfig> {
  const cfg = (raw ?? {}) as PluginConfig;
  const models = Array.isArray(cfg.models)
    ? cfg.models.map((model) => String(model).trim()).filter(Boolean)
    : [...DEFAULT_MODEL_IDS];

  return {
    autoStart: cfg.autoStart !== false,
    autoRestart: cfg.autoRestart !== false,
    restartDelayMs: Math.max(1_000, asNumber(cfg.restartDelayMs, DEFAULT_RESTART_DELAY_MS)),
    host: normalizeHost(cfg.host),
    port: normalizePort(cfg.port),
    command: normalizeCommand(cfg.command),
    models: models.length > 0 ? models : [...DEFAULT_MODEL_IDS],
  };
}

function formatCommand(command: string[]): string {
  return command.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}

function createService(api: OpenClawPluginApi): OpenClawPluginService {
  let child: ChildProcessWithoutNullStreams | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let stopping = false;

  const clearRestartTimer = () => {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  };

  const stopChild = () => {
    if (!child) {
      return;
    }
    const proc = child;
    child = null;

    if (proc.killed) {
      return;
    }

    proc.kill("SIGTERM");

    const hardKill = setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
    }, 2_000);
    hardKill.unref?.();
  };

  const startChild = (
    cfg: Required<PluginConfig>,
    logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
  ) => {
    const [bin, ...args] = cfg.command;
    if (!bin) {
      logger.error("anthropic-claude-proxy: command is empty; cannot start proxy");
      return;
    }

    logger.info(
      `anthropic-claude-proxy: starting proxy (${formatCommand(cfg.command)}) on ${cfg.host}:${cfg.port}`,
    );

    const env = {
      ...process.env,
      CLAUDE_PROXY_HOST: cfg.host,
      CLAUDE_PROXY_PORT: String(cfg.port),
    };

    const proc = spawn(bin, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child = proc;

    proc.stdout.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        logger.info(`anthropic-claude-proxy: ${text}`);
      }
    });

    proc.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        logger.warn(`anthropic-claude-proxy: ${text}`);
      }
    });

    proc.on("error", (err) => {
      logger.error(`anthropic-claude-proxy: process error: ${String(err)}`);
    });

    proc.on("exit", (code, signal) => {
      if (child === proc) {
        child = null;
      }

      if (stopping) {
        logger.info("anthropic-claude-proxy: stopped");
        return;
      }

      logger.warn(`anthropic-claude-proxy: exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);

      if (!cfg.autoRestart) {
        return;
      }

      clearRestartTimer();
      restartTimer = setTimeout(() => startChild(cfg, logger), cfg.restartDelayMs);
      restartTimer.unref?.();
      logger.info(`anthropic-claude-proxy: restart scheduled in ${cfg.restartDelayMs}ms`);
    });
  };

  return {
    id: "anthropic-claude-proxy-service",
    async start(ctx) {
      const cfg = parsePluginConfig(api.pluginConfig);
      if (!cfg.autoStart) {
        ctx.logger.info("anthropic-claude-proxy: autoStart=false; service idle");
        return;
      }

      stopping = false;
      clearRestartTimer();
      startChild(cfg, ctx.logger);
    },
    async stop() {
      stopping = true;
      clearRestartTimer();
      stopChild();
    },
  };
}

async function runLocalAuth(ctx: ProviderAuthContext, pluginCfg: Required<PluginConfig>) {
  const host = normalizeHost(
    await ctx.prompter.text({
      message: "Proxy host",
      initialValue: pluginCfg.host,
      validate: (value: string) => (value.trim() ? undefined : "Host is required"),
    }),
  );

  const portRaw = await ctx.prompter.text({
    message: "Proxy port",
    initialValue: String(pluginCfg.port),
    validate: (value: string) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return "Enter a valid port (1-65535)";
      }
      return undefined;
    },
  });

  const modelInput = await ctx.prompter.text({
    message: "Model IDs (comma-separated)",
    initialValue: pluginCfg.models.join(", "),
    validate: (value: string) =>
      uniqueModelIds(value).length > 0 ? undefined : "Enter at least one model ID",
  });

  const port = normalizePort(portRaw);
  const modelIds = uniqueModelIds(modelInput);
  const defaultModelId = modelIds[0] ?? DEFAULT_MODEL_IDS[0];
  const defaultModelRef = `${PROVIDER_ID}/${defaultModelId}`;
  const baseUrl = `http://${host}:${port}`;

  const modelsPatch = Object.fromEntries(
    modelIds.map((modelId, idx) => [
      `${PROVIDER_ID}/${modelId}`,
      idx === 0 ? { alias: "claude-max-proxy" } : {},
    ]),
  );

  const result: ProviderAuthResult = {
    profiles: [
      {
        profileId: `${PROVIDER_ID}:default`,
        credential: {
          type: "token",
          provider: PROVIDER_ID,
          token: PLACEHOLDER_TOKEN,
        },
      },
    ],
    configPatch: {
      models: {
        providers: {
          [PROVIDER_ID]: {
            baseUrl,
            apiKey: PLACEHOLDER_TOKEN,
            api: "anthropic-messages",
            models: modelIds.map((modelId) => buildModelDefinition(modelId)),
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: defaultModelRef,
            fallbacks: [],
          },
          models: modelsPatch,
        },
      },
    },
    defaultModel: defaultModelRef,
    notes: [
      "This provider is fail-closed: configure no fallback if you require strict proxy-only routing.",
      "Authenticate Claude separately via `claude login` on the gateway host/container.",
      "If the proxy is down, model calls should fail instead of bypassing to direct Anthropic.",
    ],
  };

  return result;
}

const plugin = {
  id: "anthropic-claude-proxy",
  name: "Anthropic Claude Proxy",
  description:
    "Claude Proxy (Claude login) provider for OpenClaw via local anthropic-compatible proxy.",
  configSchema: {
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        autoStart: { type: "boolean", default: true },
        autoRestart: { type: "boolean", default: true },
        restartDelayMs: { type: "integer", minimum: 1000, default: DEFAULT_RESTART_DELAY_MS },
        host: { type: "string", default: DEFAULT_HOST },
        port: { type: "integer", minimum: 1, maximum: 65535, default: DEFAULT_PORT },
        command: {
          type: "array",
          items: { type: "string" },
          default: DEFAULT_COMMAND,
        },
        models: {
          type: "array",
          items: { type: "string" },
          default: [...DEFAULT_MODEL_IDS],
        },
      },
    },
  },
  register(api: OpenClawPluginApi) {
    const pluginCfg = parsePluginConfig(api.pluginConfig);

    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/models",
      aliases: ["claude-max-proxy", "anthropic-proxy"],
      models: {
        baseUrl: `http://${pluginCfg.host}:${pluginCfg.port}`,
        apiKey: PLACEHOLDER_TOKEN,
        api: "anthropic-messages",
        models: pluginCfg.models.map((modelId) => buildModelDefinition(modelId)),
      },
      auth: [
        {
          id: "local-proxy",
          label: "Local proxy",
          hint: "Configure host/port + model ids for Claude Proxy proxy",
          kind: "custom",
          run: async (ctx: ProviderAuthContext) => runLocalAuth(ctx, pluginCfg),
        },
      ],
    });

    api.registerService(createService(api));
  },
};

export default plugin;
