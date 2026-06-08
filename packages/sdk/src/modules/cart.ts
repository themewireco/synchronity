import type { HttpClient } from '../http.js';
import type { AMPSCart, AddonSelections } from '../types/amps.js';

export interface AddItemParams {
  product_id: string;
  quantity: number;
  variant_id?: string;
  /** Selected add-ons as a map of addon_id -> chosen value(s). */
  addons?: AddonSelections;
}

export class CartModule {
  constructor(private readonly http: HttpClient) {}

  async create(siteId: string, currency?: string): Promise<AMPSCart> {
    const body = currency ? { currency } : {};
    return this.http.post<AMPSCart>(`/v1/sites/${siteId}/cart`, body);
  }

  async get(siteId: string, cartId: string): Promise<AMPSCart> {
    return this.http.get<AMPSCart>(`/v1/sites/${siteId}/cart/${cartId}`);
  }

  async addItem(
    siteId: string,
    cartId: string,
    item: AddItemParams,
  ): Promise<AMPSCart> {
    return this.http.post<AMPSCart>(
      `/v1/sites/${siteId}/cart/${cartId}/items`,
      item,
    );
  }

  async removeItem(
    siteId: string,
    cartId: string,
    itemId: string,
  ): Promise<AMPSCart> {
    return this.http.delete<AMPSCart>(
      `/v1/sites/${siteId}/cart/${cartId}/items/${itemId}`,
    );
  }

  async applyCoupon(
    siteId: string,
    cartId: string,
    code: string,
  ): Promise<AMPSCart> {
    return this.http.post<AMPSCart>(
      `/v1/sites/${siteId}/cart/${cartId}/coupon`,
      { code },
    );
  }

  async setShippingAddress(
    siteId: string,
    cartId: string,
    destination: { country_code: string; postal_code?: string; state?: string; city?: string },
  ): Promise<AMPSCart> {
    return this.http.put<AMPSCart>(`/v1/sites/${siteId}/cart/${cartId}/shipping-address`, destination);
  }

  async selectShippingOption(siteId: string, cartId: string, optionId: string): Promise<AMPSCart> {
    return this.http.post<AMPSCart>(`/v1/sites/${siteId}/cart/${cartId}/shipping-option`, { option_id: optionId });
  }
}
