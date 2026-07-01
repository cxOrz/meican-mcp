# meican-mcp

[![MCP Badge](https://lobehub.com/badge/mcp/cxorz-meican-mcp)](https://lobehub.com/mcp/cxorz-meican-mcp)

美餐（Meican）MCP Server。支持查询餐次、餐厅、菜单、订单，以及下单和取消订单。

## 可用工具

| 工具 | 用途 |
|---|---|
| `meican_whoami` | 查询组织信息和取餐地址。 |
| `meican_list_meal_tabs` | 查询某天可用餐次。 |
| `meican_list_restaurants` | 查询某个餐次下可用餐厅。 |
| `meican_show_menu` | 查询某个餐厅在指定餐次下的菜单。 |
| `meican_list_orders` | 查询某天已有订单和未支付项目摘要。 |
| `meican_show_order` | 查询单个订单详情。 |
| `meican_place_order` | 下单。调用前必须向用户确认。 |
| `meican_cancel_order` | 取消订单。调用前必须向用户确认。 |

工具返回一个 MCP text content block，内容是 JSON 字符串：

```json
{ "ok": true, "data": {} }
```

失败时：

```json
{ "ok": false, "error": { "message": "...", "status": 400, "body": {}, "kind": "MeicanError" } }
```

如果返回 `_rotation`，说明 token 已刷新，客户端应在下一次调用前保存新的 `access_token` 和 `refresh_token`。

## 快速使用

```json
{
  "mcpServers": {
    "meican": {
      "command": "npx",
      "args": ["-y", "meican-mcp"],
      "env": {
        "MEICAN_CLIENT_ID": "...",
        "MEICAN_CLIENT_SECRET": "...",
        "MEICAN_ACCESS_TOKEN": "...",
        "MEICAN_REFRESH_TOKEN": "...",
        "MEICAN_NAMESPACE": "..."
      }
    }
  }
}
```

`MEICAN_ACCESS_TOKEN` 对应美餐的 cookie `sat`，`MEICAN_REFRESH_TOKEN` 对应美餐的 cookie `srt`。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---:|---|
| `MEICAN_CLIENT_ID` | 是 | 美餐的 OAuth client id，去 Web 端找，或抓包。 |
| `MEICAN_CLIENT_SECRET` | 是 | 美餐的 OAuth client secret，去 Web 端找，或抓包。 |
| `MEICAN_ACCESS_TOKEN` | 是 | 美餐 `sat` cookie。不填的话在调用时传 `access_token` 也可。 |
| `MEICAN_REFRESH_TOKEN` | 是 | 美餐 `srt` cookie。不填的话在调用时传 `refresh_token` 也可。 |
| `MEICAN_NAMESPACE` | 否 | 默认组织/站点 namespace。也可以在工具调用参数里传。 |
| `MEICAN_API_BASE_URL` | 否 | 默认 `https://www.meican.com/forward/api`。 |

HTTP 模式相关：

| 变量 | 必填 | 说明 |
|---|---:|---|
| `MCP_API_KEY` | 是 | HTTP `/mcp` 的 Bearer token，随便生成一个，不带 token 的不允许调用。 |
| `BIND_HOST` | 否 | 默认 `127.0.0.1`。容器内通常用 `0.0.0.0`。 |
| `PORT` | 否 | 默认 `3000`。 |
| `LOG_LEVEL` | 否 | 默认 `info`。可选 `debug`、`info`、`warn`、`error`。 |

## HTTP 模式

```bash
npm install
cp .env.example .env
# 编辑 .env
npm run build
npm start
```

健康检查：

```bash
curl http://127.0.0.1:3000/healthz
```

HTTP MCP 配置示例：

```json
{
  "mcpServers": {
    "meican": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_API_KEY}"
      }
    }
  }
}
```

