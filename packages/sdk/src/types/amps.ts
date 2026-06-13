// SynchronityErrorResponse mirrors the AMPSError envelope from the API.
export interface SynchronityErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ─── Monetary ──────────────────────────────────────────────────────────────────

export interface MonetaryAmount {
  /** Decimal string with exactly 2 decimal places, e.g. "19.99" */
  amount: string;
  /** ISO 4217 currency code, e.g. "USD" */
  currency: string;
}

// ─── Product ───────────────────────────────────────────────────────────────────

export type AvailabilityStatus = 'in_stock' | 'out_of_stock' | 'backorder';

export interface AMPSProductAttribute {
  name: string;
  value: string;
}

export interface AMPSProductImage {
  url: string;
  alt?: string;
}

export interface AMPSProductVariant {
  variant_id: string;
  title: string;
  sku?: string;
  price: MonetaryAmount;
  compare_at_price: MonetaryAmount | null;
  availability: AvailabilityStatus;
  stock_quantity: number | null;
  attributes?: AMPSProductAttribute[];
  image_url: string | null;
}

// ─── Add-ons (customer-selectable product options) ──────────────────────────────

export type AddonInputType = 'select' | 'radio' | 'checkbox' | 'boolean' | 'text' | 'number';

export interface AMPSAddonOption {
  value: string;
  label: string;
  price_modifier?: MonetaryAmount; // optional; absent = free
}

export interface AMPSProductAddon {
  addon_id: string; // stable per product
  label: string;
  type: AddonInputType;
  required: boolean;
  multiple: boolean; // true for checkbox / multi-select
  options?: AMPSAddonOption[]; // select/radio/checkbox
  min?: number; // number
  max?: number; // number
  help?: string;
}

export interface AMPSSelectedAddon {
  addon_id: string;
  label: string;
  value: string | string[]; // single value or multi
  price_modifier?: MonetaryAmount; // per-unit, resolved at selection time
}

export interface AMPSProduct {
  product_id: string;
  site_id: string;
  title: string;
  description?: string;
  price: MonetaryAmount;
  compare_at_price: MonetaryAmount | null;
  availability: AvailabilityStatus;
  stock_quantity: number | null;
  sku: string;
  categories: string[];
  tags: string[];
  attributes: AMPSProductAttribute[];
  variants: AMPSProductVariant[];
  image_url: string | null;
  images: AMPSProductImage[];
  url: string | null;
  addons?: AMPSProductAddon[];
  metadata?: Record<string, unknown>;
}

// ─── Cart ──────────────────────────────────────────────────────────────────────

export interface AMPSDiscount {
  code: string;
  description?: string;
  amount: MonetaryAmount;
}

export interface AMPSCartItem {
  item_id: string;
  product_id: string;
  variant_id?: string;
  title: string;
  quantity: number;
  unit_price: MonetaryAmount;
  line_total: MonetaryAmount;
  addons?: AMPSSelectedAddon[];
}

export interface AMPSCart {
  cart_id: string;
  site_id: string;
  items: AMPSCartItem[];
  subtotal: MonetaryAmount;
  discounts?: AMPSDiscount[];
  total: MonetaryAmount;
  currency: string;
  expires_at: string;
  shipping_destination?: AMPSShippingDestination;
  shipping_options?: AMPSShippingOption[];
  selected_shipping_option_id?: string;
  shipping_total?: MonetaryAmount;
}

export interface AMPSShippingDestination {
  country_code: string; // ISO-3166 alpha-2
  postal_code?: string;
  state?: string;
  city?: string;
}

export interface AMPSShippingOption {
  option_id: string;
  title: string;
  description?: string;
  amount: MonetaryAmount;
  estimated_delivery?: string;
}

// ─── Order ─────────────────────────────────────────────────────────────────────

export type AMPSOrderStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export interface AMPSAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  /** ISO 3166-1 alpha-2 country code */
  country_code: string;
  /** Contact phone for this address (E.164 preferred) */
  phone?: string;
}

export interface AMPSOrderItem {
  item_id: string;
  product_id: string;
  variant_id?: string;
  title: string;
  quantity: number;
  unit_price: MonetaryAmount;
  line_total: MonetaryAmount;
}

export interface AMPSOrder {
  order_id: string;
  site_id: string;
  status: AMPSOrderStatus;
  items: AMPSOrderItem[];
  subtotal: MonetaryAmount;
  discounts?: AMPSDiscount[];
  total: MonetaryAmount;
  currency: string;
  shipping_address?: AMPSAddress;
  tracking_number?: string;
  estimated_delivery?: string;
  payment_url?: string; // For pending orders awaiting payment completion
  created_at: string;
  updated_at?: string;
}

// ─── Inline Payments ───────────────────────────────────────────────────────────

export type PaymentChannel = 'mobile_money' | 'card';

export type MobileMoneyProvider = 'mtn' | 'vod' | 'tgo';

export type PaymentStatus =
  | 'pending'
  | 'awaiting_user'
  | 'processing'
  | 'paid'
  | 'failed';

/** Channel-specific instruction the agent renders in chat. */
export type PaymentInstruction =
  | {
      channel: 'mobile_money';
      action: 'approve_on_phone' | 'submit_otp';
      provider: string;
      phone: string;
      reference: string;
      display_text: string;
    }
  | {
      channel: 'card';
      action: 'redirect';
      authorization_url: string;
      reference: string;
    };

export interface PaymentSession {
  order_id: string;
  reference: string;
  channel: PaymentChannel;
  payment_status: PaymentStatus;
  instruction?: PaymentInstruction;
  message?: string;
}

export interface PaymentMethodsResponse {
  channels: PaymentChannel[];
  [key: string]: unknown;
}

// ─── Capability Manifest ───────────────────────────────────────────────────────

export type AMPSPlatform =
  | 'woocommerce'
  | 'shopify'
  | 'magento'
  | 'bigcommerce'
  | 'custom';

export interface AMPSCapabilities {
  product_search: boolean;
  product_compare: boolean;
  cart_management: boolean;
  coupon_support: boolean;
  checkout_execution: boolean;
  order_tracking: boolean;
  real_time_inventory: boolean;
  guest_checkout: boolean;
  authenticated_checkout: boolean;
}

export interface AMPSShippingZone {
  /** ISO 3166-1 alpha-2 country code */
  country_code: string;
  regions?: string[];
}

export interface AMPSRateLimits {
  requests_per_minute: number;
  requests_per_day: number;
}

export interface AMPSCapabilityManifest {
  site_id: string;
  platform: AMPSPlatform;
  platform_version: string;
  agentmesh_version: string;
  capabilities: AMPSCapabilities;
  api_base_url: string;
  supported_currencies: string[];
  shipping_zones: AMPSShippingZone[];
}

// ─── Site ──────────────────────────────────────────────────────────────────────

export interface SiteListItem {
  site_id: string;
  name: string;
  platform: AMPSPlatform;
  api_base_url: string;
  description?: string;
  capabilities?: AMPSCapabilities;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

export type AgentScope =
  | 'read_products'
  | 'manage_cart'
  | 'execute_checkout'
  | 'read_orders';

export interface SiteRegistration {
  agent_name: string;
  scopes: AgentScope[];
  audience?: string;
  ttl?: number;
}

export interface AgentToken {
  agent_id: string;
  token: string;
  expires_at: string;
}

export interface AgentRegistration {
  agent_id: string;
  token: string;
  expires_at: string;
}

export interface BuyerDelegationToken {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

// ─── Request / Response helpers ────────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  has_next: boolean;
}

export interface PaginatedSiteResponse {
  data: SiteListItem[];
  pagination: PaginationMeta;
}

export interface PaginatedProductResponse {
  data: AMPSProduct[];
  pagination: PaginationMeta;
}

export interface PaginatedOrderResponse {
  data: AMPSOrder[];
  pagination: PaginationMeta;
}

export interface CompareProductsRequest {
  site_ids: string[];
  // The gateway expects `query` as an object, not a bare string.
  query: {
    q?: string;
    category?: string;
    max_price?: number;
    in_stock?: boolean;
  };
}

export interface CompareProductsResponse {
  results: Array<{ site_id: string; products: AMPSProduct[] }>;
}

// ─── Reviews & Authenticity ────────────────────────────────────────────────

export interface AMPSReview {
  review_id: string;
  product_id: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title?: string;
  body?: string;
  author?: string;
  verified_purchase: boolean;
  helpful_count?: number;
  unhelpful_count?: number;
  created_at: string;
  updated_at?: string;
  source: 'woocommerce' | 'trustpilot' | 'google' | 'amazon' | 'agentmesh_verified';
  metadata?: Record<string, unknown>;
}

export interface AMPSReviewFlag {
  type: 'unverified_seller' | 'fake_review_spike' | 'recent_negative_trend' | 'outliers_detected';
  severity: 'low' | 'medium' | 'high';
  message: string;
  data?: Record<string, unknown>;
}

export interface AMPSReviewSentiment {
  positive_ratio: number;
  neutral_ratio: number;
  negative_ratio: number;
}

export interface AMPSReviewConsensus {
  product_id: string;
  product?: {
    id: string;
    name: string;
    price: number;
    image_url?: string;
    images?: Array<{ url: string; alt?: string }>;
  };
  average_rating: number;
  total_count: number;
  verified_count: number;
  verified_percentage: number;
  trust_score: number;
  consensus: 'authentic' | 'questionable' | 'flagged';
  sentiment: AMPSReviewSentiment;
  flags: AMPSReviewFlag[];
  recent_reviews: AMPSReview[];
  cached_at: string;
}

export interface CreateCartRequest {
  currency?: string;
}

/** Selected add-ons on add-to-cart: a map of addon_id -> chosen value(s). */
export type AddonSelections = Record<string, string | string[] | boolean | number>;

export interface AddCartItemRequest {
  product_id: string;
  quantity: number;
  variant_id?: string;
  addons?: AddonSelections;
}

export interface ApplyCouponRequest {
  code: string;
}

export interface CheckoutRequest {
  cart_id: string;
  shipping_address: AMPSAddress;
  billing_address?: AMPSAddress;
  customer_email?: string;
  customer_name?: string;
  notes?: string;
}
