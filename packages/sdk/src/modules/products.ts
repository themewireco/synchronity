import type { HttpClient } from '../http.js';
import type {
  AMPSProduct,
  CompareProductsRequest,
  CompareProductsResponse,
  PaginatedProductResponse,
} from '../types/amps.js';

export interface SearchProductsParams {
  q?: string;
  category?: string;
  min_price?: number;
  max_price?: number;
  in_stock?: boolean;
  page?: number;
  limit?: number;
}

export class ProductsModule {
  constructor(private readonly http: HttpClient) {}

  async search(
    siteId: string,
    params?: SearchProductsParams,
  ): Promise<{
    products: AMPSProduct[];
    total: number;
    page: number;
    total_pages: number;
  }> {
    const query: Record<string, string | number | boolean> = {};

    if (params?.q !== undefined) query['q'] = params.q;
    if (params?.category !== undefined) query['category'] = params.category;
    if (params?.min_price !== undefined) query['min_price'] = params.min_price;
    if (params?.max_price !== undefined) query['max_price'] = params.max_price;
    if (params?.in_stock !== undefined) query['in_stock'] = params.in_stock;
    if (params?.page !== undefined) query['page'] = params.page;
    if (params?.limit !== undefined) query['limit'] = params.limit;

    const response = await this.http.get<PaginatedProductResponse>(
      `/v1/sites/${siteId}/products`,
      query,
    );

    const { page, limit, total } = response.pagination;
    const total_pages = limit > 0 ? Math.ceil(total / limit) : 1;

    return {
      products: response.data,
      total,
      page,
      total_pages,
    };
  }

  async getById(siteId: string, productId: string): Promise<AMPSProduct> {
    return this.http.get<AMPSProduct>(`/v1/sites/${siteId}/products/${productId}`);
  }

  async compare(
    siteIds: string[],
    query: SearchProductsParams,
  ): Promise<{ results: Array<{ site_id: string; products: AMPSProduct[] }> }> {
    const filters: CompareProductsRequest['filters'] = {};
    if (query.min_price !== undefined) filters.min_price = query.min_price;
    if (query.max_price !== undefined) filters.max_price = query.max_price;
    if (query.in_stock !== undefined) filters.in_stock = query.in_stock;

    const body: CompareProductsRequest = {
      query: query.q ?? '',
      site_ids: siteIds,
    };
    if (Object.keys(filters).length > 0) {
      body.filters = filters;
    }

    return this.http.post<CompareProductsResponse>('/v1/multi/products/compare', body);
  }
}
