const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { logAudit } = require("../../services/audit.service");
const { runObservedJob } = require("../../services/observability.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");

const DEFAULT_CASE_COLUMNS = `
    id,
    tenant_id,
    branch_id,
    loan_id,
    member_id,
    status,
    dpd_days,
    opened_at,
    closed_at,
    opened_by,
    closed_by,
    reason_code,
    notes,
    created_at,
    updated_at,
    loans(id, loan_number, status),
    members(id, full_name, member_no, phone)
`;

const COLLECTION_ACTION_COLUMNS = `
    id,
    tenant_id,
    branch_id,
    default_case_id,
    loan_id,
    member_id,
    action_type,
    owner_user_id,
    due_at,
    completed_at,
    outcome_code,
    status,
    priority,
    escalated_at,
    escalation_reason,
    notes,
    created_by,
    created_at,
    updated_at
`;

const GUARANTOR_CLAIM_COLUMNS = `
    id,
    tenant_id,
    branch_id,
    default_case_id,
    loan_id,
    guarantor_member_id,
    claim_amount,
    settled_amount,
    status,
    claim_reference,
    notes,
    approval_request_id,
    posted_journal_id,
    claimed_by,
    claimed_at,
    settled_at,
    waived_at,
    created_at,
    updated_at,
    members(id, full_name, member_no, phone),
    loan_default_cases(id, status, dpd_days)
`;

const CLOSED_DEFAULT_CASE_STATUSES = new Set([
    "restructured",
    "written_off",
    "recovered"
]);

const OPEN_DEFAULT_CASE_STATUSES = ["delinquent", "in_recovery", "claim_ready"];
const COMMITTED_GUARANTOR_APPLICATION_STATUSES = ["submitted", "appraised", "approved", "disbursed"];
const ACTIVE_GUARANTOR_CLAIM_STATUSES = ["approved", "posted", "partial_settled"];
const OPEN_GUARANTOR_CLAIM_STATUSES = ["draft", "submitted", "approved", "posted", "partial_settled"];

const DEFAULT_CASE_TRANSITIONS = {
    delinquent: ["in_recovery"],
    in_recovery: ["claim_ready", "restructured", "written_off", "recovered"],
    claim_ready: ["in_recovery", "written_off", "recovered"],
    restructured: [],
    written_off: [],
    recovered: []
};

function assertStaffBranchScopedRead(actor, builder) {
    if (
        !actor.isInternalOps
        && [ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)
        && Array.isArray(actor.branchIds)
        && actor.branchIds.length
    ) {
        return builder.in("branch_id", actor.branchIds);
    }

    return builder;
}

function normalizePagination(query = {}) {
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    return { page, limit, from, to };
}

function normalizeDefaultDetectionPolicy(policy) {
    return {
        enabled: typeof policy?.default_case_detection_enabled === "boolean"
            ? policy.default_case_detection_enabled
            : true,
        dpdThreshold: Math.max(
            1,
            Number(policy?.default_case_dpd_threshold || env.creditRiskDefaultDpdThreshold || 30)
        ),
        reasonCode: String(policy?.default_case_reason_code || "arrears_threshold_breached")
            .trim()
            .slice(0, 80)
            || "arrears_threshold_breached"
    };
}

function normalizeGuarantorPolicy(policy) {
    const maxCommitmentRatio = Math.min(
        1,
        Math.max(
            0.01,
            Number(policy?.guarantor_max_commitment_ratio || env.creditRiskGuarantorMaxCommitmentRatio || 0.8)
        )
    );

    return {
        enabled: typeof policy?.guarantor_exposure_enforced === "boolean"
            ? policy.guarantor_exposure_enforced
            : true,
        maxCommitmentRatio,
        minAvailableAmount: Math.max(
            0,
            Number(policy?.guarantor_min_available_amount || env.creditRiskGuarantorMinAvailableAmount || 0)
        )
    };
}

async function getLoanPolicySettings(tenantId) {
    const { data, error } = await adminSupabase
        .from("loan_policy_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "LOAN_POLICY_LOOKUP_FAILED", "Unable to load loan policy settings.", error);
    }

    return data || null;
}

async function listDetectionCandidates({ tenantId, dpdThreshold, branchId, maxLoans }) {
    let arrearsQuery = adminSupabase
        .from("loan_arrears_view")
        .select("loan_id, days_past_due, overdue_amount")
        .eq("tenant_id", tenantId)
        .gte("days_past_due", dpdThreshold)
        .gt("overdue_amount", 0)
        .order("days_past_due", { ascending: false })
        .limit(maxLoans);

    const { data: arrearsRows, error: arrearsError } = await arrearsQuery;

    if (arrearsError) {
        throw new AppError(500, "LOAN_ARREARS_FETCH_FAILED", "Unable to load arrears candidates.", arrearsError);
    }

    const loanIds = (arrearsRows || []).map((row) => row.loan_id).filter(Boolean);
    if (!loanIds.length) {
        return [];
    }

    let loansQuery = adminSupabase
        .from("loans")
        .select("id, branch_id, member_id, status")
        .eq("tenant_id", tenantId)
        .in("id", loanIds)
        .in("status", ["active", "in_arrears"]);

    if (branchId) {
        loansQuery = loansQuery.eq("branch_id", branchId);
    }

    const { data: loanRows, error: loanError } = await loansQuery;

    if (loanError) {
        throw new AppError(500, "LOAN_LOOKUP_FAILED", "Unable to load candidate loan details.", loanError);
    }

    const loanMap = new Map((loanRows || []).map((loan) => [loan.id, loan]));

    return (arrearsRows || [])
        .map((row) => ({
            loan: loanMap.get(row.loan_id),
            daysPastDue: Number(row.days_past_due || 0)
        }))
        .filter((entry) => entry.loan && entry.daysPastDue > 0);
}

async function listExistingOpenDefaultCaseLoanIds(tenantId, loanIds) {
    if (!loanIds.length) {
        return new Set();
    }

    const { data, error } = await adminSupabase
        .from("loan_default_cases")
        .select("loan_id")
        .eq("tenant_id", tenantId)
        .in("loan_id", loanIds)
        .in("status", OPEN_DEFAULT_CASE_STATUSES)
        .is("closed_at", null);

    if (error) {
        throw new AppError(
            500,
            "DEFAULT_CASE_LOOKUP_FAILED",
            "Unable to load existing open default cases.",
            error
        );
    }

    return new Set((data || []).map((row) => row.loan_id));
}

async function listAllGuarantorMemberIds(tenantId) {
    const [guarantorRows, claimRows, exposureRows] = await Promise.all([
        adminSupabase
            .from("loan_guarantors")
            .select("member_id")
            .eq("tenant_id", tenantId),
        adminSupabase
            .from("guarantor_claims")
            .select("guarantor_member_id")
            .eq("tenant_id", tenantId),
        adminSupabase
            .from("guarantor_exposures")
            .select("guarantor_member_id")
            .eq("tenant_id", tenantId)
    ]);

    if (guarantorRows.error) {
        throw new AppError(500, "GUARANTOR_MEMBERS_LOOKUP_FAILED", "Unable to load guarantor members.", guarantorRows.error);
    }
    if (claimRows.error) {
        throw new AppError(500, "GUARANTOR_CLAIMS_LOOKUP_FAILED", "Unable to load guarantor claims.", claimRows.error);
    }
    if (exposureRows.error) {
        throw new AppError(500, "GUARANTOR_EXPOSURES_LOOKUP_FAILED", "Unable to load guarantor exposures.", exposureRows.error);
    }

    return Array.from(
        new Set([
            ...(guarantorRows.data || []).map((row) => row.member_id),
            ...(claimRows.data || []).map((row) => row.guarantor_member_id),
            ...(exposureRows.data || []).map((row) => row.guarantor_member_id)
        ].filter(Boolean))
    );
}

async function getGuarantorCapacityMap(tenantId, memberIds, policy) {
    if (!memberIds.length) {
        return new Map();
    }

    const { data, error } = await adminSupabase
        .from("member_accounts")
        .select("member_id, available_balance, product_type, status")
        .eq("tenant_id", tenantId)
        .in("member_id", memberIds)
        .eq("status", "active")
        .in("product_type", ["savings", "shares"]);

    if (error) {
        throw new AppError(500, "GUARANTOR_CAPACITY_LOOKUP_FAILED", "Unable to load guarantor account balances.", error);
    }

    const capacityMap = new Map();
    for (const row of data || []) {
        const current = Number(capacityMap.get(row.member_id) || 0);
        const next = current + Number(row.available_balance || 0);
        capacityMap.set(row.member_id, next);
    }

    for (const memberId of memberIds) {
        const base = Number(capacityMap.get(memberId) || 0);
        capacityMap.set(memberId, base * policy.maxCommitmentRatio);
    }

    return capacityMap;
}

async function getGuarantorCommittedMap(tenantId, memberIds) {
    if (!memberIds.length) {
        return new Map();
    }

    const { data: applications, error: applicationsError } = await adminSupabase
        .from("loan_applications")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("status", COMMITTED_GUARANTOR_APPLICATION_STATUSES);

    if (applicationsError) {
        throw new AppError(500, "GUARANTOR_APPLICATIONS_LOOKUP_FAILED", "Unable to load guarantor application exposures.", applicationsError);
    }

    const applicationIds = (applications || []).map((row) => row.id);
    if (!applicationIds.length) {
        return new Map();
    }

    const { data, error } = await adminSupabase
        .from("loan_guarantors")
        .select("member_id, guaranteed_amount")
        .eq("tenant_id", tenantId)
        .in("member_id", memberIds)
        .in("application_id", applicationIds);

    if (error) {
        throw new AppError(500, "GUARANTOR_COMMITTED_LOOKUP_FAILED", "Unable to load committed guarantor amounts.", error);
    }

    const committedMap = new Map();
    for (const row of data || []) {
        const current = Number(committedMap.get(row.member_id) || 0);
        committedMap.set(row.member_id, current + Number(row.guaranteed_amount || 0));
    }

    return committedMap;
}

async function getGuarantorInvokedMap(tenantId, memberIds) {
    if (!memberIds.length) {
        return new Map();
    }

    const { data, error } = await adminSupabase
        .from("guarantor_claims")
        .select("guarantor_member_id, claim_amount, settled_amount, status")
        .eq("tenant_id", tenantId)
        .in("guarantor_member_id", memberIds)
        .in("status", ACTIVE_GUARANTOR_CLAIM_STATUSES);

    if (error) {
        throw new AppError(500, "GUARANTOR_INVOKED_LOOKUP_FAILED", "Unable to load invoked guarantor claims.", error);
    }

    const invokedMap = new Map();
    for (const row of data || []) {
        const outstanding = Math.max(
            0,
            Number(row.claim_amount || 0) - Number(row.settled_amount || 0)
        );
        const current = Number(invokedMap.get(row.guarantor_member_id) || 0);
        invokedMap.set(row.guarantor_member_id, current + outstanding);
    }

    return invokedMap;
}

async function recomputeGuarantorExposuresForMembers({
    tenantId,
    memberIds = [],
    actorUserId = null,
    dryRun = false,
    source = "manual"
}) {
    const targetMemberIds = memberIds.length
        ? Array.from(new Set(memberIds.filter(Boolean)))
        : await listAllGuarantorMemberIds(tenantId);

    if (!targetMemberIds.length) {
        return {
            tenant_id: tenantId,
            source,
            dry_run: dryRun,
            members_scanned: 0,
            rows_upserted: 0,
            policy: normalizeGuarantorPolicy(await getLoanPolicySettings(tenantId)),
            exposures: []
        };
    }

    const policy = normalizeGuarantorPolicy(await getLoanPolicySettings(tenantId));
    const [capacityMap, committedMap, invokedMap] = await Promise.all([
        getGuarantorCapacityMap(tenantId, targetMemberIds, policy),
        getGuarantorCommittedMap(tenantId, targetMemberIds),
        getGuarantorInvokedMap(tenantId, targetMemberIds)
    ]);

    const nowIso = new Date().toISOString();
    const exposures = targetMemberIds.map((memberId) => {
        const capacity = Number(capacityMap.get(memberId) || 0);
        const committed = Number(committedMap.get(memberId) || 0);
        const invoked = Number(invokedMap.get(memberId) || 0);
        const availableRaw = capacity - committed - invoked;
        const available = Math.max(0, availableRaw);

        return {
            tenant_id: tenantId,
            guarantor_member_id: memberId,
            committed_amount: committed,
            invoked_amount: invoked,
            available_amount: available,
            last_recalculated_at: nowIso,
            exposure_capacity_amount: capacity,
            available_raw_amount: availableRaw
        };
    });

    if (!dryRun) {
        const upsertRows = exposures.map((row) => ({
            tenant_id: row.tenant_id,
            guarantor_member_id: row.guarantor_member_id,
            committed_amount: row.committed_amount,
            invoked_amount: row.invoked_amount,
            available_amount: row.available_amount,
            last_recalculated_at: row.last_recalculated_at
        }));

        const { error } = await adminSupabase
            .from("guarantor_exposures")
            .upsert(upsertRows, { onConflict: "tenant_id,guarantor_member_id" });

        if (error) {
            throw new AppError(500, "GUARANTOR_EXPOSURES_UPSERT_FAILED", "Unable to persist guarantor exposure values.", error);
        }

        if (actorUserId) {
            await logAudit({
                tenantId,
                actorUserId,
                table: "guarantor_exposures",
                action: "recompute_guarantor_exposures",
                entityType: "guarantor_exposure_recompute",
                afterData: {
                    source,
                    members_scanned: targetMemberIds.length
                }
            });
        }
    }

    return {
        tenant_id: tenantId,
        source,
        dry_run: dryRun,
        members_scanned: targetMemberIds.length,
        rows_upserted: dryRun ? 0 : targetMemberIds.length,
        policy,
        exposures
    };
}

async function getLoanRecord(tenantId, loanId) {
    const { data, error } = await adminSupabase
        .from("loans")
        .select("id, tenant_id, branch_id, member_id, status")
        .eq("tenant_id", tenantId)
        .eq("id", loanId)
        .single();

    if (error || !data) {
        throw new AppError(404, "LOAN_NOT_FOUND", "Loan was not found.");
    }

    return data;
}

async function getDefaultCaseById(actor, id, tenantId) {
    let builder = adminSupabase
        .from("loan_default_cases")
        .select(DEFAULT_CASE_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("id", id);

    builder = assertStaffBranchScopedRead(actor, builder);
    const { data, error } = await builder.maybeSingle();

    if (error) {
        throw new AppError(500, "DEFAULT_CASE_LOOKUP_FAILED", "Unable to load default case.", error);
    }

    if (!data) {
        throw new AppError(404, "DEFAULT_CASE_NOT_FOUND", "Default case was not found.");
    }

    return data;
}

async function getCollectionActionById(actor, actionId, tenantId) {
    let builder = adminSupabase
        .from("collection_actions")
        .select(COLLECTION_ACTION_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("id", actionId);

    builder = assertStaffBranchScopedRead(actor, builder);
    const { data, error } = await builder.maybeSingle();

    if (error) {
        throw new AppError(500, "COLLECTION_ACTION_LOOKUP_FAILED", "Unable to load collection action.", error);
    }

    if (!data) {
        throw new AppError(404, "COLLECTION_ACTION_NOT_FOUND", "Collection action was not found.");
    }

    return data;
}

async function getGuarantorClaimById(actor, claimId, tenantId) {
    let builder = adminSupabase
        .from("guarantor_claims")
        .select(GUARANTOR_CLAIM_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("id", claimId);

    builder = assertStaffBranchScopedRead(actor, builder);
    const { data, error } = await builder.maybeSingle();

    if (error) {
        throw new AppError(500, "GUARANTOR_CLAIM_LOOKUP_FAILED", "Unable to load guarantor claim.", error);
    }

    if (!data) {
        throw new AppError(404, "GUARANTOR_CLAIM_NOT_FOUND", "Guarantor claim was not found.");
    }

    return data;
}

async function getLoanGuarantorRecord(tenantId, loanId, guarantorMemberId) {
    const { data: loan, error: loanError } = await adminSupabase
        .from("loans")
        .select("id, application_id")
        .eq("tenant_id", tenantId)
        .eq("id", loanId)
        .maybeSingle();

    if (loanError) {
        throw new AppError(500, "LOAN_LOOKUP_FAILED", "Unable to load loan context for guarantor claim.", loanError);
    }

    if (!loan) {
        throw new AppError(404, "LOAN_NOT_FOUND", "Loan was not found.");
    }

    let applicationId = loan.application_id || null;
    if (!applicationId) {
        const { data: fallbackApplication, error: fallbackApplicationError } = await adminSupabase
            .from("loan_applications")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("loan_id", loanId)
            .maybeSingle();

        if (fallbackApplicationError) {
            throw new AppError(
                500,
                "LOAN_APPLICATION_LOOKUP_FAILED",
                "Unable to resolve loan application context for guarantor claim.",
                fallbackApplicationError
            );
        }

        applicationId = fallbackApplication?.id || null;
    }

    if (!applicationId) {
        throw new AppError(
            400,
            "GUARANTOR_CONTEXT_MISSING",
            "Loan application context is missing for this disbursed loan."
        );
    }

    const { data: guarantor, error: guarantorError } = await adminSupabase
        .from("loan_guarantors")
        .select("id, application_id, member_id, guaranteed_amount")
        .eq("tenant_id", tenantId)
        .eq("application_id", applicationId)
        .eq("member_id", guarantorMemberId)
        .maybeSingle();

    if (guarantorError) {
        throw new AppError(
            500,
            "GUARANTOR_LOOKUP_FAILED",
            "Unable to validate guarantor assignment for this loan.",
            guarantorError
        );
    }

    if (!guarantor) {
        throw new AppError(
            400,
            "GUARANTOR_NOT_LINKED_TO_LOAN",
            "Selected guarantor member is not linked to this loan."
        );
    }

    return guarantor;
}

async function updateGuarantorClaimById(tenantId, claimId, patch) {
    const { data, error } = await adminSupabase
        .from("guarantor_claims")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", claimId)
        .select(GUARANTOR_CLAIM_COLUMNS)
        .single();

    if (error || !data) {
        throw new AppError(500, "GUARANTOR_CLAIM_UPDATE_FAILED", "Unable to update guarantor claim.", error);
    }

    return data;
}

function assertDefaultCaseTransitionAllowed(currentStatus, nextStatus) {
    const allowed = DEFAULT_CASE_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
        throw new AppError(
            400,
            "DEFAULT_CASE_INVALID_TRANSITION",
            `Cannot transition default case from ${currentStatus} to ${nextStatus}.`
        );
    }
}

async function listDefaultCases(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const { page, limit, from, to } = normalizePagination(query);

    let builder = adminSupabase
        .from("loan_default_cases")
        .select(DEFAULT_CASE_COLUMNS, { count: "exact" })
        .eq("tenant_id", tenantId);

    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        builder = builder.eq("branch_id", query.branch_id);
    }
    if (query.member_id) {
        builder = builder.eq("member_id", query.member_id);
    }
    if (query.loan_id) {
        builder = builder.eq("loan_id", query.loan_id);
    }
    if (query.status) {
        builder = builder.eq("status", query.status);
    }

    builder = assertStaffBranchScopedRead(actor, builder);

    const { data, error, count } = await builder
        .order("opened_at", { ascending: false })
        .range(from, to);

    if (error) {
        throw new AppError(500, "DEFAULT_CASES_FETCH_FAILED", "Unable to load default cases.", error);
    }

    return {
        data: data || [],
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
}

async function getDefaultCase(actor, id, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    return getDefaultCaseById(actor, id, tenantId);
}

async function createDefaultCase(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const loan = await getLoanRecord(tenantId, payload.loan_id);
    assertBranchAccess({ auth: actor }, loan.branch_id);

    const insertPayload = {
        tenant_id: tenantId,
        branch_id: loan.branch_id,
        loan_id: loan.id,
        member_id: loan.member_id,
        status: "delinquent",
        dpd_days: payload.dpd_days,
        opened_at: new Date().toISOString(),
        opened_by: actor.user.id,
        reason_code: payload.reason_code,
        notes: payload.notes || null
    };

    const { data, error } = await adminSupabase
        .from("loan_default_cases")
        .insert(insertPayload)
        .select(DEFAULT_CASE_COLUMNS)
        .single();

    if (error) {
        if (String(error.code || "") === "23505") {
            throw new AppError(409, "DEFAULT_CASE_ALREADY_OPEN", "An open default case already exists for this loan.");
        }

        throw new AppError(500, "DEFAULT_CASE_CREATE_FAILED", "Unable to create default case.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_default_cases",
        action: "create_default_case",
        entityType: "loan_default_case",
        entityId: data.id,
        afterData: data
    });

    return data;
}

async function transitionDefaultCase(actor, id, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getDefaultCaseById(actor, id, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);
    assertDefaultCaseTransitionAllowed(current.status, payload.to_status);

    const movingToClosed = CLOSED_DEFAULT_CASE_STATUSES.has(payload.to_status);
    const patch = {
        status: payload.to_status,
        reason_code: payload.reason_code,
        notes: payload.notes || current.notes || null,
        closed_at: movingToClosed ? new Date().toISOString() : null,
        closed_by: movingToClosed ? actor.user.id : null
    };

    const { data, error } = await adminSupabase
        .from("loan_default_cases")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select(DEFAULT_CASE_COLUMNS)
        .single();

    if (error || !data) {
        throw new AppError(500, "DEFAULT_CASE_TRANSITION_FAILED", "Unable to transition default case.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_default_cases",
        action: "transition_default_case",
        entityType: "loan_default_case",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function listCollectionActions(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const { page, limit, from, to } = normalizePagination(query);

    let builder = adminSupabase
        .from("collection_actions")
        .select(COLLECTION_ACTION_COLUMNS, { count: "exact" })
        .eq("tenant_id", tenantId);

    if (query.default_case_id) {
        builder = builder.eq("default_case_id", query.default_case_id);
    }
    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        builder = builder.eq("branch_id", query.branch_id);
    }
    if (query.loan_id) {
        builder = builder.eq("loan_id", query.loan_id);
    }
    if (query.owner_user_id) {
        builder = builder.eq("owner_user_id", query.owner_user_id);
    }
    if (query.status) {
        builder = builder.eq("status", query.status);
    }
    if (query.action_type) {
        builder = builder.eq("action_type", query.action_type);
    }
    if (query.due_from) {
        builder = builder.gte("due_at", query.due_from);
    }
    if (query.due_to) {
        builder = builder.lte("due_at", query.due_to);
    }

    builder = assertStaffBranchScopedRead(actor, builder);

    const { data, error, count } = await builder
        .order("due_at", { ascending: true })
        .order("created_at", { ascending: false })
        .range(from, to);

    if (error) {
        throw new AppError(500, "COLLECTION_ACTIONS_FETCH_FAILED", "Unable to load collection actions.", error);
    }

    return {
        data: data || [],
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
}

async function createCollectionAction(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const defaultCase = await getDefaultCaseById(actor, payload.default_case_id, tenantId);
    assertBranchAccess({ auth: actor }, defaultCase.branch_id);

    if (CLOSED_DEFAULT_CASE_STATUSES.has(defaultCase.status)) {
        throw new AppError(400, "DEFAULT_CASE_CLOSED", "Cannot add collection action to a closed default case.");
    }

    const insertPayload = {
        tenant_id: tenantId,
        branch_id: defaultCase.branch_id,
        default_case_id: defaultCase.id,
        loan_id: defaultCase.loan_id,
        member_id: defaultCase.member_id,
        action_type: payload.action_type,
        owner_user_id: payload.owner_user_id || null,
        due_at: payload.due_at,
        priority: payload.priority,
        notes: payload.notes || null,
        created_by: actor.user.id
    };

    const { data, error } = await adminSupabase
        .from("collection_actions")
        .insert(insertPayload)
        .select(COLLECTION_ACTION_COLUMNS)
        .single();

    if (error || !data) {
        throw new AppError(500, "COLLECTION_ACTION_CREATE_FAILED", "Unable to create collection action.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "collection_actions",
        action: "create_collection_action",
        entityType: "collection_action",
        entityId: data.id,
        afterData: data
    });

    return data;
}

async function updateCollectionAction(actor, actionId, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getCollectionActionById(actor, actionId, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);

    if (["completed", "cancelled"].includes(current.status)) {
        throw new AppError(400, "COLLECTION_ACTION_LOCKED", "Completed or cancelled actions cannot be updated.");
    }

    const patch = {};

    if (Object.prototype.hasOwnProperty.call(payload, "owner_user_id")) {
        patch.owner_user_id = payload.owner_user_id || null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "due_at")) {
        patch.due_at = payload.due_at;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "priority")) {
        patch.priority = payload.priority;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "notes")) {
        patch.notes = payload.notes || null;
    }

    if (!Object.keys(patch).length) {
        return current;
    }

    const { data, error } = await adminSupabase
        .from("collection_actions")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", actionId)
        .select(COLLECTION_ACTION_COLUMNS)
        .single();

    if (error || !data) {
        throw new AppError(500, "COLLECTION_ACTION_UPDATE_FAILED", "Unable to update collection action.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "collection_actions",
        action: "update_collection_action",
        entityType: "collection_action",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function completeCollectionAction(actor, actionId, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getCollectionActionById(actor, actionId, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);

    if (current.status === "cancelled") {
        throw new AppError(400, "COLLECTION_ACTION_CANCELLED", "Cancelled actions cannot be completed.");
    }

    if (current.status === "completed") {
        return current;
    }

    const patch = {
        status: "completed",
        completed_at: new Date().toISOString(),
        outcome_code: payload.outcome_code,
        notes: payload.notes || current.notes || null
    };

    const { data, error } = await adminSupabase
        .from("collection_actions")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", actionId)
        .select(COLLECTION_ACTION_COLUMNS)
        .single();

    if (error || !data) {
        throw new AppError(500, "COLLECTION_ACTION_COMPLETE_FAILED", "Unable to complete collection action.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "collection_actions",
        action: "complete_collection_action",
        entityType: "collection_action",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function escalateCollectionAction(actor, actionId, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getCollectionActionById(actor, actionId, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);

    if (["completed", "cancelled"].includes(current.status)) {
        throw new AppError(400, "COLLECTION_ACTION_LOCKED", "Completed or cancelled actions cannot be escalated.");
    }

    const nowIso = new Date().toISOString();
    const patch = {
        status: current.status === "open" ? "overdue" : current.status,
        escalated_at: nowIso,
        escalation_reason: payload.escalation_reason,
        notes: payload.notes || current.notes || null
    };

    const { data, error } = await adminSupabase
        .from("collection_actions")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", actionId)
        .select(COLLECTION_ACTION_COLUMNS)
        .single();

    if (error || !data) {
        throw new AppError(500, "COLLECTION_ACTION_ESCALATE_FAILED", "Unable to escalate collection action.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "collection_actions",
        action: "escalate_collection_action",
        entityType: "collection_action",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function listGuarantorExposures(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const { page, limit, from, to } = normalizePagination(query);

    let builder = adminSupabase
        .from("guarantor_exposures")
        .select(`
            id,
            tenant_id,
            guarantor_member_id,
            committed_amount,
            invoked_amount,
            available_amount,
            last_recalculated_at,
            created_at,
            updated_at,
            members(id, full_name, member_no, phone, branch_id)
        `, { count: "exact" })
        .eq("tenant_id", tenantId);

    if (query.guarantor_member_id) {
        builder = builder.eq("guarantor_member_id", query.guarantor_member_id);
    }
    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        builder = builder.eq("members.branch_id", query.branch_id);
    }

    if (
        !actor.isInternalOps
        && [ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)
        && Array.isArray(actor.branchIds)
        && actor.branchIds.length
    ) {
        builder = builder.in("members.branch_id", actor.branchIds);
    }

    const { data, error, count } = await builder
        .order("available_amount", { ascending: true })
        .range(from, to);

    if (error) {
        throw new AppError(500, "GUARANTOR_EXPOSURES_FETCH_FAILED", "Unable to load guarantor exposures.", error);
    }

    return {
        data: data || [],
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
}

async function recomputeGuarantorExposures(actor, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    return runObservedJob(
        "credit_risk.guarantor_exposure_recompute",
        { tenantId },
        () =>
            recomputeGuarantorExposuresForMembers({
                tenantId,
                memberIds: Array.isArray(payload.member_ids) ? payload.member_ids : [],
                actorUserId: actor.user.id,
                dryRun: Boolean(payload.dry_run),
                source: "manual"
            })
    );
}

async function listGuarantorClaims(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const { page, limit, from, to } = normalizePagination(query);

    let builder = adminSupabase
        .from("guarantor_claims")
        .select(GUARANTOR_CLAIM_COLUMNS, { count: "exact" })
        .eq("tenant_id", tenantId);

    if (query.default_case_id) {
        builder = builder.eq("default_case_id", query.default_case_id);
    }
    if (query.loan_id) {
        builder = builder.eq("loan_id", query.loan_id);
    }
    if (query.guarantor_member_id) {
        builder = builder.eq("guarantor_member_id", query.guarantor_member_id);
    }
    if (query.status) {
        builder = builder.eq("status", query.status);
    }
    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        builder = builder.eq("branch_id", query.branch_id);
    }

    builder = assertStaffBranchScopedRead(actor, builder);

    const { data, error, count } = await builder
        .order("claimed_at", { ascending: false })
        .range(from, to);

    if (error) {
        throw new AppError(500, "GUARANTOR_CLAIMS_FETCH_FAILED", "Unable to load guarantor claims.", error);
    }

    return {
        data: data || [],
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
}

async function getGuarantorClaim(actor, claimId, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    return getGuarantorClaimById(actor, claimId, tenantId);
}

async function createGuarantorClaim(actor, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const defaultCase = await getDefaultCaseById(actor, payload.default_case_id, tenantId);
    assertBranchAccess({ auth: actor }, defaultCase.branch_id);

    if (defaultCase.status !== "claim_ready") {
        throw new AppError(
            400,
            "DEFAULT_CASE_NOT_CLAIM_READY",
            "Guarantor claims can only be created when default case status is claim_ready."
        );
    }

    await getLoanGuarantorRecord(tenantId, defaultCase.loan_id, payload.guarantor_member_id);

    const { data: existingOpenClaims, error: existingOpenClaimsError } = await adminSupabase
        .from("guarantor_claims")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("default_case_id", defaultCase.id)
        .eq("guarantor_member_id", payload.guarantor_member_id)
        .in("status", OPEN_GUARANTOR_CLAIM_STATUSES)
        .limit(1);

    if (existingOpenClaimsError) {
        throw new AppError(
            500,
            "GUARANTOR_CLAIM_LOOKUP_FAILED",
            "Unable to validate existing guarantor claims for this case.",
            existingOpenClaimsError
        );
    }

    if (Array.isArray(existingOpenClaims) && existingOpenClaims.length) {
        throw new AppError(
            409,
            "GUARANTOR_CLAIM_ALREADY_OPEN",
            "An active guarantor claim already exists for this member on the selected default case."
        );
    }

    const { data, error } = await adminSupabase
        .from("guarantor_claims")
        .insert({
            tenant_id: tenantId,
            branch_id: defaultCase.branch_id,
            default_case_id: defaultCase.id,
            loan_id: defaultCase.loan_id,
            guarantor_member_id: payload.guarantor_member_id,
            claim_amount: payload.claim_amount,
            claim_reference: payload.claim_reference || null,
            notes: payload.notes || null,
            claimed_by: actor.user.id,
            claimed_at: new Date().toISOString(),
            status: "draft"
        })
        .select(GUARANTOR_CLAIM_COLUMNS)
        .single();

    if (error || !data) {
        throw new AppError(500, "GUARANTOR_CLAIM_CREATE_FAILED", "Unable to create guarantor claim.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "guarantor_claims",
        action: "create_guarantor_claim",
        entityType: "guarantor_claim",
        entityId: data.id,
        afterData: data
    });

    return data;
}

async function submitGuarantorClaim(actor, claimId, payload = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getGuarantorClaimById(actor, claimId, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);

    if (current.status === "submitted") {
        return current;
    }
    if (current.status !== "draft") {
        throw new AppError(
            400,
            "GUARANTOR_CLAIM_INVALID_TRANSITION",
            `Cannot submit claim from status ${current.status}.`
        );
    }

    const data = await updateGuarantorClaimById(tenantId, claimId, {
        status: "submitted",
        claim_reference: Object.prototype.hasOwnProperty.call(payload, "claim_reference")
            ? (payload.claim_reference || null)
            : current.claim_reference,
        notes: Object.prototype.hasOwnProperty.call(payload, "notes")
            ? (payload.notes || null)
            : current.notes
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "guarantor_claims",
        action: "submit_guarantor_claim",
        entityType: "guarantor_claim",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function approveGuarantorClaim(actor, claimId, payload = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getGuarantorClaimById(actor, claimId, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);

    if (current.status === "approved") {
        return current;
    }
    if (current.status !== "submitted") {
        throw new AppError(
            400,
            "GUARANTOR_CLAIM_INVALID_TRANSITION",
            `Cannot approve claim from status ${current.status}.`
        );
    }

    const data = await updateGuarantorClaimById(tenantId, claimId, {
        status: "approved",
        approval_request_id: Object.prototype.hasOwnProperty.call(payload, "approval_request_id")
            ? (payload.approval_request_id || null)
            : current.approval_request_id,
        notes: Object.prototype.hasOwnProperty.call(payload, "notes")
            ? (payload.notes || null)
            : current.notes
    });

    await recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: [data.guarantor_member_id],
        actorUserId: actor.user.id,
        source: "guarantor_claim_approve"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "guarantor_claims",
        action: "approve_guarantor_claim",
        entityType: "guarantor_claim",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function rejectGuarantorClaim(actor, claimId, payload = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getGuarantorClaimById(actor, claimId, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);

    if (!["submitted", "approved"].includes(current.status)) {
        throw new AppError(
            400,
            "GUARANTOR_CLAIM_INVALID_TRANSITION",
            `Cannot reject claim from status ${current.status}.`
        );
    }

    const reasonNotes = [`rejection_reason:${payload.reason_code}`];
    if (payload.notes) {
        reasonNotes.push(payload.notes);
    }

    const data = await updateGuarantorClaimById(tenantId, claimId, {
        status: "draft",
        approval_request_id: null,
        posted_journal_id: null,
        notes: reasonNotes.join(" | ")
    });

    if (ACTIVE_GUARANTOR_CLAIM_STATUSES.includes(current.status)) {
        await recomputeGuarantorExposuresForMembers({
            tenantId,
            memberIds: [data.guarantor_member_id],
            actorUserId: actor.user.id,
            source: "guarantor_claim_reject"
        });
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "guarantor_claims",
        action: "reject_guarantor_claim",
        entityType: "guarantor_claim",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function postGuarantorClaim(actor, claimId, payload = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getGuarantorClaimById(actor, claimId, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);

    if (current.status === "posted") {
        return current;
    }
    if (current.status !== "approved") {
        throw new AppError(400, "GUARANTOR_CLAIM_NOT_POSTABLE", "Claim must be approved before posting.");
    }

    const data = await updateGuarantorClaimById(tenantId, claimId, {
        status: "posted",
        posted_journal_id: Object.prototype.hasOwnProperty.call(payload, "posted_journal_id")
            ? (payload.posted_journal_id || null)
            : current.posted_journal_id,
        notes: Object.prototype.hasOwnProperty.call(payload, "notes")
            ? (payload.notes || null)
            : current.notes
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "guarantor_claims",
        action: "post_guarantor_claim",
        entityType: "guarantor_claim",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function settleGuarantorClaim(actor, claimId, payload = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getGuarantorClaimById(actor, claimId, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);

    if (!["approved", "posted", "partial_settled"].includes(current.status)) {
        throw new AppError(
            400,
            "GUARANTOR_CLAIM_NOT_SETTLEABLE",
            `Cannot settle claim in status ${current.status}.`
        );
    }

    const nextSettledAmount = Number(current.settled_amount || 0) + Number(payload.settled_amount || 0);
    const claimAmount = Number(current.claim_amount || 0);
    if (nextSettledAmount > claimAmount) {
        throw new AppError(
            400,
            "GUARANTOR_CLAIM_SETTLEMENT_EXCEEDS_AMOUNT",
            "Settlement amount cannot exceed outstanding claim amount."
        );
    }

    const nextStatus = nextSettledAmount >= claimAmount ? "settled" : "partial_settled";
    const nowIso = new Date().toISOString();
    const data = await updateGuarantorClaimById(tenantId, claimId, {
        status: nextStatus,
        settled_amount: Number(nextSettledAmount.toFixed(2)),
        settled_at: nextStatus === "settled" ? nowIso : null,
        notes: Object.prototype.hasOwnProperty.call(payload, "notes")
            ? (payload.notes || null)
            : current.notes
    });

    await recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: [data.guarantor_member_id],
        actorUserId: actor.user.id,
        source: "guarantor_claim_settle"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "guarantor_claims",
        action: "settle_guarantor_claim",
        entityType: "guarantor_claim",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function waiveGuarantorClaim(actor, claimId, payload = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const current = await getGuarantorClaimById(actor, claimId, tenantId);
    assertBranchAccess({ auth: actor }, current.branch_id);

    if (["settled", "waived"].includes(current.status)) {
        throw new AppError(
            400,
            "GUARANTOR_CLAIM_NOT_WAIVABLE",
            `Cannot waive claim in status ${current.status}.`
        );
    }

    const reasonNotes = [`waiver_reason:${payload.reason_code}`];
    if (payload.notes) {
        reasonNotes.push(payload.notes);
    }

    const data = await updateGuarantorClaimById(tenantId, claimId, {
        status: "waived",
        waived_at: new Date().toISOString(),
        notes: reasonNotes.join(" | ")
    });

    await recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: [data.guarantor_member_id],
        actorUserId: actor.user.id,
        source: "guarantor_claim_waive"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "guarantor_claims",
        action: "waive_guarantor_claim",
        entityType: "guarantor_claim",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return data;
}

async function assertGuarantorExposureWithinLimits({
    tenantId,
    guarantors = [],
    actorUserId = null,
    source = "approval"
}) {
    const uniqueMemberIds = Array.from(
        new Set((guarantors || []).map((row) => row.member_id).filter(Boolean))
    );

    if (!uniqueMemberIds.length) {
        return {
            policy: normalizeGuarantorPolicy(await getLoanPolicySettings(tenantId)),
            checked: 0,
            violations: []
        };
    }

    const recompute = await recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: uniqueMemberIds,
        actorUserId,
        dryRun: false,
        source
    });
    const policy = recompute.policy;
    if (!policy.enabled) {
        return { policy, checked: uniqueMemberIds.length, violations: [] };
    }

    const exposureByMember = new Map(
        (recompute.exposures || []).map((row) => [row.guarantor_member_id, row])
    );

    const violations = [];
    for (const guarantor of guarantors) {
        const exposure = exposureByMember.get(guarantor.member_id);
        if (!exposure) {
            continue;
        }

        if (Number(exposure.available_raw_amount) < policy.minAvailableAmount) {
            violations.push({
                member_id: guarantor.member_id,
                guaranteed_amount: Number(guarantor.guaranteed_amount || 0),
                exposure_capacity_amount: Number(exposure.exposure_capacity_amount || 0),
                committed_amount: Number(exposure.committed_amount || 0),
                invoked_amount: Number(exposure.invoked_amount || 0),
                available_amount: Number(exposure.available_amount || 0),
                available_raw_amount: Number(exposure.available_raw_amount || 0),
                min_available_amount_required: Number(policy.minAvailableAmount || 0)
            });
        }
    }

    if (violations.length) {
        throw new AppError(
            400,
            "GUARANTOR_EXPOSURE_LIMIT_EXCEEDED",
            "One or more guarantors exceed configured exposure limits.",
            { violations, policy }
        );
    }

    return {
        policy,
        checked: uniqueMemberIds.length,
        violations: []
    };
}

async function runDefaultDetectionForTenant({
    tenantId,
    actor = null,
    branchId = null,
    dryRun = false,
    maxLoans = 500,
    source = "manual"
}) {
    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant identifier is required.");
    }

    if (actor) {
        assertTenantAccess({ auth: actor }, tenantId);
        if (branchId) {
            assertBranchAccess({ auth: actor }, branchId);
        }
    }

    const policy = await getLoanPolicySettings(tenantId);
    const normalizedPolicy = normalizeDefaultDetectionPolicy(policy);

    if (!normalizedPolicy.enabled) {
        return {
            tenant_id: tenantId,
            branch_id: branchId || null,
            source,
            detection_enabled: false,
            dry_run: dryRun,
            threshold_dpd_days: normalizedPolicy.dpdThreshold,
            scanned_candidates: 0,
            open_cases_existing: 0,
            would_open_cases: 0,
            created_cases: 0,
            skipped_duplicates: 0
        };
    }

    const candidates = await listDetectionCandidates({
        tenantId,
        dpdThreshold: normalizedPolicy.dpdThreshold,
        branchId,
        maxLoans
    });

    const loanIds = candidates.map((entry) => entry.loan.id);
    const existingOpenLoanIds = await listExistingOpenDefaultCaseLoanIds(tenantId, loanIds);

    const toCreate = candidates.filter((entry) => !existingOpenLoanIds.has(entry.loan.id));
    const summary = {
        tenant_id: tenantId,
        branch_id: branchId || null,
        source,
        detection_enabled: true,
        dry_run: dryRun,
        threshold_dpd_days: normalizedPolicy.dpdThreshold,
        scanned_candidates: candidates.length,
        open_cases_existing: existingOpenLoanIds.size,
        would_open_cases: toCreate.length,
        created_cases: 0,
        skipped_duplicates: 0
    };

    if (dryRun || !toCreate.length) {
        return summary;
    }

    for (const entry of toCreate) {
        const insertPayload = {
            tenant_id: tenantId,
            branch_id: entry.loan.branch_id,
            loan_id: entry.loan.id,
            member_id: entry.loan.member_id,
            status: "delinquent",
            dpd_days: entry.daysPastDue,
            opened_at: new Date().toISOString(),
            opened_by: actor?.user?.id || null,
            reason_code: normalizedPolicy.reasonCode,
            notes: source === "scheduler"
                ? "Auto-opened by scheduled default detection."
                : "Auto-opened by manual default detection run."
        };

        const { error } = await adminSupabase
            .from("loan_default_cases")
            .insert(insertPayload);

        if (error) {
            if (String(error.code || "") === "23505") {
                summary.skipped_duplicates += 1;
                continue;
            }

            throw new AppError(500, "DEFAULT_CASE_DETECTION_FAILED", "Unable to auto-open default case.", error);
        }

        summary.created_cases += 1;
    }

    if (actor?.user?.id) {
        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "loan_default_cases",
            action: "run_default_detection",
            entityType: "loan_default_detection_run",
            afterData: summary
        });
    }

    return summary;
}

async function runDefaultDetection(actor, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    const branchId = payload.branch_id || null;
    const dryRun = Boolean(payload.dry_run);
    const maxLoans = Number(payload.max_loans || 500);

    return runObservedJob(
        "credit_risk.default_detection",
        { tenantId },
        () => runDefaultDetectionForTenant({
            tenantId,
            actor,
            branchId,
            dryRun,
            maxLoans,
            source: "manual"
        })
    );
}

async function runScheduledDefaultDetection() {
    const { data: tenants, error } = await adminSupabase
        .from("tenants")
        .select("id")
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(env.creditRiskDefaultDetectionMaxTenantsPerRun);

    if (error) {
        throw new AppError(500, "TENANTS_LOOKUP_FAILED", "Unable to load tenants for default detection.", error);
    }

    const summaries = [];
    for (const tenant of tenants || []) {
        const summary = await runObservedJob(
            "credit_risk.default_detection",
            { tenantId: tenant.id },
            () => runDefaultDetectionForTenant({
                tenantId: tenant.id,
                source: "scheduler",
                maxLoans: env.creditRiskDefaultDetectionMaxLoansPerTenant
            })
        );
        summaries.push(summary);
    }

    return {
        tenants_scanned: summaries.length,
        summaries
    };
}

module.exports = {
    listDefaultCases,
    getDefaultCase,
    createDefaultCase,
    transitionDefaultCase,
    listCollectionActions,
    createCollectionAction,
    updateCollectionAction,
    completeCollectionAction,
    escalateCollectionAction,
    listGuarantorExposures,
    recomputeGuarantorExposures,
    listGuarantorClaims,
    getGuarantorClaim,
    createGuarantorClaim,
    submitGuarantorClaim,
    approveGuarantorClaim,
    rejectGuarantorClaim,
    postGuarantorClaim,
    settleGuarantorClaim,
    waiveGuarantorClaim,
    assertGuarantorExposureWithinLimits,
    recomputeGuarantorExposuresForMembers,
    runDefaultDetection,
    runScheduledDefaultDetection,
    runDefaultDetectionForTenant
};
