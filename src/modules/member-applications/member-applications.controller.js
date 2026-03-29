const asyncHandler = require("../../utils/async-handler");
const service = require("./member-applications.service");

exports.listApplications = asyncHandler(async (req, res) => {
    const result = await service.listApplications(req.auth, req.validated.query);
    res.json({
        data: result.data,
        pagination: result.pagination
    });
});

exports.getApplication = asyncHandler(async (req, res) => {
    res.json({ data: await service.getApplication(req.auth, req.params.id) });
});

exports.getMyApplication = asyncHandler(async (req, res) => {
    res.json({ data: await service.getMyApplication(req.auth) });
});

exports.createApplication = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createApplication(req.auth, req.validated.body) });
});

exports.updateApplication = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateApplication(req.auth, req.params.id, req.validated.body) });
});

exports.submitApplication = asyncHandler(async (req, res) => {
    res.json({ data: await service.submitApplication(req.auth, req.params.id) });
});

exports.reviewApplication = asyncHandler(async (req, res) => {
    res.json({ data: await service.reviewApplication(req.auth, req.params.id, req.validated.body) });
});

exports.requestMoreInfo = asyncHandler(async (req, res) => {
    res.json({ data: await service.requestMoreInfo(req.auth, req.params.id, req.validated.body.reason) });
});

exports.approveApplication = asyncHandler(async (req, res) => {
    res.json({ data: await service.approveApplication(req.auth, req.params.id) });
});

exports.rejectApplication = asyncHandler(async (req, res) => {
    res.json({ data: await service.rejectApplication(req.auth, req.params.id, req.validated.body.reason) });
});
