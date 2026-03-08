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
    const safeRows = Array.isArray(rows) ? rows : [];

    if (format === "pdf") {
        const buffer = await buildSimplePdf(title, safeRows, {
            brandName: env.reportBrandName,
            subtitle: env.reportBrandSubtitle,
            generatedAt: new Date().toISOString(),
            tenantName: tenantName || "N/A",
            logoPath: env.reportBrandLogoPath || ""
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
        return res.send(buffer);
    }

    const csv = toCsv(safeRows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    return res.send(csv);
}

module.exports = {
    assertExportQuota,
    sendExport
};
