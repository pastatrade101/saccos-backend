const asyncHandler = require("../../utils/async-handler");
const financeService = require("./finance.service");

function applyNoStore(res) {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0",
        Vary: "Authorization"
    });
}

exports.deposit = asyncHandler(async (req, res) => {
    const result = await financeService.deposit(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.withdraw = asyncHandler(async (req, res) => {
    const result = await financeService.withdraw(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.shareContribution = asyncHandler(async (req, res) => {
    const result = await financeService.shareContribution(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.dividendAllocation = asyncHandler(async (req, res) => {
    const result = await financeService.dividendAllocation(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.transfer = asyncHandler(async (req, res) => {
    const result = await financeService.transfer(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.loanDisburse = asyncHandler(async (req, res) => {
    const result = await financeService.loanDisburse(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.loanRepay = asyncHandler(async (req, res) => {
    const result = await financeService.loanRepay(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.accrueInterest = asyncHandler(async (req, res) => {
    const result = await financeService.accrueInterest(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.closePeriod = asyncHandler(async (req, res) => {
    const result = await financeService.closePeriod(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.getStatements = asyncHandler(async (req, res) => {
    const result = await financeService.getStatements(req.auth, req.validated.query);
    applyNoStore(res);
    res.json({
        data: result.data,
        pagination: result.pagination
    });
});

exports.getLedger = asyncHandler(async (req, res) => {
    const result = await financeService.getLedger(req.auth, req.validated.query);
    applyNoStore(res);
    res.json({
        data: result.data,
        pagination: result.pagination
    });
});

exports.getLoans = asyncHandler(async (req, res) => {
    const result = await financeService.getLoans(req.auth, req.validated.query);
    applyNoStore(res);
    res.json({
        data: result.data,
        pagination: result.pagination
    });
});

exports.getLoanSchedules = asyncHandler(async (req, res) => {
    const result = await financeService.getLoanSchedules(req.auth, req.validated.query);
    applyNoStore(res);
    res.json({
        data: result.data,
        pagination: result.pagination
    });
});

exports.getLoanTransactions = asyncHandler(async (req, res) => {
    const result = await financeService.getLoanTransactions(req.auth, req.validated.query);
    applyNoStore(res);
    res.json({
        data: result.data,
        pagination: result.pagination
    });
});
