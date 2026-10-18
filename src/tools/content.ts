import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { open } from "../features/content.js";
import type { MoodleClient } from "../moodle/client.js";
import { jsonTool, READ_ONLY } from "./result.js";
import { classroomUrl } from "./schemas.js";

export function registerContentTools(server: McpServer, client: MoodleClient): void {
    server.registerTool(
        "unsada_open",
        {
            description:
                "Opens a classroom url and returns its content by `kind`: a forum with its discussions, a discussion " +
                "with all its posts, a page with its text, a folder with its files, an assignment with its " +
                "instructions, submission status and feedback, an external link, or a file. The urls come from the " +
                "`url` fields of the other tools. Files (PDF, Word, etc.) are read with unsada_read_file.",
            inputSchema: z.object({
                url: classroomUrl.describe(
                    'Classroom url, e.g. "https://moodle.unsada.edu.ar/mod/forum/view.php?id=94428".',
                ),
                page: z
                    .number()
                    .int()
                    .min(0)
                    .max(1000)
                    .optional()
                    .describe(
                        "Forums only: page of the discussion list. The answer sets `hasMorePages` when there are more.",
                    ),
            }),
            annotations: READ_ONLY,
        },
        jsonTool(({ url, page }: { url: string; page?: number }) => open(client, url, page)),
    );
}
