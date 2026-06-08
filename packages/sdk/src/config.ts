import type { SynchronityErrorResponse } from './types/amps.js';

const SDK_VERSION = '0.1.0';
const DEFAULT_BASE_URL = 'https://api.synchronity.app';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 1_000;

export interface SynchronityConfig {
  agentToken: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  onRetry?: (attempt: number, error: Error) => void;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void } | false;
}

interface ResolvedConfig {
  agentToken: string;
  baseUrl: string;
  timeout: number;
  retries: number;
  retryDelay: number;
  onRetry?: (attempt: number, error: Error) => void;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void } | false;
}

export function resolveConfig(config: SynchronityConfig): ResolvedConfig {
  const resolved: ResolvedConfig = {
    agentToken: config.agentToken,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
    retries: config.retries ?? DEFAULT_RETRIES,
    retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY,
    logger: config.logger === false ? false : (config.logger ?? console),
  };
  if (config.onRetry !== undefined) {
    resolved.onRetry = config.onRetry;
  }
  return resolved;
}

export { SDK_VERSION, DEFAULT_BASE_URL };
export type { ResolvedConfig };
export type { SynchronityErrorResponse };
