const asyncHandler = require("../../utils/async-handler");
const tenantService = require("./tenants.service");

function applyNoStore(res) {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0",
        Vary: "Authorization"
    });
}

exports.listTenants = asyncHandler(async (req, res) => {
    const tenants = await tenantService.listTenants(req.auth, req.validated.query);
    applyNoStore(res);
    res.json({
        data: tenants.data,
        pagination: tenants.pagination
    });
});

exports.createTenant = asyncHandler(async (req, res) => {
    const tenant = await tenantService.createTenant(req.auth, req.validated.body);
    res.status(201).json({ data: tenant });
});

exports.getTenant = asyncHandler(async (req, res) => {
    const tenant = await tenantService.getTenant(req.auth, req.params.id);
    applyNoStore(res);
    res.json({ data: tenant });
});

exports.updateTenant = asyncHandler(async (req, res) => {
    const tenant = await tenantService.updateTenant(req.auth, req.params.id, req.validated.body);
    res.json({ data: tenant });
});
