import type { MoodleClient } from "../moodle/client.js";
import { type CourseGrade, type GradeItem, parseGradesOverview, parseUserGrades } from "../scrape/grades.js";

export type Grades = { courses: CourseGrade[] } | { courseId: number; items: GradeItem[] };

export async function getGrades(client: Pick<MoodleClient, "page">, courseId?: number): Promise<Grades> {
    if (courseId === undefined) {
        return { courses: parseGradesOverview((await client.page("/grade/report/overview/index.php")).html) };
    }
    const { html } = await client.page(`/grade/report/user/index.php?id=${courseId}`);
    return { courseId, items: parseUserGrades(html) };
}
