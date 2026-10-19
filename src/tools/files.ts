import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { Picture } from "../documents/document.js";
import { type FileRead, fileReader } from "../features/files.js";
import type { MoodleClient } from "../moodle/client.js";
import { READ_ONLY, withErrorResult } from "./result.js";
import { classroomUrl } from "./schemas.js";

export function registerFileTools(server: McpServer, client: MoodleClient): void {
    const readFile = fileReader(client);
    server.registerTool(
        "unsada_read_file",
        {
            description:
                "Reads a classroom file: PDF, Word (docx), PowerPoint (pptx), Excel (xlsx), images and plain text. " +
                "Scanned PDF pages come back as images; figures on PDF pages with text are counted in the page label " +
                "and returned only with `figures`. Takes the file url (pluginfile.php) or a resource url " +
                "(mod/resource/view.php).\n\n" +
                "The file comes in parts (pages, slides or chunks), as many as fit in one answer. When more remain, " +
                "`next` says where to continue. A damaged part comes back as an `unreadable` note and five in a row " +
                "end the answer; when the first parts of a file are all damaged, the read is an error.\n\n" +
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
                figures: z
                    .boolean()
                    .optional()
                    .describe(
                        "PDF only: also return the figures of each page as one cropped image. Read without it first; " +
                            "ask for them when a page label says figures were not shown and they matter.",
                    ),
            }),
            annotations: READ_ONLY,
        },
        withErrorResult(async ({ url, from, figures }: { url: string; from?: number; figures?: boolean }) =>
            fileResult(await readFile(url, from, figures)),
        ),
    );
}

type ReadPart = FileRead["parts"][number];

function fileResult({ parts, ...summary }: FileRead): CallToolResult {
    const label = (part: ReadPart) => {
        const notes = [part.title, figureNote(part)].filter(Boolean).join(", ");
        return `--- ${summary.unit} ${part.number} of ${summary.total}${notes ? ` (${notes})` : ""} ---`;
    };
    return {
        content: [
            { type: "text", text: JSON.stringify(summary) },
            ...parts.flatMap((part): CallToolResult["content"] => {
                const picture = "text" in part ? part.figureImage : part;
                return [
                    {
                        type: "text",
                        text: "text" in part ? `${label(part)}\n${part.text}` : label(part),
                    },
                    ...(picture ? [imageContent(picture)] : []),
                ];
            }),
        ],
    };
}

const imageContent = ({ image, mimeType }: Picture) => ({
    type: "image" as const,
    data: Buffer.from(image).toString("base64"),
    mimeType,
});

function figureNote(part: ReadPart): string | undefined {
    if (!("text" in part) || !part.figures) return undefined;
    const count = part.figures === 1 ? "1 figure" : `${part.figures} figures`;
    return part.figureImage ? `${count}, shown below` : `${count} not shown`;
}
