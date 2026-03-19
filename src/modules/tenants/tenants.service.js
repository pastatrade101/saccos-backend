const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const {
    assignTenantSubscription,
    getSubscriptionStatus,
    getSubscriptionStatusesForTenants
} = require("../../services/subscription.service");
const { assertTenantAccess } = require("../../services/user-context.service");

function withTenantSubscription(tenant, subscription) {
    const normalizedSubscription = subscription && subscription.status !== "missing"
        ? subscription
        : null;

    return {
        ...tenant,
        subscription: normalizedSubscription
    };
}

async function listTenants(actor, query = {}) {
    const page = Number(query.page || 1);
    const limit = Math.min(Number(query.limit || 50), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (actor.isInternalOps) {
        const { data, error, count } = await adminSupabase
            .from("tenants")
            .select("*", { count: "exact" })
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .range(from, to);

        if (error) {
            throw new AppError(500, "TENANTS_LIST_FAILED", "Unable to load tenants.", error);
        }

        const subscriptionsByTenant = await getSubscriptionStatusesForTenants(
            (data || []).map((tenant) => tenant.id)
        );

        return {
            data: (data || []).map((tenant) =>
                withTenantSubscription(tenant, subscriptionsByTenant[tenant.id] || null)
            ),
            pagination: {
                page,
                limit,
                total: count || 0
            }
        };
    }

    if (!actor.tenantId) {
        throw new AppError(403, "TENANT_ACCESS_DENIED", "Tenant context is missing.");
    }

    const { data, error } = await adminSupabase
        .from("tenants")
        .select("*")
        .eq("id", actor.tenantId)
        .is("deleted_at", null)
        .single();

    if (error) {
        throw new AppError(500, "TENANT_FETCH_FAILED", "Unable to load tenant.", error);
    }

    return {
        data: [withTenantSubscription(data, await getSubscriptionStatus(actor.tenantId))],
        pagination: {
            page: 1,
            limit: 1,
            total: data ? 1 : 0
        }
    };
}

async function createTenant(actor, payload) {
    if (!actor.isInternalOps) {
        throw new AppError(403, "FORBIDDEN", "Only internal operations can create tenants.");
    }

    const { data: tenant, error } = await adminSupabase
        .from("tenants")
        .insert({
            name: payload.name,
            registration_number: payload.registration_number,
            status: payload.status
        })
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "TENANT_CREATE_FAILED", "Unable to create tenant.", error);
    }

    await assignTenantSubscription({
        tenantId: tenant.id,
        planCode: payload.plan,
        status: payload.subscription_status,
        startAt: payload.start_at,
        expiresAt: payload.expires_at
    });

    const { error: seedError } = await adminSupabase.rpc("seed_tenant_defaults", {
        p_tenant_id: tenant.id
    });

    if (seedError) {
        throw new AppError(500, "TENANT_SEED_FAILED", "Unable to seed tenant defaults.", seedError);
    }

    const { error: phase1SeedError } = await adminSupabase.rpc("seed_phase1_defaults", {
        p_tenant_id: tenant.id
    });

    if (phase1SeedError) {
        throw new AppError(500, "TENANT_PHASE1_SEED_FAILED", "Unable to seed tenant product defaults.", phase1SeedError);
    }

    const { error: phase2SeedError } = await adminSupabase.rpc("seed_phase2_defaults", {
        p_tenant_id: tenant.id
    });

    if (phase2SeedError) {
        throw new AppError(500, "TENANT_PHASE2_SEED_FAILED", "Unable to seed tenant cash-control defaults.", phase2SeedError);
    }

    const { error: phase3SeedError } = await adminSupabase.rpc("seed_phase3_defaults", {
        p_tenant_id: tenant.id
    });

    if (phase3SeedError) {
        throw new AppError(500, "TENANT_PHASE3_SEED_FAILED", "Unable to seed tenant loan workflow defaults.", phase3SeedError);
    }

    const { error: branchError } = await adminSupabase
        .from("branches")
        .insert({
            tenant_id: tenant.id,
            name: "Head Office",
            code: "HQ",
            address_line1: `${tenant.name} Head Office`,
            address_line2: null,
            city: "Dar es Salaam",
            state: "Dar es Salaam",
            country: "Tanzania"
        });

    if (branchError) {
        throw new AppError(500, "TENANT_DEFAULT_BRANCH_CREATE_FAILED", "Unable to create default tenant branch.", branchError);
    }

    await logAudit({
        tenantId: tenant.id,
        userId: actor.user.id,
        table: "tenants",
        action: "create_tenant",
        afterData: tenant
    });

    return withTenantSubscription(tenant, await getSubscriptionStatus(tenant.id));
}

async function getTenant(actor, tenantId) {
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .is("deleted_at", null)
        .single();

    if (error) {
        throw new AppError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    return withTenantSubscription(data, await getSubscriptionStatus(tenantId));
}

async function updateTenant(actor, tenantId, payload) {
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: before, error: beforeError } = await adminSupabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .single();

    if (beforeError || !before) {
        throw new AppError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    const { data: updated, error } = await adminSupabase
        .from("tenants")
        .update(payload)
        .eq("id", tenantId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "TENANT_UPDATE_FAILED", "Unable to update tenant.", error);
    }

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "tenants",
        action: "update_tenant",
        beforeData: before,
        afterData: updated
    });

    return withTenantSubscription(updated, await getSubscriptionStatus(tenantId));
}

module.exports = {
    listTenants,
    createTenant,
    getTenant,
    updateTenant
};
