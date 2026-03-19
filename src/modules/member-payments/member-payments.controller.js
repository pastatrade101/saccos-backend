const asyncHandler = require("../../utils/async-handler");
const service = require("./member-payments.service");

exports.initiateContributionPayment = asyncHandler(async (req, res) => {
    const result = await service.initiateContributionPayment(req.auth, req.validated.body);
    const httpStatus = result.processing_state === "pending_confirmation" ? 202 : 201;
    res.status(httpStatus).json({ data: result });
});

exports.initiateSavingsPayment = asyncHandler(async (req, res) => {
    const result = await service.initiateSavingsPayment(req.auth, req.validated.body);
    const httpStatus = result.processing_state === "pending_confirmation" ? 202 : 201;
    res.status(httpStatus).json({ data: result });
});

exports.listPaymentOrders = asyncHandler(async (req, res) => {
    const result = await service.listPaymentOrders(req.auth, req.validated.query);
    res.json({ data: result });
});

exports.getPaymentOrderStatus = asyncHandler(async (req, res) => {
    const result = await service.getPaymentOrderStatus(req.auth, req.validated.params.id);
    res.json({ data: result });
});

exports.reconcilePaymentOrder = asyncHandler(async (req, res) => {
    const result = await service.reconcilePaymentOrder(req.auth, req.validated.params.id);
    res.json({ data: result });
});

exports.handleAzamCallback = asyncHandler(async (req, res) => {
    const result = await service.handleAzamCallback({
        body: req.body || {},
        query: req.query || {},
        headers: req.headers || {}
    });

    res.status(result.httpStatus || 200).json({
        data: result.data
    });
});
