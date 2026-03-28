const asyncHandler = require("../../utils/async-handler");
const service = require("./snippeWebhook.service");

exports.handleSnippeWebhook = asyncHandler(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.rawBody || (req.body ? JSON.stringify(req.body) : ""), "utf8");

    const result = await service.handleWebhook({
        body: req.body || {},
        headers: req.headers || {},
        rawBody,
        ip: req.ip || null,
        userAgent: req.get("user-agent") || null,
        source: req.originalUrl === "/webhooks/snippe" ? "public_webhook" : "member_payments_api_webhook"
    });

    res.status(result.httpStatus || 200).json({
        data: result.data
    });
});
