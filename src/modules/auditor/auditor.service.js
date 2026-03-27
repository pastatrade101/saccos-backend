const crypto = require("crypto");
const env = require("../../config/env");
const { adminSupabase } = require("../../config/supabase");
const { createInAppNotifications } = require("../notifications/notifications.service");
const AppError = require("../../utils/app-error");
const { assertTenantAccess } = require("../../services/user-context.service");
const reportService = require("../reports/reports.service");

function getReasonSeverity(reasonCode) {
    if (["REVERSAL", "MAKER_CHECKER_VIOLATION", "CASH_VARIANCE"].includes(reasonCode)) {
        return "critical";
    }
    if (["HIGH_VALUE_TX", "BACKDATED_ENTRY", "OUT_OF_HOURS_POSTING"].includes(reasonCode)) {
        return "warning";
    }
    return "info";
}

function buildAuditCaseKey(exception) {
    const parts = [
        exception.tenant_id || "",
        exception.reason_code || "",
        exception.journal_id || "",
        exception.reference || "",
        exception.branch_id || "",
        exception.user_id || "",
        exception.created_at || "",
        Number(exception.amount || 0).toFixed(2)
    ];

    return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
}

function toRange(page, limit) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    return { from, to };
}

function applyDateRange(query, column, from, to) {
    let next = query;

    if (from) {
        next = next.gte(column, from);
    }

    if (to) {
        next = next.lte(column, to);
    }

    return next;
}

function toTimeValue(value) {
    const [hours = "0", minutes = "0"] = String(value).split(":");
    return Number(hours) * 60 + Number(minutes);
}

function isOutOfHours(timestamp) {
    if (!timestamp) {
        return false;
    }

    const date = new Date(timestamp);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const start = toTimeValue(env.outOfHoursStart);
    const end = toTimeValue(env.outOfHoursEnd);

    if (start > end) {
        return minutes >= start || minutes < end;
    }

    return minutes >= start && minutes < end;
}

function computeJournalFlags(journal, amount) {
    const flags = [];

    if (amount >= env.highValueThresholdTzs) {
        flags.push("HIGH_VALUE_TX");
    }

    if (journal.entry_date && journal.created_at && journal.entry_date < journal.created_at.slice(0, 10)) {
        flags.push("BACKDATED_ENTRY");
    }

    if (journal.is_reversal) {
        flags.push("REVERSAL");
    }

    if (journal.reference === "MANUAL" || journal.source_type === "adjustment") {
        flags.push("MANUAL_JOURNAL");
    }

    if (isOutOfHours(journal.posted_at || journal.created_at)) {
        flags.push("OUT_OF_HOURS_POSTING");
    }

    return flags;
}

function sanitizeFileName(fileName) {
    return String(fileName || "evidence")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 120) || "evidence";
}

async function loadExceptionRows(tenantId, query = {}, { page, limit } = {}) {
    let exceptionQuery = adminSupabase
        .from("v_audit_exception_feed")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    exceptionQuery = applyDateRange(exceptionQuery, "created_at", query.from, query.to);

    if (query.reason) {
        exceptionQuery = exceptionQuery.eq("reason_code", query.reason);
    }

    if (page && limit) {
        const range = toRange(page, limit);
        exceptionQuery = exceptionQuery.range(range.from, range.to);
    }

    const { data, count, error } = await exceptionQuery;

    if (error) {
        throw new AppError(500, "AUDITOR_EXCEPTIONS_FAILED", "Unable to load auditor exceptions.", error);
    }

    return {
        rows: (data || []).map((row) => ({
            ...row,
            case_key: buildAuditCaseKey(row),
            severity: getReasonSeverity(row.reason_code)
        })),
        count: count || 0
    };
}

async function resolveCaseAssigneeNames(tenantId, cases = []) {
    const assigneeIds = Array.from(new Set((cases || []).map((row) => row.assignee_user_id).filter(Boolean)));
    if (!assigneeIds.length) {
        return new Map();
    }

    const { data: assignees, error: assigneesError } = await adminSupabase
        .from("user_profiles")
        .select("user_id, full_name")
        .eq("tenant_id", tenantId)
        .in("user_id", assigneeIds);

    if (assigneesError) {
        throw new AppError(500, "AUDITOR_EXCEPTION_ASSIGNEE_LOOKUP_FAILED", "Unable to resolve case assignees.", assigneesError);
    }

    return new Map((assignees || []).map((row) => [row.user_id, row.full_name]));
}

async function validateAssignee(tenantId, assigneeUserId) {
    if (!assigneeUserId) {
        return;
    }

    const { data: assignee, error: assigneeError } = await adminSupabase
        .from("user_profiles")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", assigneeUserId)
        .eq("role", "auditor")
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle();

    if (assigneeError) {
        throw new AppError(500, "AUDIT_CASE_ASSIGNEE_VALIDATE_FAILED", "Unable to validate case assignee.", assigneeError);
    }

    if (!assignee) {
        throw new AppError(400, "AUDIT_CASE_ASSIGNEE_INVALID", "Selected assignee is not an active auditor.");
    }
}

async function notifyCriticalAuditCase({ tenantId, branchId, caseRow, reasonLabel }) {
    const { data: auditors, error } = await adminSupabase
        .from("user_profiles")
        .select("user_id, full_name, role")
        .eq("tenant_id", tenantId)
        .eq("role", "auditor")
        .eq("is_active", true)
        .is("deleted_at", null);

    if (error) {
        throw new AppError(500, "AUDIT_CASE_NOTIFY_FAILED", "Unable to load auditors for critical case notification.", error);
    }

    await createInAppNotifications({
        tenantId,
        branchId: branchId || null,
        eventType: "audit_case_critical",
        eventKey: `audit_case_critical:${caseRow.case_key}`,
        message: `${reasonLabel} was opened as a critical audit case and requires investigation.`,
        metadata: {
            audit_case_id: caseRow.id,
            audit_case_key: caseRow.case_key,
            reason_code: caseRow.reason_code,
            branch_id: branchId || null,
            journal_id: caseRow.journal_id || null
        },
        recipients: (auditors || []).map((row) => ({
            user_id: row.user_id,
            full_name: row.full_name || "Auditor",
            role: row.role || "auditor"
        }))
    });
}

async function ensureAuditCase(actor, caseKey, payload = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: existing, error: existingError } = await adminSupabase
        .from("audit_cases")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("case_key", caseKey)
        .maybeSingle();

    if (existingError && !["PGRST205", "42P01", "42703"].includes(String(existingError.code || ""))) {
        throw new AppError(500, "AUDIT_CASE_LOOKUP_FAILED", "Unable to load audit case.", existingError);
    }

    if (existing) {
        return { caseRow: existing, created: false };
    }

    const reasonCode = payload.reason_code;
    if (!reasonCode) {
        throw new AppError(404, "AUDIT_CASE_NOT_FOUND", "Audit case was not found.");
    }

    const caseInsert = {
        tenant_id: tenantId,
        case_key: caseKey,
        reason_code: reasonCode,
        severity: getReasonSeverity(reasonCode),
        status: payload.status || "open",
        journal_id: payload.journal_id || null,
        branch_id: payload.branch_id || null,
        subject_user_id: payload.user_id || null,
        reference: payload.reference || null,
        assignee_user_id: payload.assignee_user_id || null,
        notes: payload.notes ? String(payload.notes).trim() : null,
        opened_at: new Date().toISOString(),
        resolved_at: ["resolved", "waived"].includes(payload.status) ? new Date().toISOString() : null,
        resolved_by: ["resolved", "waived"].includes(payload.status) ? actor.user.id : null,
        created_by: actor.user.id,
        updated_by: actor.user.id
    };

    const { data, error } = await adminSupabase
        .from("audit_cases")
        .insert(caseInsert)
        .select("*")
        .single();

    if (error || !data) {
        if (String(error?.code || "") === "23505") {
            const { data: duplicateCase, error: duplicateError } = await adminSupabase
                .from("audit_cases")
                .select("*")
                .eq("tenant_id", tenantId)
                .eq("case_key", caseKey)
                .single();

            if (duplicateError || !duplicateCase) {
                throw new AppError(500, "AUDIT_CASE_CREATE_FAILED", "Unable to create audit case.", error || duplicateError);
            }

            return { caseRow: duplicateCase, created: false };
        }

        throw new AppError(500, "AUDIT_CASE_CREATE_FAILED", "Unable to create audit case.", error);
    }

    if (data.severity === "critical") {
        await notifyCriticalAuditCase({
            tenantId,
            branchId: data.branch_id,
            caseRow: data,
            reasonLabel: reasonCode.replaceAll("_", " ").toLowerCase()
        });
    }

    return { caseRow: data, created: true };
}

async function getSummary(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let journalQuery = adminSupabase
        .from("journal_entries")
        .select("id, entry_date, created_at, posted, is_reversal, source_type, reference, posted_at", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    journalQuery = applyDateRange(journalQuery, "created_at", query.from, query.to);

    const { data: journals, error: journalsError } = await journalQuery;

    if (journalsError) {
        throw new AppError(500, "AUDITOR_SUMMARY_FAILED", "Unable to load journal summary.", journalsError);
    }

    const journalIds = (journals || []).map((journal) => journal.id);
    let lineTotals = [];

    if (journalIds.length) {
        const { data: lines, error: linesError } = await adminSupabase
            .from("journal_lines")
            .select("journal_id, debit, credit")
            .in("journal_id", journalIds);

        if (linesError) {
            throw new AppError(500, "AUDITOR_SUMMARY_FAILED", "Unable to load journal lines.", linesError);
        }

        lineTotals = lines || [];
    }

    const debitTotal = lineTotals.reduce((sum, row) => sum + Number(row.debit || 0), 0);
    const creditTotal = lineTotals.reduce((sum, row) => sum + Number(row.credit || 0), 0);

    const exceptions = await getExceptions(actor, {
        from: query.from,
        to: query.to,
        page: 1,
        limit: 1000
    });

    return {
        trial_balance_balanced: Math.abs(debitTotal - creditTotal) < 0.005,
        unposted_journals_count: (journals || []).filter((journal) => !journal.posted).length,
        backdated_entries_count: (journals || []).filter((journal) => journal.entry_date < journal.created_at.slice(0, 10)).length,
        reversals_count: (journals || []).filter((journal) => journal.is_reversal).length,
        manual_journals_count: (journals || []).filter((journal) => journal.reference === "MANUAL" || journal.source_type === "adjustment").length,
        high_value_tx_count: exceptions.data.filter((item) => item.reason_code === "HIGH_VALUE_TX").length,
        out_of_hours_count: exceptions.data.filter((item) => item.reason_code === "OUT_OF_HOURS_POSTING").length
    };
}

async function getExceptions(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const { rows, count } = await loadExceptionRows(tenantId, query, {
        page: query.page || 1,
        limit: query.limit || 20
    });

    const caseKeys = rows.map((row) => row.case_key);
    let caseMap = new Map();

    if (caseKeys.length) {
        const { data: cases, error: casesError } = await adminSupabase
            .from("audit_cases")
            .select("id, tenant_id, case_key, status, notes, assignee_user_id, resolved_at, updated_at")
            .eq("tenant_id", tenantId)
            .in("case_key", caseKeys);

        if (casesError && !["PGRST205", "42P01", "42703"].includes(String(casesError.code || ""))) {
            throw new AppError(500, "AUDITOR_EXCEPTIONS_CASES_FAILED", "Unable to load audit case status.", casesError);
        }

        const assigneeNameMap = await resolveCaseAssigneeNames(tenantId, cases || []);

        caseMap = new Map((cases || []).map((row) => [
            row.case_key,
            {
                case_id: row.id,
                case_status: row.status,
                case_notes: row.notes,
                case_assignee_user_id: row.assignee_user_id,
                case_assignee_name: row.assignee_user_id ? assigneeNameMap.get(row.assignee_user_id) || null : null,
                case_resolved_at: row.resolved_at,
                case_updated_at: row.updated_at
            }
        ]));
    }

    return {
        data: rows.map((row) => ({
            ...row,
            case_status: caseMap.get(row.case_key)?.case_status || "open",
            case_notes: caseMap.get(row.case_key)?.case_notes || null,
            case_assignee_user_id: caseMap.get(row.case_key)?.case_assignee_user_id || null,
            case_assignee_name: caseMap.get(row.case_key)?.case_assignee_name || null,
            case_resolved_at: caseMap.get(row.case_key)?.case_resolved_at || null,
            case_updated_at: caseMap.get(row.case_key)?.case_updated_at || null,
            case_id: caseMap.get(row.case_key)?.case_id || null
        })),
        pagination: {
            page: query.page || 1,
            limit: query.limit || 20,
            total: count || 0
        }
    };
}

async function listCaseAssignees(actor) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from("user_profiles")
        .select("user_id, full_name")
        .eq("tenant_id", tenantId)
        .eq("role", "auditor")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("full_name", { ascending: true });

    if (error) {
        throw new AppError(500, "AUDIT_CASE_ASSIGNEES_FAILED", "Unable to load auditor assignees.", error);
    }

    return (data || []).map((row) => ({
        user_id: row.user_id,
        full_name: row.full_name || "Auditor"
    }));
}

async function updateCase(actor, caseKey, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    await validateAssignee(tenantId, payload.assignee_user_id);
    const { caseRow: existing } = await ensureAuditCase(actor, caseKey, payload);

    const nextStatus = payload.status || existing.status || "open";
    const nextNotes = payload.notes === undefined ? (existing.notes || null) : (payload.notes ? String(payload.notes).trim() : null);
    const nextAssignee = payload.assignee_user_id === undefined ? (existing.assignee_user_id || null) : payload.assignee_user_id;
    const severity = getReasonSeverity(payload.reason_code || existing.reason_code || "");

    const upsertPayload = {
        tenant_id: tenantId,
        case_key: caseKey,
        reason_code: payload.reason_code || existing.reason_code,
        severity,
        status: nextStatus,
        journal_id: payload.journal_id === undefined ? existing.journal_id || null : payload.journal_id,
        branch_id: payload.branch_id === undefined ? existing.branch_id || null : payload.branch_id,
        subject_user_id: payload.user_id === undefined ? existing.subject_user_id || null : payload.user_id,
        reference: payload.reference === undefined ? existing.reference || null : payload.reference,
        assignee_user_id: nextAssignee,
        notes: nextNotes,
        opened_at: existing.opened_at || new Date().toISOString(),
        resolved_at: ["resolved", "waived"].includes(nextStatus) ? (existing.resolved_at || new Date().toISOString()) : null,
        resolved_by: ["resolved", "waived"].includes(nextStatus) ? actor.user.id : null,
        created_by: existing.created_by || actor.user.id,
        updated_by: actor.user.id
    };

    if (!upsertPayload.reason_code) {
        throw new AppError(400, "AUDIT_CASE_REASON_REQUIRED", "Reason code is required to create an audit case.");
    }

    const { data, error } = await adminSupabase
        .from("audit_cases")
        .upsert(upsertPayload, { onConflict: "tenant_id,case_key" })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "AUDIT_CASE_UPDATE_FAILED", "Unable to update audit case.", error);
    }

    let assigneeName = null;
    if (data.assignee_user_id) {
        const { data: assigneeProfile } = await adminSupabase
            .from("user_profiles")
            .select("full_name")
            .eq("tenant_id", tenantId)
            .eq("user_id", data.assignee_user_id)
            .maybeSingle();
        assigneeName = assigneeProfile?.full_name || null;
    }

    return {
        case_id: data.id,
        case_key: data.case_key,
        case_status: data.status,
        case_notes: data.notes,
        case_assignee_user_id: data.assignee_user_id,
        case_assignee_name: assigneeName,
        case_resolved_at: data.resolved_at,
        case_updated_at: data.updated_at
    };
}

async function getCaseDetail(actor, caseKey, query = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { caseRow } = await ensureAuditCase(actor, caseKey, query);
    const [assigneeNameMap, commentsResult, evidenceResult, relatedEntities] = await Promise.all([
        resolveCaseAssigneeNames(tenantId, [caseRow]),
        adminSupabase
            .from("audit_case_comments")
            .select("id, body, author_user_id, created_at, updated_at")
            .eq("tenant_id", tenantId)
            .eq("case_id", caseRow.id)
            .order("created_at", { ascending: true }),
        adminSupabase
            .from("audit_case_evidence")
            .select("id, file_name, mime_type, file_size_bytes, checksum_sha256, status, uploaded_by, created_at, confirmed_at")
            .eq("tenant_id", tenantId)
            .eq("case_id", caseRow.id)
            .order("created_at", { ascending: false }),
        resolveCaseRelatedEntities(tenantId, caseRow)
    ]);

    if (commentsResult.error && !["PGRST205", "42P01", "42703"].includes(String(commentsResult.error.code || ""))) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to load audit case comments.", commentsResult.error);
    }

    if (evidenceResult.error && !["PGRST205", "42P01", "42703"].includes(String(evidenceResult.error.code || ""))) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to load audit case evidence.", evidenceResult.error);
    }

    const commentRows = commentsResult.data || [];
    const evidenceRows = evidenceResult.data || [];
    const commentAuthorIds = Array.from(new Set(commentRows.map((row) => row.author_user_id).filter(Boolean)));
    const evidenceUserIds = Array.from(new Set(evidenceRows.map((row) => row.uploaded_by).filter(Boolean)));
    const actorIds = Array.from(new Set([...commentAuthorIds, ...evidenceUserIds]));
    [caseRow.created_by, caseRow.updated_by, caseRow.resolved_by, caseRow.assignee_user_id].forEach((value) => {
        if (value) {
            actorIds.push(value);
        }
    });
    let actorNameMap = new Map();

    if (actorIds.length) {
        const { data: actorProfiles, error: actorProfilesError } = await adminSupabase
            .from("user_profiles")
            .select("user_id, full_name")
            .eq("tenant_id", tenantId)
            .in("user_id", Array.from(new Set(actorIds)));

        if (actorProfilesError) {
            throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve case actors.", actorProfilesError);
        }

        actorNameMap = new Map((actorProfiles || []).map((row) => [row.user_id, row.full_name]));
    }

    return {
        case: {
            case_id: caseRow.id,
            case_key: caseRow.case_key,
            case_status: caseRow.status,
            case_notes: caseRow.notes,
            case_assignee_user_id: caseRow.assignee_user_id,
            case_assignee_name: caseRow.assignee_user_id ? assigneeNameMap.get(caseRow.assignee_user_id) || null : null,
            case_resolved_at: caseRow.resolved_at,
            case_updated_at: caseRow.updated_at,
            reason_code: caseRow.reason_code,
            severity: caseRow.severity,
            reference: caseRow.reference,
            branch_id: caseRow.branch_id,
            journal_id: caseRow.journal_id,
            user_id: caseRow.subject_user_id
        },
        related_entities: relatedEntities,
        timeline: buildCaseTimeline({
            caseRow,
            actorNameMap,
            comments: commentRows,
            evidence: evidenceRows
        }),
        comments: commentRows.map((row) => ({
            id: row.id,
            body: row.body,
            author_user_id: row.author_user_id,
            author_name: actorNameMap.get(row.author_user_id) || null,
            created_at: row.created_at,
            updated_at: row.updated_at
        })),
        evidence: evidenceRows.map((row) => ({
            id: row.id,
            file_name: row.file_name,
            mime_type: row.mime_type,
            file_size_bytes: Number(row.file_size_bytes || 0),
            checksum_sha256: row.checksum_sha256 || null,
            status: row.status,
            uploaded_by: row.uploaded_by,
            uploaded_by_name: actorNameMap.get(row.uploaded_by) || null,
            created_at: row.created_at,
            confirmed_at: row.confirmed_at || null
        }))
    };
}

async function addCaseComment(actor, caseKey, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { caseRow } = await ensureAuditCase(actor, caseKey, payload);
    const body = String(payload.body || "").trim();
    if (!body) {
        throw new AppError(400, "AUDIT_CASE_COMMENT_REQUIRED", "Comment body is required.");
    }

    const { data, error } = await adminSupabase
        .from("audit_case_comments")
        .insert({
            tenant_id: tenantId,
            case_id: caseRow.id,
            author_user_id: actor.user.id,
            body
        })
        .select("id, body, author_user_id, created_at, updated_at")
        .single();

    if (error || !data) {
        throw new AppError(500, "AUDIT_CASE_COMMENT_CREATE_FAILED", "Unable to add audit case comment.", error);
    }

    return {
        id: data.id,
        body: data.body,
        author_user_id: data.author_user_id,
        author_name: actor.profile?.full_name || null,
        created_at: data.created_at,
        updated_at: data.updated_at
    };
}

async function initCaseEvidenceUpload(actor, caseKey, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { caseRow } = await ensureAuditCase(actor, caseKey, payload);
    const safeName = sanitizeFileName(payload.file_name);
    const evidenceId = crypto.randomUUID();
    const storagePath = `tenant/${tenantId}/audit-cases/${caseRow.id}/${evidenceId}-${safeName}`;

    const { data: evidence, error } = await adminSupabase
        .from("audit_case_evidence")
        .insert({
            id: evidenceId,
            tenant_id: tenantId,
            case_id: caseRow.id,
            uploaded_by: actor.user.id,
            storage_bucket: env.auditEvidenceBucket,
            storage_path: storagePath,
            file_name: payload.file_name,
            mime_type: payload.mime_type,
            file_size_bytes: payload.file_size_bytes
        })
        .select("id, case_id, storage_bucket, storage_path, file_name, mime_type, file_size_bytes, status, created_at")
        .single();

    if (error || !evidence) {
        throw new AppError(500, "AUDIT_CASE_EVIDENCE_INIT_FAILED", "Unable to initialize evidence upload.", error);
    }

    const { data: signedUpload, error: signedUploadError } = await adminSupabase
        .storage
        .from(env.auditEvidenceBucket)
        .createSignedUploadUrl(storagePath);

    if (signedUploadError || !signedUpload) {
        throw new AppError(500, "AUDIT_CASE_EVIDENCE_SIGNED_UPLOAD_FAILED", "Unable to create evidence upload URL.", signedUploadError);
    }

    return {
        evidence: {
            id: evidence.id,
            storage_bucket: evidence.storage_bucket,
            file_name: evidence.file_name,
            mime_type: evidence.mime_type,
            file_size_bytes: Number(evidence.file_size_bytes || 0),
            status: evidence.status,
            created_at: evidence.created_at
        },
        upload: signedUpload
    };
}

async function confirmCaseEvidenceUpload(actor, evidenceId, payload = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: evidence, error: evidenceError } = await adminSupabase
        .from("audit_case_evidence")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", evidenceId)
        .single();

    if (evidenceError || !evidence) {
        throw new AppError(404, "AUDIT_CASE_EVIDENCE_NOT_FOUND", "Audit evidence was not found.", evidenceError);
    }

    const { data, error } = await adminSupabase
        .from("audit_case_evidence")
        .update({
            status: "uploaded",
            checksum_sha256: payload.checksum_sha256 || null,
            confirmed_at: new Date().toISOString()
        })
        .eq("id", evidenceId)
        .select("id, file_name, mime_type, file_size_bytes, checksum_sha256, status, uploaded_by, created_at, confirmed_at")
        .single();

    if (error || !data) {
        throw new AppError(500, "AUDIT_CASE_EVIDENCE_CONFIRM_FAILED", "Unable to confirm audit evidence upload.", error);
    }

    return {
        id: data.id,
        file_name: data.file_name,
        mime_type: data.mime_type,
        file_size_bytes: Number(data.file_size_bytes || 0),
        checksum_sha256: data.checksum_sha256 || null,
        status: data.status,
        uploaded_by: data.uploaded_by,
        uploaded_by_name: actor.profile?.full_name || null,
        created_at: data.created_at,
        confirmed_at: data.confirmed_at
    };
}

async function getCaseEvidenceDownload(actor, evidenceId) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: evidence, error: evidenceError } = await adminSupabase
        .from("audit_case_evidence")
        .select("id, storage_bucket, storage_path, file_name, mime_type")
        .eq("tenant_id", tenantId)
        .eq("id", evidenceId)
        .single();

    if (evidenceError || !evidence) {
        throw new AppError(404, "AUDIT_CASE_EVIDENCE_NOT_FOUND", "Audit evidence was not found.", evidenceError);
    }

    const { data: signedUrl, error: signedUrlError } = await adminSupabase
        .storage
        .from(evidence.storage_bucket)
        .createSignedUrl(evidence.storage_path, 60 * 10);

    if (signedUrlError || !signedUrl) {
        throw new AppError(500, "AUDIT_CASE_EVIDENCE_DOWNLOAD_FAILED", "Unable to create evidence download URL.", signedUrlError);
    }

    return {
        evidence_id: evidence.id,
        file_name: evidence.file_name,
        mime_type: evidence.mime_type,
        download_url: signedUrl.signedUrl
    };
}

async function getRiskSummary(actor, query = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { rows } = await loadExceptionRows(tenantId, query);

    const branchIds = Array.from(new Set(rows.map((row) => row.branch_id).filter(Boolean)));
    let branchNameMap = new Map();
    if (branchIds.length) {
        const { data: branches, error: branchesError } = await adminSupabase
            .from("branches")
            .select("id, name")
            .eq("tenant_id", tenantId)
            .in("id", branchIds);

        if (branchesError) {
            throw new AppError(500, "AUDITOR_RISK_SUMMARY_FAILED", "Unable to resolve branch names.", branchesError);
        }

        branchNameMap = new Map((branches || []).map((row) => [row.id, row.name]));
    }

    const { data: cases, error: casesError } = await adminSupabase
        .from("audit_cases")
        .select("branch_id, status, severity")
        .eq("tenant_id", tenantId);

    if (casesError && !["PGRST205", "42P01", "42703"].includes(String(casesError.code || ""))) {
        throw new AppError(500, "AUDITOR_RISK_SUMMARY_FAILED", "Unable to load audit case summary.", casesError);
    }

    const branchSummaryMap = new Map();
    for (const row of rows) {
        const current = branchSummaryMap.get(row.branch_id || "unassigned") || {
            branch_id: row.branch_id || null,
            branch_name: row.branch_id ? branchNameMap.get(row.branch_id) || formatBranchName(row.branch_id) : "No branch",
            total_exceptions: 0,
            critical_exceptions: 0,
            warning_exceptions: 0,
            last_exception_at: row.created_at,
            open_cases: 0
        };
        current.total_exceptions += 1;
        if (row.severity === "critical") current.critical_exceptions += 1;
        if (row.severity === "warning") current.warning_exceptions += 1;
        if (!current.last_exception_at || current.last_exception_at < row.created_at) {
            current.last_exception_at = row.created_at;
        }
        branchSummaryMap.set(row.branch_id || "unassigned", current);
    }

    for (const caseRow of cases || []) {
        const key = caseRow.branch_id || "unassigned";
        const current = branchSummaryMap.get(key) || {
            branch_id: caseRow.branch_id || null,
            branch_name: caseRow.branch_id ? branchNameMap.get(caseRow.branch_id) || formatBranchName(caseRow.branch_id) : "No branch",
            total_exceptions: 0,
            critical_exceptions: 0,
            warning_exceptions: 0,
            last_exception_at: null,
            open_cases: 0
        };
        if (!["resolved", "waived"].includes(caseRow.status)) {
            current.open_cases += 1;
        }
        branchSummaryMap.set(key, current);
    }

    const reasonMap = new Map();
    for (const row of rows) {
        const current = reasonMap.get(row.reason_code) || { reason_code: row.reason_code, count: 0, severity: row.severity };
        current.count += 1;
        reasonMap.set(row.reason_code, current);
    }

    return {
        totals: {
            exceptions: rows.length,
            critical_exceptions: rows.filter((row) => row.severity === "critical").length,
            warning_exceptions: rows.filter((row) => row.severity === "warning").length,
            open_cases: (cases || []).filter((row) => !["resolved", "waived"].includes(row.status)).length,
            resolved_cases: (cases || []).filter((row) => ["resolved", "waived"].includes(row.status)).length
        },
        branches: Array.from(branchSummaryMap.values())
            .sort((left, right) => right.critical_exceptions - left.critical_exceptions || right.total_exceptions - left.total_exceptions)
            .slice(0, Number(query.limit || 5)),
        reasons: Array.from(reasonMap.values())
            .sort((left, right) => right.count - left.count)
            .slice(0, 6)
    };
}

function formatBranchName(branchId) {
    return `Branch ${String(branchId).slice(0, 8)}`;
}

function formatUserName(userId) {
    return `User ${String(userId).slice(0, 8)}`;
}

async function resolveCaseRelatedEntities(tenantId, caseRow) {
    const [branchResult, subjectUserResult, memberTransactionResult, loanTransactionResult, tellerTransactionResult] = await Promise.all([
        caseRow.branch_id
            ? adminSupabase
                .from("branches")
                .select("id, name")
                .eq("tenant_id", tenantId)
                .eq("id", caseRow.branch_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        caseRow.subject_user_id
            ? adminSupabase
                .from("user_profiles")
                .select("user_id, full_name, role")
                .eq("tenant_id", tenantId)
                .eq("user_id", caseRow.subject_user_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        caseRow.journal_id
            ? adminSupabase
                .from("member_account_transactions")
                .select("member_account_id, amount, reference, created_at")
                .eq("tenant_id", tenantId)
                .eq("journal_id", caseRow.journal_id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        caseRow.journal_id
            ? adminSupabase
                .from("loan_account_transactions")
                .select("loan_id, member_id, amount, reference, created_at")
                .eq("tenant_id", tenantId)
                .eq("journal_id", caseRow.journal_id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        caseRow.journal_id
            ? adminSupabase
                .from("teller_session_transactions")
                .select("session_id, amount, transaction_type, created_at")
                .eq("tenant_id", tenantId)
                .eq("journal_id", caseRow.journal_id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null })
    ]);

    if (branchResult.error) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve related branch.", branchResult.error);
    }
    if (subjectUserResult.error) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve subject user.", subjectUserResult.error);
    }
    if (memberTransactionResult.error) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve member context.", memberTransactionResult.error);
    }
    if (loanTransactionResult.error) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve loan context.", loanTransactionResult.error);
    }
    if (tellerTransactionResult.error) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve teller context.", tellerTransactionResult.error);
    }

    const memberAccountId = memberTransactionResult.data?.member_account_id || null;
    const memberIdFromLoan = loanTransactionResult.data?.member_id || null;
    const loanId = loanTransactionResult.data?.loan_id || null;
    const tellerSessionId = tellerTransactionResult.data?.session_id || null;

    const [memberAccountResult, loanResult, tellerSessionResult] = await Promise.all([
        memberAccountId
            ? adminSupabase
                .from("member_accounts")
                .select("id, member_id, account_number, account_name, product_type")
                .eq("tenant_id", tenantId)
                .eq("id", memberAccountId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        loanId
            ? adminSupabase
                .from("loans")
                .select("id, loan_number, status, member_id")
                .eq("tenant_id", tenantId)
                .eq("id", loanId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        tellerSessionId
            ? adminSupabase
                .from("teller_sessions")
                .select("id, status, opened_at, closed_at, teller_user_id, expected_cash, closing_cash, variance")
                .eq("tenant_id", tenantId)
                .eq("id", tellerSessionId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null })
    ]);

    if (memberAccountResult.error) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve member account context.", memberAccountResult.error);
    }
    if (loanResult.error) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve linked loan.", loanResult.error);
    }
    if (tellerSessionResult.error) {
        throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve teller session.", tellerSessionResult.error);
    }

    const memberId = memberAccountResult.data?.member_id || memberIdFromLoan || loanResult.data?.member_id || null;
    let memberResult = { data: null, error: null };
    if (memberId) {
        memberResult = await adminSupabase
            .from("members")
            .select("id, full_name, member_no")
            .eq("tenant_id", tenantId)
            .eq("id", memberId)
            .maybeSingle();
        if (memberResult.error) {
            throw new AppError(500, "AUDIT_CASE_DETAIL_FAILED", "Unable to resolve linked member.", memberResult.error);
        }
    }

    return {
        branch: branchResult.data
            ? {
                id: branchResult.data.id,
                name: branchResult.data.name
            }
            : null,
        subject_user: subjectUserResult.data
            ? {
                user_id: subjectUserResult.data.user_id,
                full_name: subjectUserResult.data.full_name || formatUserName(subjectUserResult.data.user_id),
                role: subjectUserResult.data.role || null
            }
            : null,
        member: memberResult.data
            ? {
                id: memberResult.data.id,
                full_name: memberResult.data.full_name,
                member_no: memberResult.data.member_no || null,
                account_number: memberAccountResult.data?.account_number || null,
                account_name: memberAccountResult.data?.account_name || null,
                product_type: memberAccountResult.data?.product_type || null
            }
            : null,
        loan: loanResult.data
            ? {
                id: loanResult.data.id,
                loan_number: loanResult.data.loan_number,
                status: loanResult.data.status,
                member_id: memberResult.data?.id || loanResult.data.member_id || null,
                member_name: memberResult.data?.full_name || null,
                member_no: memberResult.data?.member_no || null
            }
            : null,
        teller_session: tellerSessionResult.data
            ? {
                id: tellerSessionResult.data.id,
                status: tellerSessionResult.data.status,
                opened_at: tellerSessionResult.data.opened_at,
                closed_at: tellerSessionResult.data.closed_at || null,
                teller_user_id: tellerSessionResult.data.teller_user_id,
                expected_cash: Number(tellerSessionResult.data.expected_cash || 0),
                closing_cash: tellerSessionResult.data.closing_cash == null ? null : Number(tellerSessionResult.data.closing_cash || 0),
                variance: tellerSessionResult.data.variance == null ? null : Number(tellerSessionResult.data.variance || 0)
            }
            : null
    };
}

function buildCaseTimeline({ caseRow, actorNameMap, comments = [], evidence = [] }) {
    const timeline = [
        {
            type: "opened",
            label: "Case opened",
            at: caseRow.opened_at || caseRow.created_at,
            actor_user_id: caseRow.created_by || null,
            actor_name: caseRow.created_by ? actorNameMap.get(caseRow.created_by) || formatUserName(caseRow.created_by) : null,
            status: caseRow.status
        }
    ];

    if (caseRow.updated_at && caseRow.updated_at !== caseRow.created_at && caseRow.updated_at !== caseRow.opened_at) {
        timeline.push({
            type: "updated",
            label: "Case updated",
            at: caseRow.updated_at,
            actor_user_id: caseRow.updated_by || null,
            actor_name: caseRow.updated_by ? actorNameMap.get(caseRow.updated_by) || formatUserName(caseRow.updated_by) : null,
            status: caseRow.status
        });
    }

    if (caseRow.resolved_at) {
        timeline.push({
            type: caseRow.status === "waived" ? "waived" : "resolved",
            label: caseRow.status === "waived" ? "Case waived" : "Case resolved",
            at: caseRow.resolved_at,
            actor_user_id: caseRow.resolved_by || null,
            actor_name: caseRow.resolved_by ? actorNameMap.get(caseRow.resolved_by) || formatUserName(caseRow.resolved_by) : null,
            status: caseRow.status
        });
    }

    for (const comment of comments) {
        timeline.push({
            type: "comment",
            label: "Comment added",
            at: comment.created_at,
            actor_user_id: comment.author_user_id,
            actor_name: actorNameMap.get(comment.author_user_id) || formatUserName(comment.author_user_id),
            body: comment.body
        });
    }

    for (const item of evidence) {
        timeline.push({
            type: "evidence",
            label: item.status === "uploaded" ? "Evidence uploaded" : "Evidence registered",
            at: item.confirmed_at || item.created_at,
            actor_user_id: item.uploaded_by,
            actor_name: actorNameMap.get(item.uploaded_by) || formatUserName(item.uploaded_by),
            file_name: item.file_name,
            status: item.status
        });
    }

    return timeline
        .filter((item) => item.at)
        .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

async function getExceptionTrends(actor, query = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const days = Math.min(60, Math.max(7, Number(query.days || 14)));
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const { rows } = await loadExceptionRows(tenantId, {
        ...query,
        from: query.from || start.toISOString(),
        to: query.to || end.toISOString()
    });

    const buckets = new Map();
    for (let offset = 0; offset < days; offset += 1) {
        const date = new Date(start);
        date.setUTCDate(start.getUTCDate() + offset);
        const key = date.toISOString().slice(0, 10);
        buckets.set(key, { day: key, total: 0, critical: 0, warning: 0, info: 0 });
    }

    for (const row of rows) {
        const key = String(row.created_at || "").slice(0, 10);
        const bucket = buckets.get(key);
        if (!bucket) {
            continue;
        }
        bucket.total += 1;
        bucket[row.severity] += 1;
    }

    return {
        days,
        points: Array.from(buckets.values())
    };
}

async function getWorkstationOverview(actor, query = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const limit = Math.min(10, Math.max(3, Number(query.limit || 5)));
    const { rows } = await loadExceptionRows(tenantId, query);

    const [casesResult, branchProfilesResult, userProfilesResult] = await Promise.all([
        adminSupabase
            .from("audit_cases")
            .select("id, case_key, status, severity, reason_code, assignee_user_id, branch_id, subject_user_id, reference, opened_at, created_at, updated_at")
            .eq("tenant_id", tenantId)
            .order("opened_at", { ascending: true }),
        adminSupabase
            .from("branches")
            .select("id, name")
            .eq("tenant_id", tenantId),
        adminSupabase
            .from("user_profiles")
            .select("user_id, full_name")
            .eq("tenant_id", tenantId)
    ]);

    if (casesResult.error && !["PGRST205", "42P01", "42703"].includes(String(casesResult.error.code || ""))) {
        throw new AppError(500, "AUDITOR_WORKSTATION_OVERVIEW_FAILED", "Unable to load audit cases.", casesResult.error);
    }

    if (branchProfilesResult.error) {
        throw new AppError(500, "AUDITOR_WORKSTATION_OVERVIEW_FAILED", "Unable to load branch profiles.", branchProfilesResult.error);
    }

    if (userProfilesResult.error) {
        throw new AppError(500, "AUDITOR_WORKSTATION_OVERVIEW_FAILED", "Unable to load user profiles.", userProfilesResult.error);
    }

    const cases = casesResult.data || [];
    const branchNameMap = new Map((branchProfilesResult.data || []).map((row) => [row.id, row.name]));
    const userNameMap = new Map((userProfilesResult.data || []).map((row) => [row.user_id, row.full_name]));

    const caseBoard = {
        open: 0,
        under_review: 0,
        resolved: 0,
        waived: 0
    };

    const oldestOpenCases = cases
        .filter((row) => ["open", "under_review"].includes(row.status))
        .map((row) => {
            const openedAt = row.opened_at || row.created_at || row.updated_at || new Date().toISOString();
            const ageDays = Math.max(
                0,
                Math.floor((Date.now() - new Date(openedAt).getTime()) / (1000 * 60 * 60 * 24))
            );
            return {
                case_id: row.id,
                case_key: row.case_key,
                status: row.status,
                severity: row.severity,
                reason_code: row.reason_code,
                reference: row.reference || null,
                branch_id: row.branch_id || null,
                branch_name: row.branch_id ? branchNameMap.get(row.branch_id) || formatBranchName(row.branch_id) : "No branch",
                assignee_user_id: row.assignee_user_id || null,
                assignee_name: row.assignee_user_id ? userNameMap.get(row.assignee_user_id) || formatUserName(row.assignee_user_id) : null,
                opened_at: openedAt,
                age_days: ageDays
            };
        })
        .sort((left, right) => right.age_days - left.age_days || (left.severity === "critical" ? -1 : 1))
        .slice(0, limit);

    for (const caseRow of cases) {
        if (Object.hasOwn(caseBoard, caseRow.status)) {
            caseBoard[caseRow.status] += 1;
        }
    }

    const branchPatterns = new Map();
    const userPatterns = new Map();
    const reasonPatterns = new Map();

    for (const row of rows) {
        const branchKey = row.branch_id || "unassigned";
        const branchPattern = branchPatterns.get(branchKey) || {
            branch_id: row.branch_id || null,
            branch_name: row.branch_id ? branchNameMap.get(row.branch_id) || formatBranchName(row.branch_id) : "No branch",
            exception_count: 0,
            critical_count: 0
        };
        branchPattern.exception_count += 1;
        if (row.severity === "critical") {
            branchPattern.critical_count += 1;
        }
        branchPatterns.set(branchKey, branchPattern);

        if (row.user_id) {
            const userPattern = userPatterns.get(row.user_id) || {
                user_id: row.user_id,
                user_name: userNameMap.get(row.user_id) || formatUserName(row.user_id),
                exception_count: 0,
                critical_count: 0
            };
            userPattern.exception_count += 1;
            if (row.severity === "critical") {
                userPattern.critical_count += 1;
            }
            userPatterns.set(row.user_id, userPattern);
        }

        const reasonPattern = reasonPatterns.get(row.reason_code) || {
            reason_code: row.reason_code,
            exception_count: 0,
            severity: row.severity
        };
        reasonPattern.exception_count += 1;
        reasonPatterns.set(row.reason_code, reasonPattern);
    }

    return {
        case_board: caseBoard,
        oldest_open_cases: oldestOpenCases,
        repeat_patterns: {
            branches: Array.from(branchPatterns.values())
                .sort((left, right) => right.critical_count - left.critical_count || right.exception_count - left.exception_count)
                .slice(0, limit),
            users: Array.from(userPatterns.values())
                .sort((left, right) => right.critical_count - left.critical_count || right.exception_count - left.exception_count)
                .slice(0, limit),
            reasons: Array.from(reasonPatterns.values())
                .sort((left, right) => right.exception_count - left.exception_count)
                .slice(0, limit)
        }
    };
}

async function getJournals(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let journalsQuery = adminSupabase
        .from("journal_entries")
        .select("id, tenant_id, reference, description, entry_date, posted, posted_at, source_type, created_by, created_at, is_reversal, reversed_journal_id", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    journalsQuery = applyDateRange(journalsQuery, "created_at", query.from, query.to);

    if (query.search) {
        journalsQuery = journalsQuery.or(`reference.ilike.%${query.search}%,description.ilike.%${query.search}%`);
    }

    const range = toRange(query.page || 1, query.limit || 20);
    journalsQuery = journalsQuery.range(range.from, range.to);

    const { data: journals, count, error } = await journalsQuery;

    if (error) {
        throw new AppError(500, "AUDITOR_JOURNALS_FAILED", "Unable to load journals.", error);
    }

    const journalIds = (journals || []).map((journal) => journal.id);
    let lineMap = new Map();

    if (journalIds.length) {
        const { data: lines, error: linesError } = await adminSupabase
            .from("journal_lines")
            .select("journal_id, debit, credit")
            .in("journal_id", journalIds);

        if (linesError) {
            throw new AppError(500, "AUDITOR_JOURNALS_FAILED", "Unable to load journal totals.", linesError);
        }

        lineMap = (lines || []).reduce((map, line) => {
            const current = map.get(line.journal_id) || { debit_total: 0, credit_total: 0 };
            current.debit_total += Number(line.debit || 0);
            current.credit_total += Number(line.credit || 0);
            map.set(line.journal_id, current);
            return map;
        }, new Map());
    }

    return {
        data: (journals || []).map((journal) => ({
            ...journal,
            ...(lineMap.get(journal.id) || { debit_total: 0, credit_total: 0 }),
            flags: computeJournalFlags(
                journal,
                Math.max(
                    (lineMap.get(journal.id) || {}).debit_total || 0,
                    (lineMap.get(journal.id) || {}).credit_total || 0
                )
            )
        })),
        pagination: {
            page: query.page || 1,
            limit: query.limit || 20,
            total: count || 0
        }
    };
}

async function getJournalDetail(actor, journalId) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: journal, error: journalError } = await adminSupabase
        .from("journal_entries")
        .select("id, tenant_id, reference, description, entry_date, posted, posted_at, source_type, created_by, created_at, is_reversal, reversed_journal_id")
        .eq("tenant_id", tenantId)
        .eq("id", journalId)
        .single();

    if (journalError || !journal) {
        throw new AppError(404, "JOURNAL_NOT_FOUND", "Journal was not found.", journalError);
    }

    const { data: lines, error: linesError } = await adminSupabase
        .from("journal_lines")
        .select("id, journal_id, tenant_id, account_id, member_account_id, branch_id, debit, credit, chart_of_accounts(account_code, account_name)")
        .eq("journal_id", journalId)
        .order("created_at", { ascending: true });

    if (linesError) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to load journal lines.", linesError);
    }

    const [
        creatorProfileResult,
        reversalOfResult,
        reversedByResult,
        memberTransactionsResult,
        loanTransactionsResult,
        tellerTransactionsResult,
        receiptsResult,
        paymentOrdersResult,
        declarationCyclesResult,
        paymentCyclesResult
    ] = await Promise.all([
        adminSupabase
            .from("user_profiles")
            .select("full_name")
            .eq("tenant_id", tenantId)
            .eq("user_id", journal.created_by)
            .maybeSingle(),
        journal.reversed_journal_id
            ? adminSupabase
                .from("journal_entries")
                .select("id, reference, entry_date, source_type")
                .eq("tenant_id", tenantId)
                .eq("id", journal.reversed_journal_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        adminSupabase
            .from("journal_entries")
            .select("id, reference, entry_date, source_type")
            .eq("tenant_id", tenantId)
            .eq("reversed_journal_id", journalId)
            .order("created_at", { ascending: false }),
        adminSupabase
            .from("member_account_transactions")
            .select("id, member_account_id, transaction_type, direction, amount, reference, created_at")
            .eq("tenant_id", tenantId)
            .eq("journal_id", journalId)
            .order("created_at", { ascending: false }),
        adminSupabase
            .from("loan_account_transactions")
            .select("id, loan_id, member_id, transaction_type, direction, amount, reference, created_at")
            .eq("tenant_id", tenantId)
            .eq("journal_id", journalId)
            .order("created_at", { ascending: false }),
        adminSupabase
            .from("teller_session_transactions")
            .select("id, session_id, transaction_type, direction, amount, created_at")
            .eq("tenant_id", tenantId)
            .eq("journal_id", journalId)
            .order("created_at", { ascending: false }),
        adminSupabase
            .from("transaction_receipts")
            .select("id, transaction_type, status, member_id, created_at")
            .eq("tenant_id", tenantId)
            .eq("journal_id", journalId)
            .order("created_at", { ascending: false }),
        adminSupabase
            .from("payment_orders")
            .select("id, purpose, status, provider, amount, external_id, member_id, created_at")
            .eq("tenant_id", tenantId)
            .eq("journal_id", journalId)
            .order("created_at", { ascending: false }),
        adminSupabase
            .from("dividend_cycles")
            .select("id, period_label, status")
            .eq("tenant_id", tenantId)
            .eq("declaration_journal_id", journalId),
        adminSupabase
            .from("dividend_cycles")
            .select("id, period_label, status")
            .eq("tenant_id", tenantId)
            .eq("payment_journal_id", journalId)
    ]);

    const creatorProfile = creatorProfileResult.data || null;
    if (creatorProfileResult.error) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to resolve journal creator.", creatorProfileResult.error);
    }

    if (reversalOfResult.error) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to resolve reversal linkage.", reversalOfResult.error);
    }

    if (reversedByResult.error) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to resolve related reversal journals.", reversedByResult.error);
    }

    if (memberTransactionsResult.error) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to load member account transactions.", memberTransactionsResult.error);
    }

    if (loanTransactionsResult.error) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to load loan account transactions.", loanTransactionsResult.error);
    }

    if (tellerTransactionsResult.error) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to load teller session transactions.", tellerTransactionsResult.error);
    }

    if (receiptsResult.error) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to load receipt records.", receiptsResult.error);
    }

    if (paymentOrdersResult.error) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to load payment orders.", paymentOrdersResult.error);
    }

    if (declarationCyclesResult.error || paymentCyclesResult.error) {
        throw new AppError(
            500,
            "JOURNAL_DETAIL_FAILED",
            "Unable to load dividend cycle linkage.",
            declarationCyclesResult.error || paymentCyclesResult.error
        );
    }

    const memberTransactions = memberTransactionsResult.data || [];
    const loanTransactions = loanTransactionsResult.data || [];

    const memberAccountIds = Array.from(new Set(memberTransactions.map((row) => row.member_account_id).filter(Boolean)));
    const memberIdsFromLoans = Array.from(new Set(loanTransactions.map((row) => row.member_id).filter(Boolean)));
    const loanIds = Array.from(new Set(loanTransactions.map((row) => row.loan_id).filter(Boolean)));

    let memberAccountsMap = new Map();
    let membersMap = new Map();
    let loansMap = new Map();

    if (memberAccountIds.length) {
        const { data: memberAccounts, error: memberAccountsError } = await adminSupabase
            .from("member_accounts")
            .select("id, member_id, account_number, account_name, product_type")
            .eq("tenant_id", tenantId)
            .in("id", memberAccountIds);

        if (memberAccountsError) {
            throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to resolve member accounts.", memberAccountsError);
        }

        memberAccountsMap = new Map((memberAccounts || []).map((row) => [row.id, row]));
    }

    const memberIds = Array.from(
        new Set([
            ...memberIdsFromLoans,
            ...Array.from(memberAccountsMap.values()).map((row) => row.member_id).filter(Boolean),
            ...(receiptsResult.data || []).map((row) => row.member_id).filter(Boolean),
            ...(paymentOrdersResult.data || []).map((row) => row.member_id).filter(Boolean)
        ])
    );

    if (memberIds.length) {
        const { data: members, error: membersError } = await adminSupabase
            .from("members")
            .select("id, full_name, member_no")
            .eq("tenant_id", tenantId)
            .in("id", memberIds);

        if (membersError) {
            throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to resolve members linked to the journal.", membersError);
        }

        membersMap = new Map((members || []).map((row) => [row.id, row]));
    }

    if (loanIds.length) {
        const { data: loans, error: loansError } = await adminSupabase
            .from("loans")
            .select("id, loan_number, status")
            .eq("tenant_id", tenantId)
            .in("id", loanIds);

        if (loansError) {
            throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to resolve loans linked to the journal.", loansError);
        }

        loansMap = new Map((loans || []).map((row) => [row.id, row]));
    }

    return {
        journal,
        lines: lines || [],
        related_context: {
            created_by_name: creatorProfile?.full_name || null,
            reversal_of: reversalOfResult.data
                ? {
                    journal_id: reversalOfResult.data.id,
                    reference: reversalOfResult.data.reference,
                    entry_date: reversalOfResult.data.entry_date,
                    source_type: reversalOfResult.data.source_type
                }
                : null,
            reversed_by: (reversedByResult.data || []).map((row) => ({
                journal_id: row.id,
                reference: row.reference,
                entry_date: row.entry_date,
                source_type: row.source_type
            })),
            member_transactions: memberTransactions.map((row) => {
                const account = memberAccountsMap.get(row.member_account_id);
                const member = account?.member_id ? membersMap.get(account.member_id) : null;
                return {
                    id: row.id,
                    member_account_id: row.member_account_id,
                    transaction_type: row.transaction_type,
                    direction: row.direction,
                    amount: Number(row.amount || 0),
                    reference: row.reference,
                    created_at: row.created_at,
                    account_number: account?.account_number || null,
                    account_name: account?.account_name || null,
                    product_type: account?.product_type || null,
                    member_id: account?.member_id || null,
                    member_name: member?.full_name || null,
                    member_no: member?.member_no || null
                };
            }),
            loan_transactions: loanTransactions.map((row) => {
                const loan = loansMap.get(row.loan_id);
                const member = membersMap.get(row.member_id);
                return {
                    id: row.id,
                    loan_id: row.loan_id,
                    member_id: row.member_id,
                    transaction_type: row.transaction_type,
                    direction: row.direction,
                    amount: Number(row.amount || 0),
                    reference: row.reference,
                    created_at: row.created_at,
                    loan_number: loan?.loan_number || null,
                    loan_status: loan?.status || null,
                    member_name: member?.full_name || null,
                    member_no: member?.member_no || null
                };
            }),
            teller_transactions: (tellerTransactionsResult.data || []).map((row) => ({
                id: row.id,
                session_id: row.session_id,
                transaction_type: row.transaction_type,
                direction: row.direction,
                amount: Number(row.amount || 0),
                created_at: row.created_at
            })),
            receipts: (receiptsResult.data || []).map((row) => ({
                id: row.id,
                transaction_type: row.transaction_type,
                status: row.status,
                member_id: row.member_id,
                created_at: row.created_at
            })),
            payment_orders: (paymentOrdersResult.data || []).map((row) => ({
                id: row.id,
                purpose: row.purpose,
                status: row.status,
                provider: row.provider,
                amount: Number(row.amount || 0),
                external_id: row.external_id,
                member_id: row.member_id,
                created_at: row.created_at
            })),
            dividend_cycles: [
                ...(declarationCyclesResult.data || []).map((row) => ({
                    id: row.id,
                    period_label: row.period_label,
                    status: row.status,
                    journal_role: "declaration"
                })),
                ...(paymentCyclesResult.data || []).map((row) => ({
                    id: row.id,
                    period_label: row.period_label,
                    status: row.status,
                    journal_role: "payment"
                }))
            ]
        }
    };
}

async function getAuditLogs(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let auditQuery = adminSupabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("timestamp", { ascending: false });

    auditQuery = applyDateRange(auditQuery, "timestamp", query.from, query.to);

    if (query.action) {
        auditQuery = auditQuery.ilike("action", `%${query.action}%`);
    }

    if (query.entity_type) {
        auditQuery = auditQuery.eq("entity_type", query.entity_type);
    }

    if (query.actor_user_id) {
        auditQuery = auditQuery.eq("actor_user_id", query.actor_user_id);
    }

    const range = toRange(query.page || 1, query.limit || 20);
    auditQuery = auditQuery.range(range.from, range.to);

    const { data, count, error } = await auditQuery;

    if (error) {
        throw new AppError(500, "AUDIT_LOGS_FAILED", "Unable to load audit logs.", error);
    }

    const rows = data || [];
    const actorIds = Array.from(new Set(rows.map((row) => row.actor_user_id || row.user_id).filter(Boolean)));
    let actorNameMap = new Map();

    if (actorIds.length) {
        const { data: actorProfiles, error: actorProfilesError } = await adminSupabase
            .from("user_profiles")
            .select("user_id, full_name")
            .in("user_id", actorIds);

        if (actorProfilesError) {
            throw new AppError(500, "AUDIT_LOG_ACTOR_LOOKUP_FAILED", "Unable to resolve audit log actors.", actorProfilesError);
        }

        actorNameMap = new Map((actorProfiles || []).map((row) => [row.user_id, row.full_name]));
    }

    return {
        data: rows.map((row) => {
            const eventAt = row.timestamp || row.created_at || null;
            const actorUserId = row.actor_user_id || row.user_id || null;

            return {
                ...row,
                action: row.action || null,
                entity_type: row.entity_type || row.table || "unknown",
                actor_user_id: actorUserId,
                actor_name: actorNameMap.get(actorUserId) || null,
                event_at: eventAt,
                created_at: row.created_at || eventAt,
                timestamp: row.timestamp || eventAt
            };
        }),
        pagination: {
            page: query.page || 1,
            limit: query.limit || 20,
            total: count || 0
        }
    };
}

async function getDividendRegister(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let allocationsQuery = adminSupabase
        .from("dividend_allocations")
        .select("id, cycle_id, member_id, basis_value, payout_amount, status, payment_ref, paid_at, dividend_cycles(period_label), members(full_name)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    if (query.periodId) {
        allocationsQuery = allocationsQuery.eq("cycle_id", query.periodId);
    }

    const { data, error } = await allocationsQuery;

    if (error) {
        throw new AppError(500, "AUDITOR_DIVIDEND_REGISTER_FAILED", "Unable to load dividend register.", error);
    }

    return {
        title: "Dividend Register",
        filename: "dividends-register",
        rows: (data || []).map((row) => ({
            period_label: row.dividend_cycles?.period_label || "Unknown period",
            member_name: row.members?.full_name || "Unknown member",
            basis_value: row.basis_value,
            payout_amount: row.payout_amount,
            status: row.status,
            payment_ref: row.payment_ref,
            paid_at: row.paid_at
        }))
    };
}

async function getTrialBalanceReport(actor, query) {
    return reportService.trialBalance(actor, {
        tenant_id: actor.tenantId,
        from_date: query.from,
        to_date: query.to
    });
}

async function getLoanAgingReport(actor, query) {
    return reportService.loanAging(actor, {
        tenant_id: actor.tenantId,
        as_of_date: query.asOf
    });
}

async function getParReport(actor, query) {
    return reportService.parReport(actor, {
        tenant_id: actor.tenantId,
        as_of_date: query.asOf
    });
}

module.exports = {
    getSummary,
    getExceptions,
    listCaseAssignees,
    updateCase,
    getCaseDetail,
    addCaseComment,
    initCaseEvidenceUpload,
    confirmCaseEvidenceUpload,
    getCaseEvidenceDownload,
    getRiskSummary,
    getExceptionTrends,
    getWorkstationOverview,
    getJournals,
    getJournalDetail,
    getAuditLogs,
    getTrialBalanceReport,
    getLoanAgingReport,
    getParReport,
    getDividendRegister
};
