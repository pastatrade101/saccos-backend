const { adminSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");
const reportService = require("./reports.service");
const { assertTenantAccess, getBranchAssignments, getUserProfile } = require("../../services/user-context.service");
const { assertExportQuota, buildExportArtifact } = require("../../services/export.service");
const { logAudit } = require("../../services/audit.service");
const { runObservedJob } = require("../../services/observability.service");
const { getSubscriptionStatus } = require("../../services/subscription.service");

const REPORT_EXPORT_SIGNED_URL_TTL_SECONDS = Math.max(
    60,
    Number(process.env.REPORT_EXPORT_SIGNED_URL_TTL_SECONDS || 600)
);
const REPORT_EXPORT_JOB_TIMEOUT_MS = Math.max(
    10000,
    Number(process.env.REPORT_EXPORT_JOB_TIMEOUT_MS || 120000)
);
const REPORT_EXPORT_UPLOAD_TIMEOUT_MS = Math.max(
    5000,
    Number(process.env.REPORT_EXPORT_UPLOAD_TIMEOUT_MS || 45000)
);
const REPORT_EXPORT_WORKER_BACKOFF_MS = Math.max(
    500,
    Number(process.env.REPORT_EXPORT_WORKER_BACKOFF_MS || 1000)
);
const REPORT_EXPORT_MAX_RETRIES = Math.max(
    0,
    Number(process.env.REPORT_EXPORT_MAX_RETRIES || 3)
);
const REPORT_EXPORT_RETRY_BASE_MS = Math.max(
    1000,
    Number(process.env.REPORT_EXPORT_RETRY_BASE_MS || 5000)
);
const REPORT_EXPORT_RETRY_MAX_MS = Math.max(
    REPORT_EXPORT_RETRY_BASE_MS,
    Number(process.env.REPORT_EXPORT_RETRY_MAX_MS || 300000)
);

const REPORT_REGISTRY = {
    member_statement: {
        loader: reportService.memberStatement,
        action: "export_member_statement"
    },
    trial_balance: {
        loader: reportService.trialBalance,
        action: "export_trial_balance"
    },
    cash_position: {
        loader: reportService.cashPosition,
        action: "export_cash_position"
    },
    par: {
        loader: reportService.parReport,
        action: "export_par"
    },
    loan_aging: {
        loader: reportService.loanAging,
        action: "export_loan_aging"
    },
    loan_portfolio_summary: {
        loader: reportService.loanPortfolioSummary,
        action: "export_loan_portfolio_summary"
    },
    member_balances_summary: {
        loader: reportService.memberBalancesSummary,
        action: "export_member_balances_summary"
    },
    audit_exceptions: {
        loader: reportService.auditExceptionsReport,
        action: "export_audit_exceptions"
    }
};

function isMissingReportExportJobsSchema(error) {
    const message = String(error?.message || "").toLowerCase();
    return error?.code === "42P01" || message.includes("report_export_jobs");
}

function isMissingReportExportJobClaimFunction(error) {
    const message = String(error?.message || "").toLowerCase();
    return error?.code === "42883" && message.includes("claim_report_export_job");
}

function toJobSchemaError(error) {
    return new AppError(
        500,
        "REPORT_EXPORT_JOBS_SCHEMA_MISSING",
        "Report export jobs schema is missing. Apply SQL migration 027_phase3_report_export_jobs.sql.",
        error
    );
}

function toClaimFunctionError(error) {
    return new AppError(
        500,
        "REPORT_EXPORT_JOB_CLAIM_FUNCTION_MISSING",
        "Report export claim function is missing. Apply SQL migrations 028_phase3_report_export_worker.sql and 029_phase3_report_export_retries.sql.",
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

function toJobRetryCount(job) {
    const value = Number(job?.retry_count);
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }
    return Math.trunc(value);
}

function toJobMaxRetries(job) {
    const value = Number(job?.max_retries);
    if (!Number.isFinite(value) || value < 0) {
        return REPORT_EXPORT_MAX_RETRIES;
    }
    return Math.trunc(value);
}

function computeRetryDelayMs(nextRetryCount) {
    const safeRetryCount = Math.max(1, Number(nextRetryCount) || 1);
    const delay = REPORT_EXPORT_RETRY_BASE_MS * (2 ** (safeRetryCount - 1));
    return Math.min(REPORT_EXPORT_RETRY_MAX_MS, delay);
}

async function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function withTimeout(promise, timeoutMs, code, message) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new AppError(504, code, message));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
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
        error_message: null,
        completed_at: null
    });

    await withTimeout(
        runObservedJob(`report.export.async.${action}`, { tenantId }, async () => {
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

            await withTimeout(
                uploadReportArtifact(resultPath, artifact),
                REPORT_EXPORT_UPLOAD_TIMEOUT_MS,
                "REPORT_EXPORT_UPLOAD_TIMEOUT",
                "Report export upload timed out."
            );

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
                dead_lettered_at: null,
                completed_at: new Date().toISOString()
            });
        }),
        REPORT_EXPORT_JOB_TIMEOUT_MS,
        "REPORT_EXPORT_JOB_TIMEOUT",
        "Report export job timed out."
    );
}

function toActorFromJob({ job, profile, branchIds }) {
    return {
        user: {
            id: job.created_by
        },
        profile,
        branchIds,
        tenantId: profile?.tenant_id || null,
        role: profile?.role || null,
        isInternalOps: profile?.role === "platform_admin"
    };
}

async function claimNextReportExportJob() {
    const { data, error } = await adminSupabase.rpc("claim_report_export_job");

    if (error) {
        if (isMissingReportExportJobClaimFunction(error)) {
            throw toClaimFunctionError(error);
        }
        if (isMissingReportExportJobsSchema(error)) {
            throw toJobSchemaError(error);
        }
        throw new AppError(
            500,
            "REPORT_EXPORT_JOB_CLAIM_FAILED",
            "Unable to claim next report export job.",
            error
        );
    }

    const job = Array.isArray(data) ? (data[0] || null) : data;
    if (!job) {
        return null;
    }

    // Some Postgres client paths can deserialize an unassigned composite return
    // as an object with all-null fields. Treat this as "no pending job".
    if (!job.id || !job.report_key || !job.tenant_id || !job.created_by) {
        return null;
    }

    return job;
}

async function processClaimedReportExportJob(job) {
    const registryItem = REPORT_REGISTRY[job.report_key];
    if (!registryItem) {
        throw new AppError(
            400,
            "REPORT_EXPORT_UNKNOWN_REPORT_KEY",
            `Unknown report key: ${job.report_key}`
        );
    }

    const [profile, branchIds] = await Promise.all([
        getUserProfile(job.created_by),
        getBranchAssignments(job.created_by)
    ]);

    if (!profile || profile.tenant_id !== job.tenant_id || !profile.is_active) {
        throw new AppError(
            403,
            "REPORT_EXPORT_ACTOR_INVALID",
            "Export job creator profile is missing, inactive, or out of tenant scope."
        );
    }

    const actor = toActorFromJob({
        job,
        profile,
        branchIds
    });
    const safeQuery = {
        ...(job.query || {}),
        tenant_id: job.tenant_id,
        format: job.format
    };

    await runReportExportJob({
        jobId: job.id,
        tenantId: job.tenant_id,
        actor,
        loader: registryItem.loader,
        query: safeQuery,
        reportKey: job.report_key,
        action: registryItem.action
    });
}

async function handleJobProcessingFailure(job, error) {
    const normalizedError = normalizeError(error);
    const currentRetryCount = toJobRetryCount(job);
    const maxRetries = toJobMaxRetries(job);
    const nextRetryCount = currentRetryCount + 1;

    const nonRetryableCodes = new Set([
        "REPORT_EXPORT_UNKNOWN_REPORT_KEY",
        "REPORT_EXPORT_ACTOR_INVALID"
    ]);

    if (!nonRetryableCodes.has(normalizedError.code) && currentRetryCount < maxRetries) {
        const retryDelayMs = computeRetryDelayMs(nextRetryCount);
        const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();

        await updateReportExportJob(job.id, {
            status: "pending",
            retry_count: nextRetryCount,
            next_attempt_at: nextAttemptAt,
            error_code: normalizedError.code,
            error_message: normalizedError.message,
            completed_at: null
        });

        console.warn("[report-export-worker] retry scheduled", {
            jobId: job.id,
            reportKey: job.report_key,
            retryCount: nextRetryCount,
            maxRetries,
            retryDelayMs,
            code: normalizedError.code
        });
        return;
    }

    await updateReportExportJob(job.id, {
        status: "failed",
        retry_count: nextRetryCount,
        error_code: normalizedError.code,
        error_message: normalizedError.message,
        dead_lettered_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
    });

    console.error("[report-export-worker] job moved to dead-letter", {
        jobId: job.id,
        reportKey: job.report_key,
        retryCount: nextRetryCount,
        maxRetries,
        code: normalizedError.code,
        message: normalizedError.message
    });
}

async function processNextReportExportJob() {
    const job = await claimNextReportExportJob();
    if (!job) {
        return false;
    }

    try {
        await processClaimedReportExportJob(job);
    } catch (error) {
        try {
            await handleJobProcessingFailure(job, error);
        } catch (updateError) {
            const normalizedError = normalizeError(error);
            console.error("[report-export-worker] failed to persist worker failure", {
                jobId: job.id,
                reportKey: job.report_key,
                code: normalizedError.code,
                message: normalizedError.message,
                error: String(updateError?.message || updateError)
            });
        }
    }

    return true;
}

async function runReportExportWorkerLoop(options = {}) {
    const shouldStop = typeof options.shouldStop === "function" ? options.shouldStop : () => false;

    while (!shouldStop()) {
        try {
            const processed = await processNextReportExportJob();
            if (!processed) {
                await wait(REPORT_EXPORT_WORKER_BACKOFF_MS);
            }
        } catch (error) {
            const normalizedError = normalizeError(error);
            console.error("[report-export-worker] loop error", {
                code: normalizedError.code,
                message: normalizedError.message
            });
            await wait(REPORT_EXPORT_WORKER_BACKOFF_MS);
        }
    }
}

async function queueReportExportJob({
    actor,
    query,
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
    getReportExportJobDownload,
    processNextReportExportJob,
    runReportExportWorkerLoop
};
