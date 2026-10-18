import * as z from "zod";

export const courseId = z
    .number()
    .int()
    .positive()
    .max(9_999_999_999)
    .describe("Course id, as unsada_list_courses returns it.");

export const classroomUrl = z.string().min(1).max(2048);
