import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { type FileRead, readClassroomFile } from "../features/files.js";
import type { MoodleClient } from "../moodle/client.js";
import { READ_ONLY, withErrorResult } from "./result.js";
import { classroomUrl } from "./schemas.js";

export function registerFileTools(server: McpServer, client: MoodleClient): void {
    server.registerTool(
        "unsada_read_file",
        {
            description:
                "Reads a classroom file: PDF, Word (docx), PowerPoint (pptx), Excel (xlsx), images and plain text. " +
                "Scanned PDF pages come back as images. Takes the file url (pluginfile.php) or a resource url " +
                "(mod/resource/view.php).\n\n" +
                "The file comes in parts (pages, slides or chunks), as many as fit in one answer. When more remain, " +
                "`next` says where to continue.\n\n" +
                "Formats it cannot read (old .doc or .ppt, .zip, .rar, videos) return an error with the url so the " +
                "user can download the file.",
            inputSchema: z.object({
                url: classroomUrl.describe("File or resource url, as the other tools return it."),
                from: z
                    .number()
                    .int()
                    .min(1)
                    .max(100_000)
                    .optional()
                    .describe("Page, slide or chunk number to start from. Defaults to 1."),
            }),
            annotations: READ_ONLY,
        },
        withErrorResult(async ({ url, from }: { url: string; from?: number }) =>
            fileResult(await readClassroomFile(client, url, from)),
        ),
    );
}

function fileResult({ parts, ...summary }: FileRead): CallToolResult {
    const label = (number: number, title?: string) =>
        `--- ${summary.unit} ${number} of ${summary.total}${title ? ` (${title})` : ""} ---`;
    return {
        content: [
            { type: "text", text: JSON.stringify(summary) },
            ...parts.flatMap((part): CallToolResult["content"] =>
                "text" in part
                    ? [{ type: "text", text: `${label(part.number, part.title)}\n${part.text}` }]
                    : [
                          { type: "text", text: label(part.number, part.title) },
                          { type: "image", data: Buffer.from(part.image).toString("base64"), mimeType: part.mimeType },
                      ],
            ),
        ],
    };
}
