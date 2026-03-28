const { adminSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const { ROLES } = require("../../constants/roles");
const { logAudit } = require("../../services/audit.service");
const { assertTwoFactorStepUp } = require("../../services/two-factor.service");
const {
    notifyApprovalOutcomeToMaker,
    notifyApprovalRequestPending,
    notifyTellerWithdrawalApprovalRequired
} = require("../../services/branch-alerts.service");
const { getSubscriptionStatus } = require("../../services/subscription.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const AppError = require("../../utils/app-error");

const APPROVAL_REQUEST_COLUMNS = `
    id,
    tenant_id,
    branch_id,
    operation_key,
    entity_type,
    entity_id,
    status,
    maker_user_id,
    payload_json,
    policy_snapshot,
    requested_amount,
    currency,
    threshold_amount,
    required_checker_count,
    approved_count,
    rejection_reason,
    requested_at,
    expires_at,
    last_decision_at,
    executed_at,
    created_at,
    updated_at
`;

const DEFAULT_OPERATION_POLICIES = {
    "finance.withdraw": {
        enabled: true,
        threshold_amount: env.highValueThresholdTzs,
        required_checker_count: 1,
        allowed_maker_roles: [ROLES.TELLER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        allowed_checker_roles: [ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        sla_minutes: 120
    },
    "finance.loan_disburse": {
        enabled: true,
        threshold_amount: env.highValueThresholdTzs,
        required_checker_count: 1,
        allowed_maker_roles: [ROLES.TELLER, ROLES.LOAN_OFFICER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        allowed_checker_roles: [ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        sla_minutes: 120
    },
    "treasury.order_execute": {
        enabled: true,
        threshold_amount: 0,
        required_checker_count: 1,
        allowed_maker_roles: [ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        allowed_checker_roles: [ROLES.SUPER_ADMIN],
        sla_minutes: 240
    }
};

function normalizePagination(query = {}) {
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    return { page, limit, from, to };
}

function assertBranchScopedRead(actor, builder) {
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

function normalizeRoles(roles = [], fallback = []) {
    const source = Array.isArray(roles) && roles.length ? roles : fallback;
    return [...new Set(source.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizePolicy(operationKey, row = null) {
    const baseline = DEFAULT_OPERATION_POLICIES[operationKey] || {
        enabled: true,
        threshold_amount: env.highValueThresholdTzs,
        required_checker_count: 1,
        allowed_maker_roles: [ROLES.TELLER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        allowed_checker_roles: [ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        sla_minutes: 120
    };

    return {
        operation_key: operationKey,
        enabled: typeof row?.enabled === "boolean" ? row.enabled : baseline.enabled,
        threshold_amount: Number(row?.threshold_amount ?? baseline.threshold_amount),
        required_checker_count: Math.max(1, Number(row?.required_checker_count ?? baseline.required_checker_count ?? 1)),
        allowed_maker_roles: normalizeRoles(row?.allowed_maker_roles, baseline.allowed_maker_roles),
        allowed_checker_roles: normalizeRoles(row?.allowed_checker_roles, baseline.allowed_checker_roles),
        sla_minutes: Math.max(5, Number(row?.sla_minutes ?? baseline.sla_minutes ?? 120))
    };
}

async function getPolicyForOperation(tenantId, operationKey) {
    const { data, error } = await adminSupabase
        .from("approval_policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("operation_key", operationKey)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "APPROVAL_POLICY_LOOKUP_FAILED", "Unable to load approval policy.", error);
    }

    return normalizePolicy(operationKey, data);
}

async function listApprovalPolicies(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from("approval_policies")
        .select("*")
        .eq("tenant_id", tenantId);

    if (error) {
        throw new AppError(500, "APPROVAL_POLICIES_FETCH_FAILED", "Unable to load approval policies.", error);
    }

    const rowByOperation = new Map((data || []).map((row) => [row.operation_key, row]));
    const operationKeys = [...new Set([
        ...Object.keys(DEFAULT_OPERATION_POLICIES),
        ...rowByOperation.keys()
    ])];

    return operationKeys.map((operationKey) => normalizePolicy(operationKey, rowByOperation.get(operationKey) || null));
}

async function updateApprovalPolicy(actor, operationKey, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertTwoFactorStepUp(actor, payload, { action: "approval_policy_update" });

    const current = await getPolicyForOperation(tenantId, operationKey);
    const next = {
        ...current,
        enabled: Object.prototype.hasOwnProperty.call(payload, "enabled") ? payload.enabled : current.enabled,
        threshold_amount: Object.prototype.hasOwnProperty.call(payload, "threshold_amount")
            ? Number(payload.threshold_amount)
            : current.threshold_amount,
        required_checker_count: Object.prototype.hasOwnProperty.call(payload, "required_checker_count")
            ? Number(payload.required_checker_count)
            : current.required_checker_count,
        allowed_maker_roles: Object.prototype.hasOwnProperty.call(payload, "allowed_maker_roles")
            ? normalizeRoles(payload.allowed_maker_roles, current.allowed_maker_roles)
            : current.allowed_maker_roles,
        allowed_checker_roles: Object.prototype.hasOwnProperty.call(payload, "allowed_checker_roles")
            ? normalizeRoles(payload.allowed_checker_roles, current.allowed_checker_roles)
            : current.allowed_checker_roles,
        sla_minutes: Object.prototype.hasOwnProperty.call(payload, "sla_minutes")
            ? Number(payload.sla_minutes)
            : current.sla_minutes
    };

    const { data, error } = await adminSupabase
        .from("approval_policies")
        .upsert({
            tenant_id: tenantId,
            operation_key: operationKey,
            enabled: next.enabled,
            threshold_amount: next.threshold_amount,
            required_checker_count: next.required_checker_count,
            allowed_maker_roles: next.allowed_maker_roles,
            allowed_checker_roles: next.allowed_checker_roles,
            sla_minutes: next.sla_minutes
        }, { onConflict: "tenant_id,operation_key" })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "APPROVAL_POLICY_UPDATE_FAILED", "Unable to update approval policy.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "approval_policies",
        action: "update_approval_policy",
        entityType: "approval_policy",
        entityId: data.id,
        beforeData: current,
        afterData: data
    });

    return normalizePolicy(operationKey, data);
}

async function getApprovalRequestById(actor, requestId, tenantId) {
    let builder = adminSupabase
        .from("approval_requests")
        .select(APPROVAL_REQUEST_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("id", requestId);

    builder = assertBranchScopedRead(actor, builder);
    const { data, error } = await builder.maybeSingle();

    if (error) {
        throw new AppError(500, "APPROVAL_REQUEST_LOOKUP_FAILED", "Unable to load approval request.", error);
    }

    if (!data) {
        throw new AppError(404, "APPROVAL_REQUEST_NOT_FOUND", "Approval request was not found.");
    }

    return data;
}

async function listApprovalRequests(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { page, limit, from, to } = normalizePagination(query);

    let builder = adminSupabase
        .from("approval_requests")
        .select(APPROVAL_REQUEST_COLUMNS, { count: "exact" })
        .eq("tenant_id", tenantId);

    builder = assertBranchScopedRead(actor, builder);

    if (query.status) builder = builder.eq("status", query.status);
    if (query.operation_key) builder = builder.eq("operation_key", query.operation_key);
    if (query.branch_id) builder = builder.eq("branch_id", query.branch_id);
    if (query.maker_user_id) builder = builder.eq("maker_user_id", query.maker_user_id);

    const { data, error, count } = await builder
        .order("requested_at", { ascending: false })
        .range(from, to);

    if (error) {
        throw new AppError(500, "APPROVAL_REQUESTS_FETCH_FAILED", "Unable to load approval requests.", error);
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

async function getApprovalRequest(actor, requestId, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const request = await getApprovalRequestById(actor, requestId, tenantId);
    const { data: decisions, error } = await adminSupabase
        .from("approval_decisions")
        .select("id, decision, decided_by, notes, created_at")
        .eq("tenant_id", tenantId)
        .eq("approval_request_id", requestId)
        .order("created_at", { ascending: true });

    if (error) {
        throw new AppError(500, "APPROVAL_DECISIONS_FETCH_FAILED", "Unable to load approval decisions.", error);
    }

    return {
        ...request,
        decisions: decisions || []
    };
}

async function createApprovalRequest({
    actor,
    tenantId,
    branchId,
    operationKey,
    requestedAmount,
    payload = {},
    entityType = null,
    entityId = null
}) {
    const policy = await getPolicyForOperation(tenantId, operationKey);
    const requestedAt = new Date();
    const expiresAt = new Date(requestedAt.getTime() + policy.sla_minutes * 60 * 1000);

    const insertRow = {
        tenant_id: tenantId,
        branch_id: branchId || null,
        operation_key: operationKey,
        entity_type: entityType,
        entity_id: entityId,
        status: "pending",
        maker_user_id: actor.user.id,
        payload_json: payload,
        policy_snapshot: policy,
        requested_amount: Number(requestedAmount || 0),
        currency: "TZS",
        threshold_amount: policy.threshold_amount,
        required_checker_count: policy.required_checker_count,
        approved_count: 0,
        requested_at: requestedAt.toISOString(),
        expires_at: expiresAt.toISOString()
    };

    const { data, error } = await adminSupabase
        .from("approval_requests")
        .insert(insertRow)
        .select(APPROVAL_REQUEST_COLUMNS)
        .single();

    if (error || !data) {
        throw new AppError(500, "APPROVAL_REQUEST_CREATE_FAILED", "Unable to create approval request.", error);
    }

    const steps = Array.from({ length: policy.required_checker_count }, (_, idx) => ({
        approval_request_id: data.id,
        tenant_id: tenantId,
        step_order: idx + 1,
        required_role: policy.allowed_checker_roles[0] || null,
        status: "pending"
    }));

    if (steps.length) {
        const { error: stepsError } = await adminSupabase.from("approval_steps").insert(steps);
        if (stepsError) {
            throw new AppError(500, "APPROVAL_STEPS_CREATE_FAILED", "Unable to initialize approval steps.", stepsError);
        }
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "approval_requests",
        action: "create_approval_request",
        entityType: "approval_request",
        entityId: data.id,
        afterData: data
    });

    await notifyApprovalRequestPending({
        actor,
        request: data
    });
    if (data.operation_key === "finance.withdraw") {
        await notifyTellerWithdrawalApprovalRequired({
            actor,
            request: data
        });
    }

    return {
        approval_required: true,
        status: "pending_approval",
        operation_key: operationKey,
        approval_request_id: data.id,
        required_checker_count: data.required_checker_count,
        approved_count: data.approved_count,
        threshold_amount: data.threshold_amount,
        requested_amount: data.requested_amount
    };
}

async function ensureOperationApproval({
    actor,
    tenantId,
    branchId,
    operationKey,
    requestedAmount,
    payload = {},
    approvalRequestId = null,
    entityType = null,
    entityId = null
}) {
    const subscription = await getSubscriptionStatus(tenantId);
    if (!subscription.features?.maker_checker_enabled) {
        return { approval_required: false };
    }

    const policy = await getPolicyForOperation(tenantId, operationKey);
    if (!policy.enabled) {
        return { approval_required: false, policy };
    }

    const amount = Number(requestedAmount || 0);
    if (amount < Number(policy.threshold_amount || 0)) {
        return { approval_required: false, policy };
    }

    if (!actor.isInternalOps && !policy.allowed_maker_roles.includes(actor.role)) {
        throw new AppError(403, "APPROVAL_MAKER_ROLE_NOT_ALLOWED", "Your role is not allowed to initiate this high-risk transaction.");
    }

    if (!approvalRequestId) {
        return createApprovalRequest({
            actor,
            tenantId,
            branchId,
            operationKey,
            requestedAmount: amount,
            payload,
            entityType,
            entityId
        });
    }

    const request = await getApprovalRequestById(actor, approvalRequestId, tenantId);

    if (request.operation_key !== operationKey) {
        throw new AppError(400, "APPROVAL_REQUEST_OPERATION_MISMATCH", "Approval request does not match this operation.");
    }

    if (!actor.isInternalOps && request.maker_user_id !== actor.user.id) {
        throw new AppError(403, "APPROVAL_REQUEST_MAKER_MISMATCH", "Only the original maker can execute this approved request.");
    }

    if (request.status === "pending") {
        throw new AppError(409, "APPROVAL_REQUEST_PENDING", "Approval request is still pending checker decision.", {
            approval_request_id: request.id
        });
    }

    if (request.status === "rejected") {
        throw new AppError(409, "APPROVAL_REQUEST_REJECTED", "Approval request was rejected by checker.", {
            approval_request_id: request.id,
            rejection_reason: request.rejection_reason
        });
    }

    if (request.status === "executed") {
        throw new AppError(409, "APPROVAL_REQUEST_ALREADY_EXECUTED", "Approval request has already been executed.", {
            approval_request_id: request.id
        });
    }

    if (request.status !== "approved") {
        throw new AppError(409, "APPROVAL_REQUEST_NOT_APPROVED", "Approval request is not approved for execution.", {
            approval_request_id: request.id,
            status: request.status
        });
    }

    if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
        const { data: expiredRow, error: expiredError } = await adminSupabase
            .from("approval_requests")
            .update({
                status: "expired",
                last_decision_at: new Date().toISOString()
            })
            .eq("tenant_id", tenantId)
            .eq("id", request.id)
            .eq("status", "approved")
            .select(APPROVAL_REQUEST_COLUMNS)
            .maybeSingle();

        if (expiredError) {
            throw new AppError(500, "APPROVAL_REQUEST_EXPIRE_FAILED", "Unable to expire stale approval request.", expiredError);
        }

        await notifyApprovalOutcomeToMaker({
            actor,
            request: expiredRow || request,
            outcome: "expired"
        });

        throw new AppError(409, "APPROVAL_REQUEST_EXPIRED", "Approval request has expired; create a new request.", {
            approval_request_id: expiredRow?.id || request.id
        });
    }

    return {
        approval_required: true,
        status: "approved",
        approval_request_id: request.id,
        request
    };
}

async function markApprovalRequestExecuted({ actor, tenantId, requestId, entityType = null, entityId = null }) {
    if (!requestId) return null;

    const { data, error } = await adminSupabase
        .from("approval_requests")
        .update({
            status: "executed",
            entity_type: entityType,
            entity_id: entityId,
            executed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq("tenant_id", tenantId)
        .eq("id", requestId)
        .eq("status", "approved")
        .select(APPROVAL_REQUEST_COLUMNS)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "APPROVAL_REQUEST_EXECUTE_MARK_FAILED", "Unable to mark approval request as executed.", error);
    }

    if (!data) {
        throw new AppError(409, "APPROVAL_REQUEST_EXECUTE_INVALID_STATE", "Approval request is not in approved state.");
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "approval_requests",
        action: "execute_approval_request",
        entityType: "approval_request",
        entityId: data.id,
        afterData: data
    });

    return data;
}

async function decideRequest(actor, requestId, payload = {}, decision = "approved") {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertTwoFactorStepUp(actor, payload, { action: `approval_request_${decision}` });

    const request = await getApprovalRequestById(actor, requestId, tenantId);
    assertBranchAccess({ auth: actor }, request.branch_id);

    if (request.status !== "pending") {
        throw new AppError(409, "APPROVAL_REQUEST_NOT_PENDING", "Only pending approval requests can be decided.", {
            status: request.status
        });
    }

    if (request.maker_user_id === actor.user.id) {
        throw new AppError(400, "MAKER_CHECKER_VIOLATION", "The request maker cannot approve or reject the same request.");
    }

    const policyFromSnapshot = normalizePolicy(request.operation_key, request.policy_snapshot || null);
    if (!actor.isInternalOps && !policyFromSnapshot.allowed_checker_roles.includes(actor.role)) {
        throw new AppError(403, "APPROVAL_CHECKER_ROLE_NOT_ALLOWED", "Your role is not allowed to decide this request.");
    }

    const { error: decisionError } = await adminSupabase
        .from("approval_decisions")
        .insert({
            approval_request_id: request.id,
            tenant_id: tenantId,
            decision,
            decided_by: actor.user.id,
            notes: payload.notes || null
        });

    if (decisionError) {
        if (decisionError.code === "23505") {
            throw new AppError(409, "APPROVAL_DECISION_ALREADY_RECORDED", "You already recorded a decision for this request.");
        }

        throw new AppError(500, "APPROVAL_DECISION_SAVE_FAILED", "Unable to save approval decision.", decisionError);
    }

    const now = new Date().toISOString();
    let patch;
    if (decision === "rejected") {
        patch = {
            status: "rejected",
            rejection_reason: payload.reason || payload.notes || "rejected",
            last_decision_at: now
        };
    } else {
        const { count: approvedCount, error: approvedCountError } = await adminSupabase
            .from("approval_decisions")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("approval_request_id", request.id)
            .eq("decision", "approved");

        if (approvedCountError) {
            throw new AppError(500, "APPROVAL_DECISION_COUNT_FAILED", "Unable to compute approval decision count.", approvedCountError);
        }

        const approved = Number(approvedCount || 0);
        patch = {
            status: approved >= Number(request.required_checker_count || 1) ? "approved" : "pending",
            approved_count: approved,
            last_decision_at: now
        };
    }

    const { data: updated, error: updateError } = await adminSupabase
        .from("approval_requests")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", request.id)
        .select(APPROVAL_REQUEST_COLUMNS)
        .single();

    if (updateError || !updated) {
        throw new AppError(500, "APPROVAL_REQUEST_DECIDE_UPDATE_FAILED", "Unable to update approval request status.", updateError);
    }

    const stepOrder = Math.min(Number(updated.approved_count || 0) + (decision === "rejected" ? 1 : 0), Number(updated.required_checker_count || 1));
    await adminSupabase
        .from("approval_steps")
        .update({
            status: decision === "approved" ? "approved" : "rejected",
            decided_by: actor.user.id,
            decided_at: now,
            notes: payload.notes || null
        })
        .eq("tenant_id", tenantId)
        .eq("approval_request_id", request.id)
        .eq("step_order", stepOrder);

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "approval_requests",
        action: decision === "approved" ? "approve_request" : "reject_request",
        entityType: "approval_request",
        entityId: request.id,
        beforeData: request,
        afterData: updated
    });

    if (["approved", "rejected"].includes(updated.status)) {
        await notifyApprovalOutcomeToMaker({
            actor,
            request: updated,
            outcome: updated.status
        });
    }

    return {
        ...updated,
        awaiting_additional_approvals: updated.status === "pending"
    };
}

async function approveRequest(actor, requestId, payload = {}) {
    return decideRequest(actor, requestId, payload, "approved");
}

async function rejectRequest(actor, requestId, payload = {}) {
    return decideRequest(actor, requestId, payload, "rejected");
}

module.exports = {
    getPolicyForOperation,
    listApprovalPolicies,
    updateApprovalPolicy,
    listApprovalRequests,
    getApprovalRequest,
    ensureOperationApproval,
    markApprovalRequestExecuted,
    approveRequest,
    rejectRequest
};
