import type { HttpClient } from '../http.js';
import type { AMPSOrder, PaginatedOrderResponse } from '../types/amps.js';

export interface ListOrdersParams {
  page?: number;
  limit?: number;
  status?: 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded';
}

export class OrdersModule {
  constructor(private readonly http: HttpClient) {}

  async get(siteId: string, orderId: string, delegationToken?: string): Promise<AMPSOrder> {
    // Orders are buyer-private: the gateway binds reads to the buyer's identity.
    // Pass the buyer's delegation token so the agent can read its own order.
    const path = `/v1/sites/${siteId}/orders/${orderId}`;
    return delegationToken
      ? this.http.get<AMPSOrder>(path, undefined, { 'X-Buyer-Delegation-Token': delegationToken })
      : this.http.get<AMPSOrder>(path);
  }

  async list(
    siteId: string,
    params?: ListOrdersParams,
    delegationToken?: string,
  ): Promise<{ orders: AMPSOrder[]; total: number }> {
    const query: Record<string, string | number | boolean> = {};

    if (params?.page !== undefined) query['page'] = params.page;
    if (params?.limit !== undefined) query['limit'] = params.limit;
    if (params?.status !== undefined) query['status'] = params.status;

    const path = `/v1/sites/${siteId}/orders`;
    const response = delegationToken
      ? await this.http.get<PaginatedOrderResponse>(path, query, { 'X-Buyer-Delegation-Token': delegationToken })
      : await this.http.get<PaginatedOrderResponse>(path, query);

    return {
      orders: response.data,
      total: response.pagination.total,
    };
  }
}
