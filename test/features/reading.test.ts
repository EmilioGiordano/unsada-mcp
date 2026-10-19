import { afterEach, describe, expect, it, vi } from "vitest";
import { getCalendar } from "../../src/features/calendar.js";
import { open } from "../../src/features/content.js";
import { getCourse, listCourses } from "../../src/features/courses.js";
import { getGrades } from "../../src/features/grades.js";
import type { ClassroomResponse } from "../../src/moodle/client.js";
import { fixture } from "../fixture.js";

const keyOf = (input: string) => {
    const url = new URL(input, "https://moodle.unsada.edu.ar");
    return url.pathname + url.search;
};

function pageClient(pages: Record<string, string>) {
    const requested: string[] = [];
    const page = vi.fn(async (input: string) => {
        const key = keyOf(input);
        requested.push(key);
        const html = pages[key];
        if (html === undefined) throw new Error(`unexpected request ${key}`);
        return { url: new URL(input, "https://moodle.unsada.edu.ar"), html };
    });
    const get = vi.fn(async (input: string): Promise<ClassroomResponse> => ({ kind: "page", ...(await page(input)) }));
    return { page, get, requested };
}

describe("listCourses", () => {
    it("adds past courses that only the grades overview knows, newest year first", async () => {
        const client = pageClient({
            "/my/": fixture("dashboard.html"),
            "/grade/report/overview/index.php": fixture("grades.html"),
        });
        expect(await listCourses(client)).toEqual([
            { id: 101, name: "Matemática Ejemplo I", category: "Carrera Ejemplo / 2026", year: 2026 },
            { id: 102, name: "Programación Ficticia 2025", category: "Carrera Ejemplo", year: 2025 },
            { id: 103, name: "Historia Inventada 2024", year: 2024 },
        ]);
    });
});

describe("getCourse", () => {
    it("fetches each missing tab once and drops empty sections", async () => {
        const tab = `<body class="format-onetopic"><h1>Matemática Ejemplo I</h1><ul class="topics">
            <li id="section-1" class="section main"><div class="summary"><p>Conjuntos</p></div></li></ul></body>`;
        const client = pageClient({
            "/course/view.php?id=101": fixture("course-onetopic.html"),
            "/course/view.php?id=101&section=1": tab,
        });
        const course = await getCourse(client, 101);
        expect(course.sections.map((section) => section.number)).toEqual([0, 1]);
        expect(client.requested).toEqual(["/course/view.php?id=101", "/course/view.php?id=101&section=1"]);
        expect(course.truncated).toBeUndefined();
    });
});

describe("open a course url", () => {
    it("reads only the section the url names", async () => {
        const client = pageClient({ "/course/view.php?id=101&section=0": fixture("course-onetopic.html") });
        const course = await open(client, "/course/view.php?id=101&section=0");
        expect(course).toMatchObject({ kind: "course", id: 101, name: "Matemática Ejemplo I" });
        expect(course.kind === "course" && course.sections.map((section) => section.number)).toEqual([0]);
        expect(client.requested).toEqual(["/course/view.php?id=101&section=0"]);
    });
});

describe("getCalendar", () => {
    afterEach(() => vi.useRealTimers());

    it("reads only the days with events and dates them in Argentina", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-14T12:00:00-03:00"));
        const client = pageClient({
            [`/calendar/view.php?view=month&time=${Date.UTC(2026, 9, 15) / 1000}`]: fixture("calendar-month.html"),
            "/calendar/view.php?view=day&time=1792033200": fixture("calendar-day.html"),
        });
        const calendar = await getCalendar(client, 7, 0);
        expect(calendar.events[0]).toMatchObject({ date: "Thu 2026-10-15", time: "23:59", courseId: 101 });
        expect(client.requested).toHaveLength(2);
    });
});

describe("getGrades", () => {
    it("reads the overview or one course", async () => {
        const client = pageClient({
            "/grade/report/overview/index.php": fixture("grades.html"),
            "/grade/report/user/index.php?id=101": fixture("grades.html"),
        });
        expect(await getGrades(client)).toMatchObject({ courses: [{ courseId: 101 }, { courseId: 103 }] });
        expect(await getGrades(client, 101)).toMatchObject({ courseId: 101, items: [{ item: "TP 1" }, {}, {}] });
    });
});

describe("open", () => {
    it("picks the reader by page kind", async () => {
        const client = pageClient({
            "/mod/forum/view.php?id=2001": fixture("forum.html"),
            "/mod/forum/view.php?id=2001&page=1": fixture("forum.html"),
            "/mod/forum/discuss.php?d=501": fixture("discussion.html"),
            "/mod/folder/view.php?id=7": fixture("folder.html"),
            "/mod/assign/view.php?id=3001": fixture("assignment.html"),
        });
        expect(await open(client, "/mod/forum/view.php?id=2001")).toMatchObject({ kind: "forum", hasMorePages: true });
        expect(await open(client, "/mod/forum/view.php?id=2001", 1)).toMatchObject({ kind: "forum" });
        expect(await open(client, "/mod/forum/discuss.php?d=501")).toMatchObject({ kind: "discussion" });
        expect(await open(client, "/mod/folder/view.php?id=7")).toMatchObject({ kind: "folder" });
        expect(await open(client, "/mod/assign/view.php?id=3001")).toMatchObject({ kind: "assignment" });
        expect(client.requested).toContain("/mod/forum/view.php?id=2001&page=1");
    });

    it("hands files to unsada_read_file without downloading them", async () => {
        const client = pageClient({});
        expect(await open(client, "/pluginfile.php/1/mod_resource/content/1/apunte.pdf")).toMatchObject({
            kind: "file",
            name: "apunte.pdf",
        });
        expect(client.requested).toEqual([]);
    });

    it("refuses pages it has no reader for", async () => {
        await expect(open(pageClient({}), "/grade/report/overview/index.php")).rejects.toThrow(/does not read/);
    });
});
