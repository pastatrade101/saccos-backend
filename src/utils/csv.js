function splitCsvLine(line) {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === "," && !inQuotes) {
            values.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    values.push(current);
    return values.map((value) => value.trim());
}

function parseCsvBuffer(buffer) {
    const content = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);

    if (!lines.length) {
        return { headers: [], rows: [] };
    }

    const headers = splitCsvLine(lines[0]);
    const rows = lines.slice(1).map((line, index) => {
        const values = splitCsvLine(line);
        const raw = {};

        headers.forEach((header, headerIndex) => {
            raw[header] = values[headerIndex] ?? "";
        });

        return {
            rowNumber: index + 2,
            raw
        };
    });

    return { headers, rows };
}

function escapeCsvValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value);

    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, "\"\"")}"`;
    }

    return text;
}

function inferHeaders(rows) {
    const headers = [];
    const seen = new Set();

    rows.forEach((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
            return;
        }

        Object.keys(row).forEach((key) => {
            if (!seen.has(key)) {
                seen.add(key);
                headers.push(key);
            }
        });
    });

    return headers;
}

function toCsv(headersOrRows, maybeRows) {
    const rows = Array.isArray(maybeRows)
        ? maybeRows
        : (Array.isArray(headersOrRows) ? headersOrRows : []);
    const headers = Array.isArray(maybeRows)
        ? (Array.isArray(headersOrRows) ? headersOrRows : [])
        : inferHeaders(rows);

    if (!headers.length) {
        return "";
    }

    const headerLine = headers.map(escapeCsvValue).join(",");
    const dataLines = rows.map((row) => headers.map((header) => escapeCsvValue(row?.[header])).join(","));
    return [headerLine, ...dataLines].join("\n");
}

module.exports = {
    parseCsvBuffer,
    toCsv
};
