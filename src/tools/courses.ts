import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { getCourse, listCourses } from "../features/courses.js";
import type { MoodleClient } from "../moodle/client.js";
import { jsonTool, READ_ONLY } from "./result.js";
import { courseId } from "./schemas.js";

export function registerCourseTools(server: McpServer, client: MoodleClient): void {
    server.registerTool(
        "unsada_list_courses",
        {
            description:
                "Lists the user's courses in the UNSAdA virtual classroom, newest school year first. This is the " +
                "starting point: the `id` of each course is used by the other tools. It includes courses from past " +
                "years; when the user asks about current ones, use those of the latest `year`.",
            annotations: READ_ONLY,
        },
        jsonTool(() => listCourses(client)),
    );

    server.registerTool(
        "unsada_get_course",
        {
            description:
                "The content of a course: its sections (weeks, units or tabs) with their activities and resources. " +
                "Labels (`module: label`) carry only their text, which often holds the schedule, class times and " +
                "meeting links. Sections without summary or activities are left out. Each activity has a `url` to " +
                "open with unsada_open; `restricted` gives the condition that blocks it, `hidden` marks what students " +
                "do not see, and `textTruncated` means unsada_open has the full text.",
            inputSchema: z.object({ courseId }),
            annotations: READ_ONLY,
        },
        jsonTool(({ courseId }: { courseId: number }) => getCourse(client, courseId)),
    );
}
