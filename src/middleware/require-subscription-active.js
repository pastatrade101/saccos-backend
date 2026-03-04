const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { getEffectiveTenantId } = require("../utils/request");
const { getSubscriptionStatus } = require("../services/subscription.service");

module.exports = (options = {}) =>
    asyncHandler(async (req, res, next) => {
        const tenantId = getEffectiveTenantId(req, options);

        if (!tenantId) {
            throw new AppError(400, "TENANT_ID_REQUIRED", "A tenant context is required for this request.");
        }

        const subscription = await getSubscriptionStatus(tenantId);
        req.subscription = subscription;
        req.tenantId = tenantId;

        if (!subscription.isUsable) {
            throw new AppError(402, "SUBSCRIPTION_INACTIVE", "Subscription inactive. Upgrade or renew.", {
                status: subscription.status,
                expiresAt: subscription.expires_at,
                gracePeriodUntil: subscription.grace_period_until
            });
        }

        next();
    });
