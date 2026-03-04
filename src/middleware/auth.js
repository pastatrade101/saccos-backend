const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { getBranchAssignments, getUserProfile } = require("../services/user-context.service");

module.exports = asyncHandler(async (req, res, next) => {
    const authorization = req.headers.authorization || "";
    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
        throw new AppError(401, "AUTH_TOKEN_MISSING", "Authorization token is required.");
    }

    const { data, error } = await adminSupabase.auth.getUser(token);

    if (error || !data?.user) {
        throw new AppError(401, "AUTH_TOKEN_INVALID", "Authorization token is invalid.");
    }

    const authUser = data.user;
    const profile = await getUserProfile(authUser.id);
    const branchIds = profile ? await getBranchAssignments(authUser.id) : [];
    const isInternalOps =
        authUser.app_metadata?.platform_role === "internal_ops" ||
        authUser.app_metadata?.platform_role === "platform_admin" ||
        profile?.role === "platform_admin";

    if (!profile && !isInternalOps) {
        throw new AppError(403, "PROFILE_NOT_FOUND", "User profile is not provisioned.");
    }

    if (profile && !profile.is_active) {
        throw new AppError(403, "PROFILE_INACTIVE", "User profile is inactive.");
    }

    req.auth = {
        token,
        user: authUser,
        profile,
        branchIds,
        isInternalOps,
        tenantId: profile?.tenant_id || null,
        role: profile?.role || null
    };

    next();
});
