# Synchronity WooCommerce Connector

WordPress/WooCommerce plugin for Synchronity — exposes a Synchronity-compatible REST API under the WP REST API namespace `agentmesh/v1`, enabling AI agents to browse, add to cart, and check out on WooCommerce stores.

## Requirements

- WordPress 5.9+
- WooCommerce 7.0+
- PHP 8.2+

## Installation

### Upload (recommended)

1. Download the latest plugin package from your Synchronity dashboard
2. In WordPress admin: **Plugins → Add New → Upload Plugin**
3. Upload the zip and activate

## Configuration

After activation, go to **WooCommerce → Settings → Synchronity** to set up the connector. No `wp-config.php` or env editing is required.

1. Next to **Connector Key**, click **Generate new key**, then **Copy**. The key is stored as a WordPress option (`agentmesh_connector_key`) and validated on every request by the `X-AgentMesh-Connector-Key` header. Regenerating a key that's already linked pushes the new value to the gateway automatically.
2. A **Site ID** (`agentmesh_site_id`) is auto-generated on first load.
3. Finish linking the store by pasting the copied key into the Synchronity dashboard (**Storefronts → Add Storefront → WooCommerce**). For the **Store URL**, enter just your site address (e.g. `https://your-store.com`) — the gateway appends the connector path (`/wp-json/agentmesh/v1`) automatically.

### Inline Payments (Paystack)

The connector can let AI agents initiate and complete payment **inside the chat** against an existing order (mobile money fully in-chat; card via a Paystack-hosted page). Payment logic is owned by the connector; see [docs/PAYMENT_INTEGRATION.md](../../docs/PAYMENT_INTEGRATION.md).

**Paystack keys.** No separate key entry is required. The connector reads keys, in order:

1. The **Paystack for WooCommerce** plugin settings (`woocommerce_paystack_settings`) — test or live keys per its test-mode toggle. Used automatically when present.
2. Fallback `agentmesh_paystack_*` options (`agentmesh_paystack_mode` = `test`/`live`, plus `agentmesh_paystack_test_secret_key` / `agentmesh_paystack_live_secret_key` and the matching public keys).

**Channel toggles.** Go to **WooCommerce → Settings → Synchronity → Inline Payments (Paystack)**:

- **Enable Mobile Money** — offers in-chat mobile money (MTN, Vodafone, AirtelTigo). **Requires a `GHS` store currency** — mobile money is hidden for any other currency.
- **Enable Card** — offers card payment via a Paystack-hosted secure page (no card details touch the chat).

**Register the webhook (required).** Copy the read-only **Paystack Webhook URL** shown in that settings section and paste it into your Paystack dashboard at **Settings → API Keys & Webhooks → Webhook URL** so payments confirm automatically:

```
https://<store>/wp-json/agentmesh/v1/webhooks/paystack
```

The webhook is authenticated by Paystack's `x-paystack-signature` (HMAC-SHA512 of the raw body with your Paystack secret). If the webhook can't reach your store, the connector still confirms payments via verify-on-poll when the agent checks payment status — but registering the webhook is the recommended, primary confirmation path.

> **Do not put this URL in Paystack's _Callback URL_ field.** The webhook URL is for server-to-server events only (POST). For card payments the connector sets the browser callback automatically to its own GET landing page (`/connector/payment/return`), which verifies the payment and tells the buyer to return to the chat. Putting the webhook URL in the Callback field makes the browser hit a POST-only route and show a `rest_no_route` 404 after paying.

### Product Add-ons (ACF)

Some stores model per-product options as **ACF (Advanced Custom Fields)** rather than native WooCommerce variations. The connector can surface those fields to agents as **add-ons** — selectable options (size, engraving text, gift wrap, etc.) that the agent collects in chat and that carry through cart → checkout onto the order.

Add-ons are **additive to native variations** — they don't replace attributes/variants. A product can have both. **ACF must be installed and active**; with ACF absent the feature is a no-op (`addons` is simply omitted from product responses) and the settings below have no effect.

**How discovery works.** When ACF is present and the master toggle is on, the connector auto-fetches every ACF field on the product via `get_field_objects()` — no manual field-by-field mapping. Each field is mapped to an add-on:

- **Single fields** map by ACF type: `select` → `select` (or `checkbox` when ACF "multiple" is on), `radio`/`button_group` → `radio`, `checkbox` → `checkbox`, `true_false` → `boolean`, `text`/`textarea`/`email`/`url` → `text`, `number`/`range` → `number` (carries `min`/`max`). Choice options come from the field's ACF `choices`.
- **Repeaters** become a **single multi-select (`checkbox`) add-on** whose rows are the options. The row label comes from a `label`/`name`/`title` subfield (or the first text subfield); the value from a `value`/`slug` subfield (else a slug of the label); the per-option price from a `price`/`cost`/`amount`/`fee` numeric subfield if present.
- **Non-input ACF types** (tab, message, group, clone, relationship, post_object, taxonomy, image, file, gallery, google_map, link, oembed, …) are **skipped**.

**Settings** (WooCommerce → Settings → Synchronity → Product Add-ons (ACF)):

- **`agentmesh_addons_enabled`** — master toggle. Default **on** when ACF is active; turn off to suppress all add-ons.
- **`agentmesh_addon_hidden_fields`** — comma/newline-separated list of ACF field **names or keys** to hide (e.g. internal fields). Matching fields are never exposed.
- **`agentmesh_addon_price_map`** — optional JSON, keyed by ACF add-on field name. Per add-on set **one** of:
  - `{ "amount": "10.00" }` — one fixed per-unit fee for the add-on;
  - `{ "options": { "<opt_value>": "5.00" } }` — per-option fees (select/radio/checkbox);
  - `{ "price_field": "<acf_key_or_name>" }` — read the fee from another ACF field on the product.

  Concrete example:

  ```json
  {
    "engraving": { "amount": "20.00" },
    "size": { "options": { "lg": "5.00", "xl": "8.00" } },
    "gift_wrap": { "price_field": "wrap_fee_field" }
  }
  ```

  Amounts are plain decimal strings in the store currency. Unmapped add-ons are free unless an auto-source resolves a price.

**Pricing is connector-owned** — the agent/LLM never sends or guesses a price. The connector resolves each add-on/option's price modifier in this order (first match wins):

1. **Merchant price map** (`agentmesh_addon_price_map`) — per-option amount, fixed amount, or referenced ACF price field.
2. **Repeater row price subfield** (`price`/`cost`/`amount`/`fee`).
3. **`(+N)` / `(-N)` suffix** parsed from a choice label (e.g. `"Large (+5)"`).
4. Otherwise **free** (no modifier).

The resolved modifier is per-unit: `unit_price = base + Σ modifiers`, `line_total = unit_price × quantity`. Selected add-ons are stored on the cart line and stamped as WooCommerce order-item meta at checkout (visible on the order screen, emails, and `get_order`). Required add-ons are enforced at both add-to-cart and checkout. See the [Connector API reference](../../docs/api/api/connector.md) for the `addons` request/response shapes and 422 error codes.

## Register with the gateway

Most merchants link the store from the Synchronity dashboard (**Storefronts → Add Storefront → WooCommerce**). To register over the API instead, POST the bare site domain — the gateway appends the connector path (`/wp-json/agentmesh/v1`) itself, so do **not** include it:

```bash
curl -X POST https://api.synchronity.app/v1/register-site \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My WooCommerce Store",
    "platform": "woocommerce",
    "connector_base_url": "https://myshop.com",
    "connector_key": "your-secret-connector-key"
  }'
```

## Endpoints

All endpoints require the `X-AgentMesh-Connector-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/products` | Search products |
| `GET` | `/products/:id` | Get product details |
| `POST` | `/cart` | Create cart |
| `GET` | `/cart/:id` | Get cart |
| `POST` | `/cart/:id/items` | Add item to cart |
| `DELETE` | `/cart/:id/items/:item_id` | Remove item |
| `POST` | `/checkout` | Execute checkout |
| `GET` | `/orders/:id` | Get order |
| `GET` | `/connector/payment/methods` | Inline payment channels for an order |
| `POST` | `/connector/payment/initiate` | Start an inline payment session |
| `POST` | `/connector/payment/submit-otp` | Submit a mobile-money OTP |
| `GET` | `/connector/payment/status` | Poll inline payment status (verify-on-poll) |
| `GET` | `/manifest` | Store capabilities |

The Paystack webhook below is provider-facing — it is called by Paystack, not the gateway, and is verified by the `x-paystack-signature` header instead of the connector key:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/paystack` | Paystack payment confirmation (HMAC-SHA512 signed) |

## Running Tests

```bash
composer install
vendor/bin/phpunit          # full suite
php run-tests.php           # lightweight stub runner (no WP install needed)
```

## Links

- [WooCommerce REST API docs](https://woocommerce.github.io/woocommerce-rest-api-docs/)

## Support

- **Documentation**: [synchronity.app/docs](https://synchronity.app/docs)
- **Support Email**: hello@themewire.co
- **GitHub Issues**: [github.com/themewireco/synchronity/issues](https://github.com/themewireco/synchronity/issues)
