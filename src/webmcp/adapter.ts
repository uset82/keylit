type ToolExecute = (input: Record<string, unknown>) => Promise<unknown> | unknown;

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: ToolExecute;
};

type ModelContextLike = {
  registerTool: (
    tool: ToolDefinition,
    options?: { signal?: AbortSignal },
  ) => Promise<void> | void;
  getTools?: () => Promise<RegisteredTool[]>;
  executeTool?: (tool: RegisteredTool, input?: Record<string, unknown>) => Promise<unknown>;
  addEventListener?: (type: string, listener: () => void) => void;
};

export type RegisteredTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

const controller = new AbortController();

export const getModelContext = (): ModelContextLike | null => {
  const doc = document as Document & { modelContext?: ModelContextLike };
  const nav = navigator as Navigator & { modelContext?: ModelContextLike };
  return doc.modelContext ?? nav.modelContext ?? null;
};

export const bootWebMcp = async (): Promise<ModelContextLike | null> => {
  try {
    const { initializeWebMCPPolyfill } = await import("@mcp-b/webmcp-polyfill");
    initializeWebMCPPolyfill();
  } catch {
    /* native or unavailable */
  }
  return getModelContext();
};

export const registerTools = async (tools: ToolDefinition[]): Promise<number> => {
  const ctx = getModelContext();
  if (!ctx?.registerTool) return 0;
  let count = 0;
  for (const tool of tools) {
    try {
      await ctx.registerTool(tool, { signal: controller.signal });
      count += 1;
    } catch {
      /* native WebMCP can exist but block registration (Permissions-Policy / SecurityError) */
    }
  }
  return count;
};

export const listTools = async (): Promise<RegisteredTool[]> => {
  const ctx = getModelContext();
  if (!ctx?.getTools) return [];
  return ctx.getTools();
};

export const runTool = async (
  name: string,
  input: Record<string, unknown> = {},
): Promise<unknown> => {
  const ctx = getModelContext();
  const tools = await listTools();
  const tool = tools.find((item) => item.name === name);
  if (!tool || !ctx?.executeTool) {
    const local = pendingLocal.get(name);
    if (local) return local(input);
    throw new Error(`Tool not available: ${name}`);
  }
  return ctx.executeTool(tool, input);
};

const pendingLocal = new Map<string, ToolExecute>();

export const rememberLocal = (tools: ToolDefinition[]): void => {
  tools.forEach((tool) => pendingLocal.set(tool.name, tool.execute));
};

export const runLocal = async (
  name: string,
  input: Record<string, unknown> = {},
): Promise<unknown> => {
  const execute = pendingLocal.get(name);
  if (!execute) throw new Error(`Unknown tool: ${name}`);
  return execute(input);
};
