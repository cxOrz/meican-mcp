// HTTP server: Express + Streamable HTTP MCP transport.
// One MCP server and transport per request keeps this process stateless.

import express, { type Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, SERVER_NAME } from "./mcp-server.js";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

function isLogLevel(value: string): value is LogLevel {
  return value in LEVELS;
}

function createLogger(logLevel: string) {
  const activeLogLevel: LogLevel = isLogLevel(logLevel) ? logLevel : "info";
  return (level: LogLevel, ...args: unknown[]) => {
    if (LEVELS[level] >= LEVELS[activeLogLevel]) {
      const ts = new Date().toISOString();
      console.error(`[${ts}] [${level}]`, ...args);
    }
  };
}

function checkAuth(req: Request, apiKeyBuffer: Buffer): boolean {
  const h = req.headers["authorization"];
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return false;
  const got = Buffer.from(h.slice("Bearer ".length).trim(), "utf8");
  if (got.length !== apiKeyBuffer.length) return false;
  return timingSafeEqual(got, apiKeyBuffer);
}

export function startHttpServer() {
  const port = Number(process.env.PORT || 3000);
  const bindHost = process.env.BIND_HOST || "127.0.0.1";
  const apiKey = process.env.MCP_API_KEY;
  const log = createLogger((process.env.LOG_LEVEL || "info").toLowerCase());

  if (!apiKey) {
    console.error(`[${SERVER_NAME}] MCP_API_KEY must be set in HTTP mode`);
    process.exit(2);
  }

  const apiKeyBuffer = Buffer.from(apiKey, "utf8");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  // Liveness probe: unauthenticated, for containers and load balancers.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: SERVER_NAME, time: new Date().toISOString() });
  });

  // MCP endpoint. Stateless: each POST spawns its own server+transport pair.
  app.post("/mcp", async (req, res) => {
    if (!checkAuth(req, apiKeyBuffer)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    try {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        // Stateless mode: no persistent session id.
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log("error", "POST /mcp failed:", err instanceof Error ? err.message : err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless mode has no use for these.
  app.get("/mcp", (_req, res) => res.status(405).end());
  app.delete("/mcp", (_req, res) => res.status(405).end());

  // Catch-all to deny noise (no info leaked).
  app.use((_req, res) => res.status(404).end());

  const server = app.listen(port, bindHost, () => {
    log("info", `${SERVER_NAME} listening on http://${bindHost}:${port}`);
    log("info", "endpoints: POST /mcp (auth), GET /healthz");
  });

  function shutdown(sig: NodeJS.Signals) {
    log("info", `received ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHttpServer();
}
