import { clean, integerParam, load, safeHref } from "./html.js";
import { numberOrText } from "./values.js";

export interface CourseGrade {
    courseId?: number;
    course: string;
    grade?: number | string;
}

export interface GradeItem {
    item: string;
    grade?: number | string;
    range?: string;
    percentage?: number | string;
    weight?: number | string;
    feedback?: string;
    url?: string;
}

export function parseGradesOverview(html: string): CourseGrade[] {
    const $ = load(html);
    const grades: CourseGrade[] = [];
    $("table#overview-grade tbody tr").each((_, row) => {
        const link = $(row).find("td.c0 a");
        if (!link.length) return;
        grades.push({
            courseId: integerParam(link.attr("href")),
            course: clean(link.text()),
            grade: numberOrText(clean($(row).find("td.c1").text())),
        });
    });
    return grades;
}

export function parseUserGrades(html: string): GradeItem[] {
    const $ = load(html);
    const items: GradeItem[] = [];
    $("table.user-grade tbody tr").each((_, element) => {
        const row = $(element);
        if (!row.find("td.column-grade").length) return;
        const name = row.find(".column-itemname").first().clone();
        name.find(".gradeitemdescription, .gradeitemdescriptionfiller, .accesshide").remove();
        const column = (name: string) => clean(row.find(`td.column-${name}`).text());
        items.push({
            item: clean(name.text()),
            grade: numberOrText(column("grade")),
            range: column("range") || undefined,
            percentage: numberOrText(column("percentage")),
            weight: numberOrText(column("weight")),
            feedback: column("feedback") || undefined,
            url: activityUrl(name.find("a").attr("href")),
        });
    });
    return items;
}

// Grade items link to mod/<module>/grade.php with the user's id; view.php opens the same activity.
function activityUrl(href: string | undefined): string | undefined {
    const url = safeHref(href);
    const id = integerParam(url);
    const activity = url?.match(/^(.*\/mod\/[a-z0-9]+\/)grade\.php\?/);
    return activity && id !== undefined ? `${activity[1]}view.php?id=${id}` : url;
}
