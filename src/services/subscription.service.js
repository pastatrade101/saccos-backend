const env = require("../config/env");

const DEFAULT_FEATURES = {
    loans_enabled: true,
    dividends_enabled: true,
    contributions_enabled: true,
    advanced_reports: true,
    maker_checker_enabled: true,
    sms_trigger_controls_enabled: true,
    multi_approval_enabled: true,
    max_branches: Number.MAX_SAFE_INTEGER,
    max_users: Number.MAX_SAFE_INTEGER,
    max_members: Number.MAX_SAFE_INTEGER
};

const DEFAULT_LIMITS = {
    branches: Number.MAX_SAFE_INTEGER,
    staffUsers: Number.MAX_SAFE_INTEGER,
    members: Number.MAX_SAFE_INTEGER,
    exportsPerDay: Number.MAX_SAFE_INTEGER
};

const FEATURE_LIMIT_MAP = {
    branches: "max_branches",
    staffUsers: "max_users",
    members: "max_members"
};

function buildSubscription(tenantId = null) {
    return {
        id: "single-tenant",
        tenant_id: tenantId || env.singleTenantId || null,
        plan: "enterprise",
        plan_name: "Enterprise",
        status: "active",
        start_at: null,
        expires_at: null,
        grace_period_until: null,
        created_at: new Date().toISOString(),
        features: { ...DEFAULT_FEATURES },
        limits: { ...DEFAULT_LIMITS },
        isUsable: true
    };
}

async function getSubscriptionStatus(tenantId = null) {
    return buildSubscription(tenantId);
}

async function getSubscriptionStatusesForTenants(tenantIds = []) {
    const unique = Array.from(new Set((tenantIds || []).filter(Boolean)));
    const result = {};
    for (const tenantId of unique) {
        result[tenantId] = buildSubscription(tenantId);
    }
    return result;
}

async function assignTenantSubscription({ tenantId = null }) {
    return buildSubscription(tenantId);
}

function clearSubscriptionStatusCache() {
    // no caches in single-tenant mode
}

async function assertPlanLimit(tenantId) {
    return buildSubscription(tenantId);
}

module.exports = {
    FEATURE_LIMIT_MAP,
    assignTenantSubscription,
    getSubscriptionStatus,
    getSubscriptionStatusesForTenants,
    clearSubscriptionStatusCache,
    assertPlanLimit
};
