const asyncHandler = require("../../utils/async-handler");
const service = require("./treasury.service");

function applyNoStore(res) {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0",
        Vary: "Authorization"
    });
}

exports.getOverview = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json({ data: await service.getOverview(req.auth, req.validated.query) });
});

exports.getLiquidityOverview = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json({ data: await service.getLiquidityOverview(req.auth, req.validated.query) });
});

exports.getPolicy = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json({ data: await service.getTreasuryPolicy(req.auth, req.validated.query) });
});

exports.getAuditLog = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json(await service.getTreasuryAuditLog(req.auth, req.validated.query));
});

exports.updatePolicy = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json({ data: await service.updateTreasuryPolicy(req.auth, req.validated.body) });
});

exports.listAssets = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json({ data: await service.listAssets(req.auth, req.validated.query) });
});

exports.createAsset = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.status(201).json({ data: await service.createAsset(req.auth, req.validated.body) });
});

exports.getPortfolio = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json({ data: await service.getPortfolio(req.auth, req.validated.query) });
});

exports.updateValuation = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json({ data: await service.updateValuation(req.auth, req.validated.params.assetId, req.validated.body) });
});

exports.listOrders = asyncHandler(async (req, res) => {
    applyNoStore(res);
    const result = await service.listOrders(req.auth, req.validated.query);
    res.json(result);
});

exports.createOrder = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.status(201).json({ data: await service.createOrder(req.auth, req.validated.body) });
});

exports.reviewOrder = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json({ data: await service.reviewOrder(req.auth, req.validated.params.orderId, req.validated.body) });
});

exports.executeOrder = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.json({ data: await service.executeOrder(req.auth, req.validated.params.orderId, req.validated.body) });
});

exports.listTransactions = asyncHandler(async (req, res) => {
    applyNoStore(res);
    const result = await service.listTransactions(req.auth, req.validated.query);
    res.json(result);
});

exports.listIncome = asyncHandler(async (req, res) => {
    applyNoStore(res);
    const result = await service.listIncome(req.auth, req.validated.query);
    res.json(result);
});

exports.recordIncome = asyncHandler(async (req, res) => {
    applyNoStore(res);
    res.status(201).json({ data: await service.recordIncome(req.auth, req.validated.body) });
});
