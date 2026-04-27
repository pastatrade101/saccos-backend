const asyncHandler = require("../../utils/async-handler");
const service = require("./member-portal-settings.service");

exports.getPaymentControls = asyncHandler(async (req, res) => {
    res.json({ data: await service.getMemberPortalPaymentControls(req.auth, req.validated.query) });
});

exports.updatePaymentControls = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateMemberPortalPaymentControls(req.auth, req.validated.body) });
});
