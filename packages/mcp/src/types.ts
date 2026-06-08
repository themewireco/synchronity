/**
 * Shared types for MCP Server
 */

export interface MCPToolRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export type MCPTextContent = { type: 'text'; text: string };
export type MCPImageContent = { type: 'image'; data: string; mimeType: string };
export type MCPResourceContent = {
  type: 'resource';
  resource: { uri: string; mimeType: string; text: string };
  _meta?: Record<string, unknown>;
};
export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent;

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    uri?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPErrorResponse {
  error: {
    code: string;
    message: string;
    data?: Record<string, unknown>;
  };
}
