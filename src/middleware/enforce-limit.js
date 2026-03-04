const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { adminSupabase } = require("../config/supabase");
const { getEffectiveTenantId } = require("../utils/request");
const { getSubscriptionStatus } = require("../services/subscription.service");

module.exports = (limitKey, currentValue, options = {}) =>
    asyncHandler(async (req, res, next) => {
        const tenantId = getEffectiveTenantId(req, options);

        if (!tenantId) {
            throw new AppError(400, "TENANT_ID_REQUIRED", "A tenant context is required for this request.");
        }

        const subscription = req.subscription || await getSubscriptionStatus(tenantId);
        req.subscription = subscription;
        req.tenantId = tenantId;

        if (!subscription.isUsable) {
            throw new AppError(402, "SUBSCRIPTION_INACTIVE", "Subscription inactive. Upgrade or renew.");
        }

        const limit = Number(subscription.features?.[limitKey]);

        if (!Number.isFinite(limit)) {
            return next();
        }

        let used = null;

        if (typeof currentValue === "function") {
            used = await currentValue(req);
        } else if (typeof currentValue === "number") {
            used = currentValue;
        } else if (options.tableName) {
            const { count, error } = await adminSupabase
                .from(options.tableName)
                .select("*", { count: "exact", head: true })
                .eq("tenant_id", tenantId)
                .is("deleted_at", null);

            if (error) {
                throw new AppError(500, "PLAN_LIMIT_LOOKUP_FAILED", "Unable to evaluate plan limits.", error);
            }

            used = count || 0;
        }

        if (used !== null && used >= limit) {
            throw new AppError(403, "PLAN_LIMIT_REACHED", `Plan limit reached for ${limitKey}.`, {
                feature: limitKey,
                limit,
                used,
                plan: subscription.plan
            });
        }

        next();
    });
