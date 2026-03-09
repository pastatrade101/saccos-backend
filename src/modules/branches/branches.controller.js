const asyncHandler = require("../../utils/async-handler");
const branchService = require("./branches.service");

exports.listBranches = asyncHandler(async (req, res) => {
    const branches = await branchService.listBranches(req.auth, req.validated.query);
    res.json({
        data: branches.data,
        pagination: branches.pagination
    });
});

exports.createBranch = asyncHandler(async (req, res) => {
    const branch = await branchService.createBranch(req.auth, req.validated.body);
    res.status(201).json({ data: branch });
});
