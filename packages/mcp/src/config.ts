/**
 * Synchronity MCP Server Configuration with Auto-Registration & Token Refresh
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface MCPServerConfig {
  /**
   * Synchronity Gateway URL (e.g., "https://api.agentmesh.com")
   * Defaults to GATEWAY_URL environment variable
   */
  gatewayUrl?: string;

  /**
   * Agent Integration Token (AIT) for authentication
   * Defaults to AIT environment variable or auto-registered token
   */
  ait?: string;

  /**
   * Server mode: "stdio" for CLI/desktop, "http" for network servers
   * Defaults to "stdio"
   */
  mode?: 'stdio' | 'http';

  /**
   * HTTP server port (only used if mode === 'http')
   * Defaults to 3000
   */
  port?: number;

  /**
   * Request timeout in milliseconds
   * Defaults to 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Enable debug logging
   * Defaults to false
   */
  debug?: boolean;
}

interface CachedTokenData {
  token: string;
  expiresAt: number;
}

const TOKEN_DIR = join(homedir(), '.agentmesh');
const TOKEN_FILE = join(TOKEN_DIR, 'token');

/**
 * Read cached token from ~/.agentmesh/token
 * Returns null if token doesn't exist, is corrupted, or is expired
 */
function readCachedToken(): string | null {
  try {
    const data = readFileSync(TOKEN_FILE, 'utf-8').trim();
    
    // Try parsing as JSON (new format with expiry)
    try {
      const tokenData = JSON.parse(data) as CachedTokenData;
      
      // Check if token is expired (with 5-minute buffer)
      if (tokenData.expiresAt && tokenData.expiresAt - 300000 < Date.now()) {
        return null; // Token expired
      }
      
      return tokenData.token;
    } catch {
      // Fallback: treat as plain token string (old format)
      return data;
    }
  } catch {
    return null;
  }
}

/**
 * Save token to ~/.agentmesh/token with expiry metadata
 */
function saveCachedToken(token: string, expiresInMs: number = 86400000): void {
  try {
    mkdirSync(TOKEN_DIR, { recursive: true });
    
    const tokenData: CachedTokenData = {
      token,
      expiresAt: Date.now() + expiresInMs,
    };
    
    writeFileSync(TOKEN_FILE, JSON.stringify(tokenData), { mode: 0o600 });
  } catch (error) {
    // Silently fail - token will be re-registered on next start
  }
}

/**
 * Validate token with gateway
 * Returns true if token is valid, false if expired/invalid
 */
async function validateToken(token: string, gatewayUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${gatewayUrl}/v1/auth/agents/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });

    return response.ok && response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Attempt to refresh token with gateway
 * Returns new token if successful, null if refresh fails
 */
async function refreshToken(token: string, gatewayUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${gatewayUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { ait?: string; token?: string };
    return data.ait || data.token || null;
  } catch {
    return null;
  }
}

/**
 * Auto-register with gateway and get AIT token
 */
async function autoRegister(gatewayUrl: string): Promise<string> {
  try {
    const url = `${gatewayUrl}/v1/auth/agents/register`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: 'Claude',
        scopes: ['read_products', 'manage_cart', 'execute_checkout', 'read_orders'],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Registration failed (${response.status}): ${(error as any).error?.message || response.statusText}`);
    }

    const data = (await response.json()) as { token: string; agent_id: string };
    const token = data.token;
    
    saveCachedToken(token);
    
    return token;
  } catch (error) {
    throw new Error(`Failed to auto-register: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get MCP server configuration with intelligent token management:
 * 1. Try environment variable
 * 2. Try cached token (if valid/not expired)
 * 3. Try to refresh expired token
 * 4. Fall back to auto-register
 */
export async function getConfig(overrides?: Partial<MCPServerConfig>): Promise<MCPServerConfig> {
  const gatewayUrl = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
  
  let ait = process.env.AIT;

  // Priority 1: Environment variable
  if (ait) {
    const config: MCPServerConfig = {
      gatewayUrl,
      ait,
      mode: 'stdio',
      port: 3000,
      timeout: 30000,
      debug: process.env.DEBUG === 'true',
      ...overrides,
    };
    return config;
  }

  // Priority 2: Try cached token
  const cachedToken = readCachedToken();
  if (cachedToken) {
    // Validate token is actually working
    const isValid = await validateToken(cachedToken, gatewayUrl);
    if (isValid) {
      ait = cachedToken;
    } else {
      // Cached token is invalid, try to refresh it
      const refreshedToken = await refreshToken(cachedToken, gatewayUrl);
      if (refreshedToken) {
        saveCachedToken(refreshedToken);
        ait = refreshedToken;
      }
      // If refresh fails, continue to auto-register below
    }
  }

  // Priority 3: Auto-register if no valid token
  if (!ait) {
    ait = await autoRegister(gatewayUrl);
  }

  const config: MCPServerConfig = {
    gatewayUrl,
    ait,
    mode: 'stdio',
    port: 3000,
    timeout: 30000,
    debug: process.env.DEBUG === 'true',
    ...overrides,
  };

  if (!config.ait) {
    throw new Error(
      'Failed to obtain AIT token. Set AIT environment variable or check gateway connectivity.',
    );
  }

  return config;
}

