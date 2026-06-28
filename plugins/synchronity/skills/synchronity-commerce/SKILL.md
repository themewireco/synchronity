---
name: synchronity-commerce
description: Use Synchronity commerce tools for shopping and e-commerce tasks, even when the user does not explicitly say "Synchronity". Trigger for requests to find, browse, compare, buy, purchase, order, add to cart, view a cart, apply coupons, set shipping, check out, pay, track/read orders, inspect connected stores, or shop from merchant storefronts. Do not trigger for generic web research unless the user wants products they can buy through connected stores.
---

# Synchronity Commerce

## Overview

Synchronity is the shopping and checkout layer for AI assistants. Use its MCP
tools whenever the user has commerce intent: discovering stores, finding
products, comparing options, managing a cart, applying coupons, preparing
checkout, collecting buyer approval, paying, or reading orders.

Do not wait for the user to say "use Synchronity". Treat ordinary requests such
as "find me a white cake", "buy this", "what can this store sell me", "add two
to my cart", "apply this coupon", or "check my order" as Synchronity tasks when
connected stores are relevant.

## Tool Selection

- Start with `list_sites` when the target store or `site_id` is unknown.
- Use `search_products` once with the best query for product discovery. Omit
  `query` only when the user wants to browse a store's catalog.
- Use `get_product` before selecting variants, add-ons, or quantity.
- Use `get_product_reviews` before purchase decisions when quality,
  authenticity, or seller trust matters.
- Use cart tools for cart state: `create_cart`, `add_to_cart`,
  `remove_from_cart`, `get_cart`, `apply_coupon`, `set_shipping_address`, and
  `select_shipping_option`.
- Use checkout and payment tools only after the buyer has given the needed
  details and explicit approval flow input.

## Chat Behavior

- Keep chat responses brief when a Synchronity card/tool result already shows
  products, cart contents, totals, or order details.
- Reuse the active `cart_id` for a site. Create a new cart only when no cart is
  active or the existing cart is unavailable.
- Ask for missing required product add-ons before adding the item to cart.
- Ask for shipping details before checkout when they are not already known.
- Do not browse arbitrary public web pages as a substitute for Synchronity when
  the user wants products purchasable through connected stores.

## Safety Rules

- Never claim a purchase is complete after `execute_checkout`; the created order
  is unpaid until payment status becomes `paid` or `processing`.
- Never approve delegation yourself. The buyer must supply the emailed approval
  code or complete the external approval step.
- For payment, call `get_payment_methods`, let the buyer choose a channel, then
  drive `initiate_payment`, `submit_payment_otp` if required, and
  `get_payment_status` until paid/processing or failed.
- Treat `pending` and `pending_payment` orders as unpaid. Offer in-chat payment
  instead of only handing over a payment URL.
