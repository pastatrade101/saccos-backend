const asyncHandler = require("../../utils/async-handler");
const service = require("./loan-capacity.service");

exports.getBorrowLimit = asyncHandler(async (req, res) => {
    res.json({ data: await service.calculateBorrowLimit(req.auth, req.validated.query) });
});

exports.getLoanProductPolicy = asyncHandler(async (req, res) => {
    res.json({ data: await service.getLoanProductPolicy(req.auth, req.params.loanProductId, req.validated.query) });
});

exports.updateLoanProductPolicy = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateLoanProductPolicy(req.auth, req.params.loanProductId, req.validated.body) });
});

exports.getBranchLiquidityPolicy = asyncHandler(async (req, res) => {
    res.json({ data: await service.getBranchLiquidityPolicy(req.auth, req.params.branchId, req.validated.query) });
});

exports.updateBranchLiquidityPolicy = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateBranchLiquidityPolicy(req.auth, req.params.branchId, req.validated.body) });
});

exports.getBranchFundPool = asyncHandler(async (req, res) => {
    res.json({ data: await service.getBranchFundPool(req.auth, req.params.branchId, req.validated.query) });
});

exports.getBranchDashboard = asyncHandler(async (req, res) => {
    res.json({ data: await service.getBranchDashboard(req.auth, req.params.branchId, req.validated.query) });
});
