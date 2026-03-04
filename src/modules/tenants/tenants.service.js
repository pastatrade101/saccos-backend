const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const { assignTenantSubscription } = require("../../services/subscription.service");
const { assertTenantAccess } = require("../../services/user-context.service");

async function listTenants(actor) {
    if (actor.isInternalOps) {
        const { data, error } = await adminSupabase
            .from("tenants")
            .select("*, subscriptions(*)")
            .is("deleted_at", null)
            .order("created_at", { ascending: false });

        if (error) {
            throw new AppError(500, "TENANTS_LIST_FAILED", "Unable to load tenants.", error);
        }

        return data || [];
    }

    if (!actor.tenantId) {
        throw new AppError(403, "TENANT_ACCESS_DENIED", "Tenant context is missing.");
    }

    const { data, error } = await adminSupabase
        .from("tenants")
        .select("*, subscriptions(*)")
        .eq("id", actor.tenantId)
        .is("deleted_at", null)
        .single();

    if (error) {
        throw new AppError(500, "TENANT_FETCH_FAILED", "Unable to load tenant.", error);
    }

    return [data];
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

    return tenant;
}

async function getTenant(actor, tenantId) {
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from("tenants")
        .select("*, subscriptions(*)")
        .eq("id", tenantId)
        .is("deleted_at", null)
        .single();

    if (error) {
        throw new AppError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    return data;
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

    return updated;
}

module.exports = {
    listTenants,
    createTenant,
    getTenant,
    updateTenant
};
