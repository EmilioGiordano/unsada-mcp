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
import { dateOrText, numberOrText } from "./values.js";

export type SubmissionState = "submitted" | "draft" | "notSubmitted" | "noOnlineSubmission";
export type GradingState = "graded" | "notGraded";

export interface AssignmentSummary {
    section: string;
    name: string;
    id?: number;
    url?: string;
    dueDate?: string;
    submission?: SubmissionState;
    submissionsReceived?: number;
    submissionText?: string;
    grade?: number | string;
}

export interface SubmissionStatus {
    state?: SubmissionState;
    grading?: GradingState;
    dueDate?: string;
    extendedDueDate?: string;
    lastModified?: string;
    timeRemaining?: string;
    group?: string;
    onlineText?: string;
    comments?: string;
    gradingCriteria?: string;
    otherFields?: Record<string, string>;
}

export interface Feedback {
    grade?: number | string;
    maxGrade?: number;
    gradedAt?: string;
    gradedBy?: string;
    comments?: string;
    otherFields?: Record<string, string>;
}

export interface Assignment {
    title: string;
    instructions?: string;
    instructionFiles: FileLink[];
    submission: SubmissionStatus;
    submittedFiles: FileLink[];
    feedback?: Feedback;
    feedbackFiles?: FileLink[];
}

interface LabelledTable {
    fields: Map<string, string>;
    files: FileLink[];
}

const SUBMISSION_STATES: Record<string, SubmissionState> = {
    "Enviado para calificar": "submitted",
    "Borrador (no enviado)": "draft",
    "No entregado": "notSubmitted",
    "No se ha enviado nada en esta tarea": "notSubmitted",
    "Sin entrega": "noOnlineSubmission",
};

const GRADING_STATES: Record<string, GradingState> = {
    Calificado: "graded",
    "Sin calificar": "notGraded",
};

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
            const submission = clean(cells.eq(3).text());
            // Teachers see how many students submitted instead of their own state.
            const received = /^\d+$/.test(submission) ? Number(submission) : undefined;
            const state = SUBMISSION_STATES[submission];
            assignments.push({
                section,
                name: clean(cells.eq(1).text()),
                id: integerParam(link.attr("href")),
                url: safeHref(link.attr("href")),
                dueDate: dateOrText(clean(cells.eq(2).text())),
                submission: state,
                submissionsReceived: received,
                submissionText: state || received !== undefined || !submission ? undefined : submission,
                grade: numberOrText(clean(cells.eq(4).text())),
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
        submission: submissionStatus(status.fields),
        submittedFiles: status.files,
        feedback: feedback.fields.size ? feedbackOf(feedback.fields) : undefined,
        feedbackFiles: feedback.files.length ? feedback.files : undefined,
    };
}

function submissionStatus(fields: Map<string, string>): SubmissionStatus {
    const take = takeFrom(fields);
    return {
        state: take("Estado de la entrega", (text) => SUBMISSION_STATES[text]),
        grading: take("Estado de la calificación", (text) => GRADING_STATES[text]),
        dueDate: take("Fecha de entrega", dateOrText),
        extendedDueDate: take("Ampliar plazo", dateOrText),
        lastModified: take("Última modificación", dateOrText),
        timeRemaining: take("Tiempo restante"),
        group: take("Grupo"),
        onlineText: take("Texto en línea"),
        comments: take("Comentarios de la entrega"),
        gradingCriteria: take("Criterios de calificación"),
        otherFields: otherFields(fields),
    };
}

function feedbackOf(fields: Map<string, string>): Feedback {
    const take = takeFrom(fields);
    const [grade, maxGrade] = take("Calificación", (text) => text.split(" / "))?.map(numberOrText) ?? [];
    return {
        grade,
        maxGrade: typeof maxGrade === "number" ? maxGrade : undefined,
        gradedAt: take("Calificado sobre", dateOrText),
        gradedBy: take("Calificado por"),
        comments: take("Comentarios de retroalimentación"),
        otherFields: otherFields(fields),
    };
}

// A field is taken out only when its value is understood; the rest stay in `otherFields`.
function takeFrom(fields: Map<string, string>) {
    function take(label: string): string | undefined;
    function take<T>(label: string, read: (text: string) => T | undefined): T | undefined;
    function take<T>(label: string, read?: (text: string) => T | undefined): T | string | undefined {
        const text = fields.get(label);
        if (text === undefined) return undefined;
        const value = read ? read(text) : text;
        if (value !== undefined) fields.delete(label);
        return value;
    }
    return take;
}

const otherFields = (fields: Map<string, string>) => (fields.size ? Object.fromEntries(fields) : undefined);

function labelledTable($: Html, table: Fragment): LabelledTable {
    const fields = new Map<string, string>();
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
        if (text && text !== "-") fields.set(label, text);
    });
    return { fields, files };
}
