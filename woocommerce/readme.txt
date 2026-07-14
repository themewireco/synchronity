=== Synchronity for WooCommerce ===
Contributors: themewireco
Tags: ai, commerce, woocommerce, ai-agents, checkout
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 8.2
Stable tag: 0.4.9
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect your WooCommerce store to Synchronity so AI agents can discover, search, and purchase your products on a shopper's behalf.

== Description ==

Synchronity for WooCommerce connects your store to the Synchronity Gateway, a hosted service operated by Themewire Ltd. Once connected, AI agents (such as Claude and ChatGPT) can browse your product catalogue, build carts, and place real orders on behalf of a shopper, using the Synchronity Model Context Protocol tools.

The plugin exposes your store to the gateway through a set of authenticated REST endpoints and normalises every response to the Synchronity product and order schema. It does nothing until you enter your Synchronity Gateway URL and Connector Key on the settings screen, and it makes no outbound network request until that connection is configured.

**Features:**

* Product catalogue API (list, search, single product, reviews)
* Cart session management (create, add / remove items, quantities, coupons)
* Shipping option calculation for a destination
* Checkout execution via buyer delegation tokens
* Order tracking and status
* Optional in-chat payments (Paystack, Stripe, PayPal) using your own gateway credentials
* Webhook delivery for inventory and order events (only after the connector is configured)
* Optional AMPS schema hint for LLM discovery (off by default, opt-in)
* Product Add-ons (ACF) support
* Admin settings under WooCommerce → Settings → Synchronity

== Installation ==

1. Install and activate WooCommerce (required).
2. Upload the plugin to `/wp-content/plugins/synchronity-for-woocommerce/` and activate it via the Plugins menu.
3. Go to WooCommerce → Settings → Synchronity.
4. Enter your Synchronity Gateway URL and Connector Key, then save.
5. Optionally enable in-chat payments and enter your payment provider keys.

No data leaves your store until steps 3–4 are complete.

== Frequently Asked Questions ==

= What is Synchronity? =
Synchronity is a hosted AI commerce service by Themewire Ltd (https://synchronity.app). It normalises your WooCommerce store so AI agents can browse and transact through a standard interface. This plugin is the WooCommerce connector for that service.

= Do I have to use the service? =
Yes. The plugin is a connector to the Synchronity Gateway and requires an account and Connector Key from https://synchronity.app to function. Without a configured connection the plugin makes no external calls.

= Is WooCommerce required? =
Yes. WooCommerce 7.0 or higher must be installed and active.

= Does the plugin send data anywhere by default? =
No. All outbound requests are gated on you configuring a Gateway URL and Connector Key. The optional schema hint is disabled by default.

== External services ==

This plugin relies on the following third party / external services. Each is only contacted after you configure the connector and, for payments, only after you enable that provider and enter its credentials.

**Synchronity Gateway (Themewire Ltd) — required**
This is the core service the plugin connects to. It is what lets AI agents discover and transact with your store.
What is sent and when: after you enter a Gateway URL and Connector Key, the plugin serves authenticated requests from the gateway (product, cart, checkout and order data) and, if enabled, delivers inventory and order webhook events to the gateway. Requests are signed with your Connector Key. No request is made before the connection is configured.
Default endpoint: https://api.synchronity.app
Terms of service: https://synchronity.app/terms
Privacy policy: https://synchronity.app/privacy-policy

**Paystack — optional (in-chat payments)**
Used only if you enable Paystack under Inline Payments and provide your Paystack keys.
What is sent and when: when a buyer pays in chat, the plugin creates and verifies a transaction with Paystack for the order amount and currency. No card data is handled by the plugin.
Terms of service: https://paystack.com/terms
Privacy policy: https://paystack.com/terms

**Stripe — optional (in-chat payments)**
Used only if you enable Stripe under Inline Payments and provide your Stripe keys (or have the official Stripe plugin configured).
What is sent and when: when a buyer pays in chat, the plugin creates and verifies a Stripe checkout / payment for the order amount and currency. No card data is handled by the plugin.
Terms of service: https://stripe.com/legal/ssa
Privacy policy: https://stripe.com/privacy

**PayPal — optional (in-chat payments)**
Used only if you enable PayPal under Inline Payments and provide your PayPal keys (or have the official PayPal Payments plugin configured).
What is sent and when: when a buyer pays in chat, the plugin creates and captures a PayPal order for the order amount and currency via the PayPal Orders API. No card data is handled by the plugin.
Terms of service: https://www.paypal.com/legalhub/home
Privacy policy: https://www.paypal.com/myaccount/privacy/privacyHub

== Changelog ==

= 0.4.9 =
* Fix: updated the Paystack privacy policy link to the Terms and Conditions / Privacy Policy at https://paystack.com/terms, per wp.org review.
* Fix: the card-payment return landing now inlines its styles as element attributes instead of a stylesheet block, resolving the wp.org enqueue finding for that standalone (non-template) page.

= 0.4.8 =
* Schema hint for LLM discovery is now off by default and only runs after the connector is configured (no requests before setup).
* Webhook delivery now requires a configured Gateway URL, Site ID and Connector Key before any event is sent.
* Admin key actions script moved out of inline markup into an enqueued file.
* Hardened schema output escaping and removed hardcoded WooCommerce path assumptions.
* readme: documented the Synchronity Gateway, Paystack, Stripe and PayPal external services.

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
* Schema hint — automatic schema hint for LLM discovery
* IP-only detection (works with generic User-Agent from web_fetch)
* Signed schema with public key validation
* 5-minute schema caching to reduce gateway load
* Silent error handling (no user-facing errors if gateway unreachable)

= 0.1.0 =
* Initial release — Phase 1 WooCommerce connector
* Implements all mandatory Connector Interface endpoints
* Full product / order normalisation layer
