import {
    clean,
    type FileLink,
    type Fragment,
    fileLinks,
    type Html,
    integerParam,
    load,
    mainRegion,
    richText,
    safeHref,
} from "./html.js";

export interface AssignmentSummary {
    section: string;
    name: string;
    id?: number;
    url?: string;
    dueDate: string;
    submission: string;
    grade: string;
}

export interface Assignment {
    title: string;
    instructions?: string;
    instructionFiles: FileLink[];
    status: Record<string, string>;
    submittedFiles: FileLink[];
    feedback?: Record<string, string>;
    feedbackFiles?: FileLink[];
}

interface LabelledTable {
    fields: Record<string, string>;
    files: FileLink[];
}

export function parseAssignmentIndex(html: string): AssignmentSummary[] {
    const $ = load(html);
    const assignments: AssignmentSummary[] = [];
    let section = "";
    mainRegion($)
        .find("table.generaltable tbody tr")
        .each((_, row) => {
            const cells = $(row).find("td");
            if (cells.length < 5) return;
            section = clean(cells.eq(0).text()) || section;
            const link = cells.eq(1).find("a").first();
            assignments.push({
                section,
                name: clean(cells.eq(1).text()),
                id: integerParam(link.attr("href")),
                url: safeHref(link.attr("href")),
                dueDate: clean(cells.eq(2).text()),
                submission: clean(cells.eq(3).text()),
                grade: clean(cells.eq(4).text()),
            });
        });
    return assignments;
}

export function parseAssignment(html: string): Assignment {
    const $ = load(html);
    const main = mainRegion($);
    const intro = main.find("#intro").first();
    const status = labelledTable($, main.find(".submissionstatustable table").first());
    const feedback = labelledTable($, main.find(".feedback table").first());
    return {
        title: clean(main.find("h2").first().text()),
        instructions: richText($, intro) || undefined,
        instructionFiles: fileLinks($, intro),
        status: status.fields,
        submittedFiles: status.files,
        feedback: Object.keys(feedback.fields).length ? feedback.fields : undefined,
        feedbackFiles: feedback.files.length ? feedback.files : undefined,
    };
}

function labelledTable($: Html, table: Fragment): LabelledTable {
    const fields: Record<string, string> = {};
    const files: FileLink[] = [];
    table.find("tr").each((_, row) => {
        const label = clean($(row).find("td.c0").text());
        if (!label) return;
        const value = $(row).find("td.c1").first().clone();
        // Long comments render twice: a summary and the full text, hidden until expanded.
        if (value.find("[class*='full_']").length) value.find("[class*='summary_']").remove();
        files.push(...fileLinks($, value));
        value.find("[id^='assign_files_tree']").remove();
        const text = richText($, value);
        if (text) fields[label] = text;
    });
    return { fields, files };
}
