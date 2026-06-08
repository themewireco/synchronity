// Public API surface for @synchronity/sdk

export { Synchronity } from './client.js';
export type { SynchronityConfig } from './config.js';

export {
  SynchronityError,
  SynchronityAuthError,
  SynchronityForbiddenError,
  SynchronityNotFoundError,
  SynchronityRateLimitError,
  SynchronityValidationError,
  SynchronityUnprocessableError,
  SynchronityServerError,
  parseErrorResponse,
} from './errors.js';

export type {
  // Monetary
  MonetaryAmount,
  // Product
  AvailabilityStatus,
  AMPSProductAttribute,
  AMPSProductImage,
  AMPSProductVariant,
  AMPSProduct,
  // Add-ons
  AddonInputType,
  AMPSAddonOption,
  AMPSProductAddon,
  AMPSSelectedAddon,
  AddonSelections,
  // Cart
  AMPSDiscount,
  AMPSCartItem,
  AMPSCart,
  // Order
  AMPSOrderStatus,
  AMPSAddress,
  AMPSOrderItem,
  AMPSOrder,
  // Payments
  PaymentChannel,
  MobileMoneyProvider,
  PaymentStatus,
  PaymentInstruction,
  PaymentSession,
  PaymentMethodsResponse,
  // Manifest
  AMPSPlatform,
  AMPSCapabilities,
  AMPSShippingZone,
  AMPSRateLimits,
  AMPSCapabilityManifest,
  // Site
  SiteListItem,
  // Auth
  AgentScope,
  SiteRegistration,
  AgentToken,
  AgentRegistration,
  BuyerDelegationToken,
  // Pagination
  PaginationMeta,
  // Requests / Responses
  SynchronityErrorResponse,
} from './types/amps.js';

export type {
  ListSitesParams,
  SearchProductsParams,
  CheckoutParams,
  ShippingAddressParams,
  ListOrdersParams,
  AddItemParams,
  InitiatePaymentParams,
  SubmitOtpParams,
} from './modules/index.js';
