import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { AulaClient } from "./aula/client.js";
import { readAulaFile } from "./aula/files.js";
import { getCalendar, getCourse, getGrades, listAssignments, listCourses, open } from "./aula/operations.js";

// JSON compacto: indentar estas respuestas cuesta ~25% más de contexto y no se lee mejor.
const json = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

const failure = (e: unknown) => ({
    content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
    isError: true,
});

/** Devuelve el resultado como JSON y cualquier error como respuesta de error de la tool. */
const safe =
    <A>(run: (args: A) => Promise<unknown>) =>
    async (args: A) => {
        try {
            return json(await run(args));
        } catch (e) {
            return failure(e);
        }
    };

/** Todo lo de esta versión solo lee: no publica, no entrega, no cambia nada en el aula. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

const courseId = z.number().int().positive().describe("Id del curso, tal como lo devuelve unsada_cursos.");

export function registerTools(server: McpServer, client: AulaClient) {
    server.registerTool(
        "unsada_cursos",
        {
            description:
                "Lista los cursos (materias) del usuario en el aula virtual de la UNSAdA, los más recientes " +
                "primero, con su ciclo lectivo. Es el punto de partida: el `id` de cada curso se usa en las " +
                "demás tools. Incluye cursos de años anteriores; si el usuario pregunta por lo actual, usar " +
                "los del ciclo lectivo más reciente.",
            annotations: READ_ONLY,
        },
        safe(() => listCourses(client)),
    );

    server.registerTool(
        "unsada_curso",
        {
            description:
                "Contenido de un curso: sus secciones (semanas, unidades o pestañas) con las actividades y " +
                "recursos de cada una. Las etiquetas (tipo `label`) traen su texto: suelen tener el cronograma, " +
                "los horarios y los links de las clases. Cada actividad trae su `url`, que se abre con unsada_abrir.",
            inputSchema: z.object({ cursoId: courseId }),
            annotations: READ_ONLY,
        },
        safe(({ cursoId }: { cursoId: number }) => getCourse(client, cursoId)),
    );

    server.registerTool(
        "unsada_abrir",
        {
            description:
                "Abre una dirección del aula y devuelve lo que hay según el tipo: un foro con sus discusiones, " +
                "una discusión con todos sus mensajes, una página con su texto, una carpeta con sus archivos, " +
                "una tarea con la consigna, el estado de la entrega y la devolución, un enlace externo, o un " +
                "archivo. Las URLs salen de las respuestas de las otras tools (`url`).\n\n" +
                "Los archivos (PDF, Word, etc.) se leen con unsada_leer_archivo.",
            inputSchema: z.object({
                url: z
                    .string()
                    .describe('URL del aula. Ej: "https://moodle.unsada.edu.ar/mod/forum/view.php?id=94428".'),
                pagina: z
                    .number()
                    .int()
                    .min(0)
                    .optional()
                    .describe("Solo para foros: página del índice de discusiones. La respuesta avisa con `hayMasDiscusiones`."),
            }),
            annotations: READ_ONLY,
        },
        safe(({ url, pagina }: { url: string; pagina?: number }) => open(client, url, pagina)),
    );

    server.registerTool(
        "unsada_leer_archivo",
        {
            description:
                "Lee un archivo del aula: PDF, Word (docx), PowerPoint (pptx), Excel (xlsx), imágenes y texto. " +
                "Los PDF escaneados se devuelven como imagen de cada página. Acepta la URL del archivo " +
                "(pluginfile.php) o la de un recurso (mod/resource/view.php).\n\n" +
                "Devuelve el archivo por partes (páginas, diapositivas o fragmentos), tantas como entren en una " +
                "respuesta. Si quedan más, `siguiente` dice desde cuál pedir.\n\n" +
                "Formatos que no sabe leer (.doc o .ppt viejos, .zip, .rar, videos): devuelve un error con la " +
                "URL para que el usuario lo baje.",
            inputSchema: z.object({
                url: z.string().describe("URL del archivo o del recurso, tal como la devuelven las otras tools."),
                desde: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    .describe("Número de página, diapositiva o fragmento desde el cual leer. Por defecto, 1."),
            }),
            annotations: READ_ONLY,
        },
        async ({ url, desde }) => {
            try {
                const { parts, ...fileRead } = await readAulaFile(client, url, desde);
                const label = (n: number, title?: string) =>
                    `--- ${fileRead.unidad} ${n} de ${fileRead.total}${title ? ` (${title})` : ""} ---`;
                return {
                    content: [
                        { type: "text" as const, text: JSON.stringify(fileRead) },
                        ...parts.flatMap((p) =>
                            "text" in p
                                ? [{ type: "text" as const, text: `${label(p.number, p.title)}\n${p.text}` }]
                                : [
                                      { type: "text" as const, text: label(p.number, p.title) },
                                      {
                                          type: "image" as const,
                                          data: Buffer.from(p.image).toString("base64"),
                                          mimeType: p.mimeType,
                                      },
                                  ],
                        ),
                    ],
                };
            } catch (e) {
                return failure(e);
            }
        },
    );

    server.registerTool(
        "unsada_tareas",
        {
            description:
                "Las tareas (entregas) de un curso, con fecha de entrega, estado de la entrega del usuario y " +
                "calificación. Para la consigna completa y la devolución del docente, abrir la `url` de la " +
                "tarea con unsada_abrir.",
            inputSchema: z.object({ cursoId: courseId }),
            annotations: READ_ONLY,
        },
        safe(({ cursoId }: { cursoId: number }) => listAssignments(client, cursoId)),
    );

    server.registerTool(
        "unsada_notas",
        {
            description:
                "Calificaciones del usuario. Sin `cursoId`: la nota total de cada curso. Con `cursoId`: cada " +
                "ítem calificable del curso con nota, rango, porcentaje y devolución.",
            inputSchema: z.object({ cursoId: courseId.optional() }),
            annotations: READ_ONLY,
        },
        safe(({ cursoId }: { cursoId?: number }) => getGrades(client, cursoId)),
    );

    server.registerTool(
        "unsada_calendario",
        {
            description:
                "Eventos del calendario del aula: vencimientos de tareas, cierres de cuestionarios, exámenes y " +
                "eventos de los cursos, en hora argentina y en orden, con el curso y la `url` de la actividad " +
                "cuando corresponde.",
            inputSchema: z.object({
                dias: z.number().int().min(1).max(365).optional().describe("Cuántos días hacia adelante. Por defecto, 30."),
                diasAtras: z
                    .number()
                    .int()
                    .min(0)
                    .max(30)
                    .optional()
                    .describe("Incluir también los de los últimos días. Por defecto, 0."),
            }),
            annotations: READ_ONLY,
        },
        safe(({ dias, diasAtras }: { dias?: number; diasAtras?: number }) =>
            getCalendar(client, dias ?? 30, diasAtras ?? 0),
        ),
    );

    server.registerTool(
        "unsada_iniciar_sesion",
        {
            description:
                "Abre una ventana del navegador para que el usuario entre al aula con Google. Usarla solo si " +
                "otra tool avisó que hace falta iniciar sesión y el usuario no ve la ventana, o si el usuario " +
                "pide cambiar de cuenta.",
            annotations: { readOnlyHint: false, openWorldHint: false },
        },
        safe(async () => {
            await client.login({ wait: "tool" });
            return { conectado: true };
        }),
    );
}
