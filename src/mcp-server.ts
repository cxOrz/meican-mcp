import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";

export const SERVER_NAME = "meican-mcp";
export const SERVER_VERSION = "0.1.0";
export const SERVER_DESCRIPTION = "MCP server for Meican meal ordering, menus, order lookup, placement, and cancellation.";

const SERVER_INSTRUCTIONS = `
Use this server to help a user inspect and manage Meican meal orders.

Credential model:
- For local single-user clients, settings come from local config first, then environment variables. Rotated tokens are persisted automatically.
- For multi-user agents, pass access_token and refresh_token in each tool call.
- Explicit per-call tokens are never written to local config. If such a call includes _rotation, persist the new pair before the next call.

Recommended workflow:
- To answer what meals are available for a day, call meican_list_meal_tabs with date, then meican_list_restaurants for a chosen tab, then meican_show_menu for a chosen restaurant.
- To avoid duplicate orders, call meican_list_orders before meican_place_order.
- To place an order, gather tab_unique_id, target_time, restaurant_unique_id, dish_id, count, and address_unique_id. Call meican_whoami if you need pickup addresses.
- Always ask the user for explicit confirmation before meican_place_order or meican_cancel_order.

Dates are Asia/Shanghai. Use YYYY-MM-DD for date and pass target_time exactly as returned by earlier tools.
`.trim();

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: SERVER_DESCRIPTION,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  registerTools(server);
  return server;
}
