import { describe, expect, it } from "vitest";
import { parseAssignment, parseAssignmentIndex } from "../../src/scrape/assign.js";
import { parseDayEvents, parseMonthEvents } from "../../src/scrape/calendar.js";
import { parseCoursePage } from "../../src/scrape/course-page.js";
import { parseDashboardCourses } from "../../src/scrape/courses.js";
import { parseErrorPage } from "../../src/scrape/error-page.js";
import { parseDiscussion, parseForum } from "../../src/scrape/forum.js";
import { parseGradesOverview, parseUserGrades } from "../../src/scrape/grades.js";
import { findResourceFile, parseContentPage, parseFolder } from "../../src/scrape/modules.js";
import { fixture } from "../fixture.js";

describe("parseDashboardCourses", () => {
    it("reads id, name, category and year, skipping courses without a valid id", () => {
        expect(parseDashboardCourses(fixture("dashboard.html"))).toEqual([
            { id: 101, name: "Matemática Ejemplo I", category: "Carrera Ejemplo / 2026", year: 2026 },
            { id: 102, name: "Programación Ficticia 2025", category: "Carrera Ejemplo", year: 2025 },
        ]);
    });
});

describe("parseCoursePage", () => {
    const course = parseCoursePage(fixture("course-onetopic.html"));

    it("reads the course name, format and unique tab urls", () => {
        expect(course.name).toBe("Matemática Ejemplo I");
        expect(course.format).toBe("onetopic");
        expect(course.otherSectionUrls).toHaveLength(2);
    });

    it("reads labels as text, skips image-only labels and links activities", () => {
        expect(course.sections[0]?.activities).toEqual([
            { module: "label", id: 2000, text: "Horario de cursada\nLunes 18 a 22 hs" },
            {
                module: "forum",
                name: "Novedades",
                id: 2001,
                url: "https://moodle.example/mod/forum/view.php?id=2001",
            },
            {
                module: "resource",
                name: "Programa de la materia",
                id: 2002,
                url: "https://moodle.example/mod/resource/view.php?id=2002",
                fileType: "pdf",
                text: "Versión 2026",
            },
            {
                module: "assign",
                name: "Recuperatorio del parcial",
                id: 2003,
                text: "Subir la resolución completa.",
                restricted: "No disponible hasta que: se pertenezca al grupo Recuperatorio",
            },
            {
                module: "folder",
                name: "Borradores",
                id: 2004,
                url: "https://moodle.example/mod/folder/view.php?id=2004",
                hidden: true,
            },
        ]);
    });

    it("flags text cut to fit", () => {
        const long = "x".repeat(700);
        const html =
            '<li id="section-1" class="section main"><ul><li class="activity page modtype_page" id="module-7">' +
            '<div class="activityinstance"><a href="/mod/page/view.php?id=7"><span class="instancename">Guía</span></a></div>' +
            `<div class="contentafterlink"><p>${long}</p></div></li></ul></li>`;
        const [activity] = parseCoursePage(html).sections[0]?.activities ?? [];
        expect(activity).toMatchObject({ textTruncated: true });
        expect(activity?.text?.length).toBeLessThan(long.length);
    });

    it("keeps link targets in summaries", () => {
        expect(course.sections[0]?.summary).toContain("el aula externa (https://example.org/aula)");
    });
});

describe("parseCoursePage in the topics format", () => {
    it("reads every section from one page and names them by heading", () => {
        const course = parseCoursePage(fixture("course-topics.html"));
        expect(course.format).toBe("topics");
        expect(course.otherSectionUrls).toEqual([]);
        expect(course.sections.map((section) => [section.number, section.name])).toEqual([
            [0, "General"],
            [1, "Unidad 1: Cinemática"],
        ]);
        expect(course.sections[1]?.activities).toEqual([
            {
                module: "page",
                name: "Guía de lectura",
                id: 4001,
                url: "https://moodle.example/mod/page/view.php?id=4001",
            },
            { module: "url", name: "Simulador", id: 4002, url: "https://moodle.example/mod/url/view.php?id=4002" },
        ]);
    });
});

describe("grades", () => {
    it("reads the overview", () => {
        expect(parseGradesOverview(fixture("grades.html"))).toEqual([
            { courseId: 101, course: "Matemática Ejemplo I", grade: "8,00" },
            { courseId: 103, course: "Historia Inventada 2024", grade: "-" },
        ]);
    });

    it("reads items without their descriptions or hidden labels", () => {
        const items = parseUserGrades(fixture("grades.html"));
        expect(items.map((item) => item.item)).toEqual(["TP 1", "Total del curso"]);
        expect(items[0]).toMatchObject({
            grade: "7,00",
            range: "0–10",
            percentage: "70,00 %",
            feedback: "Bien resuelto",
        });
        expect(items[1]?.weight).toBeUndefined();
    });
});

describe("forum", () => {
    it("reads discussions and the next page", () => {
        const forum = parseForum(fixture("forum.html"), 0);
        expect(forum.title).toBe("Novedades");
        expect(forum.hasMorePages).toBe(true);
        expect(forum.discussions[0]).toMatchObject({
            id: 501,
            title: "Cambio de aula",
            author: "Docente Ejemplo",
            replies: 3,
        });
    });

    it("has no next page from the last one", () => {
        expect(parseForum(fixture("forum.html"), 1).hasMorePages).toBeUndefined();
    });

    it("reads posts without scripts or session links", () => {
        const discussion = parseDiscussion(fixture("discussion.html"));
        expect(discussion.posts).toHaveLength(2);
        const [first, second] = discussion.posts;
        expect(first).toMatchObject({ id: 901, author: "Docente Ejemplo", date: "2026-10-05T10:00-03:00" });
        expect(first?.text).not.toContain("alert");
        expect(first?.text).not.toContain("sesskey");
        expect(first?.attachments).toEqual([
            { name: "plano.pdf", url: "https://moodle.example/pluginfile.php/1/mod_forum/attachment/901/plano.pdf" },
        ]);
        expect(second?.text).toBe("Gracias <profe>");
    });
});

describe("assignments", () => {
    it("reads the index, carrying the section down", () => {
        const assignments = parseAssignmentIndex(fixture("assignment-index.html"));
        expect(assignments.map((a) => [a.section, a.id])).toEqual([
            ["Unidad 1", 3001],
            ["Unidad 1", 3002],
        ]);
    });

    it("reads due dates, submission states and grades as values", () => {
        const [first, second] = parseAssignmentIndex(fixture("assignment-index.html"));
        expect(first).toMatchObject({ dueDate: "2026-10-16T23:59-03:00", submissionText: "Enviado", grade: 7 });
        expect(second).toMatchObject({ submission: "notSubmitted", grade: undefined });
    });

    it("gives teachers the number of submissions received", () => {
        const row = (submission: string) =>
            '<div id="region-main"><table class="generaltable"><tbody><tr><td>Unidad 1</td>' +
            '<td><a href="/mod/assign/view.php?id=5">TP</a></td><td>-</td>' +
            `<td>${submission}</td><td>-</td></tr></tbody></table></div>`;
        expect(parseAssignmentIndex(row("18"))[0]).toMatchObject({ submissionsReceived: 18, dueDate: undefined });
        expect(parseAssignmentIndex(row("Sin entrega"))[0]?.submission).toBe("noOnlineSubmission");
    });

    it("reads status, files and the full feedback comment", () => {
        const assignment = parseAssignment(fixture("assignment.html"));
        expect(assignment.title).toBe("TP 1: Conjuntos");
        expect(assignment.instructionFiles.map((file) => file.name)).toEqual(["consigna.pdf"]);
        expect(assignment.submittedFiles.map((file) => file.name)).toEqual(["entrega.docx"]);
        expect(assignment.submission).toEqual({ state: "submitted", dueDate: "2026-10-16T23:59-03:00" });
        expect(assignment.feedback).toEqual({
            grade: 7,
            maxGrade: 10,
            comments: "Bien resuelto, revisar el ejercicio 3.",
        });
    });
});

describe("calendar", () => {
    it("reads event ids and day starts from the month view", () => {
        expect(parseMonthEvents(fixture("calendar-month.html"))).toEqual([
            { id: 801, dayStart: 1792033200 },
            { id: 802, dayStart: 1792033200 },
        ]);
    });

    it("reads day events", () => {
        const [event, holiday] = parseDayEvents(fixture("calendar-day.html"));
        expect(event).toMatchObject({ id: 801, title: "TP 1: Conjuntos vence", time: "23:59", courseId: 101 });
        expect(holiday).toMatchObject({ id: undefined, title: "Feriado" });
    });
});

describe("modules", () => {
    it("reads folder files with their paths", () => {
        expect(parseFolder(fixture("folder.html")).files.map((file) => file.path)).toEqual([
            "Unidad 1/apunte.pdf",
            "guia de ejercicios.docx",
        ]);
    });

    it("reads a page with its files and modification date", () => {
        const page = parseContentPage(fixture("page.html"));
        expect(page).toMatchObject({
            title: "Guía de lectura",
            modified: "2026-10-05T09:00-03:00",
        });
        expect(page.text).toContain("Leer el capítulo 2");
        expect(page.files).toEqual([
            { name: "capítulo 2", url: "https://moodle.example/pluginfile.php/7/mod_page/content/1/capitulo%202.pdf" },
        ]);
    });

    it("finds a resource file but never a session link", () => {
        expect(
            findResourceFile(
                '<div id="region-main"><a href="/pluginfile.php/1/x.pdf?sesskey=abc">a</a><a href="/pluginfile.php/1/y.pdf">b</a></div>',
            ),
        ).toBe("/pluginfile.php/1/y.pdf");
    });

    it("finds an image resource shown inline", () => {
        expect(
            findResourceFile(
                '<div id="region-main"><img src="/pluginfile.php/1/mod_resource/content/1/foto.jpg"></div>',
            ),
        ).toBe("/pluginfile.php/1/mod_resource/content/1/foto.jpg");
    });
});

describe("session links", () => {
    it("never come out as activity urls", () => {
        const html =
            '<li id="section-1" class="section main"><ul><li class="activity forum modtype_forum">' +
            '<div class="activityinstance"><a href="/course/mod.php?sesskey=FAKESESSKEY&amp;hide=1">' +
            '<span class="instancename">Foro</span></a></div></li></ul></li>';
        const [activity] = parseCoursePage(html).sections[0]?.activities ?? [];
        expect(activity?.url).toBeUndefined();
        expect(JSON.stringify(activity)).not.toContain("FAKESESSKEY");
    });
});

describe("parseErrorPage", () => {
    it("reads the message of print_error and notice pages", () => {
        expect(parseErrorPage(fixture("error-page.html"))).toBe(
            "No se puede encontrar el registro en la tabla course_modules de la base de datos.",
        );
        expect(parseErrorPage(fixture("notice-page.html"))).toBe(
            "Este curso no está disponible para estudiantes en este momento.",
        );
    });

    it("finds nothing on regular pages", () => {
        expect(parseErrorPage(fixture("page.html"))).toBeUndefined();
        expect(parseErrorPage(fixture("course-topics.html"))).toBeUndefined();
    });

    it("ignores error boxes written inside course content", () => {
        const post =
            '<div class="posting fullpost"><div class="errorbox"><p class="errormessage">Falso</p></div></div>';
        expect(parseErrorPage(`<div role="main">${post}</div>`)).toBeUndefined();
    });
});
