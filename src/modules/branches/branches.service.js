const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertPlanLimit } = require("../../services/subscription.service");
const { logAudit } = require("../../services/audit.service");
const { assertTenantAccess } = require("../../services/user-context.service");

async function listBranches(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;

    if (!tenantId && !actor.isInternalOps) {
        throw new AppError(403, "TENANT_ACCESS_DENIED", "Tenant context is missing.");
    }

    if (query.tenant_id) {
        assertTenantAccess({ auth: actor }, query.tenant_id);
    }

    const page = Number(query.page || 1);
    const limit = Math.min(Number(query.limit || 50), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let request = adminSupabase
        .from("branches")
        .select("*", { count: "exact" })
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(from, to);

    if (tenantId) {
        request = request.eq("tenant_id", tenantId);
    }

    if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        request = request.in("id", actor.branchIds);
    }

    const { data, error, count } = await request;

    if (error) {
        throw new AppError(500, "BRANCHES_LIST_FAILED", "Unable to load branches.", error);
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

async function createBranch(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertPlanLimit(tenantId, "branches", "branches");

    const { data, error } = await adminSupabase
        .from("branches")
        .insert({
            tenant_id: tenantId,
            ...payload
        })
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "BRANCH_CREATE_FAILED", "Unable to create branch.", error);
    }

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "branches",
        action: "create_branch",
        afterData: data
    });

    return data;
}

module.exports = {
    listBranches,
    createBranch
};
