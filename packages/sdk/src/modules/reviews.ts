import type { HttpClient } from '../http.js';
import type { AMPSReviewConsensus } from '../types/amps.js';

export class ReviewsModule {
  constructor(private readonly http: HttpClient) {}

  async getProductReviews(
    siteId: string,
    productId: string,
    params?: { limit?: number; page?: number }
  ): Promise<AMPSReviewConsensus> {
    const query: Record<string, string | number> = {};
    if (params?.limit !== undefined) query['limit'] = params.limit;
    if (params?.page !== undefined) query['page'] = params.page;

    return this.http.get<AMPSReviewConsensus>(
      `/v1/sites/${siteId}/products/${productId}/reviews`,
      query
    );
  }
}
