const { verifyWebhookSignature } = require("../../services/snippe.service");

function getHeaderValue(headers, name) {
    return headers?.[name] || headers?.[name.toLowerCase()] || headers?.[name.toUpperCase()] || "";
}

function verifySnippeRequestSignature({ headers = {}, rawBody = "" }) {
    const signature = getHeaderValue(headers, "X-Webhook-Signature");
    const timestamp = getHeaderValue(headers, "X-Webhook-Timestamp");
    verifyWebhookSignature(rawBody, signature, timestamp);

    return {
        signature,
        timestamp,
        eventType: String(getHeaderValue(headers, "X-Webhook-Event") || "").trim()
    };
}

module.exports = {
    verifySnippeRequestSignature,
    getHeaderValue
};
