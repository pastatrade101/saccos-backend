const asyncHandler = require("../../utils/async-handler");
const service = require("./credit-risk.service");

exports.listDefaultCases = asyncHandler(async (req, res) => {
    const result = await service.listDefaultCases(req.auth, req.validated.query);
    res.json({ data: result.data, pagination: result.pagination });
});

exports.getDefaultCase = asyncHandler(async (req, res) => {
    const query = req.validated?.query || {};
    res.json({ data: await service.getDefaultCase(req.auth, req.params.id, query) });
});

exports.createDefaultCase = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createDefaultCase(req.auth, req.validated.body) });
});

exports.transitionDefaultCase = asyncHandler(async (req, res) => {
    res.json({ data: await service.transitionDefaultCase(req.auth, req.params.id, req.validated.body) });
});

exports.listCollectionActions = asyncHandler(async (req, res) => {
    const result = await service.listCollectionActions(req.auth, req.validated.query);
    res.json({ data: result.data, pagination: result.pagination });
});

exports.createCollectionAction = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createCollectionAction(req.auth, req.validated.body) });
});

exports.updateCollectionAction = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateCollectionAction(req.auth, req.params.actionId, req.validated.body) });
});

exports.completeCollectionAction = asyncHandler(async (req, res) => {
    res.json({ data: await service.completeCollectionAction(req.auth, req.params.actionId, req.validated.body) });
});

exports.escalateCollectionAction = asyncHandler(async (req, res) => {
    res.json({ data: await service.escalateCollectionAction(req.auth, req.params.actionId, req.validated.body) });
});
