const asyncHandler = require("../../utils/async-handler");
const service = require("./loan-applications.service");

exports.list = asyncHandler(async (req, res) => {
    const result = await service.listLoanApplications(req.auth, req.validated.query);
    res.json({
        data: result.data,
        pagination: result.pagination
    });
});

exports.create = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createLoanApplication(req.auth, req.validated.body) });
});

exports.update = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateLoanApplication(req.auth, req.params.id, req.validated.body) });
});

exports.submit = asyncHandler(async (req, res) => {
    res.json({ data: await service.submitLoanApplication(req.auth, req.params.id) });
});

exports.appraise = asyncHandler(async (req, res) => {
    res.json({ data: await service.appraiseLoanApplication(req.auth, req.params.id, req.validated.body) });
});

exports.approve = asyncHandler(async (req, res) => {
    res.json({ data: await service.approveLoanApplication(req.auth, req.params.id, req.validated.body) });
});

exports.reject = asyncHandler(async (req, res) => {
    res.json({ data: await service.rejectLoanApplication(req.auth, req.params.id, req.validated.body) });
});

exports.disburse = asyncHandler(async (req, res) => {
    const result = await service.disburseLoanApplication(req.auth, req.params.id, req.validated.body);
    if (result?.approval_required) {
        return res.status(202).json({ data: result });
    }
    return res.status(201).json({ data: result });
});
