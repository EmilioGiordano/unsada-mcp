import { UnsadaError } from "../errors.js";
import { mapLimit } from "../lib/concurrency.js";
import { MAX_CONCURRENT_REQUESTS, type MoodleClient } from "../moodle/client.js";
import { parseCoursePage, type Section } from "../scrape/course-page.js";
import { type CourseSummary, parseDashboardCourses, yearIn } from "../scrape/courses.js";
import { parseGradesOverview } from "../scrape/grades.js";
import { integerParam } from "../scrape/html.js";

const MAX_TABS = 60;

export interface Course {
    id: number;
    name: string;
    sections: Section[];
    truncated?: true;
}

// The dashboard can omit courses from past years; the grades overview lists every course, without category.
export async function listCourses(client: Pick<MoodleClient, "page">): Promise<CourseSummary[]> {
    const [dashboard, grades] = await Promise.all([
        client.page("/my/").then(({ html }) => parseDashboardCourses(html)),
        client.page("/grade/report/overview/index.php").then(({ html }) => parseGradesOverview(html)),
    ]);
    const known = new Set(dashboard.map((course) => course.id));
    const missing = grades.flatMap(({ courseId, course }): CourseSummary[] =>
        courseId === undefined || known.has(courseId) ? [] : [{ id: courseId, name: course, year: yearIn(course) }],
    );
    return [...dashboard, ...missing].sort(
        (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name, "es"),
    );
}

export async function getCourseSection(
    client: Pick<MoodleClient, "page">,
    courseId: number,
    sectionNumber: number,
): Promise<Course> {
    const page = parseCoursePage((await client.page(`/course/view.php?id=${courseId}&section=${sectionNumber}`)).html);
    const sections = page.sections.filter((section) => section.number === sectionNumber);
    if (!sections.length) {
        throw new UnsadaError(
            `Course ${courseId} shows no section ${sectionNumber}. Use unsada_get_course to see its sections.`,
        );
    }
    return { id: courseId, name: page.name, sections };
}

// Courses in the tabbed format (onetopic) show one section per page.
export async function getCourse(client: Pick<MoodleClient, "page">, courseId: number): Promise<Course> {
    const first = parseCoursePage((await client.page(`/course/view.php?id=${courseId}`)).html);
    const sections = new Map(first.sections.map((section) => [section.number, section]));

    const missingTabs = first.otherSectionUrls.filter((url) => !sections.has(integerParam(url, "section") ?? -1));
    const tabs = missingTabs.slice(0, MAX_TABS);
    const pages = await mapLimit(tabs, MAX_CONCURRENT_REQUESTS, async (url) =>
        parseCoursePage((await client.page(url)).html),
    );
    for (const page of pages) {
        for (const section of page.sections) if (!sections.has(section.number)) sections.set(section.number, section);
    }

    return {
        id: courseId,
        name: first.name,
        sections: [...sections.values()]
            .filter((section) => section.summary || section.activities.length)
            .sort((a, b) => a.number - b.number),
        truncated: missingTabs.length > MAX_TABS || undefined,
    };
}
