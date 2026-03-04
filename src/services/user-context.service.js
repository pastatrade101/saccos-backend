const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");

async function getUserProfile(userId) {
    const { data, error } = await adminSupabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "USER_PROFILE_LOOKUP_FAILED", "Unable to load user profile.");
    }

    return data;
}

async function getBranchAssignments(userId) {
    const { data, error } = await adminSupabase
        .from("branch_staff_assignments")
        .select("branch_id")
        .eq("user_id", userId)
        .is("deleted_at", null);

    if (error) {
        throw new AppError(500, "BRANCH_ASSIGNMENTS_LOOKUP_FAILED", "Unable to load branch assignments.");
    }

    return (data || []).map((row) => row.branch_id);
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
    assertTenantAccess,
    assertBranchAccess
};
