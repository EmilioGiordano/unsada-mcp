import { clean, integerParam, load, safeHref } from "./html.js";

export interface CourseGrade {
    courseId?: number;
    course: string;
    grade: string;
}

export interface GradeItem {
    item: string;
    grade?: string;
    range?: string;
    percentage?: string;
    weight?: string;
    feedback?: string;
    url?: string;
}

const GRADE_COLUMNS = [
    "grade",
    "range",
    "percentage",
    "weight",
    "feedback",
] as const satisfies readonly (keyof GradeItem)[];

export function parseGradesOverview(html: string): CourseGrade[] {
    const $ = load(html);
    const grades: CourseGrade[] = [];
    $("table#overview-grade tbody tr").each((_, row) => {
        const link = $(row).find("td.c0 a");
        if (!link.length) return;
        grades.push({
            courseId: integerParam(link.attr("href")),
            course: clean(link.text()),
            grade: clean($(row).find("td.c1").text()),
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
        const item: GradeItem = { item: clean(name.text()), url: safeHref(name.find("a").attr("href")) };
        for (const column of GRADE_COLUMNS) {
            const value = clean(row.find(`td.column-${column}`).text());
            if (value && value !== "-") item[column] = value;
        }
        items.push(item);
    });
    return items;
}
