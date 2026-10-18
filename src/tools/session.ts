import type { McpServer } from "@modelcontextprotocol/server";
import type { MoodleClient } from "../moodle/client.js";
import { jsonTool } from "./result.js";

export function registerSessionTools(server: McpServer, client: MoodleClient): void {
    server.registerTool(
        "unsada_login",
        {
            description:
                "Opens a browser window so the user can sign in to the classroom with Google. Use it only when " +
                "another tool said a sign-in is needed and the user cannot see the window, or when the user asks to " +
                "switch accounts.",
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        jsonTool(async () => {
            await client.signIn("toolBudget");
            return { signedIn: true };
        }),
    );
}
