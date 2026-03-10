const asyncHandler = require("../../utils/async-handler");
const service = require("./approvals.service");

exports.listPolicies = asyncHandler(async (req, res) => {
    res.json({ data: await service.listApprovalPolicies(req.auth, req.validated.query) });
});

exports.updatePolicy = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateApprovalPolicy(req.auth, req.params.operationKey, req.validated.body) });
});

exports.listRequests = asyncHandler(async (req, res) => {
    const result = await service.listApprovalRequests(req.auth, req.validated.query);
    res.json({
        data: result.data,
        pagination: result.pagination
    });
});

exports.getRequest = asyncHandler(async (req, res) => {
    res.json({ data: await service.getApprovalRequest(req.auth, req.params.requestId, req.validated.query) });
});

exports.approveRequest = asyncHandler(async (req, res) => {
    res.json({ data: await service.approveRequest(req.auth, req.params.requestId, req.validated.body) });
});

exports.rejectRequest = asyncHandler(async (req, res) => {
    res.json({ data: await service.rejectRequest(req.auth, req.params.requestId, req.validated.body) });
});
