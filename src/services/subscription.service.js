const { adminSupabase } = require("../config/supabase");
const { PLAN_FEATURES, PLAN_LIMITS } = require("../constants/plans");
const env = require("../config/env");
const AppError = require("../utils/app-error");

const FEATURE_LIMIT_MAP = {
    branches: "max_branches",
    staffUsers: "max_users",
    members: "max_members"
};

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
        return {
            isUsable: false,
            status: "missing",
            plan: null,
            features: {},
            limits: null
        };
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

async function getSubscriptionStatus(tenantId) {
    const subscription = await getLatestTenantSubscription(tenantId);

    if (!subscription) {
        const legacy = await getLegacySubscription(tenantId);

        if (!legacy) {
            return {
                isUsable: false,
                status: "missing",
                plan: null,
                features: {},
                limits: null
            };
        }

        const entitlements = buildEntitlements(legacy.plan, []);
        return buildSubscriptionResponse(legacy, entitlements);
    }

    const entitlements = await getFeaturesByPlanId(subscription.plan_id).then((features) =>
        buildEntitlements(subscription.plans?.code, features)
    );

    return buildSubscriptionResponse(
        {
            id: subscription.id,
            tenant_id: subscription.tenant_id,
            plan_id: subscription.plan_id,
            plan: subscription.plans?.code || "starter",
            plan_name: subscription.plans?.name || null,
            status: subscription.status,
            start_at: subscription.start_at,
            expires_at: subscription.expires_at,
            created_at: subscription.created_at
        },
        entitlements
    );
}

async function assertPlanLimit(tenantId, resource, tableName) {
    const subscription = await getSubscriptionStatus(tenantId);

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
    assertPlanLimit
};
