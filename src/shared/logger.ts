// Todo a stderr: en STDIO, stdout es el canal del protocolo MCP.
export const logger = {
    info: (...args: unknown[]) => console.error("[unsada-mcp]", ...args),
    warn: (...args: unknown[]) => console.error("[unsada-mcp] WARN", ...args),
    error: (...args: unknown[]) => console.error("[unsada-mcp] ERROR", ...args),
};
