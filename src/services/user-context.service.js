const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");
const { STAFF_ROLES, ROLES } = require("../constants/roles");
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

function isTwoFactorRequiredForRole(role) {
    return STAFF_ROLES.includes(role) || role === ROLES.PLATFORM_ADMIN || role === ROLES.PLATFORM_OWNER;
}

function sanitizeUserProfile(profile) {
    if (!profile) {
        return null;
    }

    const {
        two_factor_secret,
        two_factor_backup_codes,
        two_factor_failed_attempts,
        two_factor_locked_until,
        ...rest
    } = profile;

    const enabled = Boolean(profile.two_factor_enabled && profile.two_factor_verified);

    return {
        ...rest,
        two_factor_enabled: enabled,
        two_factor_verified: Boolean(profile.two_factor_verified),
        two_factor_enabled_at: profile.two_factor_enabled_at || null,
        two_factor_last_verified_at: profile.two_factor_last_verified_at || null,
        two_factor_required: isTwoFactorRequiredForRole(profile.role),
        two_factor_setup_required: isTwoFactorRequiredForRole(profile.role) && !enabled
    };
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

        const sanitized = sanitizeUserProfile(data || null);
        setCached(userProfileCache, userId, sanitized);
        return sanitized;
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
    assertBranchAccess,
    sanitizeUserProfile
};
