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
const membersService = require("../members/members.service");
const {
    postGatewayShareContribution,
    postGatewaySavingsDeposit,
    postGatewayMembershipFee,
    postGatewayLoanRepayment
} = require("../finance/finance.service");

function isMissingPaymentOrderRelationError(error) {
    const code = String(error?.code || "");
    return code === "PGRST205" || code === "42P01" || code === "42703";
}

function wrapPaymentOrderError(statusCode, code, fallbackMessage, error) {
    if (isMissingPaymentOrderRelationError(error)) {
        return new AppError(
            503,
            "PAYMENT_ORDER_SCHEMA_MISSING",
            "Payment orders are not available because database migration 060_phase5_member_payment_orders.sql has not been applied.",
            error
        );
    }

    if (error?.code === "23502" && typeof error?.message === "string" && error.message.includes("account_id")) {
        return new AppError(
            503,
            "PAYMENT_ORDER_SCHEMA_OUTDATED",
            "Loan repayment payment orders require database migration 070_member_payment_orders_loan_repayment.sql.",
            error
        );
    }

    return new AppError(statusCode, code, fallbackMessage, error);
}

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
        account_id: order.account_id || null,
        loan_id: order.loan_id || null,
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
        loan_number: metadata.loan_number || null,
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

function isMissingColumnError(error, columnName) {
    return error?.code === "PGRST204"
        && typeof error?.message === "string"
        && error.message.includes(`'${columnName}'`);
}

async function resolveActorMember(actor, tenantId) {
    if (actor.profile?.member_id) {
        const { data, error } = await adminSupabase
            .from("members")
            .select("id, tenant_id, user_id, full_name, branch_id")
            .eq("tenant_id", tenantId)
            .eq("id", actor.profile.member_id)
            .is("deleted_at", null)
            .maybeSingle();

        if (error) {
            throw new AppError(500, "PAYMENT_MEMBER_LOOKUP_FAILED", "Unable to resolve the linked member.", error);
        }

        if (data) {
            return data;
        }
    }

    let { data, error } = await adminSupabase
        .from("members")
        .select("id, tenant_id, user_id, full_name, branch_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", actor.user.id)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "PAYMENT_MEMBER_LOOKUP_FAILED", "Unable to resolve the linked member.", error);
    }

    if (data) {
        return data;
    }

    let applicationQuery = adminSupabase
        .from("member_applications")
        .select("approved_member_id")
        .eq("tenant_id", tenantId)
        .eq("auth_user_id", actor.user.id)
        .is("deleted_at", null)
        .not("approved_member_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    ({ data, error } = await applicationQuery);

    if (isMissingColumnError(error, "auth_user_id")) {
        applicationQuery = adminSupabase
            .from("member_applications")
            .select("approved_member_id")
            .eq("tenant_id", tenantId)
            .eq("created_by", actor.user.id)
            .is("deleted_at", null)
            .not("approved_member_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        ({ data, error } = await applicationQuery);
    }

    if (error) {
        throw new AppError(500, "PAYMENT_MEMBER_LOOKUP_FAILED", "Unable to resolve the approved member record.", error);
    }

    if (!data?.approved_member_id) {
        throw new AppError(404, "PAYMENT_MEMBER_NOT_FOUND", "Member was not found for this portal profile.");
    }

    const { data: member, error: memberError } = await adminSupabase
        .from("members")
        .select("id, tenant_id, user_id, full_name, branch_id")
        .eq("tenant_id", tenantId)
        .eq("id", data.approved_member_id)
        .is("deleted_at", null)
        .maybeSingle();

    if (memberError || !member) {
        throw new AppError(500, "PAYMENT_MEMBER_LOOKUP_FAILED", "Unable to load the approved member record.");
    }

    return member;
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
        const ownMember = await resolveActorMember(actor, tenantId);
        if (ownMember.id !== member.id) {
            throw new AppError(403, "FORBIDDEN", "You can only initiate payments for your own member account.");
        }

        if (member.user_id && member.user_id !== actor.user.id) {
            throw new AppError(403, "FORBIDDEN", "This member account is not linked to the signed-in user.");
        }
    }

    return { account, member };
}

async function resolvePortalPaymentAccount(actor, tenantId, accountId = null, expectedProductType, purposeLabel) {
    if (accountId) {
        return getPortalPaymentAccount(actor, tenantId, accountId, expectedProductType);
    }

    const member = actor.role === ROLES.MEMBER
        ? await resolveActorMember(actor, tenantId)
        : null;

    if (!member) {
        throw new AppError(400, "PAYMENT_ACCOUNT_REQUIRED", `A ${expectedProductType} account is required for ${purposeLabel}.`);
    }

    let { data: account, error: accountError } = await adminSupabase
        .from("member_accounts")
        .select("id, tenant_id, member_id, product_type, account_name, account_number")
        .eq("tenant_id", tenantId)
        .eq("member_id", member.id)
        .eq("product_type", expectedProductType)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (accountError) {
        throw new AppError(500, "PAYMENT_ACCOUNT_LOOKUP_FAILED", `Unable to load a ${expectedProductType} account for ${purposeLabel}.`, accountError);
    }

    if (!account) {
        await membersService.ensureMemberAccounts({
            tenantId,
            branchId: member.branch_id,
            member
        });

        ({ data: account, error: accountError } = await adminSupabase
            .from("member_accounts")
            .select("id, tenant_id, member_id, product_type, account_name, account_number")
            .eq("tenant_id", tenantId)
            .eq("member_id", member.id)
            .eq("product_type", expectedProductType)
            .eq("status", "active")
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle());

        if (accountError) {
            throw new AppError(500, "PAYMENT_ACCOUNT_LOOKUP_FAILED", `Unable to provision a ${expectedProductType} account for ${purposeLabel}.`, accountError);
        }
    }

    if (!account) {
        throw new AppError(404, "PAYMENT_ACCOUNT_NOT_FOUND", `No ${expectedProductType} account is available for ${purposeLabel}.`);
    }

    return { account, member };
}

async function resolvePortalRepaymentLoan(actor, tenantId, loanId) {
    const member = await resolveActorMember(actor, tenantId);
    const { data: loan, error } = await adminSupabase
        .from("loans")
        .select("id, tenant_id, member_id, branch_id, loan_number, status, outstanding_principal, accrued_interest")
        .eq("tenant_id", tenantId)
        .eq("id", loanId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "PAYMENT_LOAN_LOOKUP_FAILED", "Unable to load the selected loan.", error);
    }

    if (!loan) {
        throw new AppError(404, "PAYMENT_LOAN_NOT_FOUND", "The selected loan was not found.");
    }

    if (loan.member_id !== member.id) {
        throw new AppError(403, "FORBIDDEN", "You can only repay your own loan from the member portal.");
    }

    if (!["active", "in_arrears"].includes(String(loan.status))) {
        throw new AppError(409, "LOAN_REPAYMENT_UNAVAILABLE", "Only active or in-arrears loans can be repaid.");
    }

    const outstandingBalance = Math.max(Number(loan.outstanding_principal || 0) + Number(loan.accrued_interest || 0), 0);
    if (outstandingBalance <= 0) {
        throw new AppError(409, "LOAN_ALREADY_CLEARED", "This loan no longer has an outstanding balance.");
    }

    return {
        member,
        loan,
        outstandingBalance
    };
}

async function createPaymentOrder(payload) {
    const { data, error } = await adminSupabase
        .from("payment_orders")
        .insert(payload)
        .select("*")
        .single();

    if (error || !data) {
        throw wrapPaymentOrderError(500, "PAYMENT_ORDER_CREATE_FAILED", "Unable to create payment order.", error);
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
        throw wrapPaymentOrderError(500, "PAYMENT_ORDER_UPDATE_FAILED", "Unable to update payment order.", error);
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
        throw wrapPaymentOrderError(500, "PAYMENT_ORDER_LOOKUP_FAILED", "Unable to load payment order.", error);
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
    let ownMember = null;

    const mustApplyBranchScope = !actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && Array.isArray(actor.branchIds) && actor.branchIds.length > 0;
    const requestedBranchId = query.branch_id || null;

    if (requestedBranchId) {
        if (actor.role === ROLES.MEMBER) {
            ownMember = await resolveActorMember(actor, tenantId);
            if (ownMember.branch_id && ownMember.branch_id !== requestedBranchId) {
                throw new AppError(403, "BRANCH_ACCESS_DENIED", "You cannot access this branch.");
            }
        } else {
            assertBranchAccess({ auth: actor }, requestedBranchId);
        }
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
        ownMember = ownMember || await resolveActorMember(actor, tenantId);
        paymentQuery = paymentQuery.eq("member_id", ownMember.id);
    } else if (memberScopeIds) {
        paymentQuery = paymentQuery.in("member_id", memberScopeIds);
    } else if (query.member_id) {
        paymentQuery = paymentQuery.eq("member_id", query.member_id);
    }

    const { data, error, count } = await paymentQuery;

    if (error) {
        throw wrapPaymentOrderError(500, "PAYMENT_ORDER_LIST_FAILED", "Unable to load payment orders.", error);
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
            throw wrapPaymentOrderError(500, "PAYMENT_ORDER_LOOKUP_FAILED", "Unable to resolve payment order by external ID.", error);
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
            throw wrapPaymentOrderError(500, "PAYMENT_ORDER_LOOKUP_FAILED", "Unable to resolve payment order by provider reference.", error);
        }

        if (data) {
            return { order: data, identifiers };
        }
    }

    return { order: null, identifiers };
}

async function assertPaymentOrderAccess(actor, order) {
    assertTenantAccess({ auth: actor }, order.tenant_id);

    if (actor.role === ROLES.MEMBER) {
        const ownMember = await resolveActorMember(actor, order.tenant_id);
        if (ownMember.id !== order.member_id) {
            throw new AppError(403, "FORBIDDEN", "You do not have access to this payment order.");
        }
        return;
    }

    if (order.members?.branch_id) {
        assertBranchAccess({ auth: actor }, order.members.branch_id);
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
        let result;
        if (order.purpose === "savings_deposit") {
            result = await postGatewaySavingsDeposit(order);
        } else if (order.purpose === "share_contribution") {
            result = await postGatewayShareContribution(order);
        } else if (order.purpose === "membership_fee") {
            result = await postGatewayMembershipFee(order);
        } else if (order.purpose === "loan_repayment") {
            result = await postGatewayLoanRepayment(order);
        } else {
            throw new AppError(400, "PAYMENT_PURPOSE_UNSUPPORTED", "Unsupported payment purpose.");
        }
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
    const { account, member } = await resolvePortalPaymentAccount(
        actor,
        tenantId,
        payload.account_id || null,
        options.productType,
        options.purposeLabel || options.purpose
    );

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
        purposeLabel: "share contribution payment",
        defaultDescriptionPrefix: "Member portal share contribution to"
    });
}

async function initiateSavingsPayment(actor, payload) {
    return initiatePortalPayment(actor, payload, {
        purpose: "savings_deposit",
        productType: "savings",
        purposeLabel: "savings deposit",
        defaultDescriptionPrefix: "Member portal savings deposit to"
    });
}

async function initiateMembershipFeePayment(actor, payload) {
    return initiatePortalPayment(actor, payload, {
        purpose: "membership_fee",
        productType: "savings",
        purposeLabel: "membership fee payment",
        defaultDescriptionPrefix: "Membership fee payment to"
    });
}

async function initiateLoanRepaymentPayment(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant identifier is required.");
    }

    assertTenantAccess({ auth: actor }, tenantId);

    const normalizedPhone = normalizePhone(payload.msisdn);
    const { member, loan, outstandingBalance } = await resolvePortalRepaymentLoan(actor, tenantId, payload.loan_id);
    const amount = Number(payload.amount);

    if (amount > outstandingBalance + 0.01) {
        throw new AppError(
            400,
            "LOAN_REPAYMENT_AMOUNT_EXCEEDS_BALANCE",
            `Repayment amount cannot exceed the outstanding balance of ${outstandingBalance.toFixed(2)}.`
        );
    }

    const orderId = crypto.randomUUID();
    const externalId = buildExternalId(orderId);
    const expiresAt = new Date(Date.now() + (env.azamPayIntentTtlSeconds * 1000)).toISOString();
    const description = payload.description || `Member portal loan repayment for ${loan.loan_number}`;

    await createPaymentOrder({
        id: orderId,
        tenant_id: tenantId,
        member_id: member.id,
        account_id: null,
        loan_id: loan.id,
        created_by_user_id: actor.user.id,
        gateway: "azampay",
        purpose: "loan_repayment",
        provider: payload.provider,
        msisdn: normalizedPhone,
        amount,
        currency: env.azamPayCurrency,
        status: "created",
        external_id: externalId,
        description,
        expires_at: expiresAt,
        metadata: {
            source: "member_portal",
            member_name: member.full_name,
            branch_id: member.branch_id,
            loan_number: loan.loan_number,
            loan_status: loan.status,
            outstanding_principal: Number(loan.outstanding_principal || 0),
            accrued_interest: Number(loan.accrued_interest || 0),
            outstanding_balance: outstandingBalance
        }
    });

    try {
        const checkout = await createCheckout({
            amount,
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
                loan_id: pendingOrder.loan_id || null,
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
    initiateMembershipFeePayment,
    initiateLoanRepaymentPayment,
    reconcilePaymentOrder
};
