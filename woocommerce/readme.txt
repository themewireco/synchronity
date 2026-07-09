=== Synchronity for WooCommerce ===
Contributors: themewireco
Tags: agentmesh, ai-commerce, woocommerce, ai-agents
Requires at least: 6.0
Tested up to: 6.6
Requires PHP: 8.2
Stable tag: 0.4.7
License: GPLv2 or later

Connect your WooCommerce store to the AgentMesh network — enabling AI agents to discover, search, and purchase from your store.

== Description ==

AgentMesh for WooCommerce implements the AgentMesh Connector Interface, exposing your WooCommerce product catalogue, cart, and checkout to the AgentMesh Gateway. AI agents (Claude, ChatGPT, LangChain, etc.) can then autonomously browse products, manage carts, and place orders on behalf of users.

**Features:**
* Full AMPS-normalised product catalogue API
* Cart session management (create, add/remove items, coupons)
* Checkout execution via buyer delegation tokens
* Order tracking and status
* Webhook delivery for inventory and order events
* Admin settings page under WooCommerce → AgentMesh
* **Phase 6: Automatic Schema Injection** — Automatically injects signed AMPS schema for LLM discovery via IP-based detection

== Installation ==

1. Upload the plugin to `/wp-content/plugins/agentmesh-woocommerce/`
2. Activate the plugin via the 'Plugins' menu in WordPress
3. Navigate to WooCommerce → Settings → AgentMesh
4. Enter your AgentMesh Gateway URL and Connector Key

== Frequently Asked Questions ==

= What is AgentMesh? =
AgentMesh is an AI agentic commerce infrastructure layer. It normalises your WooCommerce store API so AI agents can transact programmatically.

= Is WooCommerce required? =
Yes — WooCommerce 7.0 or higher must be installed and active.

== Changelog ==

= 0.4.7 =
* New: PayPal as a selectable in-chat payment gateway (PayPal-hosted redirect via Orders v2, captures on return/poll). Credentials read from the WooCommerce PayPal Payments plugin when present. Enable under Inline Payments (PayPal); shown only for PayPal-supported currencies.

= 0.4.2 =
* Fix: after a successful card payment, buyers are now redirected to WooCommerce's own order-received (thank-you) page instead of the connector's minimal "Payment received" landing. Failed/pending/unsettled states keep the landing page

= 0.4.1 =
* Grouped (nested) ACF repeater add-ons — OPT-IN (default off). For stores that build options as an outer repeater of groups, each with an inner repeater of priced options; each group becomes its own add-on. Detected generically by subfield role (text=label, number=price, "discount"=sale price) — no store-specific field names
* New setting: Add-on Pricing Mode — "additive" (default, unchanged) or "absolute" (line = sum of selected option prices; base ignored) for builder/configurator products
* New setting: Multi-select Add-on Groups — group titles that allow choosing more than one option
* All additive/opt-in: existing single-field and flat-repeater add-ons and native variations are unchanged

= 0.4.0 =
* Product Add-ons (ACF) — auto-fetch a product's ACF fields (single fields + repeaters) as customer-selectable add-ons, alongside native variations
* Supported types: select/radio/button group, checkbox/true-false, text/textarea/number; repeater rows become options
* Buyers choose add-ons in chat; required ones enforced at cart and checkout; selections stamped on the order
* Connector-owned pricing via a merchant price map (fixed amount, per-option, or referenced ACF field); repeater price subfield and (+N) label suffix also supported; unmapped add-ons are free
* New settings: enable toggle, hidden-field list, and price map

= 0.3.1 =
* Fix: card payments now send an explicit Paystack callback_url to a new GET return landing (/connector/payment/return) instead of the POST-only webhook — fixes the 404 buyers saw after paying
* New: branded "return to your chat" landing page that verifies + advances the order on redirect

= 0.3.0 =
* Inline (in-chat) payments — Paystack v1
* Mobile money (MTN/Vodafone/AirtelTigo) charged in-chat; card via Paystack-hosted redirect
* New endpoints: /connector/payment/{methods,initiate,submit-otp,status} and /webhooks/paystack
* Paystack webhook (HMAC-SHA512 verified) + verify-on-poll advance order pending → processing
* Amount/currency always derived from the order; no card data handled by the connector
* Admin: Inline Payments settings (channel toggles + Paystack webhook URL)

= 0.2.0 =
* Phase 6 Schema Injection — Automatic schema injection for LLM discovery
* IP-only detection (works with generic User-Agent from web_fetch)
* Signed schema with public key validation
* 5-minute schema caching to reduce gateway load
* Silent error handling (no user-facing errors if gateway unreachable)

= 0.1.0 =
* Initial release — Phase 1 WooCommerce connector
* Implements all mandatory Connector Interface endpoints
* Full AMPS normalisation layer
