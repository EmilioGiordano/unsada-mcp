import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { download } from "../features/downloads.js";
import type { MoodleClient } from "../moodle/client.js";
import { jsonTool } from "./result.js";
import { classroomUrl } from "./schemas.js";

export function registerDownloadTools(server: McpServer, client: MoodleClient): void {
    server.registerTool(
        "unsada_download",
        {
            description:
                "Downloads classroom files to the user's disk, any file type. Takes file urls (pluginfile.php), " +
                "resources (mod/resource/view.php) and folders (mod/folder/view.php, saved in a subfolder named " +
                "after the folder). Existing files are never overwritten: one of the same size is skipped and " +
                "any other gets a ` (2)` suffix. Returns the absolute `directory` and each file's `path` inside it.",
            inputSchema: z.object({
                urls: z.array(classroomUrl).min(1).max(50).describe("Urls as the other tools return them."),
                directory: z
                    .string()
                    .min(1)
                    .max(240)
                    .describe(
                        'Destination, relative to the directory the client was opened in, e.g. "Bases de Datos/Unidad 1". ' +
                            "Created if missing. Absolute paths work only inside UNSADA_DOWNLOAD_ROOTS.",
                    ),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        jsonTool(({ urls, directory }: { urls: string[]; directory: string }) => download(client, urls, directory)),
    );
}
