const asyncHandler = require("../../utils/async-handler");
const service = require("./public-signups.service");

exports.signup = asyncHandler(async (req, res) => {
    const result = await service.createPublicSignup(req.validated.body, req.ip, req.files || {});
    res.status(201).json({ data: result });
});

exports.listBranches = asyncHandler(async (req, res) => {
    const data = await service.listBranches();
    res.json({ data });
});
