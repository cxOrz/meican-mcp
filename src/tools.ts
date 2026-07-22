import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeicanClient, MeicanError, type TokenRotation } from "./meican-api.js";
import {
  getConfigPath,
  persistTokens,
  readLocalConfig,
  resolveSetting,
  type MeicanConfig,
} from "./config.js";
import {
  summarizeCalendar,
  summarizeRestaurants,
  summarizeMenu,
  summarizeAddresses,
  summarizeOrderShow,
  summarizeOrdersAdd,
  pickSuggestedAddress,
} from "./summarizers.js";

type ToolArgs = Record<string, any>;
type ToolPayload = Record<string, any>;
type ToolHandler = (client: MeicanClient, args: ToolArgs) => Promise<unknown> | unknown;

// Explicit tool arguments are user-scoped and take precedence. Local
// single-user calls use config-file values before environment variables.
const tokensShape = {
  access_token: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Meican access token (cookie 'sat' on www.meican.com). " +
        "If omitted, the server reads local config, then MEICAN_ACCESS_TOKEN.",
    ),
  refresh_token: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Meican refresh token (cookie 'srt'). If omitted, the server " +
        "reads local config, then MEICAN_REFRESH_TOKEN. On HTTP 401 the " +
        "server refreshes once. In local mode the rotated pair is persisted " +
        "automatically; callers using explicit tokens must persist `_rotation`.",
    ),
  namespace: z
    .string()
    .optional()
    .describe(
      "Meican namespace for the user's organization or site. Only " +
        "meican_whoami uses this to scope organization info and pickup " +
        "addresses; other tools ignore it.",
    ),
};

function todayCST(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}

function asContent(payload: ToolPayload) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function makeHandler(fn: ToolHandler) {
  return async (args: ToolArgs) => {
    let client: MeicanClient | undefined;
    let persistRotation = false;
    let configPath: string | undefined;
    let persistenceWarning: string | undefined;
    try {
      configPath = getConfigPath();
      const localConfig = await readLocalConfig(configPath);
      const hasExplicitTokens = hasValue(args.access_token) || hasValue(args.refresh_token);
      persistRotation = !hasExplicitTokens;
      const onTokenRotation = persistRotation
        ? async (rotation: TokenRotation) => {
            try {
              await persistTokens(rotation.access_token, rotation.refresh_token, configPath);
            } catch (error) {
              persistenceWarning = `token refreshed but could not update ${configPath}: ${
                error instanceof Error ? error.message : String(error)
              }`;
            }
          }
        : undefined;
      client = createClient(args, localConfig, onTokenRotation);
      const data = await fn(client, args);
      const out: ToolPayload = { ok: true, data };
      if (client.rotation) out._rotation = client.rotation;
      if (persistenceWarning) out._persistence_warning = persistenceWarning;
      return asContent(out);
    } catch (err) {
      const result: ToolPayload = {
        ok: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          // Only surface a few safe fields; never the stack.
          status: err instanceof MeicanError ? err.status : undefined,
          body: err instanceof MeicanError ? err.body : undefined,
          kind: err instanceof Error ? err.name : "Error",
        },
      };
      if (client?.rotation) result._rotation = client.rotation;
      if (persistenceWarning) result._persistence_warning = persistenceWarning;
      return asContent(result);
    }
  };
}

function createClient(
  args: ToolArgs,
  local: MeicanConfig,
  onTokenRotation?: (rotation: TokenRotation) => Promise<void> | void,
): MeicanClient {
  return new MeicanClient({
    accessToken: requireSetting(
      stringValue(args.access_token) || local.accessToken || process.env.MEICAN_ACCESS_TOKEN,
      "access_token; provide a tool argument, local config accessToken, or MEICAN_ACCESS_TOKEN",
    ),
    refreshToken: requireSetting(
      stringValue(args.refresh_token) || local.refreshToken || process.env.MEICAN_REFRESH_TOKEN,
      "refresh_token; provide a tool argument, local config refreshToken, or MEICAN_REFRESH_TOKEN",
    ),
    namespace: stringValue(args.namespace) || resolveSetting(local.namespace, process.env.MEICAN_NAMESPACE),
    clientId: requireSetting(
      resolveSetting(local.clientId, process.env.MEICAN_CLIENT_ID),
      "MEICAN client id; set local config clientId or MEICAN_CLIENT_ID",
    ),
    clientSecret: requireSetting(
      resolveSetting(local.clientSecret, process.env.MEICAN_CLIENT_SECRET),
      "MEICAN client secret; set local config clientSecret or MEICAN_CLIENT_SECRET",
    ),
    apiBaseUrl: resolveSetting(local.apiBaseUrl, process.env.MEICAN_API_BASE_URL),
    onTokenRotation,
  });
}

function requireSetting(value: string | undefined, description: string): string {
  const normalized = value?.trim();
  if (normalized) return normalized;
  throw new MeicanError(`missing ${description}`);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasValue(value: unknown): boolean {
  return stringValue(value) !== undefined;
}

// ---- tool registrations ----

export function registerTools(server: McpServer) {
  server.registerTool(
    "meican_whoami",
    {
      description:
        "Look up the current user's organization info and ALL delivery " +
        "addresses on Meican. Call this once per user to discover their " +
        "`suggested_default_address` (= most recently used pickup point); " +
        "store the returned unique_id on the user's profile and pass it as " +
        "`address_unique_id` to `meican_place_order`.",
      inputSchema: tokensShape,
    },
    makeHandler(async (client) => {
      const [organization, addr] = await Promise.all([client.corpsShow(), client.corpAddresses()]);
      return {
        organization: {
          namespace: client.namespace,
          price_visible: organization.priceVisible,
          show_price: organization.showPrice,
          dish_limit: organization.dishLimit,
          price_limit_in_cent: organization.priceLimitInCent,
        },
        ...summarizeAddresses(addr),
        suggested_default_address: pickSuggestedAddress(addr),
      };
    }),
  );

  server.registerTool(
    "meican_list_meal_tabs",
    {
      description:
        "List meal sessions ('餐次', e.g. 午餐, 晚餐) available for a given date. " +
        "Each tab has a `tab_unique_id` and a `target_time` (the order deadline " +
        "as 'YYYY-MM-DD HH:MM') which you pass verbatim to subsequent tools. " +
        "Use this FIRST when the user wants to order or view orders for a day. " +
        "If `existing_order` is non-null for a tab, the user has already ordered " +
        "from it — surface that instead of placing a duplicate.",
      inputSchema: {
        ...tokensShape,
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Date in YYYY-MM-DD (Asia/Shanghai). Defaults to today."),
      },
    },
    makeHandler(async (client, args) => {
      const date = args.date || todayCST();
      const resp = await client.calendarList(date, date, true);
      return summarizeCalendar(resp);
    }),
  );

  server.registerTool(
    "meican_list_restaurants",
    {
      description:
        "List restaurants serving in one meal session. Returns each restaurant's " +
        "`unique_id` and name. Get the args from `meican_list_meal_tabs`.",
      inputSchema: {
        ...tokensShape,
        tab_unique_id: z.string().min(1).describe("From `meican_list_meal_tabs[].tab_unique_id`"),
        target_time: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
          .describe("From `meican_list_meal_tabs[].target_time`. Format: 'YYYY-MM-DD HH:MM'"),
      },
    },
    makeHandler((client, args) => client.restaurantsList(args.tab_unique_id, args.target_time).then(summarizeRestaurants)),
  );

  server.registerTool(
    "meican_show_menu",
    {
      description:
        "Show one restaurant's full menu for a meal session. Returns dishes " +
        "grouped by section. You need `dish_id` values from here to place an order.",
      inputSchema: {
        ...tokensShape,
        tab_unique_id: z.string().min(1),
        restaurant_unique_id: z.string().min(1).describe("From `meican_list_restaurants`"),
        target_time: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
      },
    },
    makeHandler((client, args) =>
      client
        .restaurantShow(args.tab_unique_id, args.restaurant_unique_id, args.target_time)
        .then(summarizeMenu),
    ),
  );

  server.registerTool(
    "meican_list_orders",
    {
      description:
        "List the current user's existing Meican orders for a date plus any unpaid " +
        "items. Call this BEFORE `meican_place_order` to avoid duplicates.",
      inputSchema: {
        ...tokensShape,
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("YYYY-MM-DD. Defaults to today."),
      },
    },
    makeHandler(async (client, args) => {
      const date = args.date || todayCST();
      const [calendar, unpaid] = await Promise.all([
        client.calendarAll(date, date, true),
        client.ordersUnpaidList(),
      ]);
      const cal = summarizeCalendar(calendar);
      const orders = [];
      for (const day of cal.dates) {
        for (const tab of day.tabs) {
          if (tab.existing_order) {
            orders.push({
              date: day.date,
              tab_unique_id: tab.tab_unique_id,
              tab_title: tab.title,
              target_time: tab.target_time,
              ...tab.existing_order,
            });
          }
        }
      }
      return {
        date,
        orders,
        unpaid: {
          user_balance: unpaid.user?.balance,
          count: (unpaid.corpOrderUserList || []).length,
        },
      };
    }),
  );

  server.registerTool(
    "meican_show_order",
    {
      description:
        "Show full status of one order by its uniqueId, including pickup location, " +
        "current pay status, and dishes. Use after placing an order to confirm it " +
        "succeeded (expect status_info='NEW_ORDER', pay_status='SUCCESS').",
      inputSchema: {
        ...tokensShape,
        order_unique_id: z.string().min(1).describe("From `meican_place_order` or `meican_list_orders`"),
      },
    },
    makeHandler(async (client, args) => {
      const [closet, groupMeal] = await Promise.all([
        client.orderClosetShow(args.order_unique_id),
        client.orderGroupMeal(args.order_unique_id).catch((e) => ({ _error: e.message })),
      ]);
      return summarizeOrderShow(closet, groupMeal);
    }),
  );

  server.registerTool(
    "meican_place_order",
    {
      description:
        "Place a meal order. " +
        "DESTRUCTIVE: this may charge the user or consume an organization subsidy. ALWAYS confirm " +
        "dish names, counts, total price, target time, and pickup address with the " +
        "user BEFORE calling this. Set `dry_run: true` first to inspect the payload " +
        "without submitting.",
      inputSchema: {
        ...tokensShape,
        tab_unique_id: z.string().min(1),
        target_time: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
        dishes: z
          .array(
            z.object({
              dish_id: z.number().int().positive().describe("From `meican_show_menu`"),
              count: z.number().int().positive().default(1),
              remark: z.string().optional().describe("Per-dish note. Empty if not needed."),
            }),
          )
          .min(1)
          .describe("Items to order. One entry per dish; use `count` for quantity."),
        address_unique_id: z
          .string()
          .min(1)
          .describe(
            "Pickup point. Get from `meican_whoami.suggested_default_address.unique_id` " +
              "or the user's stored preference.",
          ),
        address_remark: z.string().optional().describe("Free-form note for the address."),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, return the prepared request body without submitting."),
      },
    },
    makeHandler(async (client, args) => {
      const order = args.dishes.map((d: ToolArgs) => ({ count: d.count || 1, dishId: d.dish_id }));
      const remarks = args.dishes.map((d: ToolArgs) => ({
        dishId: String(d.dish_id),
        remark: d.remark || "",
      }));
      if (args.dry_run) {
        return {
          dry_run: true,
          body: {
            tabUniqueId: args.tab_unique_id,
            order: JSON.stringify(order),
            remarks: JSON.stringify(remarks),
            targetTime: args.target_time,
            userAddressUniqueId: args.address_unique_id,
            corpAddressUniqueId: args.address_unique_id,
            corpAddressRemark: args.address_remark || "",
          },
        };
      }
      const resp = await client.ordersAdd({
        tabUniqueId: args.tab_unique_id,
        targetTime: args.target_time,
        order,
        remarks,
        addressUniqueId: args.address_unique_id,
        addressRemark: args.address_remark,
      });
      return {
        ...summarizeOrdersAdd(resp),
        hint:
          "Order placed. Corp-subsidised payment usually flips to SUCCESS within ~1s. " +
          "Call meican_show_order to verify.",
      };
    }),
  );

  server.registerTool(
    "meican_cancel_order",
    {
      description:
        "Cancel a meal order. " +
        "DESTRUCTIVE: this removes the order. ALWAYS confirm with the user before calling.",
      inputSchema: {
        ...tokensShape,
        order_unique_id: z.string().min(1),
        type: z.string().optional().default("CORP_ORDER"),
      },
    },
    makeHandler(async (client, args) => {
      const resp = await client.ordersDelete(args.order_unique_id, args.type || "CORP_ORDER");
      return {
        status: resp.status,
        unique_id: resp.order?.uniqueId || args.order_unique_id,
        message: resp.message || undefined,
      };
    }),
  );
}
