const asyncHandler = require("../../utils/async-handler");
const service = require("./cash-control.service");

exports.listSessions = asyncHandler(async (req, res) => {
    res.json({ data: await service.listSessions(req.auth, req.validated.query) });
});

exports.currentSession = asyncHandler(async (req, res) => {
    res.json({ data: await service.getCurrentSession(req.auth, req.query.branch_id || null) });
});

exports.openSession = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.openSession(req.auth, req.validated.body) });
});

exports.closeSession = asyncHandler(async (req, res) => {
    res.json({ data: await service.closeSession(req.auth, req.params.id, req.validated.body) });
});

exports.reviewSession = asyncHandler(async (req, res) => {
    res.json({ data: await service.reviewSession(req.auth, req.params.id, req.validated.body) });
});

exports.getReceiptPolicy = asyncHandler(async (req, res) => {
    res.json({ data: await service.getReceiptPolicy(req.auth, req.query.branch_id || null) });
});

exports.updateReceiptPolicy = asyncHandler(async (req, res) => {
    res.json({ data: await service.updateReceiptPolicy(req.auth, req.validated.body) });
});

exports.initReceiptUpload = asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.initReceiptUpload(req.auth, req.validated.body) });
});

exports.confirmReceiptUpload = asyncHandler(async (req, res) => {
    res.json({ data: await service.confirmReceiptUpload(req.auth, req.params.id, req.validated.body) });
});

exports.listJournalReceipts = asyncHandler(async (req, res) => {
    res.json({ data: await service.listJournalReceipts(req.auth, req.params.journalId) });
});

exports.downloadReceipt = asyncHandler(async (req, res) => {
    res.json({ data: await service.getReceiptDownload(req.auth, req.params.id) });
});

exports.dailySummary = asyncHandler(async (req, res) => {
    res.json({ data: await service.getDailySummary(req.auth, req.validated.query) });
});

exports.dailyCashbookCsv = asyncHandler(async (req, res) => {
    return service.exportDailyCashbook(req.auth, res, req.validated.query);
});

exports.tellerBalancingCsv = asyncHandler(async (req, res) => {
    return service.exportTellerBalancing(req.auth, res, req.validated.query);
});
