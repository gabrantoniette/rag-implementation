import { readFileSync } from 'node:fs';
import { type CallToolResult, Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { PROJECT_ROOT, projectPath } from '../core/paths.js';

export interface McpServerSpec {
  command: string;
  args: string[];
}

export interface McpSession {
  /** Milliseconds from spawning the server to the end of the first tools/list. */
  startMs: number;
  tools: { name: string; inputSchema: unknown }[];
  calls: { tool: string; ms: number; ok: boolean }[];
  call(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ result: CallToolResult; ms: number }>;
  /** The last 4 KB the server wrote to stderr, for failure reports. */
  stderr(): string;
  close(): Promise<void>;
}

/** The MCP servers declared in .mcp.json, so the harness starts exactly what agents start. */
export function readMcpConfig(file = projectPath('.mcp.json')): Record<string, McpServerSpec> {
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as {
    mcpServers: Record<string, McpServerSpec>;
  };
  return cfg.mcpServers;
}

/** Spawns a server over stdio, connects the official MCP client and lists its tools. */
export async function openMcp(
  name: string,
  spec: McpServerSpec,
  env: Record<string, string> = {},
): Promise<McpSession> {
  const started = performance.now();
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args,
    cwd: PROJECT_ROOT,
    env: { ...baseEnv, ...env },
    stderr: 'pipe',
  });
  let stderrTail = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4096);
  });
  const client = new Client({ name: `rag-mcp-eval-${name}`, version: '1.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const startMs = Math.round(performance.now() - started);
  const calls: McpSession['calls'] = [];
  return {
    startMs,
    tools: tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })),
    calls,
    async call(tool, args) {
      const t0 = performance.now();
      try {
        const result = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
        const ms = Math.round(performance.now() - t0);
        calls.push({ tool, ms, ok: !result.isError });
        return { result, ms };
      } catch (error) {
        calls.push({ tool, ms: Math.round(performance.now() - t0), ok: false });
        throw error;
      }
    },
    stderr: () => stderrTail,
    close: () => client.close(),
  };
}
