import { clean, integerParam, load } from "./html.js";

export interface CourseSummary {
    id: number;
    name: string;
    category?: string;
    year?: number;
}

export function parseDashboardCourses(html: string): CourseSummary[] {
    const $ = load(html);
    const courses: CourseSummary[] = [];
    $("div.coursebox").each((_, box) => {
        const link = $(box).find(".course_title a").first();
        const id = integerParam(link.attr("href"));
        if (id === undefined) return;
        const category = clean($(box).find(".categorypath").text());
        courses.push({
            id,
            name: clean(link.text()),
            category: category || undefined,
            year: yearIn(category) ?? yearIn(link.text()),
        });
    });
    return courses;
}

export function yearIn(text: string): number | undefined {
    const year = text.match(/\b(20\d{2})\b/)?.[1];
    return year ? Number(year) : undefined;
}
