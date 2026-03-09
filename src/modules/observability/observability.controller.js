const asyncHandler = require("../../utils/async-handler");
const {
    getSummary,
    getTenantDashboards,
    getSloStatus,
    resetObservability
} = require("../../services/observability.service");

exports.summary = asyncHandler(async (req, res) => {
    res.json({ data: getSummary() });
});

exports.tenants = asyncHandler(async (req, res) => {
    res.json({ data: getTenantDashboards() });
});

exports.slos = asyncHandler(async (req, res) => {
    res.json({ data: getSloStatus() });
});

exports.reset = asyncHandler(async (req, res) => {
    resetObservability();
    res.json({
        data: {
            success: true,
            resetAt: new Date().toISOString()
        }
    });
});
