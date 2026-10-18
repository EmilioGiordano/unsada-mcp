import type { CallToolResult } from "@modelcontextprotocol/server";
import { UnsadaError } from "../errors.js";
import { logger } from "../logger.js";

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

export const jsonResult = (data: unknown): CallToolResult => ({
    content: [{ type: "text", text: JSON.stringify(data) }],
});

export function errorResult(error: unknown): CallToolResult {
    if (error instanceof UnsadaError) return { content: [{ type: "text", text: error.message }], isError: true };
    logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return {
        content: [{ type: "text", text: "Unexpected error in unsada-mcp; the details are in its log." }],
        isError: true,
    };
}

export function withErrorResult<A>(run: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
    return async (args) => {
        try {
            return await run(args);
        } catch (error) {
            return errorResult(error);
        }
    };
}

export const jsonTool = <A>(run: (args: A) => Promise<unknown>) =>
    withErrorResult(async (args: A) => jsonResult(await run(args)));
