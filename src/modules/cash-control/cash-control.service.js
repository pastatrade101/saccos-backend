const path = require("path");
const crypto = require("crypto");

const { adminSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");
const { sendExport } = require("../../services/export.service");
const { ROLES } = require("../../constants/roles");

function sanitizeFileName(fileName) {
    const extension = path.extname(fileName) || "";
    const base = path.basename(fileName, extension).replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60);
    return `${base || "receipt"}${extension.toLowerCase()}`;
}

async function getCashControlSettings(tenantId) {
    const { data, error } = await adminSupabase
        .from("cash_control_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .single();

    if (error || !data) {
        throw new AppError(500, "CASH_CONTROL_SETTINGS_MISSING", "Cash control settings are not configured for this tenant.", error);
    }

    return data;
}

async function getReceiptPolicyForBranch(tenantId, branchId) {
    const { data: branchPolicy, error: branchPolicyError } = await adminSupabase
        .from("receipt_policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .maybeSingle();

    if (branchPolicyError) {
        throw new AppError(500, "RECEIPT_POLICY_FETCH_FAILED", "Unable to load receipt policy.", branchPolicyError);
    }

    if (branchPolicy) {
        return branchPolicy;
    }

    const { data: tenantPolicy, error: tenantPolicyError } = await adminSupabase
        .from("receipt_policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("branch_id", null)
        .single();

    if (tenantPolicyError || !tenantPolicy) {
        throw new AppError(500, "RECEIPT_POLICY_FETCH_FAILED", "Default receipt policy is not configured.", tenantPolicyError);
    }

    return tenantPolicy;
}

async function listSessions(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let request = adminSupabase
        .from("teller_sessions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("opened_at", { ascending: false });

    if (query.status) {
        request = request.eq("status", query.status);
    }

    if (query.branch_id) {
        request = request.eq("branch_id", query.branch_id);
    } else if (actor.role === ROLES.TELLER && actor.branchIds.length) {
        request = request.in("branch_id", actor.branchIds);
    }

    if (query.teller_user_id) {
        request = request.eq("teller_user_id", query.teller_user_id);
    } else if (actor.role === ROLES.TELLER) {
        request = request.eq("teller_user_id", actor.user.id);
    }

    if (query.date) {
        request = request.gte("opened_at", `${query.date}T00:00:00.000Z`).lt("opened_at", `${query.date}T23:59:59.999Z`);
    }

    const { data, error } = await request;

    if (error) {
        throw new AppError(500, "TELLER_SESSIONS_LIST_FAILED", "Unable to load teller sessions.", error);
    }

    return data || [];
}

async function getCurrentSession(actor, branchId = null) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let request = adminSupabase
        .from("teller_sessions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1);

    if (branchId) {
        request = request.eq("branch_id", branchId);
    }

    if (actor.role === ROLES.TELLER) {
        request = request.eq("teller_user_id", actor.user.id);
    }

    const { data, error } = await request.maybeSingle();

    if (error) {
        throw new AppError(500, "CURRENT_TELLER_SESSION_FETCH_FAILED", "Unable to load current teller session.", error);
    }

    return data || null;
}

async function openSession(actor, payload) {
    const tenantId = actor.tenantId;
    const branchId = payload.branch_id || actor.branchIds[0];
    assertTenantAccess({ auth: actor }, tenantId);

    if (!branchId) {
        throw new AppError(400, "BRANCH_ID_REQUIRED", "Branch context is required to open a teller session.");
    }

    assertBranchAccess({ auth: actor }, branchId);

    const current = await getCurrentSession(actor, branchId);
    if (current) {
        throw new AppError(409, "TELLER_SESSION_ALREADY_OPEN", "An open teller session already exists for this teller.");
    }

    const { data, error } = await adminSupabase
        .from("teller_sessions")
        .insert({
            tenant_id: tenantId,
            branch_id: branchId,
            teller_user_id: actor.user.id,
            opened_by: actor.user.id,
            opening_cash: payload.opening_cash,
            expected_cash: payload.opening_cash,
            notes: payload.notes || null
        })
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "TELLER_SESSION_OPEN_FAILED", "Unable to open teller session.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "teller_sessions",
        action: "TELLER_SESSION_OPENED",
        entityType: "teller_session",
        entityId: data.id,
        afterData: data
    });

    return data;
}

async function closeSession(actor, sessionId, payload) {
    const { data: session, error: sessionError } = await adminSupabase
        .from("teller_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();

    if (sessionError || !session) {
        throw new AppError(404, "TELLER_SESSION_NOT_FOUND", "Teller session was not found.");
    }

    assertTenantAccess({ auth: actor }, session.tenant_id);
    assertBranchAccess({ auth: actor }, session.branch_id);

    if (session.teller_user_id !== actor.user.id && ![ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN].includes(actor.role)) {
        throw new AppError(403, "FORBIDDEN", "You are not allowed to close this teller session.");
    }

    const { data: totalsRows, error: totalsError } = await adminSupabase
        .from("teller_session_transactions")
        .select("direction, amount")
        .eq("session_id", sessionId);

    if (totalsError) {
        throw new AppError(500, "TELLER_SESSION_TOTALS_FAILED", "Unable to calculate teller session totals.", totalsError);
    }

    const inflow = (totalsRows || [])
        .filter((row) => row.direction === "in")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const outflow = (totalsRows || [])
        .filter((row) => row.direction === "out")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expectedCash = Number(session.opening_cash || 0) + inflow - outflow;
    const variance = Number(payload.closing_cash) - expectedCash;

    const { data, error } = await adminSupabase
        .from("teller_sessions")
        .update({
            expected_cash: expectedCash,
            closing_cash: payload.closing_cash,
            variance,
            closed_at: new Date().toISOString(),
            status: "closed_pending_review",
            notes: payload.notes || session.notes || null
        })
        .eq("id", sessionId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "TELLER_SESSION_CLOSE_FAILED", "Unable to close teller session.", error);
    }

    await logAudit({
        tenantId: session.tenant_id,
        actorUserId: actor.user.id,
        table: "teller_sessions",
        action: "TELLER_SESSION_CLOSED",
        entityType: "teller_session",
        entityId: sessionId,
        beforeData: session,
        afterData: data
    });

    return data;
}

async function reviewSession(actor, sessionId, payload) {
    const { data: session, error: sessionError } = await adminSupabase
        .from("teller_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();

    if (sessionError || !session) {
        throw new AppError(404, "TELLER_SESSION_NOT_FOUND", "Teller session was not found.");
    }

    assertTenantAccess({ auth: actor }, session.tenant_id);
    assertBranchAccess({ auth: actor }, session.branch_id);

    const { data, error } = await adminSupabase
        .from("teller_sessions")
        .update({
            status: "reviewed",
            reviewed_by: actor.user.id,
            reviewed_at: new Date().toISOString(),
            review_notes: payload.review_notes || null
        })
        .eq("id", sessionId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "TELLER_SESSION_REVIEW_FAILED", "Unable to review teller session.", error);
    }

    await logAudit({
        tenantId: session.tenant_id,
        actorUserId: actor.user.id,
        table: "teller_sessions",
        action: "TELLER_SESSION_REVIEWED",
        entityType: "teller_session",
        entityId: sessionId,
        beforeData: session,
        afterData: data
    });

    return data;
}

async function getReceiptPolicy(actor, branchId = null) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    return getReceiptPolicyForBranch(tenantId, branchId || actor.branchIds[0] || null);
}

async function updateReceiptPolicy(actor, payload) {
    const tenantId = actor.tenantId;
    const branchId = payload.branch_id || null;
    assertTenantAccess({ auth: actor }, tenantId);
    if (branchId) {
        assertBranchAccess({ auth: actor }, branchId);
    }

    let existingQuery = adminSupabase
        .from("receipt_policies")
        .select("*")
        .eq("tenant_id", tenantId);

    if (branchId) {
        existingQuery = existingQuery.eq("branch_id", branchId);
    } else {
        existingQuery = existingQuery.is("branch_id", null);
    }

    const { data: existing, error: existingError } = await existingQuery.maybeSingle();

    if (existingError) {
        throw new AppError(500, "RECEIPT_POLICY_FETCH_FAILED", "Unable to load existing receipt policy.", existingError);
    }

    let data;
    let error;
    if (existing) {
        ({ data, error } = await adminSupabase
            .from("receipt_policies")
            .update({
                ...payload,
                branch_id: branchId,
                updated_by: actor.user.id
            })
            .eq("id", existing.id)
            .select("*")
            .single());
    } else {
        ({ data, error } = await adminSupabase
            .from("receipt_policies")
            .insert({
                tenant_id: tenantId,
                branch_id: branchId,
                ...payload,
                created_by: actor.user.id,
                updated_by: actor.user.id
            })
            .select("*")
            .single());
    }

    if (error || !data) {
        throw new AppError(500, "RECEIPT_POLICY_SAVE_FAILED", "Unable to save receipt policy.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "receipt_policies",
        action: "RECEIPT_POLICY_UPDATED",
        entityType: "receipt_policy",
        entityId: data.id,
        beforeData: existing || null,
        afterData: data
    });

    return data;
}

async function initReceiptUpload(actor, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    assertBranchAccess({ auth: actor }, payload.branch_id);

    const policy = await getReceiptPolicyForBranch(tenantId, payload.branch_id);
    const allowedMimeTypes = Array.isArray(policy.allowed_mime_types) ? policy.allowed_mime_types : [];
    const maxBytes = Number(policy.max_file_size_mb || 0) * 1024 * 1024;

    if (allowedMimeTypes.length && !allowedMimeTypes.includes(payload.mime_type)) {
        throw new AppError(400, "RECEIPT_MIME_NOT_ALLOWED", "This receipt file type is not allowed.");
    }

    if (maxBytes > 0 && payload.file_size_bytes > maxBytes) {
        throw new AppError(400, "RECEIPT_FILE_TOO_LARGE", "Receipt file exceeds the configured size limit.");
    }

    const id = crypto.randomUUID();
    const safeName = sanitizeFileName(payload.file_name);
    const storagePath = `tenant/${tenantId}/branch/${payload.branch_id}/receipts/${id}-${safeName}`;

    const { data: receipt, error } = await adminSupabase
        .from("transaction_receipts")
        .insert({
            id,
            tenant_id: tenantId,
            branch_id: payload.branch_id,
            member_id: payload.member_id || null,
            transaction_type: payload.transaction_type,
            storage_bucket: env.receiptsBucket,
            storage_path: storagePath,
            file_name: payload.file_name,
            mime_type: payload.mime_type,
            file_size_bytes: payload.file_size_bytes,
            uploaded_by: actor.user.id
        })
        .select("*")
        .single();

    if (error || !receipt) {
        throw new AppError(500, "RECEIPT_INIT_FAILED", "Unable to initialize receipt upload.", error);
    }

    const { data: signedUpload, error: signedUploadError } = await adminSupabase
        .storage
        .from(env.receiptsBucket)
        .createSignedUploadUrl(storagePath);

    if (signedUploadError || !signedUpload) {
        throw new AppError(500, "RECEIPT_SIGNED_UPLOAD_FAILED", "Unable to create signed upload URL.", signedUploadError);
    }

    return {
        receipt,
        upload: signedUpload
    };
}

async function confirmReceiptUpload(actor, receiptId, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: receipt, error: receiptError } = await adminSupabase
        .from("transaction_receipts")
        .select("*")
        .eq("id", receiptId)
        .eq("tenant_id", tenantId)
        .single();

    if (receiptError || !receipt) {
        throw new AppError(404, "RECEIPT_NOT_FOUND", "Receipt draft was not found.");
    }

    if (receipt.uploaded_by !== actor.user.id && ![ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER].includes(actor.role)) {
        throw new AppError(403, "FORBIDDEN", "You are not allowed to confirm this receipt.");
    }

    const { data, error } = await adminSupabase
        .from("transaction_receipts")
        .update({
            status: "uploaded",
            checksum_sha256: payload.checksum_sha256 || null
        })
        .eq("id", receiptId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "RECEIPT_CONFIRM_FAILED", "Unable to confirm receipt upload.", error);
    }

    return data;
}

async function finalizeReceiptsForTransaction(actor, { tenantId, branchId, memberId = null, journalId, transactionType, amount, receiptIds = [] }) {
    const policy = await getReceiptPolicyForBranch(tenantId, branchId);
    const enforceTypes = Array.isArray(policy.enforce_on_types) ? policy.enforce_on_types : [];
    const requiresReceipt = Boolean(policy.receipt_required)
        && enforceTypes.includes(transactionType)
        && Number(amount) >= Number(policy.required_threshold || 0);

    const uniqueReceiptIds = [...new Set((receiptIds || []).filter(Boolean))];

    if (requiresReceipt && uniqueReceiptIds.length === 0) {
        throw new AppError(400, "RECEIPT_REQUIRED", "Receipt upload is required for this transaction.");
    }

    if (uniqueReceiptIds.length > Number(policy.max_receipts_per_tx || 0)) {
        throw new AppError(400, "RECEIPT_LIMIT_EXCEEDED", "Too many receipts were attached to this transaction.");
    }

    if (!uniqueReceiptIds.length) {
        return [];
    }

    const { data: receipts, error } = await adminSupabase
        .from("transaction_receipts")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("id", uniqueReceiptIds);

    if (error) {
        throw new AppError(500, "RECEIPT_FETCH_FAILED", "Unable to load transaction receipts.", error);
    }

    if ((receipts || []).length !== uniqueReceiptIds.length) {
        throw new AppError(400, "RECEIPT_NOT_FOUND", "One or more attached receipts could not be found.");
    }

    const invalidReceipt = (receipts || []).find((receipt) =>
        receipt.status !== "uploaded"
        || receipt.journal_id
        || receipt.branch_id !== branchId
        || receipt.transaction_type !== transactionType
        || receipt.uploaded_by !== actor.user.id
    );

    if (invalidReceipt) {
        throw new AppError(400, "RECEIPT_NOT_READY", "One or more receipts are not ready to be attached to the transaction.");
    }

    const { data: finalized, error: finalizeError } = await adminSupabase
        .from("transaction_receipts")
        .update({
            journal_id: journalId,
            member_id: memberId,
            confirmed_by: actor.user.id,
            confirmed_at: new Date().toISOString(),
            status: "confirmed"
        })
        .in("id", uniqueReceiptIds)
        .select("*");

    if (finalizeError) {
        throw new AppError(500, "RECEIPT_FINALIZE_FAILED", "Unable to attach receipts to the transaction.", finalizeError);
    }

    return finalized || [];
}

async function ensureOpenTellerSession(actor, { tenantId, branchId }) {
    if (actor.role !== ROLES.TELLER) {
        return null;
    }

    const settings = await getCashControlSettings(tenantId);
    if (!settings.enforce_open_teller_session || settings.allow_session_bypass) {
        return null;
    }

    const { data, error } = await adminSupabase
        .from("teller_sessions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("teller_user_id", actor.user.id)
        .eq("status", "open")
        .maybeSingle();

    if (error) {
        throw new AppError(500, "TELLER_SESSION_LOOKUP_FAILED", "Unable to validate open teller session.", error);
    }

    if (!data) {
        throw new AppError(409, "TELLER_SESSION_REQUIRED", "Open a teller session before posting this transaction.");
    }

    return data;
}

async function recordSessionTransaction({ session, tenantId, branchId, journalId, transactionType, direction, amount, userId }) {
    if (!session || !journalId) {
        return null;
    }

    const { data, error } = await adminSupabase
        .from("teller_session_transactions")
        .insert({
            session_id: session.id,
            tenant_id: tenantId,
            branch_id: branchId,
            journal_id: journalId,
            transaction_type: transactionType,
            direction,
            amount,
            recorded_by: userId
        })
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "TELLER_SESSION_TRANSACTION_FAILED", "Unable to record teller session transaction.", error);
    }

    return data;
}

async function getDailySummary(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let request = adminSupabase
        .from("v_daily_cash_summary")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("business_date", { ascending: false });

    if (query.date) {
        request = request.eq("business_date", query.date);
    }

    if (query.branch_id) {
        request = request.eq("branch_id", query.branch_id);
    } else if (actor.role === ROLES.TELLER && actor.branchIds.length) {
        request = request.in("branch_id", actor.branchIds);
    }

    if (query.teller_user_id) {
        request = request.eq("teller_user_id", query.teller_user_id);
    } else if (actor.role === ROLES.TELLER) {
        request = request.eq("teller_user_id", actor.user.id);
    }

    const { data, error } = await request;

    if (error) {
        throw new AppError(500, "CASH_SUMMARY_FETCH_FAILED", "Unable to load daily cash summary.", error);
    }

    return data || [];
}

async function listJournalReceipts(actor, journalId) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from("transaction_receipts")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("journal_id", journalId)
        .order("created_at", { ascending: true });

    if (error) {
        throw new AppError(500, "TRANSACTION_RECEIPTS_FETCH_FAILED", "Unable to load transaction receipts.", error);
    }

    return data || [];
}

async function getReceiptDownload(actor, receiptId) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: receipt, error: receiptError } = await adminSupabase
        .from("transaction_receipts")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", receiptId)
        .single();

    if (receiptError || !receipt) {
        throw new AppError(404, "RECEIPT_NOT_FOUND", "Receipt was not found.");
    }

    const { data, error } = await adminSupabase
        .storage
        .from(receipt.storage_bucket)
        .createSignedUrl(receipt.storage_path, 60 * 10);

    if (error || !data) {
        throw new AppError(500, "RECEIPT_DOWNLOAD_URL_FAILED", "Unable to create receipt download URL.", error);
    }

    return {
        signed_url: data.signedUrl,
        receipt
    };
}

async function exportDailyCashbook(actor, res, query) {
    const rows = await getDailySummary(actor, query);
    return sendExport(res, {
        rows,
        format: "csv",
        filename: `daily-cashbook-${query.date || "latest"}`,
        title: "Daily Cashbook"
    });
}

async function exportTellerBalancing(actor, res, query) {
    const rows = await listSessions(actor, query);
    return sendExport(res, {
        rows,
        format: "csv",
        filename: `teller-balancing-${query.date || "latest"}`,
        title: "Teller Balancing Report"
    });
}

module.exports = {
    getCashControlSettings,
    getReceiptPolicyForBranch,
    listSessions,
    getCurrentSession,
    openSession,
    closeSession,
    reviewSession,
    getReceiptPolicy,
    updateReceiptPolicy,
    initReceiptUpload,
    confirmReceiptUpload,
    finalizeReceiptsForTransaction,
    ensureOpenTellerSession,
    recordSessionTransaction,
    getDailySummary,
    listJournalReceipts,
    getReceiptDownload,
    exportDailyCashbook,
    exportTellerBalancing
};
