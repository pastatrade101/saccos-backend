const { adminSupabase } = require("../config/supabase");
const { PLAN_FEATURES, PLAN_LIMITS } = require("../constants/plans");
const env = require("../config/env");
const AppError = require("../utils/app-error");

const FEATURE_LIMIT_MAP = {
    branches: "max_branches",
    staffUsers: "max_users",
    members: "max_members"
};
const SUBSCRIPTION_CACHE_TTL_MS = Math.max(0, Number(process.env.SUBSCRIPTION_CACHE_TTL_MS || 15000));
const subscriptionStatusCache = new Map();
const subscriptionStatusInFlight = new Map();

function isMissingRpcError(error) {
    const code = String(error?.code || "");
    return code === "PGRST202" || code === "42883";
}

function getCachedSubscriptionStatus(tenantId) {
    if (!SUBSCRIPTION_CACHE_TTL_MS) {
        return null;
    }

    const cached = subscriptionStatusCache.get(tenantId);
    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        subscriptionStatusCache.delete(tenantId);
        return null;
    }

    return cached.value;
}

function setCachedSubscriptionStatus(tenantId, value) {
    if (!SUBSCRIPTION_CACHE_TTL_MS) {
        return;
    }

    subscriptionStatusCache.set(tenantId, {
        value,
        expiresAt: Date.now() + SUBSCRIPTION_CACHE_TTL_MS
    });
}

function clearSubscriptionStatusCache(tenantId) {
    if (tenantId) {
        subscriptionStatusCache.delete(tenantId);
        subscriptionStatusInFlight.delete(tenantId);
        return;
    }

    subscriptionStatusCache.clear();
    subscriptionStatusInFlight.clear();
}

function loadSubscriptionStatusOnce(tenantId, loader) {
    const existing = subscriptionStatusInFlight.get(tenantId);
    if (existing) {
        return existing;
    }

    const task = (async () => {
        try {
            return await loader();
        } finally {
            subscriptionStatusInFlight.delete(tenantId);
        }
    })();

    subscriptionStatusInFlight.set(tenantId, task);
    return task;
}

function parseFeatureValue(feature) {
    if (feature.feature_type === "bool") {
        return Boolean(feature.bool_value);
    }

    if (feature.feature_type === "int") {
        return Number(feature.int_value || 0);
    }

    return feature.string_value;
}

function getFallbackPlanCode(planCode) {
    if (planCode && PLAN_FEATURES[planCode]) {
        return planCode;
    }

    return "starter";
}

function buildEntitlements(planCode, features = []) {
    const safePlanCode = getFallbackPlanCode(planCode);
    const baseEntitlements = { ...PLAN_FEATURES[safePlanCode] };

    for (const feature of features) {
        baseEntitlements[feature.feature_key] = parseFeatureValue(feature);
    }

    return baseEntitlements;
}

function buildLimits(planCode, entitlements) {
    const safePlanCode = getFallbackPlanCode(planCode);
    const baseLimits = PLAN_LIMITS[safePlanCode] || PLAN_LIMITS.enterprise;

    return {
        ...baseLimits,
        branches: Number(entitlements.max_branches ?? baseLimits.branches),
        staffUsers: Number(entitlements.max_users ?? baseLimits.staffUsers),
        members: Number(entitlements.max_members ?? baseLimits.members)
    };
}

function toGracePeriod(expiresAt, explicitGracePeriod) {
    if (explicitGracePeriod) {
        return new Date(explicitGracePeriod);
    }

    if (!expiresAt) {
        return null;
    }

    return new Date(expiresAt.getTime() + env.defaultGraceDays * 24 * 60 * 60 * 1000);
}

function buildSubscriptionResponse(subscriptionRow, entitlements) {
    if (!subscriptionRow) {
        return buildMissingSubscriptionResponse();
    }

    const expiresAt = subscriptionRow.expires_at ? new Date(subscriptionRow.expires_at) : null;
    const gracePeriodUntil = toGracePeriod(
        expiresAt,
        subscriptionRow.grace_period_until
    );
    const now = new Date();
    const activeAndNotExpired =
        subscriptionRow.status === "active" && (!expiresAt || expiresAt >= now);
    const usablePastDue =
        subscriptionRow.status === "past_due" && gracePeriodUntil && gracePeriodUntil >= now;

    return {
        ...subscriptionRow,
        isUsable: activeAndNotExpired || usablePastDue,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        grace_period_until: gracePeriodUntil ? gracePeriodUntil.toISOString() : null,
        features: entitlements,
        limits: buildLimits(subscriptionRow.plan, entitlements)
    };
}

function buildMissingSubscriptionResponse() {
    return {
        isUsable: false,
        status: "missing",
        plan: null,
        features: {},
        limits: null
    };
}

function normalizeTenantSubscriptionRow(subscription) {
    if (!subscription) {
        return null;
    }

    return {
        id: subscription.id,
        tenant_id: subscription.tenant_id,
        plan_id: subscription.plan_id,
        plan: subscription.plans?.code || "starter",
        plan_name: subscription.plans?.name || null,
        status: subscription.status,
        start_at: subscription.start_at,
        expires_at: subscription.expires_at,
        created_at: subscription.created_at
    };
}

async function getLatestTenantSubscription(tenantId) {
    const { data, error } = await adminSupabase
        .from("tenant_subscriptions")
        .select("id, tenant_id, plan_id, status, start_at, expires_at, created_at, plans(id, code, name, description)")
        .eq("tenant_id", tenantId)
        .order("start_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "SUBSCRIPTION_LOOKUP_FAILED", "Unable to load tenant subscription.", error);
    }

    return data || null;
}

async function getPlanByCode(planCode) {
    const { data, error } = await adminSupabase
        .from("plans")
        .select("id, code, name, description")
        .eq("code", planCode)
        .eq("is_active", true)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "PLAN_LOOKUP_FAILED", "Unable to load plan.", error);
    }

    return data || null;
}

async function getLegacySubscription(tenantId) {
    const { data, error } = await adminSupabase
        .from("subscriptions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("start_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "SUBSCRIPTION_LOOKUP_FAILED", "Unable to load tenant subscription.", error);
    }

    return data || null;
}

async function getFeaturesByPlanId(planId) {
    const { data, error } = await adminSupabase
        .from("plan_features")
        .select("feature_key, feature_type, bool_value, int_value, string_value")
        .eq("plan_id", planId);

    if (error) {
        throw new AppError(500, "PLAN_FEATURES_LOOKUP_FAILED", "Unable to load plan features.", error);
    }

    return data || [];
}

async function getFeaturesByPlanIds(planIds) {
    if (!planIds.length) {
        return {};
    }

    const { data, error } = await adminSupabase
        .from("plan_features")
        .select("plan_id, feature_key, feature_type, bool_value, int_value, string_value")
        .in("plan_id", planIds);

    if (error) {
        throw new AppError(500, "PLAN_FEATURES_LOOKUP_FAILED", "Unable to load plan features.", error);
    }

    return (data || []).reduce((accumulator, feature) => {
        if (!accumulator[feature.plan_id]) {
            accumulator[feature.plan_id] = [];
        }
        accumulator[feature.plan_id].push(feature);
        return accumulator;
    }, {});
}

async function getLatestTenantSubscriptionsByTenantIds(tenantIds) {
    if (!tenantIds.length) {
        return {};
    }

    const { data: rpcRows, error: rpcError } = await adminSupabase.rpc("latest_tenant_subscriptions", {
        p_tenant_ids: tenantIds
    });

    if (!rpcError) {
        const latestByTenant = {};
        for (const row of rpcRows || []) {
            latestByTenant[row.tenant_id] = {
                id: row.subscription_id,
                tenant_id: row.tenant_id,
                plan_id: row.plan_id,
                status: row.status,
                start_at: row.start_at,
                expires_at: row.expires_at,
                created_at: row.created_at,
                plans: {
                    code: row.plan_code || "starter",
                    name: row.plan_name || null,
                    description: row.plan_description || null
                }
            };
        }
        return latestByTenant;
    }

    if (!isMissingRpcError(rpcError)) {
        throw new AppError(500, "SUBSCRIPTION_LOOKUP_FAILED", "Unable to load tenant subscriptions.", rpcError);
    }

    // Backward compatibility path before migration is applied.
    const { data, error } = await adminSupabase
        .from("tenant_subscriptions")
        .select("id, tenant_id, plan_id, status, start_at, expires_at, created_at, plans(id, code, name, description)")
        .in("tenant_id", tenantIds)
        .order("start_at", { ascending: false });

    if (error) {
        throw new AppError(500, "SUBSCRIPTION_LOOKUP_FAILED", "Unable to load tenant subscriptions.", error);
    }

    const latestByTenant = {};
    for (const row of data || []) {
        if (!latestByTenant[row.tenant_id]) {
            latestByTenant[row.tenant_id] = row;
        }
    }

    return latestByTenant;
}

async function getLegacySubscriptionsByTenantIds(tenantIds) {
    if (!tenantIds.length) {
        return {};
    }

    const { data, error } = await adminSupabase
        .from("subscriptions")
        .select("*")
        .in("tenant_id", tenantIds)
        .order("start_at", { ascending: false });

    if (error) {
        throw new AppError(500, "SUBSCRIPTION_LOOKUP_FAILED", "Unable to load tenant subscriptions.", error);
    }

    const latestByTenant = {};
    for (const row of data || []) {
        if (!latestByTenant[row.tenant_id]) {
            latestByTenant[row.tenant_id] = row;
        }
    }

    return latestByTenant;
}

async function getTenantEntitlements(tenantId) {
    const subscription = await getLatestTenantSubscription(tenantId);

    if (!subscription) {
        const legacy = await getLegacySubscription(tenantId);

        if (!legacy) {
            return {};
        }

        return buildEntitlements(legacy.plan, []);
    }

    const features = await getFeaturesByPlanId(subscription.plan_id);
    return buildEntitlements(subscription.plans?.code, features);
}

async function resolveSubscriptionStatus(tenantId) {
    const statusMap = await resolveSubscriptionStatuses([tenantId]);
    const status = statusMap[tenantId] || buildMissingSubscriptionResponse();
    setCachedSubscriptionStatus(tenantId, status);
    return status;
}

async function resolveSubscriptionStatuses(tenantIds = []) {
    const uniqueTenantIds = Array.from(new Set((tenantIds || []).filter(Boolean)));
    if (!uniqueTenantIds.length) {
        return {};
    }

    const latestSubscriptionsByTenant = await getLatestTenantSubscriptionsByTenantIds(uniqueTenantIds);
    const latestSubscriptions = Object.values(latestSubscriptionsByTenant);
    const planIds = Array.from(new Set(latestSubscriptions.map((row) => row.plan_id).filter(Boolean)));
    const featuresByPlanId = await getFeaturesByPlanIds(planIds);
    const responseByTenant = {};
    const missingTenantIds = [];

    for (const tenantId of uniqueTenantIds) {
        const subscription = latestSubscriptionsByTenant[tenantId];
        if (!subscription) {
            missingTenantIds.push(tenantId);
            continue;
        }

        const planFeatures = featuresByPlanId[subscription.plan_id] || [];
        const entitlements = buildEntitlements(subscription.plans?.code, planFeatures);
        responseByTenant[tenantId] = buildSubscriptionResponse(
            normalizeTenantSubscriptionRow(subscription),
            entitlements
        );
    }

    if (missingTenantIds.length) {
        const legacyByTenant = await getLegacySubscriptionsByTenantIds(missingTenantIds);
        for (const tenantId of missingTenantIds) {
            const legacy = legacyByTenant[tenantId];
            if (!legacy) {
                responseByTenant[tenantId] = buildMissingSubscriptionResponse();
                continue;
            }

            const entitlements = buildEntitlements(legacy.plan, []);
            responseByTenant[tenantId] = buildSubscriptionResponse(legacy, entitlements);
        }
    }

    return responseByTenant;
}

async function getSubscriptionStatusesForTenants(tenantIds = [], options = {}) {
    const uniqueTenantIds = Array.from(new Set((tenantIds || []).filter(Boolean)));
    if (!uniqueTenantIds.length) {
        return {};
    }

    const responseByTenant = {};
    const unresolvedTenantIds = [];

    for (const tenantId of uniqueTenantIds) {
        if (options.bypassCache) {
            unresolvedTenantIds.push(tenantId);
            continue;
        }

        const cached = getCachedSubscriptionStatus(tenantId);
        if (cached) {
            responseByTenant[tenantId] = cached;
            continue;
        }

        unresolvedTenantIds.push(tenantId);
    }

    if (unresolvedTenantIds.length) {
        const loaded = await resolveSubscriptionStatuses(unresolvedTenantIds);
        for (const tenantId of unresolvedTenantIds) {
            const value = loaded[tenantId] || buildMissingSubscriptionResponse();
            responseByTenant[tenantId] = value;
            setCachedSubscriptionStatus(tenantId, value);
        }
    }

    return responseByTenant;
}

async function getSubscriptionStatus(tenantId, options = {}) {
    if (!options.bypassCache) {
        const cached = getCachedSubscriptionStatus(tenantId);
        if (cached) {
            return cached;
        }

        return loadSubscriptionStatusOnce(tenantId, () => resolveSubscriptionStatus(tenantId));
    }

    return resolveSubscriptionStatus(tenantId);
}

async function assertPlanLimit(tenantId, resource, tableName) {
    const subscription = await getSubscriptionStatus(tenantId, { bypassCache: true });

    if (!subscription.isUsable) {
        throw new AppError(402, "SUBSCRIPTION_INACTIVE", "Subscription inactive. Upgrade or renew.");
    }

    const limitKey = FEATURE_LIMIT_MAP[resource] || resource;
    const limit = Number(subscription.features?.[limitKey]);

    if (!Number.isFinite(limit)) {
        return subscription;
    }

    const { count, error } = await adminSupabase
        .from(tableName)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("deleted_at", null);

    if (error) {
        throw new AppError(500, "PLAN_LIMIT_LOOKUP_FAILED", "Unable to evaluate plan limits.");
    }

    if ((count || 0) >= limit) {
        throw new AppError(403, "PLAN_LIMIT_REACHED", `Plan limit reached for ${resource}.`, {
            resource,
            limit,
            plan: subscription.plan
        });
    }

    return subscription;
}

async function assignTenantSubscription({
    tenantId,
    planCode,
    status,
    startAt,
    expiresAt
}) {
    const plan = await getPlanByCode(planCode);

    if (!plan) {
        throw new AppError(404, "PLAN_NOT_FOUND", "Selected plan was not found.");
    }

    const effectiveStartAt = startAt || new Date().toISOString();
    const effectiveExpiresAt =
        expiresAt ||
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: subscription, error: subscriptionError } = await adminSupabase
        .from("tenant_subscriptions")
        .insert({
            tenant_id: tenantId,
            plan_id: plan.id,
            status,
            start_at: effectiveStartAt,
            expires_at: effectiveExpiresAt
        })
        .select("id, tenant_id, plan_id, status, start_at, expires_at, created_at")
        .single();

    if (subscriptionError) {
        throw new AppError(500, "TENANT_SUBSCRIPTION_CREATE_FAILED", "Unable to assign tenant subscription.", subscriptionError);
    }

    const { error: legacyError } = await adminSupabase
        .from("subscriptions")
        .insert({
            tenant_id: tenantId,
            plan: plan.code,
            status: status === "suspended" ? "past_due" : status,
            start_at: effectiveStartAt,
            expires_at: effectiveExpiresAt
        });

    if (legacyError) {
        throw new AppError(
            500,
            "LEGACY_SUBSCRIPTION_SYNC_FAILED",
            "Unable to synchronize tenant subscription.",
            legacyError
        );
    }

    clearSubscriptionStatusCache(tenantId);

    return {
        ...subscription,
        plan: plan.code,
        plan_name: plan.name
    };
}

module.exports = {
    FEATURE_LIMIT_MAP,
    assignTenantSubscription,
    getTenantEntitlements,
    getSubscriptionStatus,
    getSubscriptionStatusesForTenants,
    clearSubscriptionStatusCache,
    assertPlanLimit
};
