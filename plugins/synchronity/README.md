# Synchronity Plugin

Shop through your connected stores from inside any AI assistant. Synchronity is
agentic commerce infrastructure: the assistant discovers merchant stores,
searches and compares products, builds carts, and completes real purchases
through a human-approved checkout. There is nothing to self-host — the plugin
connects to the hosted Synchronity MCP at `https://api.synchronity.app`.

The bundled `synchronity-commerce` skill means you do **not** have to say "use
Synchronity". Requests like *"find me a birthday cake"*, *"buy this item"*,
*"check my cart"*, or *"compare prices across my stores"* trigger the flow
automatically.

## Install

### Claude Code

```bash
/plugin marketplace add themewireco/synchronity
/plugin install synchronity@synchronity
```

The plugin runs the published MCP server (`@synchronity/mcp-server`) locally via
`npx` and points it at `https://api.synchronity.app`.

### Codex

Add the plugin from this repository; Codex reads `.codex-plugin/plugin.json` and
connects to the hosted Streamable HTTP MCP server at
`https://api.synchronity.app/mcp`.

### Claude Desktop

Use the one-click desktop extension instead — download `synchronity.mcpb` from
the [latest release](https://github.com/themewireco/synchronity/releases/latest)
and open it with Claude Desktop.

### Any other MCP client

Point it at the hosted server: `https://api.synchronity.app/mcp` (Streamable
HTTP), or run `@synchronity/mcp-server` locally with
`GATEWAY_URL=https://api.synchronity.app`.

## Interactive views

In clients that support MCP Apps resources, the server serves rich cards:

- `ui://synchronity/product-list`
- `ui://synchronity/product`
- `ui://synchronity/cart`

They render product, product-list, and cart views and call back into Synchronity
tools through the host bridge — never directly to merchant APIs.

## Safety model

Checkout and payment are intentionally human-in-the-loop. The assistant can
browse, manage carts, and prepare checkout, but spending money requires buyer
delegation and explicit payment approval. An order is not complete until its
payment status is `paid` or `processing`. Read-only shopping tools are safe to
allow automatically; checkout and payment tools should stay gated.
