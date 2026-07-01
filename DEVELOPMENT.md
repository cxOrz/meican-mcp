# 开发说明

## 本地开发

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

## CLI

```bash
meican-mcp              # 启动 stdio MCP server
meican-mcp stdio        # 启动 stdio MCP server
meican-mcp http         # 启动 Streamable HTTP MCP server
meican-mcp --help
meican-mcp --version
```

## Docker

Docker 默认运行 HTTP 模式：

```bash
cp .env.example .env
# 编辑 .env
docker compose up -d --build
```

`docker-compose.yml` 默认只绑定宿主机 `127.0.0.1:3000`。如果要给团队或内网使用，建议放在 TLS 反向代理后面，并加网络访问控制。

## Agent 使用说明

server 会在 MCP initialize 响应里提供 `instructions`，告诉 Agent 推荐调用流程：

- 查某天有什么餐：先 `meican_list_meal_tabs`，再 `meican_list_restaurants`，最后 `meican_show_menu`。
- 下单前先 `meican_list_orders`，避免重复下单。
- 下单需要 `tab_unique_id`、`target_time`、`dish_id`、数量和 `address_unique_id`；取餐地址可通过 `meican_whoami` 获取。
- 调用 `meican_place_order` 或 `meican_cancel_order` 前必须获得用户明确确认。
- 日期按 Asia/Shanghai 处理，`target_time` 必须原样传递。

每个工具也有自己的 `description` 和参数 schema 描述，客户端可通过 `tools/list` 获取。

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

## 发布到 npm

发布前检查：

```bash
npm login
npm whoami
npm run typecheck
npm run build
npm pack --dry-run
```

确认 `npm pack --dry-run` 里只包含预期文件：

- `dist/`
- `README.md`
- `DEVELOPMENT.md`
- `.env.example`
- `package.json`

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

试跑发布流程但不真正发布：

```bash
npm publish --dry-run
```
