const asyncHandler = require("../../utils/async-handler");
const platformService = require("./platform.service");

function applyNoStore(res) {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0",
        Vary: "Authorization"
    });
}

exports.listPlans = asyncHandler(async (req, res) => {
    const data = await platformService.listPlans();
    applyNoStore(res);
    res.json({ data });
});

exports.updatePlanFeatures = asyncHandler(async (req, res) => {
    const data = await platformService.updatePlanFeatures(req.auth, req.validated.params.planId, req.validated.body);
    res.json({ data });
});

exports.listTenants = asyncHandler(async (req, res) => {
    const result = await platformService.listPlatformTenants(req.validated.query);
    applyNoStore(res);
    res.json({
        data: result.data,
        pagination: result.pagination
    });
});

exports.assignSubscription = asyncHandler(async (req, res) => {
    const data = await platformService.assignSubscription(req.auth, req.validated.params.tenantId, req.validated.body);
    res.status(201).json({ data });
});

exports.deleteTenant = asyncHandler(async (req, res) => {
    const data = await platformService.deleteTenant(req.auth, req.validated.params.tenantId, req.validated.body);
    res.json({ data });
});
