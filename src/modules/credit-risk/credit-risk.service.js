const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { logAudit } = require("../../services/audit.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
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

const CLOSED_DEFAULT_CASE_STATUSES = new Set([
    "restructured",
    "written_off",
    "recovered"
]);

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

module.exports = {
    listDefaultCases,
    getDefaultCase,
    createDefaultCase,
    transitionDefaultCase,
    listCollectionActions,
    createCollectionAction,
    updateCollectionAction,
    completeCollectionAction,
    escalateCollectionAction
};
