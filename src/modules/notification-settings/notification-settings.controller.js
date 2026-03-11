const asyncHandler = require("../../utils/async-handler");
const service = require("./notification-settings.service");

exports.listSmsTriggers = asyncHandler(async (req, res) => {
    res.json({ data: await service.listSmsTriggers(req.auth, req.validated.query) });
});

exports.updateSmsTrigger = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateSmsTrigger(req.auth, req.params.eventType, req.validated.body) });
});
