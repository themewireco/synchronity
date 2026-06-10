import { resolveConfig, SDK_VERSION } from './config.js';
import { parseErrorResponse } from './errors.js';
import type { SynchronityConfig, ResolvedConfig } from './config.js';
import type { SynchronityErrorResponse } from './types/amps.js';

export class HttpClient {
  private readonly config: ResolvedConfig;
  private lastRequestId: string | undefined;
  private currentToken: string; // Mutable token storage for refresh

  constructor(config: SynchronityConfig) {
    this.config = resolveConfig(config);
    this.currentToken = this.config.agentToken;
  }

  get requestId(): string | undefined {
    return this.lastRequestId;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | string[]>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>('GET', url, undefined, 0, extraHeaders);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>('POST', url, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>('PUT', url, body);
  }

  async delete<T>(path: string): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>('DELETE', url, undefined);
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | string[]>,
  ): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const url = new URL(`${base}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          // Serialise array params as comma-separated (OpenAPI style: explode: false)
          url.searchParams.set(key, value.join(','));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async request<T>(
    method: string,
    url: string,
    body: unknown,
    attempt = 0,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.currentToken}`,
      'User-Agent': `@synchronity/sdk/${SDK_VERSION}`,
      Accept: 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;
    }

    let response: any;

    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    this.lastRequestId = response.headers.get('X-AgentMesh-Request-Id') ?? undefined;

    if (response.ok) {
      // 204 No Content
      if (response.status === 204) {
        return undefined as unknown as T;
      }
      return response.json() as Promise<T>;
    }

    // ── Error handling ──────────────────────────────────────────────────────────

    let errorBody: SynchronityErrorResponse;
    try {
      errorBody = (await response.json()) as SynchronityErrorResponse;
    } catch {
      errorBody = {
        error: {
          code: 'UNKNOWN_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
        },
      };
    }

    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

    // ── Retry logic ─────────────────────────────────────────────────────────────

    const shouldRetry =
      attempt < this.config.retries &&
      (response.status === 429 || response.status >= 500 || response.status === 401);

    if (shouldRetry) {
      let delay: number;

      if (response.status === 429 && retryAfterSeconds !== undefined) {
        delay = retryAfterSeconds * 1000;
      } else if (response.status === 401 && attempt === 0) {
        // On first 401, attempt token refresh
        try {
          await this.refreshToken();
          delay = 100; // Brief delay before retry
        } catch (err) {
          if (this.config.logger) {
            this.config.logger.warn(
              `[Synchronity] Token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          delay = 100;
        }
      } else {
        // Exponential backoff: 1s, 2s, 4s, …
        delay = this.config.retryDelay * Math.pow(2, attempt);
      }

      const error = parseErrorResponse(response.status, errorBody, this.lastRequestId, retryAfterSeconds);

      if (this.config.logger) {
        this.config.logger.warn(
          `[Synchronity] Retrying request (attempt ${attempt + 1}/${this.config.retries}) after ${delay}ms — ${error.message}`,
        );
      }

      this.config.onRetry?.(attempt + 1, error);

      await sleep(delay);
      return this.request<T>(method, url, body, attempt + 1, extraHeaders);
    }

    throw parseErrorResponse(response.status, errorBody, this.lastRequestId, retryAfterSeconds);
  }

  private async refreshToken(): Promise<void> {
    // Attempt to refresh the agent token at the gateway
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.currentToken}` },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { token: string };
      // Store refreshed token for use in subsequent requests
      this.currentToken = data.token;
    } catch (err) {
      // If refresh fails, let the caller handle it (could be expired delegation token, etc)
      throw err;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
