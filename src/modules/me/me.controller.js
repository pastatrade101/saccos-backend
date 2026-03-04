const asyncHandler = require("../../utils/async-handler");
const { getSubscriptionStatus } = require("../../services/subscription.service");
const { getEffectiveTenantId } = require("../../utils/request");

function applyNoStore(res) {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0",
        Vary: "Authorization"
    });
}

exports.subscription = asyncHandler(async (req, res) => {
    const tenantId = getEffectiveTenantId(req);
    const subscription = await getSubscriptionStatus(tenantId);
    applyNoStore(res);
    res.json({ data: subscription });
});
