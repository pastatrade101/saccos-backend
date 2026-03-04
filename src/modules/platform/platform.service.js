const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const { assignTenantSubscription, getSubscriptionStatus } = require("../../services/subscription.service");

async function listPlans() {
    const { data, error } = await adminSupabase
        .from("plans")
        .select("*, plan_features(*)")
        .order("created_at", { ascending: true });

    if (error) {
        throw new AppError(500, "PLANS_LIST_FAILED", "Unable to load plans.", error);
    }

    return data || [];
}

async function updatePlanFeatures(actor, planId, payload) {
    const { data: plan, error: planError } = await adminSupabase
        .from("plans")
        .select("*")
        .eq("id", planId)
        .single();

    if (planError || !plan) {
        throw new AppError(404, "PLAN_NOT_FOUND", "Plan was not found.");
    }

    const rows = payload.features.map((feature) => ({
        plan_id: planId,
        feature_key: feature.feature_key,
        feature_type: feature.feature_type,
        bool_value: feature.feature_type === "bool" ? Boolean(feature.bool_value) : null,
        int_value: feature.feature_type === "int" ? Number(feature.int_value || 0) : null,
        string_value: feature.feature_type === "string" ? feature.string_value || "" : null
    }));

    const { error } = await adminSupabase
        .from("plan_features")
        .upsert(rows, { onConflict: "plan_id,feature_key" });

    if (error) {
        throw new AppError(500, "PLAN_FEATURE_UPDATE_FAILED", "Unable to update plan features.", error);
    }

    await logAudit({
        tenantId: null,
        userId: actor.user.id,
        table: "plan_features",
        action: "update_plan_features",
        afterData: { plan_id: planId, features: rows }
    });

    return listPlans();
}

async function listPlatformTenants() {
    const { data: tenants, error } = await adminSupabase
        .from("tenants")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

    if (error) {
        throw new AppError(500, "PLATFORM_TENANTS_LIST_FAILED", "Unable to load platform tenants.", error);
    }

    const { data: branches, error: branchError } = await adminSupabase
        .from("branches")
        .select("tenant_id")
        .is("deleted_at", null);

    if (branchError) {
        throw new AppError(500, "PLATFORM_BRANCHES_LIST_FAILED", "Unable to load platform branch counts.", branchError);
    }

    const branchCounts = (branches || []).reduce((accumulator, branch) => {
        accumulator[branch.tenant_id] = (accumulator[branch.tenant_id] || 0) + 1;
        return accumulator;
    }, {});

    const enriched = await Promise.all((tenants || []).map(async (tenant) => ({
        ...tenant,
        branch_count: branchCounts[tenant.id] || 0,
        subscription: await getSubscriptionStatus(tenant.id)
    })));

    return enriched;
}

async function assignSubscription(actor, tenantId, payload) {
    const { data: tenant, error: tenantError } = await adminSupabase
        .from("tenants")
        .select("id, name")
        .eq("id", tenantId)
        .is("deleted_at", null)
        .maybeSingle();

    if (tenantError || !tenant) {
        throw new AppError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    const subscription = await assignTenantSubscription({
        tenantId,
        planCode: payload.plan_code,
        status: payload.status,
        startAt: payload.start_at,
        expiresAt: payload.expires_at
    });

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "tenant_subscriptions",
        action: "assign_tenant_subscription",
        afterData: { tenant_id: tenantId, ...subscription }
    });

    return {
        tenant,
        subscription: await getSubscriptionStatus(tenantId)
    };
}

module.exports = {
    listPlans,
    updatePlanFeatures,
    listPlatformTenants,
    assignSubscription
};
