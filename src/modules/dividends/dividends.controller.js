const asyncHandler = require("../../utils/async-handler");
const dividendsService = require("./dividends.service");

exports.getOptions = asyncHandler(async (req, res) => {
    const data = await dividendsService.getOptions(req.auth);
    res.json({ data });
});

exports.listCycles = asyncHandler(async (req, res) => {
    const data = await dividendsService.listCycles(req.auth, req.validated.query);
    res.json({ data });
});

exports.getCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.getCycle(req.auth, req.validated.params.id);
    res.json({ data });
});

exports.createCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.createCycle(req.auth, req.validated.body);
    res.status(201).json({ data });
});

exports.updateCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.updateCycle(req.auth, req.validated.params.id, req.validated.body);
    res.json({ data });
});

exports.freezeCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.freezeCycle(req.auth, req.validated.params.id);
    res.json({ data });
});

exports.allocateCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.allocateCycle(req.auth, req.validated.params.id);
    res.json({ data });
});

exports.submitCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.submitCycle(req.auth, req.validated.params.id);
    res.json({ data });
});

exports.approveCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.approveCycle(req.auth, req.validated.params.id, req.validated.body);
    res.json({ data });
});

exports.rejectCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.rejectCycle(req.auth, req.validated.params.id, req.validated.body);
    res.json({ data });
});

exports.payCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.payCycle(req.auth, req.validated.params.id, req.validated.body);
    res.json({ data });
});

exports.closeCycle = asyncHandler(async (req, res) => {
    const data = await dividendsService.closeCycle(req.auth, req.validated.params.id);
    res.json({ data });
});
