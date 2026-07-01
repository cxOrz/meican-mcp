# meican-mcp

面向美餐（Meican）的开源 MCP Server，支持查询餐次、餐厅、菜单、订单，以及下单和取消订单。

默认传输方式是 **stdio**，适合让各类 MCP 客户端通过 `npx` 在本地启动。项目也保留了 **Streamable HTTP** 模式，适合在内网部署一个常驻服务给多个内部客户端使用。

## 使用方式：stdio

大多数 MCP 客户端都支持在 `mcpServers` 里配置一个本地命令。

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

OpenCode 的配置格式稍有不同：`command` 是一个数组，环境变量字段叫 `environment`。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "meican": {
      "enabled": true,
      "type": "local",
      "command": ["npx", "-y", "meican-mcp"],
      "environment": {
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

也可以全局安装后运行：

```bash
npm install -g meican-mcp
meican-mcp
```

不带参数时，`meican-mcp` 默认启动 stdio 模式。`meican-mcp stdio` 与其等价。

## 使用方式：HTTP

HTTP 模式适合在内网跑一个常驻 MCP 服务，让多个内部客户端通过 HTTP 连接。

```bash
npm install
cp .env.example .env
# 编辑 .env
npm run build
npm start
```

`npm start` 实际执行：

```bash
node --env-file-if-exists=.env dist/cli.js http
```

健康检查：

```bash
curl http://127.0.0.1:3000/healthz
```

HTTP MCP 客户端配置示例：

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

## CLI

```bash
meican-mcp              # 启动 stdio MCP server
meican-mcp stdio        # 启动 stdio MCP server
meican-mcp http         # 启动 Streamable HTTP MCP server
meican-mcp --help
meican-mcp --version
```

## 配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---:|---|---|
| `MEICAN_CLIENT_ID` | 是 | - | 美餐 Web API 的 OAuth client id。 |
| `MEICAN_CLIENT_SECRET` | 是 | - | 美餐 Web API 的 OAuth client secret。 |
| `MEICAN_ACCESS_TOKEN` | 否 | - | 单用户本地模式下的 Meican `sat` cookie fallback。 |
| `MEICAN_REFRESH_TOKEN` | 否 | - | 单用户本地模式下的 Meican `srt` cookie fallback。 |
| `MEICAN_NAMESPACE` | 否 | - | `meican_whoami` 的默认组织/站点 namespace。也可以在工具调用参数里传。 |
| `MEICAN_API_BASE_URL` | 否 | `https://www.meican.com/forward/api` | 测试或兼容部署时可覆盖上游 API 地址。 |
| `MCP_API_KEY` | 仅 HTTP 模式 | - | HTTP `/mcp` endpoint 的 Bearer token。 |
| `BIND_HOST` | 仅 HTTP 模式 | `127.0.0.1` | HTTP 监听地址。容器内通常用 `0.0.0.0`。 |
| `PORT` | 仅 HTTP 模式 | `3000` | HTTP 监听端口。 |
| `LOG_LEVEL` | 仅 HTTP 模式 | `info` | `debug`、`info`、`warn` 或 `error`。 |

多用户平台集成时，建议由 Agent 在每次工具调用里传入用户自己的 `access_token` 和 `refresh_token`。

本地单用户 stdio 使用时，可以直接把 `MEICAN_ACCESS_TOKEN` 和 `MEICAN_REFRESH_TOKEN` 配到 MCP server 的环境变量里。工具调用如果显式传了 `access_token` / `refresh_token`，优先使用工具参数；否则读取环境变量。

如果上游 API 返回 401，server 会自动刷新一次 token，并在工具响应里返回 `_rotation`：

```json
{
  "ok": true,
  "data": {},
  "_rotation": {
    "access_token": "...",
    "refresh_token": "...",
    "rotated_at": "2026-07-01T00:00:00.000Z"
  }
}
```

MCP 客户端或上层 Agent 应在下一次调用前保存 `_rotation` 里的新 token。

## Docker

```bash
cp .env.example .env
# 编辑 .env
docker compose up -d --build
```

Docker 镜像默认运行 HTTP 模式。`docker-compose.yml` 默认只绑定宿主机 `127.0.0.1:3000`。如果要给团队或内网使用，建议放在 TLS 反向代理后面，并加网络访问控制。

## MCP 工具

| 工具 | 用途 |
|---|---|
| `meican_whoami` | 查询组织信息和取餐地址，返回最近使用的 `suggested_default_address`。 |
| `meican_list_meal_tabs` | 查询某天可用餐次，返回 `tab_unique_id` 和 `target_time`。 |
| `meican_list_restaurants` | 查询某个餐次下可用餐厅。 |
| `meican_show_menu` | 查询某个餐厅在指定餐次下的完整菜单。 |
| `meican_list_orders` | 查询某天已有订单和未支付项目摘要。 |
| `meican_show_order` | 查询单个订单详情。 |
| `meican_place_order` | 下单。支持 `dry_run: true`。调用前必须向用户确认。 |
| `meican_cancel_order` | 取消订单。调用前必须向用户确认。 |

工具响应是一个 MCP text content block，里面是 JSON 字符串：

```json
{
  "ok": true,
  "data": {}
}
```

失败时：

```json
{
  "ok": false,
  "error": {
    "message": "...",
    "status": 400,
    "body": {},
    "kind": "MeicanError"
  }
}
```

## 给 Agent 的说明

server 会在 MCP initialize 响应里提供 `instructions`，告诉 Agent 推荐调用流程：

- 查某天有什么餐：先 `meican_list_meal_tabs`，再 `meican_list_restaurants`，最后 `meican_show_menu`。
- 下单前先 `meican_list_orders`，避免重复下单。
- 下单需要 `tab_unique_id`、`target_time`、`dish_id`、数量和 `address_unique_id`；取餐地址可通过 `meican_whoami` 获取。
- 调用 `meican_place_order` 或 `meican_cancel_order` 前必须获得用户明确确认。
- 日期按 Asia/Shanghai 处理，`target_time` 必须原样传递。

每个工具也有自己的 `description` 和参数 schema 描述，客户端可通过 `tools/list` 获取。

## 开发

```bash
npm install
npm run dev          # HTTP 模式，读取 .env
npm run dev:stdio    # stdio 模式，读取 .env
npm run typecheck
npm run build
npm pack --dry-run
```

用官方 MCP Inspector 检查 HTTP 模式：

```bash
MCP_API_KEY=$(grep '^MCP_API_KEY=' .env | cut -d= -f2-) \
npx @modelcontextprotocol/inspector \
  --transport http \
  --url http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer $MCP_API_KEY"
```

## 发布到 npm

发布前检查：

```bash
npm login
npm whoami
npm run typecheck
npm run build
npm pack --dry-run
```

确认 `npm pack --dry-run` 里只包含预期文件：`dist/`、`README.md`、`.env.example` 和 `package.json`。

首次公开发布：

```bash
npm publish --access public
```

后续发版：

```bash
npm version patch   # 0.1.0 -> 0.1.1
npm publish
```

也可以根据变更选择：

```bash
npm version minor   # 新功能
npm version major   # 破坏性变更
```

发布后测试：

```bash
npx -y meican-mcp --version
npx -y meican-mcp --help
```

如果需要先试发布流程但不真正发布，可以用：

```bash
npm publish --dry-run
```

## 安全注意事项

- 不要提交 `.env` 或用户 token。
- `MCP_API_KEY`、Meican 用户 token、Meican OAuth client 凭据都应视为敏感信息。
- HTTP 模式暴露到 localhost 之外时，建议使用 TLS、反向代理和网络 allow-list。
- 工具错误不会返回堆栈、文件路径或进程信息。

## 项目结构

```text
meican-mcp/
├── src/
│   ├── cli.ts           # npm bin；默认 stdio，可显式启动 http
│   ├── mcp-server.ts    # 共享 MCP server factory
│   ├── stdio-server.ts  # stdio transport
│   ├── http-server.ts   # HTTP transport + auth
│   ├── tools.ts         # 工具注册 + Zod schema
│   ├── meican-api.ts    # Meican HTTP client + token refresh
│   └── summarizers.ts   # 响应裁剪和结构化
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── README.md
```
