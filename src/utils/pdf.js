const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const PAGE_SIZE = "A4";
const MARGIN = 36;
const HEADER_HEIGHT = 88;
const ACCENT_HEIGHT = 10;
const TABLE_TOP = 214;
const TABLE_HEADER_HEIGHT = 22;
const TABLE_ROW_HEIGHT = 20;
const FOOTER_HEIGHT = 26;

const COLORS = {
    primary: "#0A0573",
    accent: "#1FA8E6",
    white: "#FFFFFF",
    text: "#0F172A",
    muted: "#475569",
    border: "#CBD5E1",
    stripe: "#F8FAFC"
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function formatLabel(key) {
    if (key === "__row_no") {
        return "No";
    }

    return key
        .split("_")
        .filter(Boolean)
        .map((part) => {
            const upper = part.toUpperCase();
            if (["ID", "PAR", "TZS", "SMS", "OTP"].includes(upper)) {
                return upper;
            }
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join(" ");
}

function formatValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "object") {
        return JSON.stringify(value);
    }

    return String(value).replace(/\s+/g, " ").trim();
}

function shouldHideIdColumn(rows, key) {
    if (key === "tenant_id") {
        return true;
    }

    if (!key.endsWith("_id")) {
        return false;
    }

    const stem = key.slice(0, -3);
    return rows.some((row) =>
        row
        && typeof row === "object"
        && !Array.isArray(row)
        && (
            row[`${stem}_name`]
            || row[`${stem}_no`]
            || row[`${stem}_number`]
            || row[`${stem}_code`]
        )
    );
}

function collectKeys(rows) {
    const ordered = [];
    const seen = new Set();

    rows.forEach((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
            return;
        }

        Object.keys(row).forEach((key) => {
            if (seen.has(key) || shouldHideIdColumn(rows, key)) {
                return;
            }
            seen.add(key);
            ordered.push(key);
        });
    });

    return ordered;
}

function normalizeRows(rows, keys) {
    return rows.map((row, index) => {
        const normalized = { __row_no: index + 1 };

        if (!row || typeof row !== "object" || Array.isArray(row)) {
            normalized.value = formatValue(row);
            return normalized;
        }

        keys.forEach((key) => {
            normalized[key] = row[key];
        });

        return normalized;
    });
}

function computeColumnDefinitions(headers, rows) {
    return headers.map((key) => {
        if (key === "__row_no") {
            return { key, label: "No", minWidth: 34, weight: 2 };
        }

        const labelLen = formatLabel(key).length;
        let maxLen = labelLen;

        rows.slice(0, 200).forEach((row) => {
            const current = formatValue(row?.[key]).length;
            if (current > maxLen) {
                maxLen = current;
            }
        });

        return {
            key,
            label: formatLabel(key),
            minWidth: 58,
            weight: clamp(maxLen, 6, 24)
        };
    });
}

function splitColumns(columnDefs, maxWidth) {
    const chunks = [];
    let current = [];
    let minSum = 0;

    columnDefs.forEach((column) => {
        if (current.length && minSum + column.minWidth > maxWidth) {
            chunks.push(current);
            current = [];
            minSum = 0;
        }

        current.push(column);
        minSum += column.minWidth;
    });

    if (current.length) {
        chunks.push(current);
    }

    return chunks.length ? chunks : [columnDefs];
}

function withComputedWidths(columns, totalWidth) {
    const minTotal = columns.reduce((sum, column) => sum + column.minWidth, 0);
    const extra = Math.max(0, totalWidth - minTotal);
    const weightTotal = columns.reduce((sum, column) => sum + column.weight, 0) || 1;
    let consumed = 0;

    return columns.map((column, index) => {
        if (index === columns.length - 1) {
            return {
                ...column,
                width: Number((totalWidth - consumed).toFixed(2))
            };
        }

        const width = column.minWidth + (extra * column.weight) / weightTotal;
        const rounded = Number(width.toFixed(2));
        consumed += rounded;

        return {
            ...column,
            width: rounded
        };
    });
}

function paginateRows(rows, rowsPerPage) {
    if (!rows.length) {
        return [[]];
    }

    const pages = [];
    for (let index = 0; index < rows.length; index += rowsPerPage) {
        pages.push(rows.slice(index, index + rowsPerPage));
    }
    return pages;
}

function getLogoCandidates(customPath) {
    const candidates = [];

    if (customPath) {
        candidates.push(path.resolve(customPath));
    }

    candidates.push(path.resolve(process.cwd(), "../frontend/public/SACCOSS-LOGO.png"));
    candidates.push(path.resolve(process.cwd(), "public/SACCOSS-LOGO.png"));
    candidates.push(path.resolve(__dirname, "../../../frontend/public/SACCOSS-LOGO.png"));

    return candidates;
}

function resolveLogoPath(customPath) {
    const found = getLogoCandidates(customPath).find((candidate) => {
        try {
            return fs.existsSync(candidate);
        } catch (_) {
            return false;
        }
    });

    return found || null;
}

function buildInitials(text) {
    const parts = String(text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);

    if (!parts.length) {
        return "SS";
    }

    return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function drawHeader(doc, {
    brandName,
    subtitle,
    title,
    tenantName,
    generatedAt,
    logoPath,
    chunkLabel
}) {
    const pageWidth = doc.page.width;

    doc.save();
    doc.rect(0, 0, pageWidth, HEADER_HEIGHT).fill(COLORS.primary);
    doc.rect(0, HEADER_HEIGHT - ACCENT_HEIGHT, pageWidth, ACCENT_HEIGHT).fill(COLORS.accent);
    doc.restore();

    if (logoPath) {
        try {
            doc.image(logoPath, MARGIN, 18, { fit: [34, 34], align: "left", valign: "center" });
        } catch (_) {
            doc.save();
            doc.rect(MARGIN, 18, 34, 34).fill(COLORS.accent);
            doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(10).text(buildInitials(brandName), MARGIN + 8, 29);
            doc.restore();
        }
    } else {
        doc.save();
        doc.rect(MARGIN, 18, 34, 34).fill(COLORS.accent);
        doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(10).text(buildInitials(brandName), MARGIN + 8, 29);
        doc.restore();
    }

    doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(17).text(brandName, MARGIN + 44, 24, {
        width: pageWidth / 2
    });
    doc.fillColor(COLORS.white).font("Helvetica").fontSize(11).text(subtitle, MARGIN + 44, 46, {
        width: pageWidth / 2
    });

    doc.fillColor(COLORS.white).font("Helvetica").fontSize(10).text(`Generated: ${generatedAt}`, pageWidth - MARGIN - 210, 24, {
        width: 210,
        align: "right"
    });
    doc.fillColor(COLORS.white).font("Helvetica").fontSize(10).text(`Tenant: ${tenantName}`, pageWidth - MARGIN - 210, 46, {
        width: 210,
        align: "right"
    });

    doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(12).text(title, MARGIN, 152);
    if (chunkLabel) {
        doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(chunkLabel, pageWidth - MARGIN - 180, 152, {
            width: 180,
            align: "right"
        });
    }
}

function drawCellText(doc, text, x, y, width, align = "left", font = "Helvetica", color = COLORS.text) {
    const innerWidth = Math.max(1, width - 2 * 4);
    const shown = doc.widthOfString(String(text || ""), { font, size: 8.2 }) > innerWidth
        ? (() => {
            let value = String(text || "");
            while (value.length > 1 && doc.widthOfString(`${value}...`, { font, size: 8.2 }) > innerWidth) {
                value = value.slice(0, -1);
            }
            return value.length < String(text || "").length ? `${value}...` : value;
        })()
        : String(text || "");

    doc.fillColor(color).font(font).fontSize(8.2).text(shown, x + 4, y + 6, {
        width: innerWidth,
        align,
        ellipsis: false
    });
}

function drawTable(doc, columns, rows) {
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
    let y = TABLE_TOP;
    let x = MARGIN;

    columns.forEach((column) => {
        doc.save();
        doc.rect(x, y, column.width, TABLE_HEADER_HEIGHT).fill(COLORS.primary);
        doc.restore();
        doc.rect(x, y, column.width, TABLE_HEADER_HEIGHT).stroke(COLORS.border);
        drawCellText(doc, column.label, x, y, column.width, "left", "Helvetica-Bold", COLORS.white);
        x += column.width;
    });

    if (!rows.length) {
        const emptyY = y + TABLE_HEADER_HEIGHT;
        doc.rect(MARGIN, emptyY, tableWidth, TABLE_ROW_HEIGHT).stroke(COLORS.border);
        drawCellText(doc, "No records found for selected filters.", MARGIN, emptyY, tableWidth, "left", "Helvetica", COLORS.muted);
        return;
    }

    rows.forEach((row, rowIndex) => {
        const rowY = y + TABLE_HEADER_HEIGHT + rowIndex * TABLE_ROW_HEIGHT;
        if (rowIndex % 2 === 1) {
            doc.save();
            doc.rect(MARGIN, rowY, tableWidth, TABLE_ROW_HEIGHT).fill(COLORS.stripe);
            doc.restore();
        }

        let cellX = MARGIN;
        columns.forEach((column) => {
            doc.rect(cellX, rowY, column.width, TABLE_ROW_HEIGHT).stroke(COLORS.border);
            const raw = formatValue(row?.[column.key]) || "-";
            const align = column.key === "__row_no" ? "center" : "left";
            drawCellText(doc, raw, cellX, rowY, column.width, align);
            cellX += column.width;
        });
    });
}

function drawFooter(doc, pageNumber, totalPages) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(
        `SMART SACCOS • Confidential Report • Page ${pageNumber} of ${totalPages}`,
        MARGIN,
        doc.page.height - FOOTER_HEIGHT,
        {
            width: doc.page.width - MARGIN * 2,
            align: "center"
        }
    );
}

async function buildSimplePdf(title, rows, options = {}) {
    const brandName = options.brandName || "SACCOS System";
    const subtitle = options.subtitle || "Official Financial Report";
    const tenantName = options.tenantName || "N/A";
    const generatedAt = options.generatedAt || new Date().toISOString();
    const logoPath = resolveLogoPath(options.logoPath);

    const safeRows = Array.isArray(rows) ? rows : [];
    const keys = collectKeys(safeRows);
    const normalizedRows = normalizeRows(safeRows, keys);
    const headers = ["__row_no", ...keys];

    const doc = new PDFDocument({
        size: PAGE_SIZE,
        margin: MARGIN,
        autoFirstPage: false,
        bufferPages: true
    });

    const pageWidth = 595;
    const pageHeight = 842;
    const tableWidth = pageWidth - MARGIN * 2;
    const rowsPerPage = Math.max(
        1,
        Math.floor((pageHeight - FOOTER_HEIGHT - (TABLE_TOP + TABLE_HEADER_HEIGHT)) / TABLE_ROW_HEIGHT)
    );

    const definitions = computeColumnDefinitions(headers, normalizedRows);
    const columnChunks = splitColumns(definitions, tableWidth).map((chunk) => withComputedWidths(chunk, tableWidth));
    const pagePlan = [];

    columnChunks.forEach((chunk, index) => {
        const rowSlices = paginateRows(normalizedRows, rowsPerPage);
        rowSlices.forEach((slice) => {
            pagePlan.push({
                columns: chunk,
                rows: slice,
                chunkLabel: columnChunks.length > 1 ? `Columns ${index + 1} of ${columnChunks.length}` : ""
            });
        });
    });

    pagePlan.forEach((plan) => {
        doc.addPage();
        drawHeader(doc, {
            brandName,
            subtitle,
            title,
            tenantName,
            generatedAt,
            logoPath,
            chunkLabel: plan.chunkLabel
        });
        drawTable(doc, plan.columns, plan.rows);
    });

    const chunks = [];
    const totalPages = pagePlan.length;
    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
        doc.switchToPage(pageIndex);
        drawFooter(doc, pageIndex + 1, totalPages);
    }

    return new Promise((resolve, reject) => {
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        doc.end();
    });
}

module.exports = {
    buildSimplePdf
};
