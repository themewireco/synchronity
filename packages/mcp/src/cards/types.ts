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

/** A selectable product variant (size/colour/etc) for the options wizard. */
export interface ProductCardVariant {
  variantId: string;
  title: string;
  price: string;
  image?: string;
  inStock: boolean;
  /** Human-readable attribute pairs, e.g. [{name:'Size',value:'M'}]. */
  attributes?: Array<{ name: string; value: string }>;
}

export interface ProductCardModel {
  kind: 'product';
  siteId: string;
  productId: string;
  title: string;
  description?: string;
  price: string;
  image?: string;       // first/primary image (markdown fallback uses this)
  images?: string[];    // all images; View renders a carousel when length > 1
  url?: string;
  inStock: boolean;
  addons?: ProductCardAddon[];
  variants?: ProductCardVariant[]; // present → options wizard offers a variant step
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
  image?: string;          // product thumbnail (needs cart-item image_url from backend)
  variantTitle?: string;   // selected variant label, when applicable
  addonsSummary?: string;  // human-readable selected-addons summary, e.g. "Engraving: Gold"
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
