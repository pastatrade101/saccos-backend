const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { getBranchAssignments, getUserProfile } = require("../services/user-context.service");
const { verifySupabaseAccessToken } = require("../services/token-verifier.service");

function clearAuthContext(req) {
    req.auth = null;
}

function createAuthMiddleware(options = {}) {
    const { optional = false } = options;

    return asyncHandler(async (req, res, next) => {
        const authorization = req.headers.authorization || "";
        const [scheme, token] = authorization.split(" ");

        if (scheme !== "Bearer" || !token) {
            if (optional) {
                clearAuthContext(req);
                return next();
            }

            throw new AppError(401, "AUTH_TOKEN_MISSING", "Authorization token is required.");
        }

        let authUser;
        try {
            authUser = await verifySupabaseAccessToken(token);
        } catch (error) {
            if (!(error instanceof AppError)) {
                // Fallback keeps auth available when JWKS is temporarily unreachable.
                const { data, error: getUserError } = await adminSupabase.auth.getUser(token);
                if (!getUserError && data?.user) {
                    authUser = data.user;
                }
            }

            if (!authUser) {
                if (optional) {
                    clearAuthContext(req);
                    return next();
                }

                if (error instanceof AppError) {
                    throw error;
                }

                throw new AppError(401, "AUTH_TOKEN_INVALID", "Authorization token is invalid.");
            }
        }

        const [profile, branchIds] = await Promise.all([
            getUserProfile(authUser.id),
            getBranchAssignments(authUser.id)
        ]);
        const isInternalOpsByMetadata =
            authUser.app_metadata?.platform_role === "internal_ops" ||
            authUser.app_metadata?.platform_role === "platform_admin" ||
            authUser.app_metadata?.platform_role === "platform_owner";
        const isInternalOps =
            isInternalOpsByMetadata
            || profile?.role === "platform_admin"
            || profile?.role === "platform_owner";

        if (!profile && !isInternalOps) {
            if (optional) {
                clearAuthContext(req);
                return next();
            }

            throw new AppError(403, "PROFILE_NOT_FOUND", "User profile is not provisioned.");
        }

        if (profile && !profile.is_active) {
            if (optional) {
                clearAuthContext(req);
                return next();
            }

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
}

const auth = createAuthMiddleware();

auth.optional = createAuthMiddleware({ optional: true });

module.exports = auth;
