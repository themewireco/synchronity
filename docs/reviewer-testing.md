# Synchronity — Reviewer Test Guide

Thanks for reviewing **Synchronity**. This guide lets you exercise the connector end-to-end, including the human-in-the-loop approval and a sandbox card payment, in ~5 minutes.

Synchronity lets an AI assistant shop across connected merchant stores: search products, build a cart, set shipping, and complete a checkout that requires explicit buyer approval before any money moves. It connects to the hosted gateway at `https://api.synchronity.app` — nothing to self-host.

---

## 1. Test account & sandbox values

> Items in **[BRACKETS]** are provisioned for this review.

| Item | Value |
|---|---|
| Gateway | `https://api.synchronity.app` |
| Demo store | **Sorella Bakery** — pre-registered; the assistant finds it by name, no store ID needed |
| Buyer email (for approval) | **[reviewer-buyer@example.com]** — checkout approval codes are emailed here; inbox access: **[how the reviewer gets the code]** |
| Test coupon | `testcoupon` — a working discount code to try |

**Mobile-money TEST payment** (Paystack sandbox — no real charge):

| Field | Value |
|---|---|
| Method | Mobile Money — MTN (Ghana) |
| Phone number | `0551234987` |
| OTP (if prompted) | `123456` |

---

## 2. Connect the connector

**Claude Desktop (extension):**
1. Download `synchronity.mcpb` from the [latest release](https://github.com/themewireco/synchronity/releases/latest) (or `https://api.synchronity.app/setup/download`).
2. Open it with Claude Desktop → **Install**.

**Remote MCP (any client):**
- MCP endpoint: `https://api.synchronity.app/mcp` (Streamable HTTP)
- Auth: **none required to connect** — the gateway provisions an agent identity automatically. Sensitive actions (checkout, payment) are gated by human approval, below.

Once connected, the assistant exposes the Synchronity shopping tools.

---

## 3. Happy-path test flow

Send these prompts to the assistant. Each lists the tool(s) it should call and what you should see.

| # | Prompt to the assistant | Tool(s) | Expected result |
|---|---|---|---|
| 1 | "**Using Synchronity, get me a white Christmas cake from Sorella Bakery.**" | `list_sites`, `search_products` | Sorella Bakery is found and a matching cake is returned, with name, price, and **inline image**. |
| 2 | "Show me the details." | `get_product` | Product details, image, and any options/add-ons. |
| 3 | "Add it to a cart." | `create_cart`, `add_to_cart` | A cart is created with the cake and a running total. |
| 4 | "Show my cart." | `get_cart` | Item, quantity, subtotal. |
| 5 | "Make it 2." | `set_cart_quantity` | Line quantity updates to 2; total recalculates. |
| 6 | "Apply the coupon `testcoupon`." | `apply_coupon` | Discount applied; cart total drops. |
| 7 | "Ship to **[name, address, city, country]**." | `set_shipping_address` | Shipping options returned. |
| 8 | "Use the cheapest shipping option." | `select_shipping_option` | Total updates to include shipping. |
| 9 | "Check out." | `request_delegation` → `execute_checkout` | The assistant asks for **buyer approval** before completing — a 6-digit code is emailed to the buyer (see §1). |
| 10 | "The approval code is **[code from email]**." | `submit_delegation_otp` (or `check_delegation`) | Approval succeeds; the order is placed. |
| 11 | "Pay with mobile money." | `get_payment_methods`, `initiate_payment` | A Paystack mobile-money charge starts for MTN number `0551234987` (see §1). |
| 12 | Approve on the phone / enter OTP `123456` if prompted. | `submit_payment_otp`, `get_payment_status` | Payment succeeds; the order is confirmed. |
| 13 | "Show me the order." | `get_order` / `list_orders` | The completed order with status and total. |

### 3a. Also exercise these tools

| Prompt to the assistant | Tool | Expected result |
|---|---|---|
| "Notify me when **[an out-of-stock item]** is back in stock — my email is **[reviewer-buyer@example.com]**." | `request_back_in_stock` | Confirms you'll be emailed when it restocks (records the request for the merchant). |
| Start a new chat, then: "**Using Synchronity, resume my Sorella Bakery cart.**" | `get_active_cart` | The in-progress cart from the flow above is restored (items + total), not a fresh empty cart. |

---

## 4. What we want you to verify

- **Human-in-the-loop:** checkout cannot complete without the buyer-entered approval code (steps 8–9). An agent cannot self-approve.
- **Scoped, safe actions:** read-only tools (search, product, cart view, orders) carry `readOnlyHint`; deletion + payment tools (`remove_from_cart`, `set_cart_quantity`, `execute_checkout`, `initiate_payment`, `submit_payment_otp`) carry `destructiveHint: true`.
- **No raw data dumps:** product/cart/order results render as clean Markdown (with inline product images), not JSON.

---

## 5. Notes & contact

- All payments above use Paystack **test** mode — no real money moves.
- Sensitive data is only shared with the connected store and the payment processor to fulfil the requested action. See the privacy policy: `https://api.synchronity.app/privacy`.
- Questions or issues during review: **hello@themewire.co**.
