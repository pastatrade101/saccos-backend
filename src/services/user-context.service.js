const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");
const USER_CONTEXT_CACHE_TTL_MS = Math.max(0, Number(process.env.USER_CONTEXT_CACHE_TTL_MS || 15000));
const userProfileCache = new Map();
const branchAssignmentsCache = new Map();
const userProfileInFlight = new Map();
const branchAssignmentsInFlight = new Map();

function getCached(cache, key) {
    if (!USER_CONTEXT_CACHE_TTL_MS) {
        return null;
    }

    const cached = cache.get(key);
    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }

    return cached.value;
}

function setCached(cache, key, value) {
    if (!USER_CONTEXT_CACHE_TTL_MS) {
        return;
    }

    cache.set(key, {
        value,
        expiresAt: Date.now() + USER_CONTEXT_CACHE_TTL_MS
    });
}

function loadOnce(inFlightMap, key, loader) {
    const existing = inFlightMap.get(key);
    if (existing) {
        return existing;
    }

    const task = (async () => {
        try {
            return await loader();
        } finally {
            inFlightMap.delete(key);
        }
    })();

    inFlightMap.set(key, task);
    return task;
}

function invalidateUserContextCache(userId) {
    if (userId) {
        userProfileCache.delete(userId);
        branchAssignmentsCache.delete(userId);
        userProfileInFlight.delete(userId);
        branchAssignmentsInFlight.delete(userId);
        return;
    }

    userProfileCache.clear();
    branchAssignmentsCache.clear();
    userProfileInFlight.clear();
    branchAssignmentsInFlight.clear();
}

async function getUserProfile(userId) {
    const cached = getCached(userProfileCache, userId);
    if (cached !== null) {
        return cached;
    }

    return loadOnce(userProfileInFlight, userId, async () => {
        const { data, error } = await adminSupabase
            .from("user_profiles")
            .select("*")
            .eq("user_id", userId)
            .is("deleted_at", null)
            .maybeSingle();

        if (error) {
            throw new AppError(500, "USER_PROFILE_LOOKUP_FAILED", "Unable to load user profile.");
        }

        setCached(userProfileCache, userId, data || null);
        return data || null;
    });
}

async function getBranchAssignments(userId) {
    const cached = getCached(branchAssignmentsCache, userId);
    if (cached !== null) {
        return cached;
    }

    return loadOnce(branchAssignmentsInFlight, userId, async () => {
        const { data, error } = await adminSupabase
            .from("branch_staff_assignments")
            .select("branch_id")
            .eq("user_id", userId)
            .is("deleted_at", null);

        if (error) {
            throw new AppError(500, "BRANCH_ASSIGNMENTS_LOOKUP_FAILED", "Unable to load branch assignments.");
        }

        const branchIds = (data || []).map((row) => row.branch_id);
        setCached(branchAssignmentsCache, userId, branchIds);
        return branchIds;
    });
}

function assertTenantAccess(req, tenantId) {
    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant identifier is required.");
    }

    if (req.auth.isInternalOps) {
        return tenantId;
    }

    if (!req.auth.tenantId || req.auth.tenantId !== tenantId) {
        throw new AppError(403, "TENANT_ACCESS_DENIED", "You cannot access another tenant.");
    }

    return tenantId;
}

function assertBranchAccess(req, branchId) {
    if (!branchId || req.auth.isInternalOps || req.auth.role === "super_admin" || req.auth.role === "auditor") {
        return;
    }

    if (!req.auth.branchIds.includes(branchId)) {
        throw new AppError(403, "BRANCH_ACCESS_DENIED", "You cannot access this branch.");
    }
}

module.exports = {
    getUserProfile,
    getBranchAssignments,
    invalidateUserContextCache,
    assertTenantAccess,
    assertBranchAccess
};
