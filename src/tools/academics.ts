import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { listAssignments } from "../features/assignments.js";
import { getCalendar } from "../features/calendar.js";
import { getGrades } from "../features/grades.js";
import type { MoodleClient } from "../moodle/client.js";
import { jsonTool, READ_ONLY } from "./result.js";
import { courseId } from "./schemas.js";

export function registerAcademicTools(server: McpServer, client: MoodleClient): void {
    server.registerTool(
        "unsada_list_assignments",
        {
            description:
                "The assignments (mod/assign) of a course, with due date in Argentina time (ISO 8601), the user's " +
                "`submission` state and grade; quizzes are not assignments and appear in unsada_get_course. Teachers " +
                "get `submissionsReceived` instead. For the instructions and feedback, open the `url` with unsada_open.",
            inputSchema: z.object({ courseId }),
            annotations: READ_ONLY,
        },
        jsonTool(({ courseId }: { courseId: number }) => listAssignments(client, courseId)),
    );

    server.registerTool(
        "unsada_get_grades",
        {
            description:
                "The user's grades. Without `courseId`: the total grade of each course. With `courseId`: every graded " +
                "item of the course with grade, range, percentage and feedback.",
            inputSchema: z.object({ courseId: courseId.optional() }),
            annotations: READ_ONLY,
        },
        jsonTool(({ courseId }: { courseId?: number }) => getGrades(client, courseId)),
    );

    server.registerTool(
        "unsada_get_calendar",
        {
            description:
                "Classroom calendar events: assignment due dates, quiz closings, exams and course events, in " +
                "Argentina time and in order, with the course and the activity `url` when there is one. `truncated` " +
                "means the range had too many days with events; ask for a shorter one.",
            inputSchema: z.object({
                daysAhead: z.number().int().min(1).max(365).optional().describe("How many days ahead. Defaults to 30."),
                daysBack: z.number().int().min(0).max(30).optional().describe("Also include past days. Defaults to 0."),
            }),
            annotations: READ_ONLY,
        },
        jsonTool(({ daysAhead, daysBack }: { daysAhead?: number; daysBack?: number }) =>
            getCalendar(client, daysAhead ?? 30, daysBack ?? 0),
        ),
    );
}
