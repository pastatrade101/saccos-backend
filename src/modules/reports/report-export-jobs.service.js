const { adminSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");
const { assertTenantAccess } = require("../../services/user-context.service");
const { assertExportQuota, buildExportArtifact } = require("../../services/export.service");
const { logAudit } = require("../../services/audit.service");
const { runObservedJob } = require("../../services/observability.service");
const { getSubscriptionStatus } = require("../../services/subscription.service");

const REPORT_EXPORT_SIGNED_URL_TTL_SECONDS = Math.max(
    60,
    Number(process.env.REPORT_EXPORT_SIGNED_URL_TTL_SECONDS || 600)
);

function isMissingReportExportJobsSchema(error) {
    const message = String(error?.message || "").toLowerCase();
    return error?.code === "42P01" || message.includes("report_export_jobs");
}

function toJobSchemaError(error) {
    return new AppError(
        500,
        "REPORT_EXPORT_JOBS_SCHEMA_MISSING",
        "Report export jobs schema is missing. Apply SQL migration 027_phase3_report_export_jobs.sql.",
        error
    );
}

function normalizeError(error) {
    if (!error) {
        return {
            code: "INTERNAL_SERVER_ERROR",
            message: "An unexpected error occurred."
        };
    }

    if (error instanceof AppError) {
        return {
            code: error.code || "INTERNAL_SERVER_ERROR",
            message: error.message || "An unexpected error occurred."
        };
    }

    return {
        code: "INTERNAL_SERVER_ERROR",
        message: String(error.message || "An unexpected error occurred.")
    };
}

function buildResultPath(jobId, tenantId, extension) {
    const datePrefix = new Date().toISOString().slice(0, 10);
    return `tenant/${tenantId}/reports/${datePrefix}/${jobId}.${extension}`;
}

async function resolveTenantName(tenantId) {
    const { data, error } = await adminSupabase
        .from("tenants")
        .select("name")
        .eq("id", tenantId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        return null;
    }

    return data.name || null;
}

async function createReportExportJobRecord({ tenantId, createdBy, reportKey, format, query }) {
    const { data, error } = await adminSupabase
        .from("report_export_jobs")
        .insert({
            tenant_id: tenantId,
            created_by: createdBy,
            report_key: reportKey,
            format,
            query,
            status: "pending"
        })
        .select("*")
        .single();

    if (error || !data) {
        if (isMissingReportExportJobsSchema(error)) {
            throw toJobSchemaError(error);
        }

        throw new AppError(
            500,
            "REPORT_EXPORT_JOB_CREATE_FAILED",
            "Unable to create report export job.",
            error
        );
    }

    return data;
}

async function updateReportExportJob(jobId, payload) {
    const { data, error } = await adminSupabase
        .from("report_export_jobs")
        .update(payload)
        .eq("id", jobId)
        .select("*")
        .single();

    if (error || !data) {
        if (isMissingReportExportJobsSchema(error)) {
            throw toJobSchemaError(error);
        }

        throw new AppError(
            500,
            "REPORT_EXPORT_JOB_UPDATE_FAILED",
            "Unable to update report export job.",
            error
        );
    }

    return data;
}

async function uploadReportArtifact(path, artifact) {
    const bucket = adminSupabase.storage.from(env.importsBucket);
    const upload = await bucket.upload(path, artifact.buffer, {
        contentType: artifact.contentType,
        upsert: true
    });

    if (upload.error) {
        throw new AppError(
            500,
            "REPORT_EXPORT_UPLOAD_FAILED",
            "Unable to upload report export artifact.",
            upload.error
        );
    }
}

async function createSignedResultUrl(path) {
    const bucket = adminSupabase.storage.from(env.importsBucket);
    const signed = await bucket.createSignedUrl(path, REPORT_EXPORT_SIGNED_URL_TTL_SECONDS);

    if (signed.error || !signed.data?.signedUrl) {
        throw new AppError(
            500,
            "REPORT_EXPORT_SIGN_FAILED",
            "Unable to sign report export artifact.",
            signed.error
        );
    }

    return signed.data.signedUrl;
}

async function runReportExportJob({
    jobId,
    tenantId,
    actor,
    loader,
    query,
    reportKey,
    action
}) {
    await updateReportExportJob(jobId, {
        status: "processing",
        started_at: new Date().toISOString(),
        error_code: null,
        error_message: null
    });

    try {
        await runObservedJob(`report.export.async.${action}`, { tenantId }, async () => {
            const report = await loader(actor, query);
            const rows = Array.isArray(report?.rows) ? report.rows : [];
            const rowCount = rows.length;
            const tenantName = await resolveTenantName(tenantId);
            const subscription = await getSubscriptionStatus(tenantId);

            await assertExportQuota(subscription, tenantId);

            const artifact = await buildExportArtifact({
                rows,
                format: query.format,
                filename: report.filename,
                title: report.title,
                tenantName
            });
            const resultPath = buildResultPath(jobId, tenantId, artifact.fileExtension);

            await uploadReportArtifact(resultPath, artifact);

            await logAudit({
                tenantId,
                userId: actor.user.id,
                table: "reports",
                action,
                afterData: {
                    mode: "async",
                    report_key: reportKey,
                    format: query.format,
                    row_count: rowCount
                }
            });

            await updateReportExportJob(jobId, {
                status: "completed",
                filename: report.filename,
                title: report.title,
                row_count: rowCount,
                result_path: resultPath,
                content_type: artifact.contentType,
                completed_at: new Date().toISOString()
            });
        });
    } catch (error) {
        const normalizedError = normalizeError(error);
        await updateReportExportJob(jobId, {
            status: "failed",
            error_code: normalizedError.code,
            error_message: normalizedError.message,
            completed_at: new Date().toISOString()
        });
    }
}

async function queueReportExportJob({
    actor,
    query,
    loader,
    action,
    reportKey,
    subscription
}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    await assertExportQuota(subscription, tenantId);

    const job = await createReportExportJobRecord({
        tenantId,
        createdBy: actor.user.id,
        reportKey,
        format: query.format,
        query
    });

    setImmediate(() => {
        void runReportExportJob({
            jobId: job.id,
            tenantId,
            actor,
            loader,
            query,
            reportKey,
            action
        }).catch(() => {});
    });

    return {
        job_id: job.id,
        status: job.status,
        report_key: job.report_key,
        format: job.format,
        created_at: job.created_at
    };
}

async function getReportExportJob(actor, jobId) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from("report_export_jobs")
        .select("*")
        .eq("id", jobId)
        .eq("tenant_id", tenantId)
        .single();

    if (error || !data) {
        if (isMissingReportExportJobsSchema(error)) {
            throw toJobSchemaError(error);
        }

        throw new AppError(404, "REPORT_EXPORT_JOB_NOT_FOUND", "Report export job was not found.", error);
    }

    return data;
}

async function getReportExportJobDownload(actor, jobId) {
    const job = await getReportExportJob(actor, jobId);

    if (job.status !== "completed") {
        throw new AppError(
            409,
            "REPORT_EXPORT_NOT_READY",
            "Report export is not ready for download yet.",
            { status: job.status }
        );
    }

    if (!job.result_path) {
        throw new AppError(
            404,
            "REPORT_EXPORT_FILE_NOT_FOUND",
            "Report export artifact is missing."
        );
    }

    const signedUrl = await createSignedResultUrl(job.result_path);
    const extension = job.format === "pdf" ? "pdf" : "csv";

    return {
        signed_url: signedUrl,
        expires_in_seconds: REPORT_EXPORT_SIGNED_URL_TTL_SECONDS,
        filename: `${job.filename || "report-export"}.${extension}`,
        content_type: job.content_type || (job.format === "pdf" ? "application/pdf" : "text/csv")
    };
}

module.exports = {
    queueReportExportJob,
    getReportExportJob,
    getReportExportJobDownload
};
