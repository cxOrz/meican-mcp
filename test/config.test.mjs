import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getConfigPath,
  persistTokens,
  readLocalConfig,
  resolveSetting,
} from "../dist/config.js";
import { MeicanClient } from "../dist/meican-api.js";

test("local config wins over environment and token writes preserve other fields", async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "meican-mcp-config-"));
  try {
    const configPath = path.join(directory, "nested", "config.json");
    assert.equal(getConfigPath({ MEICAN_CONFIG_FILE: configPath }), configPath);
    assert.deepEqual(await readLocalConfig(configPath), {});

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ clientId: " local-id ", custom: true }));
    await persistTokens("new-access", "new-refresh", configPath);

    assert.deepEqual(await readLocalConfig(configPath), {
      clientId: "local-id",
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    assert.equal(JSON.parse(await fs.readFile(configPath, "utf8")).custom, true);
    assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600);
    assert.equal(resolveSetting("local", "environment"), "local");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a successful refresh persists the rotated token before retrying", async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "meican-mcp-refresh-"));
  const configPath = path.join(directory, "config.json");
  const responses = [
    new Response("unauthorized", { status: 401 }),
    new Response(JSON.stringify({ access_token: "rotated-a", refresh_token: "rotated-r" })),
    new Response(JSON.stringify({ ok: true })),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responses.shift();

  try {
    const client = new MeicanClient({
      accessToken: "old-a",
      refreshToken: "old-r",
      clientId: "id",
      clientSecret: "secret",
      onTokenRotation: (rotation) =>
        persistTokens(rotation.access_token, rotation.refresh_token, configPath),
    });

    assert.deepEqual(await client.call({ path: "/test" }), { ok: true });
    const saved = await readLocalConfig(configPath);
    assert.equal(saved.accessToken, "rotated-a");
    assert.equal(saved.refreshToken, "rotated-r");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
