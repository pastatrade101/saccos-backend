const { adminSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const {
    assignTenantSubscription,
    getSubscriptionStatus,
    getSubscriptionStatusesForTenants
} = require("../../services/subscription.service");

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const MISSING_SUBSCRIPTION = {
    isUsable: false,
    status: "missing",
    plan: null,
    features: {},
    limits: null
};

async function listPlans() {
    const { data, error } = await adminSupabase
        .from("plans")
        .select("*, plan_features(*)")
        .order("created_at", { ascending: true })
        .limit(200);

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

async function listPlatformTenants(query = {}) {
    const page = Number(query.page || 1);
    const limit = Math.min(Number(query.limit || 50), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const statusFilter = typeof query.status === "string" ? query.status.trim() : "";
    const rawSearch = typeof query.search === "string" ? query.search.trim() : "";
    const search = rawSearch.replace(/[^a-zA-Z0-9._\s-]/g, "").trim();

    let tenantsQuery = adminSupabase
        .from("tenants")
        .select("*", { count: "exact" })
        .is("deleted_at", null);

    if (statusFilter) {
        tenantsQuery = tenantsQuery.eq("status", statusFilter);
    }

    if (search) {
        tenantsQuery = tenantsQuery.or(`name.ilike.%${search}%,registration_number.ilike.%${search}%`);
    }

    const { data: tenants, error, count } = await tenantsQuery
        .order("created_at", { ascending: false })
        .range(from, to);

    if (error) {
        throw new AppError(500, "PLATFORM_TENANTS_LIST_FAILED", "Unable to load platform tenants.", error);
    }

    const tenantIds = (tenants || []).map((tenant) => tenant.id);

    const { data: branches, error: branchError } = await adminSupabase
        .from("branches")
        .select("tenant_id")
        .is("deleted_at", null)
        .in("tenant_id", tenantIds.length ? tenantIds : [EMPTY_UUID]);

    if (branchError) {
        throw new AppError(500, "PLATFORM_BRANCHES_LIST_FAILED", "Unable to load platform branch counts.", branchError);
    }

    const branchCounts = (branches || []).reduce((accumulator, branch) => {
        accumulator[branch.tenant_id] = (accumulator[branch.tenant_id] || 0) + 1;
        return accumulator;
    }, {});

    const subscriptionsByTenant = await getSubscriptionStatusesForTenants(tenantIds);

    const enriched = (tenants || []).map((tenant) => ({
        ...tenant,
        branch_count: branchCounts[tenant.id] || 0,
        subscription: subscriptionsByTenant[tenant.id] || MISSING_SUBSCRIPTION
    }));

    return {
        data: enriched,
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
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

async function listByTenant(table, select, tenantIds) {
    if (!tenantIds.length) {
        return [];
    }

    const { data, error } = await adminSupabase
        .from(table)
        .select(select)
        .in("tenant_id", tenantIds);

    if (error) {
        throw new AppError(500, "TENANT_DELETE_SCOPE_FAILED", `Unable to load ${table}.`, error);
    }

    return data || [];
}

async function deleteIn(table, column, values) {
    if (!values.length) {
        return;
    }

    const { error } = await adminSupabase
        .from(table)
        .delete()
        .in(column, values);

    if (error) {
        throw new AppError(500, "TENANT_DELETE_FAILED", `Unable to delete from ${table}.`, error);
    }
}

async function deleteByTenant(table, tenantIds) {
    if (!tenantIds.length) {
        return;
    }

    const { error } = await adminSupabase
        .from(table)
        .delete()
        .in("tenant_id", tenantIds);

    if (error) {
        throw new AppError(500, "TENANT_DELETE_FAILED", `Unable to delete from ${table}.`, error);
    }
}

async function updateByTenant(table, tenantIds, patch) {
    if (!tenantIds.length) {
        return;
    }

    const { error } = await adminSupabase
        .from(table)
        .update(patch)
        .in("tenant_id", tenantIds);

    if (error) {
        throw new AppError(500, "TENANT_DELETE_FAILED", `Unable to prepare ${table} for deletion.`, error);
    }
}

async function removeStorageTree(bucketName, prefix) {
    if (!bucketName) {
        return;
    }

    const queue = [prefix];
    const files = [];

    while (queue.length) {
        const currentPrefix = queue.shift();
        const { data, error } = await adminSupabase.storage.from(bucketName).list(currentPrefix, {
            limit: 1000,
            offset: 0
        });

        if (error) {
            continue;
        }

        for (const item of data || []) {
            if (!item.name) {
                continue;
            }

            const nextPath = `${currentPrefix}/${item.name}`;

            if (item.id) {
                files.push(nextPath);
            } else {
                queue.push(nextPath);
            }
        }
    }

    if (!files.length) {
        return;
    }

    const chunkSize = 100;

    for (let index = 0; index < files.length; index += chunkSize) {
        const batch = files.slice(index, index + chunkSize);
        const { error } = await adminSupabase.storage.from(bucketName).remove(batch);
        if (error) {
            throw new AppError(500, "TENANT_STORAGE_DELETE_FAILED", `Unable to delete files from ${bucketName}.`, error);
        }
    }
}

async function loadTenantDeletionScope(tenantId) {
    const tenantIds = [tenantId];
    const profiles = await listByTenant("user_profiles", "user_id, tenant_id, role, member_id", tenantIds);
    const userIds = Array.from(new Set(profiles.map((row) => row.user_id).filter(Boolean)));

    const members = await listByTenant("members", "id, user_id", tenantIds);
    const memberIds = Array.from(new Set(members.map((row) => row.id).filter(Boolean)));
    const memberUserIds = Array.from(
        new Set([
            ...profiles.filter((row) => row.role === "member").map((row) => row.user_id).filter(Boolean),
            ...members.map((row) => row.user_id).filter(Boolean)
        ])
    );

    const memberAccounts = await listByTenant("member_accounts", "id", tenantIds);
    const loans = await listByTenant("loans", "id", tenantIds);
    const loanAccounts = await listByTenant("loan_accounts", "id", tenantIds);
    const journalEntries = await listByTenant("journal_entries", "id", tenantIds);

    return {
        tenantIds,
        userIds,
        memberUserIds,
        memberIds,
        memberAccountIds: memberAccounts.map((row) => row.id),
        loanIds: loans.map((row) => row.id),
        loanAccountIds: loanAccounts.map((row) => row.id),
        journalIds: journalEntries.map((row) => row.id)
    };
}

async function deleteAuthUsers(userIds) {
    for (const userId of userIds) {
        const { data, error } = await adminSupabase.auth.admin.getUserById(userId);

        if (error) {
            throw new AppError(500, "TENANT_AUTH_USER_LOOKUP_FAILED", `Unable to inspect auth user ${userId}.`, error);
        }

        const platformRole = data.user?.app_metadata?.platform_role;

        if (platformRole === "internal_ops") {
            continue;
        }

        const { error: deleteError } = await adminSupabase.auth.admin.deleteUser(userId);

        if (deleteError) {
            throw new AppError(500, "TENANT_AUTH_USER_DELETE_FAILED", `Unable to delete auth user ${userId}.`, deleteError);
        }
    }
}

async function deleteTenant(actor, tenantId, payload) {
    const { data: tenant, error: tenantError } = await adminSupabase
        .from("tenants")
        .select("id, name, registration_number")
        .eq("id", tenantId)
        .is("deleted_at", null)
        .maybeSingle();

    if (tenantError || !tenant) {
        throw new AppError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    if (payload.confirm_name.trim() !== tenant.name) {
        throw new AppError(400, "TENANT_DELETE_CONFIRMATION_MISMATCH", "Confirmation name does not match the tenant.");
    }

    const scope = await loadTenantDeletionScope(tenantId);

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "tenants",
        action: "delete_tenant_started",
        entityType: "tenant",
        entityId: tenantId,
        beforeData: {
            tenant,
            scope: {
                users: scope.userIds.length,
                members: scope.memberIds.length,
                loans: scope.loanIds.length,
                journals: scope.journalIds.length
            }
        }
    });

    await removeStorageTree(env.receiptsBucket, `tenant/${tenantId}`);
    await removeStorageTree(env.importsBucket, `tenant/${tenantId}`);

    // Break cyclic references before delete order starts.
    await updateByTenant("members", scope.tenantIds, { approved_application_id: null });
    await updateByTenant("member_applications", scope.tenantIds, { approved_member_id: null });
    await updateByTenant("membership_status_history", scope.tenantIds, { application_id: null });
    await updateByTenant("loans", scope.tenantIds, { application_id: null });

    await deleteIn("credential_handoffs", "member_id", scope.memberIds);
    await deleteIn("credential_handoffs", "user_id", scope.userIds);
    await deleteByTenant("transaction_receipts", scope.tenantIds);
    await deleteByTenant("teller_session_transactions", scope.tenantIds);
    await deleteByTenant("teller_sessions", scope.tenantIds);
    await deleteByTenant("receipt_policies", scope.tenantIds);
    await deleteByTenant("cash_control_settings", scope.tenantIds);
    await deleteByTenant("api_idempotency_requests", scope.tenantIds);
    await deleteByTenant("report_export_jobs", scope.tenantIds);
    await deleteByTenant("import_jobs", scope.tenantIds);
    await deleteByTenant("member_application_attachments", scope.tenantIds);
    await deleteByTenant("membership_status_history", scope.tenantIds);
    await deleteByTenant("member_applications", scope.tenantIds);
    await deleteByTenant("loan_approvals", scope.tenantIds);
    await deleteByTenant("loan_guarantors", scope.tenantIds);
    await deleteByTenant("collateral_items", scope.tenantIds);
    await deleteByTenant("loan_applications", scope.tenantIds);
    await deleteByTenant("dividend_payments", scope.tenantIds);
    await deleteByTenant("dividend_approvals", scope.tenantIds);
    await deleteByTenant("dividend_allocations", scope.tenantIds);
    await deleteByTenant("dividend_member_snapshots", scope.tenantIds);
    await deleteByTenant("dividend_components", scope.tenantIds);
    await deleteByTenant("dividend_cycles", scope.tenantIds);
    await deleteByTenant("journal_lines", scope.tenantIds);
    await deleteByTenant("loan_account_transactions", scope.tenantIds);
    await deleteByTenant("member_account_transactions", scope.tenantIds);
    await deleteIn("journal_entries", "id", scope.journalIds);
    await deleteByTenant("loan_accounts", scope.tenantIds);
    await deleteByTenant("loan_schedules", scope.tenantIds);
    await deleteByTenant("loans", scope.tenantIds);
    await deleteByTenant("member_accounts", scope.tenantIds);
    await deleteByTenant("period_closures", scope.tenantIds);
    await deleteByTenant("daily_account_snapshots", scope.tenantIds);
    await deleteByTenant("audit_logs", scope.tenantIds);
    await deleteByTenant("account_balances", scope.tenantIds);
    await deleteByTenant("posting_rules", scope.tenantIds);
    await deleteByTenant("fee_rules", scope.tenantIds);
    await deleteByTenant("penalty_rules", scope.tenantIds);
    await deleteByTenant("loan_policy_settings", scope.tenantIds);
    await deleteByTenant("loan_products", scope.tenantIds);
    await deleteByTenant("share_products", scope.tenantIds);
    await deleteByTenant("savings_products", scope.tenantIds);
    await deleteByTenant("branch_staff_assignments", scope.tenantIds);
    await deleteByTenant("user_profiles", scope.tenantIds);
    await deleteByTenant("members", scope.tenantIds);
    await deleteByTenant("branches", scope.tenantIds);
    await deleteByTenant("tenant_settings", scope.tenantIds);
    await deleteByTenant("chart_of_accounts", scope.tenantIds);
    await deleteByTenant("tenant_subscriptions", scope.tenantIds);
    await deleteByTenant("subscriptions", scope.tenantIds);
    await deleteIn("tenants", "id", scope.tenantIds);
    await deleteAuthUsers(scope.userIds);

    return {
        deleted: true,
        tenant_id: tenantId,
        tenant_name: tenant.name
    };
}

module.exports = {
    listPlans,
    updatePlanFeatures,
    listPlatformTenants,
    assignSubscription,
    deleteTenant
};
