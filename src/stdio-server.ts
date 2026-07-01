import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  const close = async () => {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  };

  process.on("SIGINT", () => {
    close().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    close().finally(() => process.exit(0));
  });

  await server.connect(transport);
}
