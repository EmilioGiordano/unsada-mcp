import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { htmlToText } from "../shared/html.js";

/**
 * Lectura del HTML de Moodle 3.2 con el tema "essential", que es lo que corre en la UNSAdA.
 * Cada función recibe el HTML de una página y devuelve lo que le sirve al modelo, con claves en
 * castellano. Si el aula cambia de versión o de tema, esto es lo que hay que tocar.
 */

type $ = cheerio.CheerioAPI;

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const idParam = (href: string | undefined, name = "id") => {
    const m = href?.match(new RegExp(`[?&]${name}=(\\d+)`));
    return m ? Number(m[1]) : undefined;
};
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

/**
 * Texto de un fragmento de HTML conservando lo que se pierde al sacar las etiquetas: el destino de
 * los links (si no es el mismo texto) y lo embebido en iframes (presentaciones, videos).
 */
export function richText($: $, el: cheerio.Cheerio<AnyNode>): string {
    const copy = el.clone();
    copy.find("script, style, form, .accesshide").remove();
    copy.find("a[href]").each((_, a) => {
        const node = $(a);
        const href = node.attr("href") ?? "";
        const text = clean(node.text());
        // Sin texto es la foto de un usuario o un ícono: el link solo ensucia.
        if (!text) node.remove();
        else if (href && !href.startsWith("#") && text !== href) node.replaceWith(`${text} (${href})`);
    });
    copy.find("iframe[src]").each((_, f) => {
        $(f).replaceWith(`[contenido embebido: ${$(f).attr("src")}]`);
    });
    return htmlToText(copy.html() ?? "");
}

const mainRegion = ($: $) => {
    const main = $("#region-main");
    return main.length ? main : $("body");
};

/** Links a archivos del aula dentro de un fragmento. */
function files($: $, el: cheerio.Cheerio<AnyNode>) {
    const seen = new Set<string>();
    const out: { nombre: string; url: string }[] = [];
    el.find('a[href*="/pluginfile.php/"]').each((_, a) => {
        const url = $(a).attr("href")!;
        if (seen.has(url)) return;
        seen.add(url);
        const nombre = clean($(a).text()) || decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
        out.push({ nombre, url });
    });
    return out;
}

// --- Cursos ---

export interface CourseSummary {
    id: number;
    nombre: string;
    categoria: string;
    cicloLectivo?: number;
}

/** Los cursos del bloque "Vista general de cursos" de /my/. */
export function parseCourses(html: string): CourseSummary[] {
    const $ = cheerio.load(html);
    const courses: CourseSummary[] = [];
    $("div.coursebox").each((_, box) => {
        const a = $(box).find(".course_title a").first();
        const id = idParam(a.attr("href"));
        if (!id) return;
        const categoria = clean($(box).find(".categorypath").text());
        const year = categoria.match(/Ciclo Lectivo (\d{4})/)?.[1];
        courses.push({
            id,
            nombre: clean(a.text()),
            categoria,
            cicloLectivo: year ? Number(year) : undefined,
        });
    });
    return courses;
}

export interface Activity {
    tipo: string;
    nombre: string;
    /** Id del módulo (cmid). No está en las etiquetas, que no tienen página propia. */
    id?: number;
    url?: string;
    texto?: string;
}

export interface Section {
    numero: number;
    nombre: string;
    resumen?: string;
    actividades: Activity[];
}

export interface CoursePage {
    nombre: string;
    formato: string;
    secciones: Section[];
    /** Formato de pestañas (onetopic): links a las secciones que esta página no muestra. */
    otrasSecciones: string[];
}

/** Una página de curso. En formato onetopic trae solo la sección general y la pestaña activa. */
export function parseCoursePage(html: string): CoursePage {
    const $ = cheerio.load(html);
    const formato = $("body").attr("class")?.match(/format-(\w+)/)?.[1] ?? "desconocido";
    const secciones: Section[] = [];

    $("li.section.main").each((_, li) => {
        const sec = $(li);
        const numero = Number(sec.attr("id")?.replace("section-", ""));
        const nombre = clean(sec.attr("aria-label")) || clean(sec.find(".sectionname").first().text());
        const resumen = richText($, sec.find(".summary").first());
        const actividades: Activity[] = [];

        sec.find("li.activity").each((_, act) => {
            actividades.push(parseActivity($, $(act) as cheerio.Cheerio<Element>));
        });

        secciones.push({ numero, nombre, resumen: resumen || undefined, actividades });
    });

    const otrasSecciones = new Set<string>();
    $(".single-section .nav-tabs a[href*='section=']").each((_, a) => {
        otrasSecciones.add($(a).attr("href")!);
    });

    return { nombre: clean($("h1").first().text()), formato, secciones, otrasSecciones: [...otrasSecciones] };
}

function parseActivity($: $, act: cheerio.Cheerio<Element>): Activity {
    const tipo = act.attr("class")?.match(/modtype_(\w+)/)?.[1] ?? "desconocido";
    const link = act.find(".activityinstance a").first();
    const name = link.find(".instancename").clone();
    name.find(".accesshide").remove();

    if (tipo === "label" || !link.length) {
        const texto = richText($, act.find(".contentwithoutlink, .no-overflow").first());
        return { tipo, nombre: cut(texto.split("\n")[0] ?? "", 80), texto: cut(texto, 2_000) };
    }
    const url = link.attr("href");
    const texto = richText($, act.find(".contentafterlink").first());
    return {
        tipo,
        nombre: clean(name.text()),
        id: idParam(url),
        url,
        texto: texto ? cut(texto, 600) : undefined,
    };
}

// --- Módulos ---

/** Lo común de la página de un módulo: título, texto principal y archivos. */
export function parseGenericModule(html: string) {
    const $ = cheerio.load(html);
    const main = mainRegion($);
    const titulo = clean(main.find("h2").first().text());
    const body = main.find("[role=main]").first().clone();
    body.find(".row-fluid .heading-rts, .footer-rts, h2").remove();
    return { titulo, texto: richText($, body), archivos: files($, body) };
}

/** mod/page: el contenido de la página. */
export function parsePage(html: string) {
    const $ = cheerio.load(html);
    const main = mainRegion($);
    const box = main.find(".box.generalbox").first();
    return {
        titulo: clean(main.find("h2").first().text()),
        texto: richText($, box),
        archivos: files($, box),
        modificado: clean(main.find(".modified").text()) || undefined,
    };
}

/** mod/folder: el árbol de archivos, aplanado con la ruta de cada uno. */
export function parseFolder(html: string) {
    const $ = cheerio.load(html);
    const main = mainRegion($);
    const intro = richText($, main.find("#intro").first());
    const archivos = files($, main.find(".foldertree"));
    return {
        titulo: clean(main.find("h2").first().text()),
        descripcion: intro || undefined,
        archivos: archivos.map((f) => {
            const path = decodeURIComponent(new URL(f.url).pathname).split("/content/0/")[1];
            return { ...f, ruta: path ?? f.nombre };
        }),
    };
}

/** mod/resource cuando no redirige al archivo y muestra una página con el link o el visor. */
export function findResourceFile(html: string): string | undefined {
    const $ = cheerio.load(html);
    const main = mainRegion($);
    return (
        main.find('.resourceworkaround a[href*="/pluginfile.php/"]').attr("href") ??
        main.find('object[data*="/pluginfile.php/"]').attr("data") ??
        main.find('iframe[src*="/pluginfile.php/"]').attr("src") ??
        main.find('a[href*="/pluginfile.php/"]').attr("href")
    );
}

// --- Foros ---

export function parseForum(html: string, page: number) {
    const $ = cheerio.load(html);
    const main = mainRegion($);
    const discusiones: { id: number; titulo: string; autor: string; respuestas: number; ultimoMensaje: string; url: string }[] = [];
    main.find("table.forumheaderlist tr.discussion").each((_, tr) => {
        const row = $(tr);
        const a = row.find("td.topic a").first();
        const url = a.attr("href")!;
        const lastpost = row.find("td.lastpost a").last();
        discusiones.push({
            id: idParam(url, "d")!,
            titulo: clean(a.text()),
            autor: clean(row.find("td.author").text()),
            respuestas: Number(clean(row.find("td.replies").text())) || 0,
            ultimoMensaje: clean(lastpost.text()),
            url,
        });
    });
    const next = main
        .find(".paging a[href]")
        .toArray()
        .some((a) => idParam($(a).attr("href"), "page") === page + 1);
    return {
        titulo: clean(main.find("h2").first().text()),
        descripcion: richText($, main.find("#intro").first()) || undefined,
        discusiones,
        pagina: page,
        hayMasDiscusiones: next || undefined,
    };
}

export function parseDiscussion(html: string) {
    const $ = cheerio.load(html);
    const main = mainRegion($);
    const mensajes: { id?: number; asunto: string; autor: string; fecha: string; texto: string; adjuntos: { nombre: string; url: string }[] }[] = [];
    main.find("div.forumpost").each((_, div) => {
        const post = $(div);
        const author = clean(post.find(".author").first().text()).replace(/^de\s+/, "");
        const [autor, ...fecha] = author.split(" - ");
        const anchor = post.prevAll("a[id^=p]").first().attr("id");
        const content = post.find(".posting").first();
        mensajes.push({
            id: anchor ? Number(anchor.slice(1)) : undefined,
            asunto: clean(post.find(".subject").first().text()),
            autor: autor ?? "",
            fecha: fecha.join(" - "),
            texto: richText($, content),
            adjuntos: files($, post.find(".attachments, .attachedimages")),
        });
    });
    return { titulo: clean(main.find("h3.discussionname").first().text()), mensajes };
}

// --- Tareas ---

/** mod/assign/index.php: todas las tareas del curso con vencimiento, estado y nota. */
export function parseAssignIndex(html: string) {
    const $ = cheerio.load(html);
    const tareas: { tema: string; nombre: string; id?: number; url?: string; vencimiento: string; entrega: string; calificacion: string }[] = [];
    let tema = "";
    mainRegion($)
        .find("table.generaltable tbody tr")
        .each((_, tr) => {
            const cells = $(tr).find("td");
            if (cells.length < 5) return;
            tema = clean(cells.eq(0).text()) || tema;
            const a = cells.eq(1).find("a").first();
            tareas.push({
                tema,
                nombre: clean(cells.eq(1).text()),
                id: idParam(a.attr("href")),
                url: a.attr("href"),
                vencimiento: clean(cells.eq(2).text()),
                entrega: clean(cells.eq(3).text()),
                calificacion: clean(cells.eq(4).text()),
            });
        });
    return tareas;
}

/** Filas "etiqueta | valor" de las tablas de estado y de devolución de una tarea. */
function labelValueTable($: $, table: cheerio.Cheerio<AnyNode>) {
    const out: Record<string, string> = {};
    const archivos: { nombre: string; url: string }[] = [];
    table.find("tr").each((_, tr) => {
        const label = clean($(tr).find("td.c0").text());
        const value = $(tr).find("td.c1").first().clone();
        if (!label) return;
        // Los comentarios largos vienen dos veces: un resumen y el texto completo oculto.
        if (value.find("[class*='full_']").length) value.find("[class*='summary_']").remove();
        archivos.push(...files($, value));
        value.find("[id^='assign_files_tree']").remove();
        const text = richText($, value);
        if (text) out[label] = text;
    });
    return { campos: out, archivos };
}

export function parseAssign(html: string) {
    const $ = cheerio.load(html);
    const main = mainRegion($);
    const intro = main.find("#intro").first();
    const status = labelValueTable($, main.find(".submissionstatustable table").first());
    const feedback = labelValueTable($, main.find(".feedback table").first());
    return {
        titulo: clean(main.find("h2").first().text()),
        consigna: richText($, intro) || undefined,
        archivosConsigna: files($, intro),
        estado: status.campos,
        archivosEntregados: status.archivos,
        devolucion: Object.keys(feedback.campos).length ? feedback.campos : undefined,
        archivosDevolucion: feedback.archivos.length ? feedback.archivos : undefined,
    };
}

// --- Notas ---

/** grade/report/overview: la nota total de cada curso. */
export function parseGradesOverview(html: string) {
    const $ = cheerio.load(html);
    const cursos: { cursoId?: number; curso: string; calificacion: string }[] = [];
    $("table#overview-grade tbody tr").each((_, tr) => {
        const a = $(tr).find("td.c0 a");
        if (!a.length) return;
        cursos.push({ cursoId: idParam(a.attr("href")), curso: clean(a.text()), calificacion: clean($(tr).find("td.c1").text()) });
    });
    return cursos;
}

/** grade/report/user: cada ítem calificable del curso con su nota y devolución. */
export function parseUserGrades(html: string) {
    const $ = cheerio.load(html);
    const items: Record<string, string>[] = [];
    $("table.user-grade tbody tr").each((_, tr) => {
        const row = $(tr);
        const name = row.find(".column-itemname").first();
        const grade = row.find("td.column-grade");
        if (!grade.length) return; // fila de categoría
        const item: Record<string, string> = { item: clean(name.text()) };
        for (const [key, col] of [
            ["calificacion", "grade"],
            ["rango", "range"],
            ["porcentaje", "percentage"],
            ["ponderacion", "weight"],
            ["devolucion", "feedback"],
        ]) {
            const v = clean(row.find(`td.column-${col}`).text());
            if (v && v !== "-") item[key] = v;
        }
        const url = name.find("a").attr("href");
        if (url) item.url = url;
        items.push(item);
    });
    return items;
}

// --- Calendario ---
// El export iCal de Moodle 3.2 pierde la hora (manda solo el día, en UTC), así que se lee la web:
// la vista mensual dice qué días tienen eventos y la diaria trae la hora exacta y el curso.

/** Vista mensual: id de cada evento y el inicio (timestamp) del día en que cae. */
export function parseMonthEvents(html: string) {
    const $ = cheerio.load(html);
    const events: { id: number; dia: number }[] = [];
    $('li[class*="calendar_event"] a[href*="view=day"]').each((_, a) => {
        const href = $(a).attr("href")!;
        const id = Number(href.match(/#event_(\d+)/)?.[1]);
        const dia = idParam(href, "time");
        if (id && dia) events.push({ id, dia });
    });
    return events;
}

/** Vista diaria: los eventos del día con hora, curso, actividad y descripción. */
export function parseDayEvents(html: string) {
    const $ = cheerio.load(html);
    const events: { id: number; titulo: string; hora: string; curso?: string; cursoId?: number; url?: string; descripcion?: string }[] = [];
    $(".eventlist .event").each((_, div) => {
        const ev = $(div);
        const referer = ev.find(".referer").first();
        const course = ev.find(".course a").first();
        const descripcion = richText($, ev.find(".description").first());
        events.push({
            id: Number(ev.attr("id")?.replace("event_", "")),
            titulo: clean(referer.text()),
            hora: clean(ev.find(".date").first().text()),
            curso: clean(course.text()) || undefined,
            cursoId: idParam(course.attr("href")),
            url: referer.find("a").attr("href"),
            descripcion: descripcion ? cut(descripcion, 400) : undefined,
        });
    });
    return events;
}
