import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { logger } from "./logger.js";
import type { MoodleClient } from "./moodle/client.js";
import { registerTools } from "./tools/index.js";

export const VERSION = "0.1.0";

export function startServer(client: MoodleClient): void {
    serveStdio(
        () => {
            const server = new McpServer({ name: "UNSAdA-MCP", version: VERSION });
            registerTools(server, client);
            return server;
        },
        { onerror: (error) => logger.error(error.message) },
    );
    logger.info("MCP server running on stdio");
}
