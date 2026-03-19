const crypto = require("crypto");

const { adminSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const { ROLES } = require("../../constants/roles");
const { normalizePhone } = require("../../services/otp.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");
const AppError = require("../../utils/app-error");
const {
    createCheckout,
    extractCallbackIdentifiers,
    normalizeCallbackStatus
} = require("../../services/azampay.service");
const {
    postGatewayShareContribution,
    postGatewaySavingsDeposit
} = require("../finance/finance.service");

function buildExternalId(orderId) {
    return `saccos_azam_${orderId}`;
}

function buildOrderView(order) {
    const metadata = order.metadata && typeof order.metadata === "object" ? order.metadata : {};
    const member = order.members && typeof order.members === "object" ? order.members : null;
    const account = order.member_accounts && typeof order.member_accounts === "object" ? order.member_accounts : null;
    return {
        id: order.id,
        tenant_id: order.tenant_id,
        member_id: order.member_id,
        account_id: order.account_id,
        gateway: order.gateway,
        purpose: order.purpose,
        provider: order.provider,
        amount: Number(order.amount || 0),
        currency: order.currency,
        status: order.status,
        external_id: order.external_id,
        provider_ref: order.provider_ref,
        description: order.description || null,
        member_name: member?.full_name || metadata.member_name || null,
        member_no: member?.member_no || null,
        branch_id: member?.branch_id || metadata.branch_id || null,
        callback_received_at: order.callback_received_at || null,
        paid_at: order.paid_at || null,
        posted_at: order.posted_at || null,
        failed_at: order.failed_at || null,
        expired_at: order.expired_at || null,
        expires_at: order.expires_at || null,
        journal_id: order.journal_id || null,
        error_code: order.error_code || null,
        error_message: order.error_message || null,
        account_name: account?.account_name || metadata.account_name || null,
        account_number: account?.account_number || metadata.account_number || null,
        product_type: account?.product_type || metadata.product_type || null,
        created_at: order.created_at,
        updated_at: order.updated_at
    };
}

function resolveListPagination(query = {}) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    return {
        page,
        limit,
        from: (page - 1) * limit,
        to: (page - 1) * limit + limit - 1
    };
}

async function getPortalPaymentAccount(actor, tenantId, accountId, expectedProductType) {
    const { data: account, error: accountError } = await adminSupabase
        .from("member_accounts")
        .select("id, tenant_id, member_id, product_type, account_name, account_number")
        .eq("id", accountId)
        .maybeSingle();

    if (accountError) {
        throw new AppError(500, "PAYMENT_ACCOUNT_LOOKUP_FAILED", "Unable to load member account.", accountError);
    }

    if (!account) {
        throw new AppError(404, "PAYMENT_ACCOUNT_NOT_FOUND", "Member account was not found.");
    }

    if (account.tenant_id !== tenantId) {
        throw new AppError(403, "FORBIDDEN", "Account does not belong to the selected tenant.");
    }

    if (expectedProductType && account.product_type !== expectedProductType) {
        throw new AppError(400, "PAYMENT_ACCOUNT_INVALID", `Only ${expectedProductType} account payments are supported for this request.`);
    }

    const { data: member, error: memberError } = await adminSupabase
        .from("members")
        .select("id, tenant_id, user_id, full_name, branch_id")
        .eq("id", account.member_id)
        .is("deleted_at", null)
        .maybeSingle();

    if (memberError) {
        throw new AppError(500, "PAYMENT_MEMBER_LOOKUP_FAILED", "Unable to load member for the selected account.", memberError);
    }

    if (!member) {
        throw new AppError(404, "PAYMENT_MEMBER_NOT_FOUND", "Member was not found for the selected account.");
    }

    if (actor.role === ROLES.MEMBER) {
        if (!actor.profile?.member_id || actor.profile.member_id !== member.id) {
            throw new AppError(403, "FORBIDDEN", "You can only initiate payments for your own member account.");
        }

        if (member.user_id && member.user_id !== actor.user.id) {
            throw new AppError(403, "FORBIDDEN", "This member account is not linked to the signed-in user.");
        }
    }

    return { account, member };
}

async function createPaymentOrder(payload) {
    const { data, error } = await adminSupabase
        .from("payment_orders")
        .insert(payload)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "PAYMENT_ORDER_CREATE_FAILED", "Unable to create payment order.", error);
    }

    return data;
}

async function updatePaymentOrder(orderId, patch) {
    const { data, error } = await adminSupabase
        .from("payment_orders")
        .update({
            ...patch,
            updated_at: new Date().toISOString()
        })
        .eq("id", orderId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "PAYMENT_ORDER_UPDATE_FAILED", "Unable to update payment order.", error);
    }

    return data;
}

async function getPaymentOrderById(orderId) {
    const { data, error } = await adminSupabase
        .from("payment_orders")
        .select("*, members(full_name, member_no, branch_id), member_accounts(account_name, account_number, product_type)")
        .eq("id", orderId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "PAYMENT_ORDER_LOOKUP_FAILED", "Unable to load payment order.", error);
    }

    return data || null;
}

async function listPaymentOrders(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant identifier is required.");
    }

    assertTenantAccess({ auth: actor }, tenantId);
    const pagination = resolveListPagination(query);

    let memberScopeIds = null;
    let memberScopeMap = new Map();

    const mustApplyBranchScope = !actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && Array.isArray(actor.branchIds) && actor.branchIds.length > 0;
    const requestedBranchId = query.branch_id || null;

    if (requestedBranchId) {
        assertBranchAccess({ auth: actor }, requestedBranchId);
    }

    if (mustApplyBranchScope || requestedBranchId) {
        let memberScopeQuery = adminSupabase
            .from("members")
            .select("id, full_name, member_no, branch_id")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null);

        if (requestedBranchId) {
            memberScopeQuery = memberScopeQuery.eq("branch_id", requestedBranchId);
        } else if (mustApplyBranchScope) {
            memberScopeQuery = memberScopeQuery.in("branch_id", actor.branchIds);
        }

        if (query.member_id) {
            memberScopeQuery = memberScopeQuery.eq("id", query.member_id);
        }

        const { data: scopedMembers, error: scopedMembersError } = await memberScopeQuery;
        if (scopedMembersError) {
            throw new AppError(500, "PAYMENT_ORDER_LIST_FAILED", "Unable to apply member payment branch scope.", scopedMembersError);
        }

        memberScopeIds = (scopedMembers || []).map((entry) => entry.id);
        memberScopeMap = new Map((scopedMembers || []).map((entry) => [entry.id, entry]));

        if (!memberScopeIds.length) {
            return {
                data: [],
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total: 0
                }
            };
        }
    }

    let paymentQuery = adminSupabase
        .from("payment_orders")
        .select("*, members(full_name, member_no, branch_id), member_accounts(account_name, account_number, product_type)", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .range(pagination.from, pagination.to);

    if (query.status) {
        paymentQuery = paymentQuery.eq("status", query.status);
    }

    if (query.purpose) {
        paymentQuery = paymentQuery.eq("purpose", query.purpose);
    }

    if (actor.role === ROLES.MEMBER) {
        if (!actor.profile?.member_id) {
            throw new AppError(403, "FORBIDDEN", "Member payment history is not available for this profile.");
        }
        paymentQuery = paymentQuery.eq("member_id", actor.profile.member_id);
    } else if (memberScopeIds) {
        paymentQuery = paymentQuery.in("member_id", memberScopeIds);
    } else if (query.member_id) {
        paymentQuery = paymentQuery.eq("member_id", query.member_id);
    }

    const { data, error, count } = await paymentQuery;

    if (error) {
        throw new AppError(500, "PAYMENT_ORDER_LIST_FAILED", "Unable to load payment orders.", error);
    }

    const orders = (data || []).map((order) => {
        if (!order.members && memberScopeMap.has(order.member_id)) {
            return {
                ...order,
                members: memberScopeMap.get(order.member_id)
            };
        }
        return order;
    });

    return {
        data: orders.map((order) => buildOrderView(order)),
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: count || 0
        }
    };
}

async function logPaymentOrderCallback({ paymentOrderId = null, externalId = null, providerRef = null, payload = {}, source = "callback" }) {
    const { error } = await adminSupabase
        .from("payment_order_callbacks")
        .insert({
            payment_order_id: paymentOrderId,
            gateway: "azampay",
            source,
            external_id: externalId,
            provider_ref: providerRef,
            payload
        });

    if (error) {
        console.warn("[member-payments] callback log failed", { paymentOrderId, externalId, providerRef });
    }
}

async function resolvePaymentOrderFromCallback(payload) {
    const identifiers = extractCallbackIdentifiers(payload);

    if (identifiers.internalOrderId) {
        const direct = await getPaymentOrderById(String(identifiers.internalOrderId));
        if (direct) {
            return { order: direct, identifiers };
        }
    }

    if (identifiers.externalId) {
        const { data, error } = await adminSupabase
            .from("payment_orders")
            .select("*")
            .eq("external_id", String(identifiers.externalId))
            .maybeSingle();

        if (error) {
            throw new AppError(500, "PAYMENT_ORDER_LOOKUP_FAILED", "Unable to resolve payment order by external ID.", error);
        }

        if (data) {
            return { order: data, identifiers };
        }
    }

    if (identifiers.providerRef) {
        const { data, error } = await adminSupabase
            .from("payment_orders")
            .select("*")
            .eq("provider_ref", String(identifiers.providerRef))
            .maybeSingle();

        if (error) {
            throw new AppError(500, "PAYMENT_ORDER_LOOKUP_FAILED", "Unable to resolve payment order by provider reference.", error);
        }

        if (data) {
            return { order: data, identifiers };
        }
    }

    return { order: null, identifiers };
}

async function assertPaymentOrderAccess(actor, order) {
    assertTenantAccess({ auth: actor }, order.tenant_id);

    if (order.members?.branch_id) {
        assertBranchAccess({ auth: actor }, order.members.branch_id);
    }

    if (actor.role === ROLES.MEMBER && actor.profile?.member_id !== order.member_id) {
        throw new AppError(403, "FORBIDDEN", "You do not have access to this payment order.");
    }
}

async function markOrderPostingFailure(orderId, error) {
    try {
        await updatePaymentOrder(orderId, {
            error_code: error?.code || "PAYMENT_POST_FAILED",
            error_message: error?.message || "Unable to post the paid payment order."
        });
    } catch (updateError) {
        console.warn("[member-payments] failed to persist posting error", { orderId });
    }
}

async function postContributionPaymentOrder(order, source = "manual_reconcile") {
    if (!order) {
        throw new AppError(404, "PAYMENT_ORDER_NOT_FOUND", "Payment order was not found.");
    }

    if (order.status === "posted" && order.journal_id) {
        return order;
    }

    if (order.status !== "paid") {
        throw new AppError(409, "PAYMENT_ORDER_NOT_READY", "Only paid payment orders can be posted.");
    }

    try {
        const result = order.purpose === "savings_deposit"
            ? await postGatewaySavingsDeposit(order)
            : await postGatewayShareContribution(order);
        const postedOrder = await updatePaymentOrder(order.id, {
            status: "posted",
            posted_at: order.posted_at || new Date().toISOString(),
            journal_id: result.journal_id || null,
            error_code: null,
            error_message: null
        });

        await logAudit({
            tenantId: postedOrder.tenant_id,
            actorUserId: postedOrder.created_by_user_id,
            table: "payment_orders",
            entityType: "payment_order",
            entityId: postedOrder.id,
            action: "MEMBER_PAYMENT_POSTED",
            afterData: {
                purpose: postedOrder.purpose,
                source,
                journal_id: postedOrder.journal_id || null,
                paid_at: postedOrder.paid_at || null,
                posted_at: postedOrder.posted_at || null
            }
        });

        return postedOrder;
    } catch (error) {
        await markOrderPostingFailure(order.id, error);
        throw error;
    }
}

async function reconcilePaymentOrder(actor, orderId) {
    const order = await getPaymentOrderById(orderId);
    if (!order) {
        throw new AppError(404, "PAYMENT_ORDER_NOT_FOUND", "Payment order was not found.");
    }

    await assertPaymentOrderAccess(actor, order);

    if (order.status === "posted" && order.journal_id) {
        return {
            reconciled: false,
            order: buildOrderView(order)
        };
    }

    if (order.status !== "paid") {
        return {
            reconciled: false,
            order: buildOrderView(order)
        };
    }

    const postedOrder = await postContributionPaymentOrder(order, "manual_reconcile");
    return {
        reconciled: true,
        order: buildOrderView(postedOrder)
    };
}

async function initiatePortalPayment(actor, payload, options) {
    const tenantId = payload.tenant_id || actor.tenantId;
    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant identifier is required.");
    }

    assertTenantAccess({ auth: actor }, tenantId);

    const normalizedPhone = normalizePhone(payload.msisdn);
    const { account, member } = await getPortalPaymentAccount(actor, tenantId, payload.account_id, options.productType);

    const orderId = crypto.randomUUID();
    const externalId = buildExternalId(orderId);
    const expiresAt = new Date(Date.now() + (env.azamPayIntentTtlSeconds * 1000)).toISOString();
    const description = payload.description || `${options.defaultDescriptionPrefix} ${account.account_name || account.account_number}`;

    const createdOrder = await createPaymentOrder({
        id: orderId,
        tenant_id: tenantId,
        member_id: member.id,
        account_id: account.id,
        created_by_user_id: actor.user.id,
        gateway: "azampay",
        purpose: options.purpose,
        provider: payload.provider,
        msisdn: normalizedPhone,
        amount: Number(payload.amount),
        currency: env.azamPayCurrency,
        status: "created",
        external_id: externalId,
        description,
        expires_at: expiresAt,
        metadata: {
            source: "member_portal",
            product_type: account.product_type,
            member_name: member.full_name,
            branch_id: member.branch_id,
            account_number: account.account_number,
            account_name: account.account_name || null
        }
    });

    try {
        const checkout = await createCheckout({
            amount: payload.amount,
            currency: env.azamPayCurrency,
            externalId,
            provider: payload.provider,
            accountNumber: normalizedPhone,
            additionalProperties: {
                source: env.azamPaySourceLabel,
                property1: tenantId,
                property2: orderId,
                property3: member.id
            }
        });

        const pendingOrder = await updatePaymentOrder(orderId, {
            status: "pending",
            provider_ref: checkout.providerRef,
            gateway_request: checkout.requestPayload,
            gateway_response: checkout.responsePayload,
            error_code: null,
            error_message: null
        });

        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "payment_orders",
            entityType: "payment_order",
            entityId: pendingOrder.id,
            action: "MEMBER_PAYMENT_INITIATED",
            afterData: {
                purpose: pendingOrder.purpose,
                amount: Number(pendingOrder.amount || 0),
                provider: pendingOrder.provider,
                account_id: pendingOrder.account_id,
                member_id: pendingOrder.member_id,
                external_id: pendingOrder.external_id,
                provider_ref: pendingOrder.provider_ref || null
            }
        });

        return {
            order: buildOrderView(pendingOrder),
            gateway: {
                provider_ref: pendingOrder.provider_ref || null,
                response: checkout.responsePayload
            }
        };
    } catch (error) {
        if (error?.code === "AZAMPAY_TIMEOUT") {
            const pendingOrder = await updatePaymentOrder(orderId, {
                status: "pending",
                error_code: "AZAMPAY_TIMEOUT",
                error_message: "Azam Pay is taking longer than expected. The order will keep waiting for callback confirmation."
            });

            await logAudit({
                tenantId,
                actorUserId: actor.user.id,
                table: "payment_orders",
                entityType: "payment_order",
                entityId: pendingOrder.id,
                action: "MEMBER_PAYMENT_INITIATION_TIMEOUT",
                afterData: {
                    purpose: pendingOrder.purpose,
                    amount: Number(pendingOrder.amount || 0),
                    error_code: pendingOrder.error_code,
                    error_message: pendingOrder.error_message
                }
            });

            return {
                order: buildOrderView(pendingOrder),
                gateway: {
                    provider_ref: pendingOrder.provider_ref || null,
                    response: {
                        success: false,
                        code: error.code,
                        message: error.message,
                        pending_confirmation: true
                    }
                },
                processing_state: "pending_confirmation"
            };
        }

        const failedOrder = await updatePaymentOrder(orderId, {
            status: "failed",
            failed_at: new Date().toISOString(),
            error_code: error?.code || "AZAMPAY_CHECKOUT_FAILED",
            error_message: error?.message || "Unable to initiate Azam Pay checkout."
        });

        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "payment_orders",
            entityType: "payment_order",
            entityId: failedOrder.id,
            action: "MEMBER_PAYMENT_INITIATION_FAILED",
            afterData: {
                purpose: failedOrder.purpose,
                amount: Number(failedOrder.amount || 0),
                error_code: failedOrder.error_code,
                error_message: failedOrder.error_message
            }
        });

        throw error;
    }
}

async function initiateContributionPayment(actor, payload) {
    return initiatePortalPayment(actor, payload, {
        purpose: "share_contribution",
        productType: "shares",
        defaultDescriptionPrefix: "Member portal share contribution to"
    });
}

async function initiateSavingsPayment(actor, payload) {
    return initiatePortalPayment(actor, payload, {
        purpose: "savings_deposit",
        productType: "savings",
        defaultDescriptionPrefix: "Member portal savings deposit to"
    });
}

async function getPaymentOrderStatus(actor, orderId) {
    const order = await getPaymentOrderById(orderId);
    if (!order) {
        throw new AppError(404, "PAYMENT_ORDER_NOT_FOUND", "Payment order was not found.");
    }

    await assertPaymentOrderAccess(actor, order);

    return {
        order: buildOrderView(order)
    };
}

async function handleAzamCallback({ body = {}, query = {}, headers = {} }) {
    const payload = Object.keys(body || {}).length ? body : query;
    const { order, identifiers } = await resolvePaymentOrderFromCallback(payload || {});

    await logPaymentOrderCallback({
        paymentOrderId: order?.id || null,
        externalId: identifiers.externalId,
        providerRef: identifiers.providerRef,
        payload: {
            headers,
            body: payload
        },
        source: "azam_callback"
    });

    if (!order) {
        return {
            httpStatus: 404,
            data: {
                success: false,
                code: "PAYMENT_ORDER_NOT_FOUND",
                identifiers
            }
        };
    }

    const normalized = normalizeCallbackStatus(payload || {});
    const nowIso = new Date().toISOString();
    const patch = {
        callback_received_at: nowIso,
        latest_callback_payload: payload,
        provider_ref: normalized.providerRef || order.provider_ref,
        error_code: null,
        error_message: null
    };

    if (order.status === "posted") {
        patch.status = "posted";
    } else if (normalized.status === "paid") {
        patch.status = "paid";
        patch.paid_at = order.paid_at || nowIso;
    } else if (order.status === "paid") {
        patch.status = "paid";
        patch.paid_at = order.paid_at || nowIso;
    } else if (normalized.status === "expired") {
        patch.status = "expired";
        patch.expired_at = order.expired_at || nowIso;
        patch.error_code = "AZAMPAY_PAYMENT_EXPIRED";
        patch.error_message = normalized.message || normalized.statusRaw || "Payment session expired.";
    } else if (normalized.status === "failed") {
        patch.status = "failed";
        patch.failed_at = order.failed_at || nowIso;
        patch.error_code = "AZAMPAY_PAYMENT_FAILED";
        patch.error_message = normalized.message || normalized.statusRaw || "Azam Pay reported payment failure.";
    } else {
        patch.status = "pending";
    }

    let updatedOrder = await updatePaymentOrder(order.id, patch);

    if (updatedOrder.status === "paid" && !updatedOrder.posted_at) {
        try {
            updatedOrder = await postContributionPaymentOrder(updatedOrder, "azam_callback");
        } catch (error) {
            console.error("[member-payments] paid order posting failed", {
                orderId: updatedOrder.id,
                error: error?.message || error
            });
        }
    }

    await logAudit({
        tenantId: updatedOrder.tenant_id,
        actorUserId: updatedOrder.created_by_user_id,
        table: "payment_orders",
        entityType: "payment_order",
        entityId: updatedOrder.id,
        action: `MEMBER_PAYMENT_${updatedOrder.status.toUpperCase()}`,
        afterData: {
            status: updatedOrder.status,
            external_id: updatedOrder.external_id,
            provider_ref: updatedOrder.provider_ref || null,
            paid_at: updatedOrder.paid_at || null,
            failed_at: updatedOrder.failed_at || null,
            expired_at: updatedOrder.expired_at || null
        }
    });

    return {
        httpStatus: 200,
        data: {
            success: true,
            order: buildOrderView(updatedOrder),
            normalized_status: normalized.status,
            provider_ref: updatedOrder.provider_ref || null,
            external_id: updatedOrder.external_id
        }
    };
}

module.exports = {
    listPaymentOrders,
    getPaymentOrderStatus,
    handleAzamCallback,
    initiateContributionPayment,
    initiateSavingsPayment,
    reconcilePaymentOrder
};
