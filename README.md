<p align="center">
  <img src="icon.png" width="96" height="96" alt="Synchronity" />
</p>

<h1 align="center">Synchronity</h1>

<p align="center">Shop anything online with AI — search, compare, and buy across connected stores from any AI assistant.</p>

---

Synchronity is commerce infrastructure for AI assistants. It connects to the hosted **Synchronity gateway** at `https://api.synchronity.app` — there is nothing to self-host.

This repository contains the public, MIT-licensed pieces:

| Part | What it is |
|---|---|
| [`packages/mcp`](packages/mcp) | The MCP server — exposes shopping tools to Claude, Cursor, and any MCP client |
| [`packages/sdk`](packages/sdk) | Typed gateway client used by the MCP server |
| [`desktop-extension`](desktop-extension) | Claude Desktop extension (`.mcpb`) source — a zero-dependency bridge to the gateway |
| [`woocommerce`](woocommerce) | The Synchronity WooCommerce plugin — makes a store agent-ready |

> Releases attach prebuilt artifacts: the **`synchronity.mcpb`** desktop extension and the **WooCommerce plugin zip**. See [Releases](https://github.com/themewireco/synchronity/releases).

## For shoppers — connect your AI assistant

### Claude Desktop (easiest)

1. Download **`synchronity.mcpb`** from the [latest release](https://github.com/themewireco/synchronity/releases/latest) (or from [api.synchronity.app/setup/download](https://api.synchronity.app/setup/download)).
2. Open it with Claude Desktop and click **Install**.
3. Ask Claude to shop — e.g. *"Search Synchronity for a wireless keyboard."*

### Any MCP client (manual)

```bash
npm install && npm run build
```

```jsonc
{
  "mcpServers": {
    "synchronity": {
      "command": "node",
      "args": ["/absolute/path/to/synchronity/packages/mcp/dist/index.js"],
      "env": { "GATEWAY_URL": "https://api.synchronity.app" }
    }
  }
}
```

`GATEWAY_URL` defaults to `https://api.synchronity.app`. Sensitive actions (checkout, payment) require buyer approval — the assistant walks you through a one-time approval step.

### What the assistant can do

Product search & details (with inline images), compare across stores, reviews, cart management, shipping, checkout, card/mobile-money payment, order tracking, and human-in-the-loop approval for sensitive actions.

## For merchants — make your WooCommerce store agent-ready

1. Download the **WooCommerce plugin zip** from the [latest release](https://github.com/themewireco/synchronity/releases/latest).
2. In WordPress: **Plugins → Add New → Upload Plugin**, choose the zip, **Install** and **Activate**.
3. Open **WooCommerce → Synchronity**, copy your connector key, and register your store with Synchronity.

Your store keeps its own catalog, currency, shipping, and orders — Synchronity routes agent requests to it through the gateway.

## Build the artifacts yourself

```bash
npm run build         # build the MCP server + client
npm run build:mcpb    # -> synchronity.mcpb (Claude Desktop extension)
npm run build:plugin  # -> synchronity-woocommerce-v<version>.zip
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `GATEWAY_URL` | `https://api.synchronity.app` | Synchronity gateway base URL |
| `DEFAULT_SITE_ID` | — | Optional default store to scope tools to |
| `DEBUG` | `false` | Verbose logging to stderr |

## Reviewing & testing

New here or reviewing the connector? Follow the end-to-end walkthrough: [docs/reviewer-testing.md](docs/reviewer-testing.md).

## Privacy & support

- Privacy Policy: [PRIVACY.md](PRIVACY.md) · hosted at [api.synchronity.app/privacy](https://api.synchronity.app/privacy)
- Support: hello@themewire.co

## License

MIT © Themewire — see [LICENSE](LICENSE).
