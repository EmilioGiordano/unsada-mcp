import { beforeAll, describe, expect, it } from "vitest";
import { type ParsedDocument, type Part, UnsupportedFormatError } from "../../src/documents/document.js";
import { openDocument } from "../../src/documents/open-document.js";
import { grayscalePng } from "../../src/documents/png.js";
import { TooLargeError } from "../../src/errors.js";
import { buildPdf } from "./make-pdf.js";
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

describe("openDocument", () => {
    // Loading pdf.js the first time took over 5 s on a Windows CI runner; pay it once, outside the tests.
    beforeAll(async () => {
        await (await openDocument(buildPdf([{ lines: ["Carga de pdf.js"] }]), "carga.pdf")).close();
    }, 60_000);

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

    it("counts an image shared between pages as a figure where it is not repeated", async () => {
        const document = await openDocument(
            buildPdf([
                { lines: ["Primer diagrama de la unidad"], sharedImages: [[72, 200, 300, 300]] },
                { lines: ["Texto sin figuras en esta hoja"] },
                { lines: ["El mismo diagrama, mas chico"], sharedImages: [[72, 400, 200, 200]] },
            ]),
            "compartida.pdf",
        );
        try {
            expect(await document.part(1)).toMatchObject({ figures: 1 });
            expect(await document.part(3)).toMatchObject({ figures: 1 });
        } finally {
            await document.close();
        }
    });

    it("reads a pdf page whose neighbour cannot be read", async () => {
        const document = await openDocument(
            buildPdf([{ lines: ["Unidad uno: introduccion"] }, { lines: [], unreadable: true }]),
            "rota.pdf",
        );
        try {
            expect(await document.part(1)).toEqual({ text: "Unidad uno: introduccion" });
            await expect(document.part(2)).rejects.toThrow();
            await expect(document.part(3)).rejects.toThrow(/no page 3/);
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

    it("rejects an image too large to pass to the model", async () => {
        const image = new Uint8Array(3 * 1024 * 1024 + 1);
        image.set([0x89, 0x50, 0x4e, 0x47]);
        await expect(openDocument(image, "foto.png")).rejects.toThrow(TooLargeError);
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
