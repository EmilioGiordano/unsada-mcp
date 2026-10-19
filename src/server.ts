import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { logger } from "./logger.js";
import type { MoodleClient } from "./moodle/client.js";
import { registerTools } from "./tools/index.js";

// package.json sits one level above both src/ and build/, and npm always ships it.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
};

export function startServer(client: MoodleClient): void {
    serveStdio(
        () => {
            const server = new McpServer({ name: "UNSAdA-MCP", version });
            registerTools(server, client);
            return server;
        },
        { onerror: (error) => logger.error(error.message) },
    );
    logger.info("MCP server running on stdio");
}
