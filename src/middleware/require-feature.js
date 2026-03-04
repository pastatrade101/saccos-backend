const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { getEffectiveTenantId } = require("../utils/request");
const { getSubscriptionStatus } = require("../services/subscription.service");

module.exports = (featureKey, options = {}) =>
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

        if (!subscription.features?.[featureKey]) {
            throw new AppError(403, "FEATURE_DISABLED", `Feature '${featureKey}' is not enabled for this plan.`, {
                feature: featureKey,
                plan: subscription.plan
            });
        }

        next();
    });
