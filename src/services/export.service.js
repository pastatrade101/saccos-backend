const { adminSupabase } = require("../config/supabase");
const env = require("../config/env");
const AppError = require("../utils/app-error");
const { toCsv } = require("../utils/csv");
const { buildSimplePdf } = require("../utils/pdf");

async function assertExportQuota(subscription, tenantId) {
    const limit = subscription?.limits?.exportsPerDay;

    if (!Number.isFinite(limit)) {
        return;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { count, error } = await adminSupabase
        .from("audit_logs")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("timestamp", startOfDay.toISOString())
        .ilike("action", "export_%");

    if (error) {
        throw new AppError(500, "EXPORT_QUOTA_LOOKUP_FAILED", "Unable to evaluate export quota.");
    }

    if ((count || 0) >= limit) {
        throw new AppError(403, "EXPORT_QUOTA_EXCEEDED", "Daily export quota exceeded for this plan.", {
            limit
        });
    }
}

async function sendExport(res, { rows, format, filename, title, tenantName }) {
    const artifact = await buildExportArtifact({
        rows,
        format,
        filename,
        title,
        tenantName
    });

    res.setHeader("Content-Type", artifact.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
    return res.send(artifact.buffer);
}

async function buildExportArtifact({ rows, format, filename, title, tenantName }) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const normalizedFormat = String(format || "csv").toLowerCase();

    if (normalizedFormat === "pdf") {
        const buffer = await buildSimplePdf(title, safeRows, {
            brandName: env.reportBrandName,
            subtitle: env.reportBrandSubtitle,
            generatedAt: new Date().toISOString(),
            tenantName: tenantName || "N/A",
            logoPath: env.reportBrandLogoPath || ""
        });
        return {
            buffer,
            contentType: "application/pdf",
            fileExtension: "pdf",
            fileName: `${filename}.pdf`
        };
    }

    const csv = toCsv(safeRows);
    return {
        buffer: Buffer.from(csv, "utf8"),
        contentType: "text/csv; charset=utf-8",
        fileExtension: "csv",
        fileName: `${filename}.csv`
    };
}

module.exports = {
    assertExportQuota,
    sendExport,
    buildExportArtifact
};
