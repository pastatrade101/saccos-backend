function escapePdfText(text) {
    return String(text)
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)");
}

function buildSimplePdf(title, rows) {
    const lines = [title, "", ...rows];
    const maxLinesPerPage = 40;
    const pages = [];

    for (let index = 0; index < lines.length; index += maxLinesPerPage) {
        pages.push(lines.slice(index, index + maxLinesPerPage));
    }

    const objects = [];
    const offsets = [];
    const pushObject = (body) => {
        offsets.push(0);
        objects.push(body);
        return objects.length;
    };

    const fontObjectId = pushObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const pageIds = [];
    const contentIds = [];

    pages.forEach((pageLines) => {
        const stream = [
            "BT",
            "/F1 11 Tf",
            "50 790 Td",
            ...pageLines.flatMap((line, lineIndex) => {
                if (lineIndex === 0) {
                    return [`(${escapePdfText(line)}) Tj`];
                }

                return ["0 -18 Td", `(${escapePdfText(line)}) Tj`];
            }),
            "ET"
        ].join("\n");

        const contentId = pushObject(
            `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`
        );
        const pageId = pushObject("");
        contentIds.push(contentId);
        pageIds.push(pageId);
    });

    const pagesId = pushObject("");

    pageIds.forEach((pageId, index) => {
        objects[pageId - 1] =
            `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] ` +
            `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`;
    });

    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const catalogId = pushObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    let pdf = "%PDF-1.4\n";
    objects.forEach((body, index) => {
        offsets[index] = Buffer.byteLength(pdf, "utf8");
        pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    offsets.forEach((offset) => {
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, "utf8");
}

module.exports = {
    buildSimplePdf
};
