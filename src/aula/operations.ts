import type { AulaClient } from "./client.js";
import { resolveFileUrl } from "./files.js";
import {
    parseAssign,
    parseAssignIndex,
    parseCoursePage,
    parseCourses,
    parseDayEvents,
    parseDiscussion,
    parseFolder,
    parseForum,
    parseGenericModule,
    parseGradesOverview,
    parseMonthEvents,
    parsePage,
    parseUserGrades,
    type Section,
} from "./parse.js";

/**
 * El bloque de cursos de /my/ no muestra todos: los de años anteriores pueden faltar. Se completa
 * con el informe de notas, que lista todos los cursos del usuario pero sin categoría.
 */
export async function listCourses(client: AulaClient) {
    const [dashboard, grades] = await Promise.all([
        client.page("/my/").then(({ html }) => parseCourses(html)),
        client.page("/grade/report/overview/index.php").then(({ html }) => parseGradesOverview(html)),
    ]);
    const known = new Set(dashboard.map((c) => c.id));
    const extra = grades
        .filter((g) => g.cursoId !== undefined && !known.has(g.cursoId))
        .map((g) => {
            const year = g.curso.match(/\b(20\d{2})\b/)?.[1];
            return { id: g.cursoId!, nombre: g.curso, categoria: "", cicloLectivo: year ? Number(year) : undefined };
        });
    return [...dashboard, ...extra].sort(
        (a, b) => (b.cicloLectivo ?? 0) - (a.cicloLectivo ?? 0) || a.nombre.localeCompare(b.nombre, "es"),
    );
}

/** El curso entero. En formato de pestañas (onetopic) cada pestaña es otra página: se piden todas. */
export async function getCourse(client: AulaClient, courseId: number) {
    const first = parseCoursePage((await client.page(`/course/view.php?id=${courseId}`)).html);
    const sections = new Map<number, Section>(first.secciones.map((s) => [s.numero, s]));

    const rest = await mapLimit(first.otrasSecciones, 4, async (url) => parseCoursePage((await client.page(url)).html));
    for (const page of rest) {
        for (const s of page.secciones) if (!sections.has(s.numero)) sections.set(s.numero, s);
    }

    return {
        id: courseId,
        nombre: first.nombre,
        secciones: [...sections.values()]
            .sort((a, b) => a.numero - b.numero)
            .filter((s) => s.resumen || s.actividades.length),
    };
}

/** Como Promise.all, pero con a lo sumo `limit` pedidos al aula a la vez. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/** Abre una dirección del aula y la interpreta según el tipo de página. */
export async function open(client: AulaClient, url: string, page = 0) {
    const href = new URL(client.resolve(url));
    const path = href.pathname;

    if (path === "/course/view.php") return { tipo: "curso", ...(await getCourse(client, Number(href.searchParams.get("id")))) };

    if (path === "/mod/forum/view.php") {
        if (page > 0) href.searchParams.set("page", String(page));
        return { tipo: "foro", ...parseForum((await client.page(href.href)).html, page) };
    }
    if (path === "/mod/forum/discuss.php") return { tipo: "discusion", ...parseDiscussion((await client.page(href.href)).html) };
    if (path === "/mod/page/view.php") return { tipo: "pagina", ...parsePage((await client.page(href.href)).html) };
    if (path === "/mod/folder/view.php") return { tipo: "carpeta", ...parseFolder((await client.page(href.href)).html) };
    if (path === "/mod/assign/view.php") return { tipo: "tarea", ...parseAssign((await client.page(href.href)).html) };

    if (path === "/mod/resource/view.php") {
        const fileUrl = await resolveFileUrl(client, href.href);
        return {
            tipo: "archivo",
            nombre: decodeURIComponent(new URL(fileUrl).pathname.split("/").pop() ?? ""),
            url: fileUrl,
            nota: "Para leerlo, usar unsada_leer_archivo con esta url.",
        };
    }
    if (path === "/mod/url/view.php") {
        const res = await client.request(href.href);
        if (res.external) return { tipo: "enlace", url: res.external };
        return { tipo: "enlace", ...parseGenericModule((await res.response?.text()) ?? "") };
    }
    if (path.startsWith("/pluginfile.php/")) {
        return { tipo: "archivo", url: href.href, nota: "Para leerlo, usar unsada_leer_archivo con esta url." };
    }

    return { tipo: path.match(/^\/mod\/(\w+)\//)?.[1] ?? "pagina", ...parseGenericModule((await client.page(href.href)).html) };
}

export async function listAssignments(client: AulaClient, courseId: number) {
    return parseAssignIndex((await client.page(`/mod/assign/index.php?id=${courseId}`)).html);
}

export async function getGrades(client: AulaClient, courseId?: number) {
    if (courseId === undefined) return { cursos: parseGradesOverview((await client.page("/grade/report/overview/index.php")).html) };
    return { cursoId: courseId, items: parseUserGrades((await client.page(`/grade/report/user/index.php?id=${courseId}`)).html) };
}

const DAY_MS = 86_400_000;

/**
 * Eventos del calendario (entregas, cierres, exámenes, eventos de curso) en un rango de días. Una
 * vista mensual por cada mes del rango y una diaria por cada día con eventos.
 */
export async function getCalendar(client: AulaClient, days: number, pastDays: number) {
    const now = Date.now();
    const from = now - pastDays * DAY_MS;
    const to = now + days * DAY_MS;

    // Un timestamp a mitad de cada mes del rango alcanza para pedir su vista mensual.
    const months: number[] = [];
    for (let d = new Date(from); d.getTime() <= to; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
        months.push(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15) / 1000));
    }
    const monthEvents = (
        await mapLimit(months, 4, async (t) => parseMonthEvents((await client.page(`/calendar/view.php?view=month&time=${t}`)).html))
    ).flat();

    // El día arranca a las 00:00 de Argentina: vale si termina después de `from` y empieza antes de `to`.
    const dayStarts = [...new Set(monthEvents.map((e) => e.dia))].filter(
        (t) => t * 1000 + DAY_MS > from && t * 1000 <= to,
    );
    const byDay = await mapLimit(dayStarts.sort((a, b) => a - b), 4, async (t) => ({
        dia: t,
        eventos: parseDayEvents((await client.page(`/calendar/view.php?view=day&time=${t}`)).html),
    }));

    return byDay.flatMap(({ dia, eventos }) =>
        eventos.map(({ hora, ...e }) => ({ fecha: `${formatDay(dia)} ${hora}`.trim(), ...e })),
    );
}

/** "miércoles 21/10/2026", en hora argentina. */
function formatDay(timestamp: number): string {
    return new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    })
        .format(new Date(timestamp * 1000))
        .replace(",", "");
}
