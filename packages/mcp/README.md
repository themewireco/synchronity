# @synchronity/mcp-server

[![npm version](https://img.shields.io/npm/v/%40synchronity%2Fmcp-server?style=flat-square&color=2d6a4f)](https://www.npmjs.com/package/@synchronity/mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/%40synchronity%2Fmcp-server?style=flat-square&color=2d6a4f)](https://www.npmjs.com/package/@synchronity/mcp-server)

MCP (Model Context Protocol) server for Synchronity — gives AI assistants like Claude the tools to autonomously browse, compare, and purchase products on connected e-commerce stores.

## Installation

```bash
npm install -g @synchronity/mcp-server
```

Or use the `.mcpb` Claude Desktop extension — download the latest package from your Synchronity dashboard.

## Claude Desktop Setup

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "synchronity": {
      "command": "synchronity-mcp",
      "env": {
        "GATEWAY_URL": "https://api.synchronity.app",
        "AIT": "your-agent-identity-token",
        "DEFAULT_SITE_ID": "your-site-id"
      }
    }
  }
}
```

## Claude Web Setup

In Claude web, go to **Settings → Integrations → Add Integration** and enter:

```
https://api.synchronity.app/mcp
```

## Get an Agent Token

```bash
curl -X POST https://api.synchronity.app/v1/auth/agents/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-agent",
    "scopes": ["read_products", "manage_cart", "execute_checkout", "read_orders"]
  }'
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_sites` | List connected stores |
| `search_products` | Search products on a connected store |
| `get_product` | Get full product details by ID |
| `get_product_reviews` | Get reviews for a product |
| `compare_products` | Compare products across multiple stores |
| `create_cart` | Create a new shopping cart |
| `get_cart` | Get current cart contents |
| `add_to_cart` | Add an item to the cart |
| `remove_from_cart` | Remove an item from the cart |
| `apply_coupon` | Apply a discount coupon |
| `set_shipping_address` | Set the shipping destination and fetch shipping rates |
| `select_shipping_option` | Select a shipping rate; binds it to the cart total |
| `execute_checkout` | Place the order (requires delegation approval) |
| `get_order` | Get order details by ID |
| `list_orders` | List recent orders |
| `request_delegation` | Request human approval for checkout |
| `submit_delegation_otp` | Submit the emailed delegation approval code |
| `check_delegation` | Poll delegation approval status |
| `get_payment_methods` | List available payment channels for an order |
| `initiate_payment` | Start in-chat payment for an order |
| `submit_payment_otp` | Submit a payment OTP when prompted |
| `get_payment_status` | Poll payment/order status until paid |

## Links

- [TypeScript SDK](https://www.npmjs.com/package/@synchronity/sdk)
