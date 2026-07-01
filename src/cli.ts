#!/usr/bin/env node

import { startHttpServer } from "./http-server.js";
import { SERVER_NAME, SERVER_VERSION } from "./mcp-server.js";
import { startStdioServer } from "./stdio-server.js";

const command = process.argv[2] || "stdio";

function printHelp(): void {
  console.log(`${SERVER_NAME} ${SERVER_VERSION}

Usage:
  meican-mcp              Start stdio MCP server (default)
  meican-mcp stdio        Start stdio MCP server
  meican-mcp http         Start Streamable HTTP MCP server
  meican-mcp --version    Print version
  meican-mcp --help       Print help

HTTP mode requires MCP_API_KEY. Both modes require MEICAN_CLIENT_ID and
MEICAN_CLIENT_SECRET before Meican tools can call the upstream API.`);
}

async function main(): Promise<void> {
  switch (command) {
    case "stdio":
      await startStdioServer();
      return;
    case "http":
      startHttpServer();
      return;
    case "-v":
    case "--version":
      console.log(SERVER_VERSION);
      return;
    case "-h":
    case "--help":
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
