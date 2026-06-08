import type { HttpClient } from '../http.js';
import type {
  AMPSCapabilityManifest,
  PaginatedSiteResponse,
  SiteListItem,
} from '../types/amps.js';

export interface ListSitesParams {
  category?: string;
  /** ISO 3166-1 alpha-2 country code */
  ships_to?: string;
  /** Capability flags to filter by */
  capabilities?: string[];
  page?: number;
  limit?: number;
}

export class DiscoveryModule {
  constructor(private readonly http: HttpClient) {}

  async listSites(
    params?: ListSitesParams,
  ): Promise<{ sites: SiteListItem[]; total: number; page: number }> {
    const query: Record<string, string | number | boolean | string[]> = {};

    if (params?.category !== undefined) query['category'] = params.category;
    if (params?.ships_to !== undefined) query['ships_to'] = params.ships_to;
    if (params?.capabilities !== undefined) query['capabilities'] = params.capabilities;
    if (params?.page !== undefined) query['page'] = params.page;
    if (params?.limit !== undefined) query['limit'] = params.limit;

    const response = await this.http.get<PaginatedSiteResponse>('/v1/sites', query);

    return {
      sites: response.data,
      total: response.pagination.total,
      page: response.pagination.page,
    };
  }

  async getManifest(siteId: string): Promise<AMPSCapabilityManifest> {
    return this.http.get<AMPSCapabilityManifest>(`/v1/sites/${siteId}/manifest`);
  }
}
