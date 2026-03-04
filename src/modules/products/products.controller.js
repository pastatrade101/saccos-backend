const asyncHandler = require("../../utils/async-handler");
const service = require("./products.service");

exports.bootstrap = asyncHandler(async (req, res) => {
    res.json({ data: await service.getBootstrap(req.auth) });
});

exports.listSavingsProducts = asyncHandler(async (req, res) => {
    res.json({ data: await service.listSavingsProducts(req.auth) });
});

exports.listLoanProducts = asyncHandler(async (req, res) => {
    res.json({ data: await service.listLoanProducts(req.auth) });
});

exports.createLoanProduct = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createLoanProduct(req.auth, req.validated.body) });
});

exports.updateLoanProduct = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateLoanProduct(req.auth, req.params.id, req.validated.body) });
});

exports.createSavingsProduct = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createSavingsProduct(req.auth, req.validated.body) });
});

exports.updateSavingsProduct = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateSavingsProduct(req.auth, req.params.id, req.validated.body) });
});

exports.listShareProducts = asyncHandler(async (req, res) => {
    res.json({ data: await service.listShareProducts(req.auth) });
});

exports.createShareProduct = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createShareProduct(req.auth, req.validated.body) });
});

exports.updateShareProduct = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateShareProduct(req.auth, req.params.id, req.validated.body) });
});

exports.listFeeRules = asyncHandler(async (req, res) => {
    res.json({ data: await service.listFeeRules(req.auth) });
});

exports.createFeeRule = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createFeeRule(req.auth, req.validated.body) });
});

exports.updateFeeRule = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateFeeRule(req.auth, req.params.id, req.validated.body) });
});

exports.listPenaltyRules = asyncHandler(async (req, res) => {
    res.json({ data: await service.listPenaltyRules(req.auth) });
});

exports.createPenaltyRule = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createPenaltyRule(req.auth, req.validated.body) });
});

exports.updatePenaltyRule = asyncHandler(async (req, res) => {
    res.json({ data: await service.updatePenaltyRule(req.auth, req.params.id, req.validated.body) });
});

exports.listPostingRules = asyncHandler(async (req, res) => {
    res.json({ data: await service.listPostingRules(req.auth) });
});

exports.createPostingRule = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createPostingRule(req.auth, req.validated.body) });
});

exports.updatePostingRule = asyncHandler(async (req, res) => {
    res.json({ data: await service.updatePostingRule(req.auth, req.params.id, req.validated.body) });
});
