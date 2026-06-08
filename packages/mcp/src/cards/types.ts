// sdk/mcp/src/cards/types.ts
export interface CardAction {
  label: string;
  toolName: string;                 // Synchronity MCP tool to call
  params: Record<string, unknown>;  // pre-filled params (UI may merge in user input)
}

export interface ProductCardAddonOption {
  value: string;
  label: string;
  priceModifier?: string;  // pre-formatted, e.g. "+$5.00"
}

export interface ProductCardAddon {
  addonId: string;
  label: string;
  type: string;            // select | radio | checkbox | boolean | text | number
  required: boolean;
  options?: ProductCardAddonOption[];
  help?: string;
}

export interface ProductCardModel {
  kind: 'product';
  siteId: string;
  productId: string;
  title: string;
  price: string;
  image?: string;
  url?: string;
  inStock: boolean;
  addons?: ProductCardAddon[];
  addToCart: CardAction;
}

export interface ProductListItem {
  productId: string;
  title: string;
  price: string;
  image?: string;
  url?: string;
  inStock: boolean;
  addToCart: CardAction;
}

export interface ProductListCardModel {
  kind: 'productList';
  siteId: string;
  products: ProductListItem[];
}

export interface CartLine {
  itemId: string;
  title: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
  removeAction?: CardAction;
}

export interface CartCardModel {
  kind: 'cart';
  siteId: string;
  cartId: string;
  items: CartLine[];
  subtotal: string;
  total: string;
}

export interface ShippingChoice {
  optionId: string;
  label: string;
  description?: string;
  cost: string;
}

export interface CheckoutCardModel {
  kind: 'checkout';
  siteId: string;
  cartId: string;
  items: CartLine[];
  shippingOptions: ShippingChoice[];
  selectedShippingId?: string;
  subtotal: string;
  shipping?: string;
  total: string;
}

export interface DelegationCardModel {
  kind: 'delegation';
  deviceCode: string;
  userCode: string;
  siteName: string;
  scopes: string[];
  approvalUrl: string;
  otpEntry: boolean;   // true when email-OTP flow is active
}

export type CardModel =
  | ProductCardModel
  | ProductListCardModel
  | CartCardModel
  | CheckoutCardModel
  | DelegationCardModel;

import type { MCPContent } from '../types.js';

/** A tool result that can carry an Apps SDK widget: content blocks + structuredContent + result-level _meta. */
export interface CardToolResult {
  content: MCPContent[];
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
}
