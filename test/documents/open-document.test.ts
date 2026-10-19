import { describe, expect, it } from "vitest";
import { type ParsedDocument, type Part, UnsupportedFormatError } from "../../src/documents/document.js";
import { openDocument } from "../../src/documents/open-document.js";
import { grayscalePng } from "../../src/documents/png.js";
import { makeZip } from "./make-zip.js";

const text = (value: string) => new TextEncoder().encode(value);

async function allParts(document: ParsedDocument): Promise<Part[]> {
    try {
        const parts: Part[] = [];
        for (let number = 1; number <= document.total; number++) parts.push(await document.part(number));
        return parts;
    } finally {
        await document.close();
    }
}

const texts = (parts: Part[]) => parts.map((part) => ("text" in part ? part.text : `[${part.mimeType}]`));

interface PdfPage {
    lines: string[];
    // Each image is a 120x120 gray square placed at [x, y, width, height] in points.
    images?: [number, number, number, number][];
}

function buildPdf(pages: PdfPage[]): Uint8Array {
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    const add = (object: string) => objects.push(object);
    const kids = pages.map(({ lines, images = [] }) => {
        const refs = images.map(() =>
            add(
                "<< /Type /XObject /Subtype /Image /Width 120 /Height 120 /ColorSpace /DeviceGray " +
                    `/BitsPerComponent 8 /Length 14400 >>\nstream\n${"~".repeat(14_400)}\nendstream`,
            ),
        );
        const draw = images.map(([x, y, w, h], i) => `q ${w} 0 0 ${h} ${x} ${y} cm /Im${i} Do Q`).join(" ");
        const stream = `BT /F1 18 Tf 72 720 Td ${lines.map((line) => `(${line}) Tj 0 -24 Td`).join(" ")} ET ${draw}`;
        const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        const xobjects = refs.map((ref, i) => `/Im${i} ${ref} 0 R`).join(" ");
        const page = add(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contents} 0 R ` +
                `/Resources << /Font << /F1 3 0 R >> /XObject << ${xobjects} >> >> >>`,
        );
        return `${page} 0 R`;
    });
    objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => {
        offsets.push(body.length);
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return text(body);
}

describe("openDocument", () => {
    it("reads pdf text page by page", async () => {
        const document = await openDocument(buildPdf([{ lines: ["Apunte de prueba", "Unidad uno"] }]), "apunte.pdf");
        expect(document).toMatchObject({ format: "pdf", unit: "page", total: 1 });
        expect(texts(await allParts(document))[0]).toContain("Apunte de prueba");
    });

    it("counts figures on pdf pages with text, leaving out images repeated on the next page", async () => {
        const logo: [number, number, number, number] = [400, 600, 200, 150];
        const document = await openDocument(
            buildPdf([
                { lines: ["Unidad uno: introduccion"], images: [logo] },
                { lines: ["Diagrama del sistema completo"], images: [logo, [72, 200, 300, 300]] },
            ]),
            "clase.pdf",
        );
        try {
            expect(await document.part(1)).toEqual({ text: "Unidad uno: introduccion" });
            expect(await document.part(2)).toEqual({ text: "Diagrama del sistema completo", figures: 1 });
            expect(await document.part(2, true)).toMatchObject({
                figures: 1,
                figureImage: { mimeType: "image/png" },
            });
        } finally {
            await document.close();
        }
    });

    it("reads a pdf page without text as a scan", async () => {
        const document = await openDocument(buildPdf([{ lines: [], images: [[0, 0, 612, 792]] }]), "scan.pdf");
        const [scan] = await allParts(document);
        expect(scan).toMatchObject({ title: "scanned, as an image", mimeType: "image/png" });
    });

    it("reads docx paragraphs and tables", async () => {
        const xml =
            '<w:document><w:body><w:p><w:r><w:t>Hola</w:t></w:r><w:r><w:t xml:space="preserve"> mundo &amp; más</w:t></w:r></w:p>' +
            "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
            "</w:body></w:document>";
        const document = await openDocument(makeZip([{ name: "word/document.xml", data: xml }]), "x.docx");
        expect(document.format).toBe("docx");
        expect(texts(await allParts(document))).toEqual(["Hola mundo & más\nA | B"]);
    });

    it("reads pptx slides in numeric order", async () => {
        const slide = (body: string) => `<p:sld><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:sld>`;
        const zip = makeZip([
            { name: "ppt/presentation.xml", data: "<p:presentation/>" },
            { name: "ppt/slides/slide10.xml", data: slide("Diez") },
            { name: "ppt/slides/slide2.xml", data: slide("Dos") },
            { name: "ppt/slides/slide1.xml", data: "<p:sld/>" },
        ]);
        const document = await openDocument(zip, "x.pptx");
        expect(document.unit).toBe("slide");
        expect(texts(await allParts(document))).toEqual(["(slide without text)", "Dos", "Diez"]);
    });

    it("reads xlsx sheets with shared strings", async () => {
        const zip = makeZip([
            {
                name: "xl/workbook.xml",
                data: '<workbook><sheets><sheet name="Notas" sheetId="1" r:id="rId1"/></sheets></workbook>',
            },
            {
                name: "xl/_rels/workbook.xml.rels",
                data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
            },
            { name: "xl/sharedStrings.xml", data: "<sst><si><t>Alumno</t></si><si><t>Nota</t></si></sst>" },
            {
                name: "xl/worksheets/sheet1.xml",
                data: '<sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="inlineStr"><is><t>Ana</t></is></c><c><v>8</v></c></row></sheetData>',
            },
        ]);
        const [sheet] = await allParts(await openDocument(zip, "x.xlsx"));
        expect(sheet).toEqual({ title: 'sheet "Notas"', text: "Alumno\tNota\nAna\t8" });
    });

    it.each([
        ["png", grayscalePng(2, 2, new Uint8Array(4)), "image/png"],
        ["jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "image/jpeg"],
        ["gif", text("GIF89a......"), "image/gif"],
    ])("passes %s images through", async (_, bytes, mimeType) => {
        const [part] = await allParts(await openDocument(bytes, "image"));
        expect(part).toMatchObject({ mimeType });
    });

    it.each([
        ["txt", "uno\ndos", "uno\ndos"],
        ["csv", "a,b\n1,2", "a,b\n1,2"],
        ["md", "# Título\n\ntexto", "# Título\n\ntexto"],
        ["html", "<h1>Título</h1><script>x()</script><p>texto</p>", "Título\ntexto"],
    ])("reads .%s as text", async (extension, input, expected) => {
        expect(texts(await allParts(await openDocument(text(input), `file.${extension}`)))).toEqual([expected]);
    });

    it("splits long text into chunks", async () => {
        const document = await openDocument(text("línea\n".repeat(10_000)), "long.txt");
        expect(document.total).toBeGreaterThan(1);
    });

    it.each([
        ["legacy Office", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]), "old.doc"],
        ["plain zip", makeZip([{ name: "a.txt", data: "x" }]), "notes.zip"],
        ["unknown binary", new Uint8Array([1, 2, 3]), "video.mp4"],
        ["no extension", text("hello"), "README"],
    ])("rejects %s", async (_, bytes, name) => {
        await expect(openDocument(bytes, name)).rejects.toThrow(UnsupportedFormatError);
    });

    it("rejects a missing part", async () => {
        const document = await openDocument(text("x"), "a.txt");
        await expect(document.part(2)).rejects.toThrow(/no chunk 2/);
    });
});
