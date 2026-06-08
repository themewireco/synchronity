import type { HttpClient } from '../http.js';
import type { AMPSOrder, PaginatedOrderResponse } from '../types/amps.js';

export interface ListOrdersParams {
  page?: number;
  limit?: number;
  status?: 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded';
}

export class OrdersModule {
  constructor(private readonly http: HttpClient) {}

  async get(siteId: string, orderId: string): Promise<AMPSOrder> {
    return this.http.get<AMPSOrder>(`/v1/sites/${siteId}/orders/${orderId}`);
  }

  async list(
    siteId: string,
    params?: ListOrdersParams,
  ): Promise<{ orders: AMPSOrder[]; total: number }> {
    const query: Record<string, string | number | boolean> = {};

    if (params?.page !== undefined) query['page'] = params.page;
    if (params?.limit !== undefined) query['limit'] = params.limit;
    if (params?.status !== undefined) query['status'] = params.status;

    const response = await this.http.get<PaginatedOrderResponse>(
      `/v1/sites/${siteId}/orders`,
      query,
    );

    return {
      orders: response.data,
      total: response.pagination.total,
    };
  }
}
