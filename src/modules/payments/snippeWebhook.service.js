const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const { normalizeWebhookStatus } = require("../../services/snippe.service");
const {
    resolvePaymentOrderFromIdentifiers,
    logPaymentOrderCallback,
    updatePaymentOrder,
    postContributionPaymentOrder,
    notifyMemberPaymentOrderEvent
} = require("../member-payments/member-payments.service");
const { processSnippeLoanDisbursementPayoutEvent } = require("../loan-applications/loan-applications.service");
const { verifySnippeRequestSignature, getHeaderValue } = require("./signatureVerifier");

/**
 * @typedef {Object} SnippeWebhookEvent
 * @property {string|null} eventId
 * @property {string} eventType
 * @property {string|null} reference
 * @property {string|null} externalReference
 * @property {string|null} status
 * @property {number|null} amountValue
 * @property {string|null} amountCurrency
 * @property {Record<string, unknown>} metadata
 * @property {string|null} providerRef
 * @property {string|null} failureReason
 * @property {string|null} completedAt
 * @property {string|null} tenantId
 * @property {string|null} orderId
 * @property {Record<string, unknown>} payload
 * @property {Record<string, unknown>} rawBody
 * @property {ReturnType<typeof normalizeWebhookStatus>} normalized
 */

function logWebhook(level, message, context = {}) {
    const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    logger(`[snippe-webhook] ${message}`, context);
}

function toNumericAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
}

function extractWebhookEvent(body = {}, headers = {}) {
    const normalized = normalizeWebhookStatus(body, headers);
    const data = body?.data && typeof body.data === "object"
        ? body.data
        : body?.payment && typeof body.payment === "object"
            ? body.payment
            : {};
    const rootMetadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : rootMetadata;
    const headerEvent = String(getHeaderValue(headers, "X-Webhook-Event") || "").trim();
    const headerEventId = String(getHeaderValue(headers, "X-Webhook-Id") || "").trim();
    const headerTimestamp = String(getHeaderValue(headers, "X-Webhook-Timestamp") || "").trim();
    const bodyEvent = String(body?.type || body?.event || "").trim();
    const eventType = headerEvent || bodyEvent;
    const reference = data?.reference || body?.reference || body?.payment_reference || null;
    const externalReference = data?.external_reference || body?.external_reference || body?.externalReference || null;
    const status = data?.status || body?.status || normalized.status || null;
    const amountValue = data?.amount?.value ?? body?.amount?.value ?? body?.amount ?? null;
    const amountCurrency = data?.amount?.currency || body?.amount?.currency || body?.currency || null;
    const completedAt = data?.completed_at || body?.completed_at || body?.completedAt || null;
    const fallbackEventId = eventType && (reference || externalReference || headerTimestamp)
        ? `snippe:${eventType}:${String(reference || externalReference || "unknown")}::${String(headerTimestamp || completedAt || "notimestamp")}`
        : null;

    return {
        eventId: body?.id
            ? String(body.id)
            : body?.event_id
                ? String(body.event_id)
                : data?.id
                    ? String(data.id)
                    : (headerEventId || fallbackEventId),
        eventType,
        reference: reference ? String(reference) : null,
        externalReference: externalReference ? String(externalReference) : null,
        status: status ? String(status).trim().toLowerCase() : normalized.status,
        amountValue: toNumericAmount(amountValue),
        amountCurrency: amountCurrency ? String(amountCurrency).trim().toUpperCase() : null,
        metadata,
        providerRef: normalized.providerRef || (data?.reference ? String(data.reference) : null),
        failureReason: normalized.message || (data?.failure_reason ? String(data.failure_reason) : null),
        completedAt: completedAt ? String(completedAt) : null,
        tenantId: metadata?.tenant_id ? String(metadata.tenant_id) : null,
        orderId: metadata?.order_id || metadata?.payment_order_id || null,
        payload: {
            headers: {
                "x-webhook-event": headerEvent || null,
                "x-webhook-signature": getHeaderValue(headers, "X-Webhook-Signature") || null,
                "x-webhook-timestamp": getHeaderValue(headers, "X-Webhook-Timestamp") || null,
                "user-agent": getHeaderValue(headers, "User-Agent") || null
            },
            body
        },
        rawBody: body,
        normalized
    };
}

function parseWebhookJson(rawBodyBuffer) {
    const bodyText = rawBodyBuffer.toString("utf8");
    try {
        return {
            bodyText,
            parsedBody: bodyText ? JSON.parse(bodyText) : {}
        };
    } catch (error) {
        throw new AppError(400, "SNIPPE_WEBHOOK_JSON_INVALID", "Snippe webhook body is not valid JSON.", error);
    }
}

async function findWebhookEventByEventId(eventId) {
    const { data, error } = await adminSupabase
        .from("webhook_events")
        .select("id, event_id, event_type, processed_at")
        .eq("event_id", eventId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "WEBHOOK_EVENT_LOOKUP_FAILED", "Unable to check Snippe webhook idempotency.", error);
    }

    return data || null;
}

async function storeProcessedWebhookEvent(event) {
    const record = {
        event_id: event.eventId,
        event_type: event.eventType,
        payload: event.payload,
        processed_at: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
        .from("webhook_events")
        .insert(record)
        .select("id, event_id, processed_at")
        .maybeSingle();

    if (!error) {
        return data || record;
    }

    if (error.code === "23505") {
        return findWebhookEventByEventId(event.eventId);
    }

    throw new AppError(500, "WEBHOOK_EVENT_STORE_FAILED", "Unable to persist processed Snippe webhook event.", error);
}

async function recordWebhookAudit({ event, action, order = null, afterData = null, ip = null, userAgent = null }) {
    const tenantId = order?.tenant_id || event.tenantId || null;
    if (!tenantId) {
        return;
    }

    await logAudit({
        tenantId,
        actorUserId: order?.created_by_user_id || null,
        table: "webhook_events",
        action,
        entityType: "snippe_webhook_event",
        entityId: event.eventId,
        afterData: afterData || {
            event_type: event.eventType,
            reference: event.reference,
            external_reference: event.externalReference,
            order_id: event.orderId,
            provider_ref: event.providerRef,
            status: event.status,
            amount: event.amountValue,
            currency: event.amountCurrency
        },
        ip,
        userAgent
    });
}

function buildStructuredViolation({ rule, severity, message, currentValue = null, requiredValue = null }) {
    return {
        violation: true,
        rule,
        severity,
        message,
        current_value: currentValue,
        required_value: requiredValue
    };
}

async function resolvePaymentOrderForEvent(event) {
    const identifiers = {
        internalOrderId: event.orderId,
        externalId: event.externalReference,
        providerRef: event.providerRef
    };

    return resolvePaymentOrderFromIdentifiers(identifiers);
}

function validateAmountMatchesOrder(order, event) {
    const orderAmount = toNumericAmount(order?.amount);
    if (orderAmount === null || event.amountValue === null) {
        return buildStructuredViolation({
            rule: "amount_match",
            severity: "block",
            message: "Webhook amount is missing or invalid.",
            currentValue: event.amountValue,
            requiredValue: orderAmount
        });
    }

    if (orderAmount !== event.amountValue) {
        return buildStructuredViolation({
            rule: "amount_match",
            severity: "block",
            message: "Webhook amount does not match the internal order amount.",
            currentValue: event.amountValue,
            requiredValue: orderAmount
        });
    }

    const orderCurrency = String(order?.currency || "").trim().toUpperCase();
    if (orderCurrency && event.amountCurrency && orderCurrency !== event.amountCurrency) {
        return buildStructuredViolation({
            rule: "currency_match",
            severity: "block",
            message: "Webhook currency does not match the internal order currency.",
            currentValue: event.amountCurrency,
            requiredValue: orderCurrency
        });
    }

    return null;
}

async function markPaymentOrderFailed(order, event, ip, userAgent) {
    const nowIso = new Date().toISOString();
    const shouldIgnoreFailure = order.status === "posted" || order.status === "paid";
    const shouldExpire = event.normalized.status === "expired";
    const patch = {
        callback_received_at: nowIso,
        latest_callback_payload: event.rawBody,
        provider_ref: event.providerRef || order.provider_ref,
        provider: event.normalized.provider || order.provider,
        status: shouldIgnoreFailure ? order.status : (shouldExpire ? "expired" : "failed"),
        failed_at: shouldIgnoreFailure || shouldExpire ? order.failed_at : order.failed_at || nowIso,
        expired_at: shouldIgnoreFailure || !shouldExpire ? order.expired_at : order.expired_at || nowIso,
        error_code: shouldIgnoreFailure ? order.error_code : (shouldExpire ? "SNIPPE_PAYMENT_EXPIRED" : "SNIPPE_PAYMENT_FAILED"),
        error_message: shouldIgnoreFailure ? order.error_message : (event.failureReason || event.status || (shouldExpire ? "The mobile money session expired." : "The mobile money gateway reported payment failure."))
    };

    const updatedOrder = await updatePaymentOrder(order.id, patch);

    await logAudit({
        tenantId: updatedOrder.tenant_id,
        actorUserId: updatedOrder.created_by_user_id,
        table: "payment_orders",
        action: shouldIgnoreFailure ? "SNIPPE_PAYMENT_FAILURE_IGNORED" : "MEMBER_PAYMENT_FAILED",
        entityType: "payment_order",
        entityId: updatedOrder.id,
        afterData: {
            gateway: updatedOrder.gateway,
            status: updatedOrder.status,
            provider_ref: updatedOrder.provider_ref || null,
            failure_reason: patch.error_message,
            snippe_event_id: event.eventId,
            snippe_event_type: event.eventType
        },
        ip,
        userAgent
    });

    if (updatedOrder.status === "failed") {
        await notifyMemberPaymentOrderEvent(updatedOrder, "member_payment_failed").catch((error) => {
            logWebhook("warn", "member payment failure notification failed", {
                orderId: updatedOrder.id,
                eventId: event.eventId,
                message: error?.message || error
            });
        });
    } else if (updatedOrder.status === "expired") {
        await notifyMemberPaymentOrderEvent(updatedOrder, "member_payment_expired").catch((error) => {
            logWebhook("warn", "member payment expiry notification failed", {
                orderId: updatedOrder.id,
                eventId: event.eventId,
                message: error?.message || error
            });
        });
    }

    return updatedOrder;
}

async function markPaymentOrderCompleted(order, event, ip, userAgent) {
    const nowIso = new Date().toISOString();
    const patch = {
        callback_received_at: nowIso,
        latest_callback_payload: event.rawBody,
        provider_ref: event.providerRef || order.provider_ref,
        provider: event.normalized.provider || order.provider,
        status: order.status === "posted" ? "posted" : "paid",
        paid_at: order.paid_at || event.completedAt || nowIso,
        error_code: null,
        error_message: null
    };

    let updatedOrder = await updatePaymentOrder(order.id, patch);

    if (updatedOrder.status === "paid" && !updatedOrder.posted_at) {
        updatedOrder = await postContributionPaymentOrder(updatedOrder, "snippe_webhook");
    }

    await logAudit({
        tenantId: updatedOrder.tenant_id,
        actorUserId: updatedOrder.created_by_user_id,
        table: "payment_orders",
        action: updatedOrder.status === "posted" ? "SNIPPE_PAYMENT_COMPLETED_AND_POSTED" : "SNIPPE_PAYMENT_COMPLETED",
        entityType: "payment_order",
        entityId: updatedOrder.id,
        afterData: {
            gateway: updatedOrder.gateway,
            status: updatedOrder.status,
            provider_ref: updatedOrder.provider_ref || null,
            paid_at: updatedOrder.paid_at || null,
            posted_at: updatedOrder.posted_at || null,
            snippe_event_id: event.eventId,
            snippe_event_type: event.eventType
        },
        ip,
        userAgent
    });

    return updatedOrder;
}

async function acknowledgeAmountMismatch(order, event, violation, ip, userAgent) {
    logWebhook("warn", "amount validation failed for Snippe payment webhook", {
        orderId: order.id,
        eventId: event.eventId,
        providerRef: event.providerRef,
        currentValue: violation.current_value,
        requiredValue: violation.required_value
    });

    await recordWebhookAudit({
        event,
        order,
        action: "SNIPPE_WEBHOOK_AMOUNT_MISMATCH",
        afterData: {
            event_type: event.eventType,
            order_id: order.id,
            provider_ref: event.providerRef,
            amount_received: violation.current_value,
            amount_expected: violation.required_value
        },
        ip,
        userAgent
    });

    return {
        httpStatus: 200,
        data: {
            success: false,
            ignored: true,
            code: "SNIPPE_AMOUNT_MISMATCH",
            violation
        }
    };
}

async function processPaymentEvent(event, ip, userAgent) {
    const { order, identifiers } = await resolvePaymentOrderForEvent(event);

    await logPaymentOrderCallback({
        paymentOrderId: order?.id || null,
        externalId: identifiers.externalId || event.externalReference,
        providerRef: identifiers.providerRef || event.providerRef,
        payload: event.payload,
        source: "snippe_webhook",
        gateway: "snippe"
    });

    if (!order) {
        await recordWebhookAudit({
            event,
            action: "SNIPPE_PAYMENT_ORDER_NOT_FOUND",
            afterData: {
                event_type: event.eventType,
                order_id: event.orderId,
                reference: event.reference,
                external_reference: event.externalReference,
                provider_ref: event.providerRef
            },
            ip,
            userAgent
        });

        return {
            httpStatus: 200,
            data: {
                success: false,
                ignored: true,
                code: "PAYMENT_ORDER_NOT_FOUND",
                identifiers
            }
        };
    }

    const violation = validateAmountMatchesOrder(order, event);
    if (violation) {
        return acknowledgeAmountMismatch(order, event, violation, ip, userAgent);
    }

    const updatedOrder = event.eventType === "payment.completed"
        ? await markPaymentOrderCompleted(order, event, ip, userAgent)
        : await markPaymentOrderFailed(order, event, ip, userAgent);

    return {
        httpStatus: 200,
        data: {
            received: true,
            processed: true,
            event_id: event.eventId,
            event_type: event.eventType,
            order_id: updatedOrder.id,
            order_status: updatedOrder.status,
            provider_ref: updatedOrder.provider_ref || null
        }
    };
}

async function processPayoutEvent(event, ip, userAgent) {
    return processSnippeLoanDisbursementPayoutEvent(event, ip, userAgent);
}

async function dispatchWebhookEvent(event, ip, userAgent) {
    switch (event.eventType) {
        case "payment.completed":
        case "payment.failed":
        case "payment.cancelled":
        case "payment.expired":
        case "payment.voided":
            return processPaymentEvent(event, ip, userAgent);
        case "payout.completed":
        case "payout.failed":
            return processPayoutEvent(event, ip, userAgent);
        default:
            logWebhook("warn", "unsupported Snippe webhook event received", {
                eventId: event.eventId,
                eventType: event.eventType
            });
            return {
                httpStatus: 200,
                data: {
                    received: true,
                    processed: false,
                    ignored: true,
                    event_id: event.eventId,
                    event_type: event.eventType,
                    code: "SNIPPE_EVENT_UNSUPPORTED"
                }
            };
    }
}

async function handleWebhook({ body = {}, headers = {}, rawBody = "", ip = null, userAgent = null, source = "public_webhook" }) {
    const rawBodyBuffer = Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.from(String(rawBody || ""), "utf8");

    console.log("[snippe-webhook] headers:", headers);
    console.log("[snippe-webhook] raw body:", rawBodyBuffer.toString("utf8"));

    verifySnippeRequestSignature({ headers, rawBody: rawBodyBuffer });

    const { parsedBody } = parseWebhookJson(rawBodyBuffer);

    const event = extractWebhookEvent(parsedBody, headers);
    if (!event.eventType) {
        return {
            httpStatus: 200,
            data: {
                success: false,
                ignored: true,
                code: "SNIPPE_EVENT_TYPE_MISSING"
            }
        };
    }

    if (!event.eventId) {
        logWebhook("warn", "received Snippe webhook without event id", {
            eventType: event.eventType,
            source
        });
        return {
            httpStatus: 200,
            data: {
                success: false,
                ignored: true,
                code: "SNIPPE_EVENT_ID_MISSING",
                event_type: event.eventType
            }
        };
    }

    const existingEvent = await findWebhookEventByEventId(event.eventId);
    if (existingEvent?.processed_at) {
        return {
            httpStatus: 200,
            data: {
                received: true,
                processed: false,
                duplicate: true,
                event_id: existingEvent.event_id,
                event_type: existingEvent.event_type,
                processed_at: existingEvent.processed_at
            }
        };
    }

    let result;
    try {
        result = await dispatchWebhookEvent(event, ip, userAgent);
        await storeProcessedWebhookEvent(event);
    } catch (error) {
        logWebhook("error", "Snippe webhook processing failed after signature verification", {
            eventId: event.eventId,
            eventType: event.eventType,
            source,
            message: error?.message || error
        });

        return {
            httpStatus: 200,
            data: {
                success: false,
                ignored: false,
                event_id: event.eventId,
                event_type: event.eventType,
                code: "SNIPPE_WEBHOOK_PROCESSING_FAILED"
            }
        };
    }

    logWebhook("info", "processed Snippe webhook", {
        eventId: event.eventId,
        eventType: event.eventType,
        source,
        httpStatus: result.httpStatus || 200
    });

    return result;
}

module.exports = {
    handleWebhook,
    extractWebhookEvent
};
