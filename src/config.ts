import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface MeicanConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  namespace?: string;
  apiBaseUrl?: string;
}

const CONFIG_KEYS = [
  "clientId",
  "clientSecret",
  "accessToken",
  "refreshToken",
  "namespace",
  "apiBaseUrl",
] as const satisfies readonly (keyof MeicanConfig)[];

let writeQueue: Promise<void> = Promise.resolve();

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = clean(env.MEICAN_CONFIG_FILE);
  if (override) return path.resolve(override);

  const xdgConfigHome = clean(env.XDG_CONFIG_HOME);
  if (xdgConfigHome) return path.join(xdgConfigHome, "meican-mcp", "config.json");

  if (process.platform === "win32") {
    const appData = clean(env.APPDATA);
    if (appData) return path.join(appData, "meican-mcp", "config.json");
  }

  return path.join(homedir(), ".config", "meican-mcp", "config.json");
}

export async function readLocalConfig(configPath = getConfigPath()): Promise<MeicanConfig> {
  const raw = await readConfigObject(configPath);
  const config: MeicanConfig = {};

  for (const key of CONFIG_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new Error(`invalid local config ${configPath}: ${key} must be a string`);
    }
    const normalized = value.trim();
    if (normalized) config[key] = normalized;
  }

  return config;
}

export function resolveSetting(
  localValue: string | undefined,
  envValue: string | undefined,
  fallback?: string,
): string | undefined {
  return clean(localValue) || clean(envValue) || fallback;
}

export function persistTokens(
  accessToken: string,
  refreshToken: string,
  configPath = getConfigPath(),
): Promise<void> {
  // Serialize read-modify-write operations in this process so two requests do
  // not accidentally discard each other's config fields.
  const operation = writeQueue.then(() =>
    updateConfig(configPath, {
      accessToken,
      refreshToken,
    }),
  );
  writeQueue = operation.catch(() => {});
  return operation;
}

async function updateConfig(configPath: string, patch: MeicanConfig): Promise<void> {
  const current = await readConfigObject(configPath);
  const next = { ...current, ...patch };
  const directory = path.dirname(configPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, configPath);
    await fs.chmod(configPath, 0o600);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function readConfigObject(configPath: string): Promise<Record<string, unknown>> {
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`invalid JSON in local config ${configPath}${detail}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`invalid local config ${configPath}: expected a JSON object`);
  }
  return parsed;
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
