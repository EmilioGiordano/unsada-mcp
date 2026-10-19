type Placement = [number, number, number, number];

export interface PdfPage {
    lines: string[];
    images?: Placement[];
    sharedImages?: Placement[];
    unreadable?: true;
}

const GRAY_IMAGE =
    "<< /Type /XObject /Subtype /Image /Width 120 /Height 120 /ColorSpace /DeviceGray " +
    `/BitsPerComponent 8 /Length 14400 >>\nstream\n${"~".repeat(14_400)}\nendstream`;

export function buildPdf(pages: PdfPage[]): Uint8Array<ArrayBuffer> {
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        GRAY_IMAGE,
    ];
    const add = (object: string) => objects.push(object);
    const kids = pages.map(({ lines, images = [], sharedImages = [], unreadable }) => {
        if (unreadable) return `${add("42")} 0 R`;
        const refs = [...images.map(() => add(GRAY_IMAGE)), ...sharedImages.map(() => 4)];
        const draw = [...images, ...sharedImages]
            .map(([x, y, w, h], i) => `q ${w} 0 0 ${h} ${x} ${y} cm /Im${i} Do Q`)
            .join(" ");
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
    return new TextEncoder().encode(body);
}
