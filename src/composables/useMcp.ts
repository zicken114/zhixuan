import { invoke } from '@tauri-apps/api/core';

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  transport: { type: 'stdio' } | { type: 'websocket'; port: number };
  auto_start: boolean;
  timeout_ms: number;
  enabled: boolean;
}

export interface McpServerStatus {
  name: string;
  status: 'Starting' | 'Running' | 'Error' | 'Stopped';
  error_message?: string;
}

export interface McpTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  server_name: string;
  enabled: boolean;
  permission_level: 'always_allow' | 'ask_user' | 'never_allow';
}

export async function listMcpServers(): Promise<McpServerStatus[]> {
  return invoke('mcp_list_servers');
}

export async function startMcpServer(config: McpServerConfig): Promise<void> {
  return invoke('mcp_start_server', { config });
}

export async function stopMcpServer(name: string): Promise<void> {
  return invoke('mcp_stop_server', { server_name: name });
}

export async function restartMcpServer(name: string): Promise<void> {
  return invoke('mcp_restart_server', { server_name: name });
}

export async function listMcpTools(): Promise<McpTool[]> {
  return invoke('mcp_list_tools');
}

export async function toggleMcpTool(toolName: string, enabled: boolean): Promise<void> {
  return invoke('mcp_toggle_tool', { toolName, enabled });
}

export async function setMcpToolPermission(toolName: string, permission: string): Promise<void> {
  return invoke('mcp_set_tool_permission', { toolName, permission });
}

export async function getMcpServersDir(): Promise<string> {
  return invoke('mcp_get_servers_dir');
}
