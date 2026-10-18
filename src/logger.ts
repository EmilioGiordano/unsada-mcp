const write = (level: string, message: string) => console.error(`[unsada-mcp]${level} ${message}`);

export const logger = {
    info: (message: string) => write("", message),
    warn: (message: string) => write(" WARN", message),
    error: (message: string) => write(" ERROR", message),
};
