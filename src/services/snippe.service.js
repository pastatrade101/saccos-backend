const crypto = require("crypto");

const env = require("../config/env");
const AppError = require("../utils/app-error");

const PROVIDER_MAP = {
    airtel: "airtel",
    vodacom: "vodacom",
    mpesa: "vodacom",
    "m-pesa": "vodacom",
    tigo: "tigo",
    mixx: "tigo",
    "mixx by yas": "tigo",
    yas: "tigo",
    halopesa: "halopesa",
    halotel: "halopesa"
};

function maskValue(value, visible = 4) {
    const stringValue = String(value || "");
    if (!stringValue) {
        return stringValue;
    }

    if (stringValue.length <= visible) {
        return "*".repeat(stringValue.length);
    }

    return `${"*".repeat(Math.max(stringValue.length - visible, 0))}${stringValue.slice(-visible)}`;
}

function redactForLog(value) {
    if (Array.isArray(value)) {
        return value.map((item) => redactForLog(item));
    }

    if (!value || typeof value !== "object") {
        return value;
    }

    const next = {};
    for (const [key, entry] of Object.entries(value)) {
        if (["phone_number", "phoneNumber", "msisdn", "Authorization", "authorization", "api_key", "apiKey", "email"].includes(key)) {
            next[key] = maskValue(entry);
        } else {
            next[key] = redactForLog(entry);
        }
    }

    return next;
}

function normalizePhoneForSnippe(phone) {
    const digits = String(phone || "").replace(/[^\d]/g, "");
    if (!digits) {
        return "";
    }

    if (digits.startsWith("255")) {
        return digits;
    }

    if (digits.startsWith("0")) {
        return `255${digits.slice(1)}`;
    }

    return digits;
}

async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

async function requestJson(url, { method = "GET", headers = {}, body, timeoutMs = 15000 } = {}) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal
        });
        const payload = await parseJsonResponse(response);
        return { response, payload };
    } catch (error) {
        if (String(error?.name || "").toLowerCase() === "aborterror") {
            throw new AppError(504, "SNIPPE_TIMEOUT", "Snippe request timed out.");
        }

        throw error;
    } finally {
        clearTimeout(timeoutHandle);
    }
}

function assertSnippeConfigured() {
    if (!env.snippeEnabled) {
        throw new AppError(503, "SNIPPE_DISABLED", "Snippe is not enabled in this environment.");
    }

    if (!env.snippeApiKey) {
        throw new AppError(500, "SNIPPE_CONFIG_MISSING", "Snippe API key is not configured.");
    }
}

function resolveSnippeWebhookUrl() {
    if (env.snippeWebhookUrl) {
        return env.snippeWebhookUrl;
    }

    if (env.passwordSetupRedirectUrl) {
        try {
            const url = new URL(env.passwordSetupRedirectUrl);
            return `${url.origin}${env.apiPrefix}/member-payments/snippe/webhook`;
        } catch {
            // fall through to config error
        }
    }

    throw new AppError(500, "SNIPPE_WEBHOOK_URL_MISSING", "Snippe webhook URL is not configured.");
}

function deriveFallbackEmail(customer = {}) {
    const rawEmail = String(customer.email || "").trim();
    if (rawEmail) {
        return rawEmail;
    }

    if (env.passwordSetupRedirectUrl) {
        try {
            const url = new URL(env.passwordSetupRedirectUrl);
            return `member@${url.hostname}`;
        } catch {
            // ignore and use local fallback below
        }
    }

    return "member@saccos.local";
}

function splitCustomerName(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
        return {
            firstname: "SACCO",
            lastname: "Member"
        };
    }

    if (parts.length === 1) {
        return {
            firstname: parts[0],
            lastname: "Member"
        };
    }

    return {
        firstname: parts[0],
        lastname: parts.slice(1).join(" ")
    };
}

async function createPaymentIntent({
    amount,
    currency,
    externalId,
    accountNumber,
    customer = {},
    metadata = {},
    idempotencyKey
}) {
    assertSnippeConfigured();

    const url = `${env.snippeBaseUrl.replace(/\/$/, "")}/v1/payments`;
    const customerName = splitCustomerName(customer.name || "SACCO Member");
    const payload = {
        payment_type: "mobile",
        details: {
            amount: Math.round(Number(amount)),
            currency: String(currency || env.snippeCurrency)
        },
        phone_number: normalizePhoneForSnippe(accountNumber),
        webhook_url: resolveSnippeWebhookUrl(),
        customer: {
            firstname: customerName.firstname,
            lastname: customerName.lastname,
            email: deriveFallbackEmail(customer)
        },
        metadata: {
            ...metadata,
            external_id: String(externalId),
            source: metadata.source || env.snippeSourceLabel
        }
    };

    console.log("[snippe] payment request", {
        url,
        payload: redactForLog(payload)
    });

    const { response, payload: responsePayload } = await requestJson(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.snippeApiKey}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey) } : {})
        },
        body: payload,
        timeoutMs: env.snippeTimeoutMs
    });

    console.log("[snippe] payment response", {
        status: response.status,
        payload: redactForLog(responsePayload)
    });

    if (!response.ok) {
        throw new AppError(
            502,
            "SNIPPE_PAYMENT_FAILED",
            responsePayload?.message || responsePayload?.error || "Unable to initiate Snippe payment.",
            responsePayload
        );
    }

    const paymentData = responsePayload?.data || responsePayload?.payment || responsePayload;

    return {
        requestPayload: payload,
        responsePayload,
        providerRef: paymentData?.reference || paymentData?.id || paymentData?.payment_id || null,
        expiresAt: paymentData?.expires_at || paymentData?.expiresAt || null,
        status: paymentData?.status || null
    };
}

async function createPayoutIntent({
    amount,
    currency,
    externalId,
    accountNumber,
    customer = {},
    metadata = {},
    idempotencyKey
}) {
    assertSnippeConfigured();

    const url = `${env.snippeBaseUrl.replace(/\/$/, "")}/v1/payouts/send`;
    const recipientName = String(customer.name || "").trim() || "SACCO Member";
    const payload = {
        channel: "mobile",
        recipient_phone: normalizePhoneForSnippe(accountNumber),
        recipient_name: recipientName,
        amount: Math.round(Number(amount)),
        currency: String(currency || env.snippeCurrency),
        webhook_url: resolveSnippeWebhookUrl(),
        metadata: {
            ...metadata,
            external_id: String(externalId),
            source: metadata.source || `${env.snippeSourceLabel}_loan_disbursement`
        }
    };

    console.log("[snippe] payout request", {
        url,
        payload: redactForLog(payload)
    });

    const { response, payload: responsePayload } = await requestJson(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.snippeApiKey}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey) } : {})
        },
        body: payload,
        timeoutMs: env.snippeTimeoutMs
    });

    console.log("[snippe] payout response", {
        status: response.status,
        payload: redactForLog(responsePayload)
    });

    if (!response.ok) {
        throw new AppError(
            502,
            "SNIPPE_PAYOUT_FAILED",
            responsePayload?.message || responsePayload?.error || "Unable to initiate Snippe payout.",
            responsePayload
        );
    }

    const payoutData = responsePayload?.data || responsePayload?.payout || responsePayload;

    return {
        requestPayload: payload,
        responsePayload,
        providerRef: payoutData?.reference || payoutData?.id || payoutData?.payout_id || null,
        externalReference: payoutData?.external_reference || payoutData?.externalReference || null,
        status: payoutData?.status || null,
        provider: payoutData?.channel?.provider || payoutData?.provider || null,
        completedAt: payoutData?.completed_at || payoutData?.completedAt || null,
        expiresAt: payoutData?.expires_at || payoutData?.expiresAt || null
    };
}

async function getPaymentStatus(reference) {
    assertSnippeConfigured();

    const providerRef = String(reference || "").trim();
    if (!providerRef) {
        throw new AppError(400, "SNIPPE_REFERENCE_REQUIRED", "Snippe payment reference is required.");
    }

    const url = `${env.snippeBaseUrl.replace(/\/$/, "")}/v1/payments/${encodeURIComponent(providerRef)}`;

    const { response, payload } = await requestJson(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${env.snippeApiKey}`
        },
        timeoutMs: env.snippeTimeoutMs
    });

    console.log("[snippe] payment status response", {
        url,
        reference: providerRef,
        status: response.status,
        payload: redactForLog(payload)
    });

    if (response.status === 404) {
        return {
            found: false,
            providerRef,
            responsePayload: payload
        };
    }

    if (!response.ok) {
        throw new AppError(
            502,
            "SNIPPE_STATUS_CHECK_FAILED",
            payload?.message || payload?.error || "Unable to query Snippe payment status.",
            payload
        );
    }

    const paymentData = payload?.data || payload?.payment || payload;
    return {
        found: true,
        providerRef: paymentData?.reference || paymentData?.id || providerRef,
        externalReference: paymentData?.external_reference || paymentData?.externalReference || null,
        status: String(paymentData?.status || payload?.status || "").trim().toLowerCase(),
        amountValue: Number(paymentData?.amount?.value ?? paymentData?.amount ?? NaN),
        amountCurrency: paymentData?.amount?.currency ? String(paymentData.amount.currency).trim().toUpperCase() : null,
        completedAt: paymentData?.completed_at || paymentData?.completedAt || null,
        expiresAt: paymentData?.expires_at || paymentData?.expiresAt || null,
        metadata: paymentData?.metadata && typeof paymentData.metadata === "object" ? paymentData.metadata : {},
        responsePayload: payload,
        payment: paymentData
    };
}

async function getPayoutStatus(reference) {
    assertSnippeConfigured();

    const providerRef = String(reference || "").trim();
    if (!providerRef) {
        throw new AppError(400, "SNIPPE_PAYOUT_REFERENCE_REQUIRED", "Snippe payout reference is required.");
    }

    const url = `${env.snippeBaseUrl.replace(/\/$/, "")}/v1/payouts/${encodeURIComponent(providerRef)}`;

    const { response, payload } = await requestJson(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${env.snippeApiKey}`
        },
        timeoutMs: env.snippeTimeoutMs
    });

    console.log("[snippe] payout status response", {
        url,
        reference: providerRef,
        status: response.status,
        payload: redactForLog(payload)
    });

    if (response.status === 404) {
        return {
            found: false,
            providerRef,
            responsePayload: payload
        };
    }

    if (!response.ok) {
        throw new AppError(
            502,
            "SNIPPE_PAYOUT_STATUS_CHECK_FAILED",
            payload?.message || payload?.error || "Unable to query Snippe payout status.",
            payload
        );
    }

    const payoutData = payload?.data || payload?.payout || payload;
    return {
        found: true,
        providerRef: payoutData?.reference || payoutData?.id || providerRef,
        externalReference: payoutData?.external_reference || payoutData?.externalReference || null,
        status: String(payoutData?.status || payload?.status || "").trim().toLowerCase(),
        amountValue: Number(payoutData?.amount?.value ?? payoutData?.amount ?? NaN),
        amountCurrency: payoutData?.amount?.currency ? String(payoutData.amount.currency).trim().toUpperCase() : null,
        completedAt: payoutData?.completed_at || payoutData?.completedAt || null,
        expiresAt: payoutData?.expires_at || payoutData?.expiresAt || null,
        metadata: payoutData?.metadata && typeof payoutData.metadata === "object" ? payoutData.metadata : {},
        provider: payoutData?.channel?.provider || payoutData?.provider || null,
        responsePayload: payload,
        payout: payoutData
    };
}

function computeWebhookSignatureDiagnostics(rawBody, signature, timestamp = "") {
    if (!env.snippeWebhookSecret) {
        throw new AppError(500, "SNIPPE_WEBHOOK_SECRET_MISSING", "Snippe webhook secret is not configured.");
    }

    const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
    const payload = payloadBuffer.toString("utf8");
    const provided = String(signature || "").trim().replace(/^sha256=/i, "");
    const timestampValue = String(timestamp || "").trim();
    const strategies = {
        raw_body_hex: crypto.createHmac("sha256", env.snippeWebhookSecret).update(payloadBuffer).digest("hex"),
        trimmed_body_hex: crypto.createHmac("sha256", env.snippeWebhookSecret).update(payload.trim(), "utf8").digest("hex")
    };

    if (timestampValue) {
        strategies.timestamp_dot_raw_hex = crypto
            .createHmac("sha256", env.snippeWebhookSecret)
            .update(`${timestampValue}.${payload}`, "utf8")
            .digest("hex");
        strategies.timestamp_dot_trimmed_hex = crypto
            .createHmac("sha256", env.snippeWebhookSecret)
            .update(`${timestampValue}.${payload.trim()}`, "utf8")
            .digest("hex");
    }

    return {
        provided,
        matches: Object.entries(strategies)
            .filter(([, expected]) => expected === provided)
            .map(([name]) => name),
        expected: strategies
    };
}

function verifyWebhookSignature(rawBody, signature, timestamp = "") {
    if (!env.snippeWebhookSecret) {
        throw new AppError(500, "SNIPPE_WEBHOOK_SECRET_MISSING", "Snippe webhook secret is not configured.");
    }

    const provided = String(signature || "").trim().replace(/^sha256=/i, "");
    const timestampValue = String(timestamp || "").trim();
    if (!provided) {
        throw new AppError(401, "SNIPPE_SIGNATURE_MISSING", "Snippe webhook signature is missing.");
    }
    if (!timestampValue) {
        throw new AppError(401, "SNIPPE_TIMESTAMP_MISSING", "Snippe webhook timestamp is missing.");
    }

    const diagnostics = computeWebhookSignatureDiagnostics(rawBody, signature, timestamp);
    const computed = diagnostics.expected.timestamp_dot_raw_hex;
    const providedBuffer = Buffer.from(provided, "hex");
    const computedBuffer = Buffer.from(String(computed || ""), "hex");

    if (providedBuffer.length !== computedBuffer.length || !crypto.timingSafeEqual(providedBuffer, computedBuffer)) {
        throw new AppError(401, "SNIPPE_SIGNATURE_INVALID", "Snippe webhook signature is invalid.");
    }

    return diagnostics;
}

function mapProviderToLocal(provider) {
    const normalized = String(provider || "").trim().toLowerCase();
    return PROVIDER_MAP[normalized] || null;
}

function extractWebhookIdentifiers(body = {}, headers = {}) {
    const data = body.data || body.payment || {};
    const metadata = data.metadata || body.metadata || {};
    const headerEvent = headers["x-webhook-event"] || headers["X-Webhook-Event"] || headers["x-snippe-event"] || headers["X-Snippe-Event"] || "";

    return {
        eventType: String(body.type || body.event || headerEvent || "").trim(),
        internalOrderId:
            metadata.payment_order_id
            || metadata.order_id
            || metadata.internal_order_id
            || body.payment_order_id
            || null,
        externalId:
            data.external_reference
            || body.external_reference
            || body.externalReference
            || metadata.external_id
            || metadata.external_reference
            || null,
        providerRef:
            data.reference
            || data.id
            || body.reference
            || body.payment_reference
            || null,
        provider: mapProviderToLocal(data.channel?.provider || data.provider || body.provider || metadata.provider || null),
        status: String(data.status || body.status || "").trim().toLowerCase(),
        failureReason:
            data.failure_reason
            || data.failureReason
            || data.message
            || data.error
            || body.failure_reason
            || body.failureReason
            || body.reason
            || body.error
            || body.message
            || null,
        paidAt:
            data.completed_at
            || data.completedAt
            || body.completed_at
            || body.completedAt
            || null
    };
}

function normalizeWebhookStatus(body = {}, headers = {}) {
    const identifiers = extractWebhookIdentifiers(body, headers);
    const normalizedEvent = identifiers.eventType.toLowerCase();
    const normalizedStatus = identifiers.status.toLowerCase();
    const normalizedReason = String(identifiers.failureReason || "").trim().toLowerCase();

    let status = "pending";
    if (normalizedEvent === "payment.completed" || normalizedStatus === "completed" || normalizedStatus === "paid" || normalizedStatus === "successful") {
        status = "paid";
    } else if (
        normalizedEvent === "payment.failed"
        || normalizedEvent === "payment.expired"
        || normalizedEvent === "payment.voided"
        || normalizedStatus === "failed"
        || normalizedStatus === "expired"
        || normalizedStatus === "declined"
        || normalizedStatus === "rejected"
        || normalizedStatus === "voided"
        || normalizedStatus === "cancelled"
        || normalizedStatus === "canceled"
    ) {
        status = normalizedReason.includes("expire") ? "expired" : "failed";
    }

    return {
        ...identifiers,
        status,
        statusRaw: identifiers.status || identifiers.eventType || null,
        message: identifiers.failureReason || null
    };
}

module.exports = {
    createPaymentIntent,
    createPayoutIntent,
    getPaymentStatus,
    getPayoutStatus,
    verifyWebhookSignature,
    computeWebhookSignatureDiagnostics,
    extractWebhookIdentifiers,
    normalizeWebhookStatus,
    mapProviderToLocal
};
