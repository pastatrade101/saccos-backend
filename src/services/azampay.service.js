const env = require("../config/env");
const AppError = require("../utils/app-error");

const PROVIDER_MAP = {
    airtel: "Airtel",
    vodacom: "Mpesa",
    tigo: "Tigo",
    halopesa: "Halopesa"
};

const tokenCache = {
    token: null,
    expiresAtMs: 0
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
        if (["accountNumber", "msisdn", "phoneNumber", "accessToken", "clientSecret", "authorization", "Authorization"].includes(key)) {
            next[key] = maskValue(entry);
        } else {
            next[key] = redactForLog(entry);
        }
    }

    return next;
}

function mapProviderToAzam(provider) {
    return PROVIDER_MAP[String(provider || "").trim().toLowerCase()] || null;
}

function extractToken(payload) {
    return payload?.data?.accessToken || payload?.accessToken || null;
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
            throw new AppError(504, "AZAMPAY_TIMEOUT", "Azam Pay request timed out.");
        }

        throw error;
    } finally {
        clearTimeout(timeoutHandle);
    }
}

function assertAzamPayConfigured() {
    if (!env.azamPayEnabled) {
        throw new AppError(503, "AZAMPAY_DISABLED", "Azam Pay is not enabled in this environment.");
    }

    if (!env.azamPayAppName || !env.azamPayClientId || !env.azamPayClientSecret) {
        throw new AppError(500, "AZAMPAY_CONFIG_MISSING", "Azam Pay credentials are not fully configured.");
    }
}

async function getAzamPayToken({ forceRefresh = false } = {}) {
    assertAzamPayConfigured();

    if (!forceRefresh && tokenCache.token && tokenCache.expiresAtMs > Date.now()) {
        return tokenCache.token;
    }

    console.log("[azampay] auth request", {
        url: env.azamPayAuthUrl,
        appName: env.azamPayAppName,
        clientId: maskValue(env.azamPayClientId, 6)
    });

    const { response, payload } = await requestJson(env.azamPayAuthUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: {
            appName: env.azamPayAppName,
            clientId: env.azamPayClientId,
            clientSecret: env.azamPayClientSecret
        },
        timeoutMs: env.azamPayAuthTimeoutMs
    });

    if (!response.ok) {
        console.error("[azampay] auth failed", redactForLog(payload));
        throw new AppError(502, "AZAMPAY_AUTH_FAILED", "Unable to authenticate with Azam Pay.", payload);
    }

    const token = extractToken(payload);
    if (!token) {
        console.error("[azampay] auth missing token", redactForLog(payload));
        throw new AppError(502, "AZAMPAY_AUTH_TOKEN_MISSING", "Azam Pay token response was incomplete.", payload);
    }

    tokenCache.token = token;
    tokenCache.expiresAtMs = Date.now() + env.azamPayTokenTtlMs;
    return token;
}

async function createCheckout({ amount, currency, externalId, provider, accountNumber, additionalProperties = {} }) {
    const azamProvider = mapProviderToAzam(provider);
    if (!azamProvider) {
        throw new AppError(400, "AZAMPAY_PROVIDER_INVALID", "Selected mobile provider is not supported by Azam Pay.");
    }

    const accessToken = await getAzamPayToken();
    const payload = {
        accountNumber: String(accountNumber),
        amount: Number(amount),
        currency: String(currency || env.azamPayCurrency),
        externalId: String(externalId),
        provider: azamProvider,
        additionalProperties
    };

    console.log("[azampay] checkout request", {
        url: env.azamPayCheckoutUrl,
        payload: redactForLog(payload)
    });

    const { response, payload: responsePayload } = await requestJson(env.azamPayCheckoutUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: payload,
        timeoutMs: env.azamPayCheckoutTimeoutMs
    });

    console.log("[azampay] checkout response", {
        status: response.status,
        payload: redactForLog(responsePayload)
    });

    if (!response.ok || responsePayload?.success === false) {
        throw new AppError(
            502,
            "AZAMPAY_CHECKOUT_FAILED",
            responsePayload?.message || "Unable to initiate Azam Pay checkout.",
            responsePayload
        );
    }

    return {
        requestPayload: payload,
        responsePayload,
        providerRef:
            responsePayload?.transactionId
            || responsePayload?.data?.transactionId
            || responsePayload?.reference
            || responsePayload?.data?.reference
            || null
    };
}

function extractCallbackIdentifiers(body = {}) {
    const additional = body.additionalProperties || {};
    return {
        internalOrderId: additional.property2 || body.intentId || body.orderId || null,
        externalId:
            body.utilityref
            || body.utilityRef
            || body.externalId
            || body.external_id
            || body.externalID
            || body.externalreference
            || body.externalReference
            || body.external_reference
            || body.pgReferenceId
            || body.initiatorReferenceId
            || body.fspReferenceId
            || null,
        providerRef:
            body.reference
            || body.externalreference
            || body.externalReference
            || body.transid
            || body.transactionId
            || body.transaction_id
            || body.pgReferenceId
            || body.initiatorReferenceId
            || body.fspReferenceId
            || null,
        transactionStatus:
            body.transactionstatus
            || body.transactionStatus
            || body.status
            || body.statusCode
            || body.statusDescription
            || body.status_description
            || body.message
            || body.description
            || null,
        transId: body.transid || body.transactionId || body.transaction_id || body.pgReferenceId || null,
        mnoReference: body.mnoreference || body.mnoReference || body.fspReferenceId || null,
        message: body.message || body.description || body.statusDescription || null
    };
}

function normalizeCallbackStatus(body = {}) {
    const identifiers = extractCallbackIdentifiers(body);
    const normalizedStatus = String(identifiers.transactionStatus || "").trim().toLowerCase();

    let status = "pending";
    if (
        normalizedStatus.includes("success")
        || normalizedStatus.includes("completed")
        || normalizedStatus.includes("paid")
    ) {
        status = "paid";
    } else if (normalizedStatus.includes("expired")) {
        status = "expired";
    } else if (
        normalizedStatus.includes("failed")
        || normalizedStatus.includes("cancel")
        || normalizedStatus.includes("declined")
        || normalizedStatus.includes("rejected")
        || normalizedStatus.includes("timeout")
        || normalizedStatus.includes("reversed")
        || normalizedStatus.includes("aborted")
    ) {
        status = "failed";
    } else if (
        normalizedStatus.includes("pending")
        || normalizedStatus.includes("processing")
        || normalizedStatus.includes("queued")
        || normalizedStatus.includes("initiated")
    ) {
        status = "pending";
    }

    return {
        status,
        statusRaw: identifiers.transactionStatus,
        providerRef: identifiers.providerRef,
        externalId: identifiers.externalId,
        transId: identifiers.transId,
        mnoReference: identifiers.mnoReference,
        message: identifiers.message
    };
}

module.exports = {
    createCheckout,
    extractCallbackIdentifiers,
    getAzamPayToken,
    mapProviderToAzam,
    normalizeCallbackStatus,
    redactForLog
};
