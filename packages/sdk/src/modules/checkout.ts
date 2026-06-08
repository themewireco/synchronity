import type { HttpClient } from '../http.js';
import type { AMPSAddress, AMPSOrder } from '../types/amps.js';

export interface ShippingAddressParams {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface CheckoutParams {
  cart_id: string;
  buyer_delegation_token: string;
  shipping_address: ShippingAddressParams;
  customer_name?: string;
  customer_email?: string;
  notes?: string;
}

export class CheckoutModule {
  constructor(private readonly http: HttpClient) {}

  async execute(siteId: string, params: CheckoutParams): Promise<AMPSOrder> {
    // Map the SDK's shipping_address shape (with `name` and `country`) to
    // the AMPSAddress shape the Gateway expects (`country_code`, no `name`).
    const address: AMPSAddress & { name?: string } = {
      line1: params.shipping_address.line1,
      city: params.shipping_address.city,
      country_code: params.shipping_address.country,
      state: params.shipping_address.state,
      postal_code: params.shipping_address.postal_code,
      name: params.shipping_address.name,
    };

    if (params.shipping_address.line2 !== undefined) {
      address.line2 = params.shipping_address.line2;
    }

    return this.http.post<AMPSOrder>(`/v1/sites/${siteId}/checkout`, {
      cart_id: params.cart_id,
      buyer_delegation_token: params.buyer_delegation_token,
      shipping_address: address,
      ...(params.customer_name && { customer_name: params.customer_name }),
      ...(params.customer_email && { customer_email: params.customer_email }),
      ...(params.notes && { notes: params.notes }),
    });
  }
}
