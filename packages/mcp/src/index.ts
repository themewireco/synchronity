#!/usr/bin/env node
/**
 * Synchronity MCP Server
 *
 * Main entry point for the MCP server.
 * Run with: agentmesh-mcp or node dist/index.js
 *
 * Environment Variables:
 *   GATEWAY_URL - Synchronity Gateway URL (default: https://api.agentmesh.com)
 *   AIT - Agent Integration Token (required)
 *   DEBUG - Enable debug logging (set to "true")
 */

import { startServer } from './server.js';

// Start the MCP server
startServer().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
