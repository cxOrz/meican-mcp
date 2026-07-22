// Meican HTTP client. Configuration resolution and token persistence are kept
// outside this class so it can also be used with per-request credentials.

const DEFAULT_BASE_URL = "https://www.meican.com/forward/api";

type QueryValue = string | number | boolean | null | undefined;
type RequestBody = URLSearchParams | Record<string, string | number | boolean> | string | null;

interface MeicanClientOptions {
  accessToken: string;
  refreshToken: string;
  namespace?: string;
  clientId: string;
  clientSecret: string;
  apiBaseUrl?: string;
  onTokenRotation?: (rotation: TokenRotation) => Promise<void> | void;
}

interface MeicanRequest {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, QueryValue>;
  body?: RequestBody;
  json?: boolean;
}

interface OrdersAddInput {
  tabUniqueId: string;
  targetTime: string;
  order: Array<{ dishId: number; count: number }>;
  remarks: Array<{ dishId: string; remark: string }>;
  addressUniqueId: string;
  addressRemark?: string;
}

export interface TokenRotation {
  access_token: string;
  refresh_token: string;
  rotated_at: string;
}

export class MeicanError extends Error {
  status?: number;
  body?: unknown;

  constructor(message: string, { status, body }: { status?: number; body?: unknown } = {}) {
    super(message);
    this.name = "MeicanError";
    this.status = status;
    this.body = body;
  }
}

export class MeicanClient {
  accessToken: string;
  refreshToken: string;
  namespace?: string;
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  onTokenRotation?: (rotation: TokenRotation) => Promise<void> | void;
  rotation: TokenRotation | null = null;

  constructor(opts: MeicanClientOptions) {
    if (!opts?.accessToken) throw new MeicanError("missing access_token");
    if (!opts?.refreshToken) throw new MeicanError("missing refresh_token");
    const clientId = opts.clientId;
    const clientSecret = opts.clientSecret;
    if (!clientId) throw new MeicanError("missing MEICAN_CLIENT_ID");
    if (!clientSecret) throw new MeicanError("missing MEICAN_CLIENT_SECRET");

    this.accessToken = opts.accessToken;
    this.refreshToken = opts.refreshToken;
    this.namespace = opts.namespace;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.apiBaseUrl = (opts.apiBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.onTokenRotation = opts.onTokenRotation;
  }

  private requireNamespace(): string {
    if (!this.namespace) throw new MeicanError("missing namespace");
    return this.namespace;
  }

  commonHeaders(): Record<string, string> {
    return {
      clientid: this.clientId,
      clientsecret: this.clientSecret,
      authorization: `bearer ${this.accessToken}`,
      accept: "application/json, text/plain, */*",
      "accept-language": "zh",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.6778.268 Safari/537.36",
      "x-lsc-version": "1",
    };
  }

  withClientQuery(url: string): string {
    const u = new URL(url);
    u.searchParams.set("client_id", this.clientId);
    u.searchParams.set("client_secret", this.clientSecret);
    return u.toString();
  }

  async refresh() {
    const url = this.withClientQuery(`${this.apiBaseUrl}/v2.1/oauth/token`);
    const headers = this.commonHeaders();
    headers["content-type"] = "application/x-www-form-urlencoded";
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    }).toString();
    const res = await fetch(url, { method: "POST", headers, body });
    const text = await res.text();
    if (!res.ok) {
      throw new MeicanError(`refresh_token failed`, { status: res.status, body: text });
    }
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new MeicanError("refresh_token: non-JSON response", { status: res.status, body: text });
    }
    if (!isTokenResponse(j)) {
      throw new MeicanError("refresh_token: malformed response", { status: res.status, body: text });
    }
    this.accessToken = j.access_token;
    this.refreshToken = j.refresh_token;
    this.rotation = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      rotated_at: new Date().toISOString(),
    };
    await this.onTokenRotation?.(this.rotation);
    return j;
  }

  async call<T = any>(req: MeicanRequest, _retried = false): Promise<T> {
    let url = req.path.startsWith("http") ? req.path : `${this.apiBaseUrl}${req.path}`;
    if (url.startsWith(this.apiBaseUrl)) url = this.withClientQuery(url);
    const u = new URL(url);
    for (const [k, v] of Object.entries(req.query || {})) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }

    const headers = this.commonHeaders();
    let payload: string | undefined;
    if (req.body != null) {
      if (req.json) {
        headers["content-type"] = "application/json";
        payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      } else if (req.body instanceof URLSearchParams) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        payload = req.body.toString();
      } else if (typeof req.body === "string") {
        headers["content-type"] = headers["content-type"] || "application/x-www-form-urlencoded";
        payload = req.body;
      } else {
        headers["content-type"] = "application/x-www-form-urlencoded";
        payload = new URLSearchParams(
          Object.entries(req.body).map(([key, value]) => [key, String(value)] as [string, string]),
        ).toString();
      }
    }

    const res = await fetch(u.toString(), {
      method: req.method || "GET",
      headers,
      body: payload,
    });

    if (res.status === 401 && !_retried) {
      await this.refresh();
      return this.call(req, true);
    }

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = typeof data === "object" ? JSON.stringify(data) : data;
      throw new MeicanError(`HTTP ${res.status} on ${req.method || "GET"} ${u.pathname}: ${msg}`, {
        status: res.status,
        body: data,
      });
    }
    return data as T;
  }

  // -------- typed endpoint helpers --------

  corpsShow() {
    return this.call({ path: "/v2.1/corps/show", query: { namespace: this.requireNamespace() } });
  }

  corpAddresses() {
    return this.call({
      path: "/v2.1/corpaddresses/getmulticorpaddress",
      query: { namespace: this.requireNamespace() },
    });
  }

  calendarList(beginDate: string, endDate: string, withOrderDetail = false) {
    return this.call({
      path: "/v2.1/calendarItems/list",
      query: { withOrderDetail: String(!!withOrderDetail), beginDate, endDate: endDate || beginDate },
    });
  }

  calendarAll(beginDate: string, endDate: string, withOrderDetail = true) {
    return this.call({
      path: "/v2.1/calendarItems/all",
      query: { withOrderDetail: String(!!withOrderDetail), beginDate, endDate: endDate || beginDate },
    });
  }

  restaurantsList(tabUniqueId: string, targetTime: string) {
    return this.call({
      path: "/v2.1/restaurants/list",
      query: { tabUniqueId, targetTime },
    });
  }

  restaurantShow(tabUniqueId: string, restaurantUniqueId: string, targetTime: string) {
    return this.call({
      path: "/v2.1/restaurants/show",
      query: { tabUniqueId, restaurantUniqueId, targetTime },
    });
  }

  ordersAdd({ tabUniqueId, targetTime, order, remarks, addressUniqueId, addressRemark }: OrdersAddInput) {
    const body = new URLSearchParams({
      tabUniqueId,
      order: JSON.stringify(order),
      remarks: JSON.stringify(remarks),
      targetTime,
      userAddressUniqueId: addressUniqueId,
      corpAddressUniqueId: addressUniqueId,
      corpAddressRemark: addressRemark || "",
    });
    return this.call({ method: "POST", path: "/v2.1/orders/add", body });
  }

  orderClosetShow(uniqueId: string) {
    return this.call({ path: "/v2.1/orders/closetShow", query: { uniqueId } });
  }

  orderGroupMeal(uniqueId: string) {
    return this.call({ path: `/gateway/group-meals/v1/order/${uniqueId}` });
  }

  ordersUnpaidList() {
    return this.call({ path: "/v2.1/orders/unpaidList" });
  }

  ordersDelete(uniqueId: string, type = "CORP_ORDER") {
    const body = new URLSearchParams({ uniqueId, type, restoreCart: "false" });
    return this.call({ method: "POST", path: "/v2.1/orders/delete", body });
  }
}

function isTokenResponse(value: unknown): value is { access_token: string; refresh_token: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "access_token" in value &&
    "refresh_token" in value &&
    typeof value.access_token === "string" &&
    typeof value.refresh_token === "string"
  );
}
