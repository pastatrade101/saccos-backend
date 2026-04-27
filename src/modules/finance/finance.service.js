const env = require("../../config/env");
const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");
const { runObservedJob } = require("../../services/observability.service");
const { assertPostingRuleConfigured } = require("../../services/posting-rule.service");
const {
    ensureOpenTellerSession,
    finalizeReceiptsForTransaction,
    recordSessionTransaction
} = require("../cash-control/cash-control.service");
const approvalService = require("../approvals/approvals.service");
const membersService = require("../members/members.service");
const {
    notifyTellerTransactionBlocked,
    notifyTellerTransactionPostFailed
} = require("../../services/branch-alerts.service");

const BLOCKING_ERROR_CODES = new Set([
    "SUBSCRIPTION_INACTIVE",
    "OUT_OF_HOURS_BLOCKED",
    "OUT_OF_HOURS_TRANSACTION_BLOCKED",
    "APPROVAL_REQUEST_PENDING",
    "APPROVAL_REQUEST_REJECTED",
    "APPROVAL_REQUEST_EXPIRED",
    "CASH_CONTROL_POLICY_BLOCKED"
]);

function isLikelyBlockedError(error) {
    const code = String(error?.code || "").trim().toUpperCase();
    if (code && BLOCKING_ERROR_CODES.has(code)) {
        return true;
    }

    const message = String(error?.message || "").toLowerCase();
    return (
        message.includes("blocked")
        || message.includes("out of hours")
        || message.includes("subscription")
        || message.includes("approval request")
    );
}

function isMissingDeletedAtColumn(error) {
    const message = error?.message || "";
    return error?.code === "42703" && message.toLowerCase().includes("deleted_at");
}

function generateTransactionReference(prefix) {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${stamp}-${suffix}`;
}

function resolvePagination(query = {}) {
    if (query.page === undefined && query.limit === undefined) {
        return null;
    }

    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 50;

    return {
        page,
        limit,
        from: (page - 1) * limit,
        to: (page - 1) * limit + limit - 1
    };
}

async function getAccountWithMember(accountId, expectedProductType = null) {
    let { data, error } = await adminSupabase
        .from("member_accounts")
        .select("*")
        .eq("id", accountId)
        .is("deleted_at", null)
        .single();

    if (error && isMissingDeletedAtColumn(error)) {
        ({ data, error } = await adminSupabase
            .from("member_accounts")
            .select("*")
            .eq("id", accountId)
            .single());
    }

    if (error || !data) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "Member account was not found.");
    }

    const { data: member, error: memberError } = await adminSupabase
        .from("members")
        .select("id, branch_id, user_id")
        .eq("id", data.member_id)
        .is("deleted_at", null)
        .single();

    if (memberError || !member) {
        throw new AppError(404, "MEMBER_NOT_FOUND", "Member was not found for this account.");
    }

    if (expectedProductType && data.product_type !== expectedProductType) {
        throw new AppError(400, "INVALID_ACCOUNT_PRODUCT", `Expected a ${expectedProductType} account.`);
    }

    return {
        account: data,
        member
    };
}

async function getLoan(loanId) {
    const { data, error } = await adminSupabase
        .from("loans")
        .select("*")
        .eq("id", loanId)
        .single();

    if (error || !data) {
        throw new AppError(404, "LOAN_NOT_FOUND", "Loan was not found.");
    }

    return data;
}

async function getApprovedLoanApplication(tenantId, applicationId) {
    const { data, error } = await adminSupabase
        .from("loan_applications")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .single();

    if (error || !data) {
        throw new AppError(404, "LOAN_APPLICATION_NOT_FOUND", "Loan application was not found.");
    }

    if (data.status !== "approved") {
        throw new AppError(400, "LOAN_APPLICATION_NOT_APPROVED", "Only approved loan applications can be disbursed.");
    }

    if (data.loan_id) {
        throw new AppError(400, "LOAN_ALREADY_DISBURSED", "This application has already been disbursed.");
    }

    return data;
}

async function runFinancialFunction(functionName, params) {
    const { data, error } = await adminSupabase.rpc(functionName, params);

    if (error) {
        throw new AppError(500, "FINANCIAL_PROCEDURE_FAILED", error.message || "Financial procedure failed.", {
            functionName
        });
    }

    if (data?.success === false) {
        throw new AppError(400, data.code || "FINANCIAL_PROCEDURE_REJECTED", data.message, data);
    }

    return data;
}

async function executeInterestAccrual({ tenantId, asOfDate, actorUserId, auditAction, auditSource }) {
    const resolvedDate = asOfDate || new Date().toISOString().slice(0, 10);
    const result = await runFinancialFunction("interest_accrual", {
        p_tenant_id: tenantId,
        p_as_of_date: resolvedDate,
        p_user_id: actorUserId
    });

    await logAudit({
        tenantId,
        actorUserId,
        table: "journal_entries",
        entityType: "interest_accrual",
        action: auditAction,
        afterData: {
            as_of_date: resolvedDate,
            source: auditSource || "manual",
            processed_loans: Number(result?.processed_loans || 0)
        }
    });

    return result;
}

async function resolveInterestAccrualActorUserId(tenantId) {
    const { data, error } = await adminSupabase
        .from("user_profiles")
        .select("user_id, full_name")
        .eq("tenant_id", tenantId)
        .eq("role", "super_admin")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1);

    if (error) {
        throw new AppError(500, "INTEREST_ACCRUAL_ACTOR_LOOKUP_FAILED", "Unable to resolve scheduler actor for interest accrual.", error);
    }

    return data?.[0] || null;
}

async function deposit(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    const depositReference = payload.reference || generateTransactionReference("DEP");
    assertTenantAccess({ auth: actor }, tenantId);
    await assertPostingRuleConfigured(tenantId, "deposit");

    const { account, member } = await getAccountWithMember(payload.account_id, "savings");
    assertTenantAccess({ auth: actor }, account.tenant_id);
    assertBranchAccess({ auth: actor }, member.branch_id);
    const session = await ensureOpenTellerSession(actor, {
        tenantId,
        branchId: member.branch_id
    });

    const result = await runFinancialFunction("deposit", {
        p_tenant_id: tenantId,
        p_account_id: payload.account_id,
        p_amount: payload.amount,
        p_teller_id: payload.teller_id || actor.user.id,
        p_reference: depositReference,
        p_description: payload.description || null
    });

    await finalizeReceiptsForTransaction(actor, {
        tenantId,
        branchId: member.branch_id,
        memberId: member.id,
        journalId: result.journal_id,
        transactionType: "deposit",
        amount: payload.amount,
        receiptIds: payload.receipt_ids
    });
    await recordSessionTransaction({
        session,
        tenantId,
        branchId: member.branch_id,
        journalId: result.journal_id,
        transactionType: "deposit",
        direction: "in",
        amount: payload.amount,
        userId: actor.user.id
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "journal_entries",
        entityType: "journal_entry",
        entityId: result.journal_id || null,
        action: "DEPOSIT_POSTED",
        afterData: {
            account_id: payload.account_id,
            member_id: member.id,
            amount: payload.amount,
            reference: depositReference,
            journal_id: result.journal_id || null
        }
    });

    return result;
}

async function withdraw(actor, payload, options = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertPostingRuleConfigured(tenantId, "withdrawal");

    const { account, member } = await getAccountWithMember(payload.account_id, "savings");
    assertTenantAccess({ auth: actor }, account.tenant_id);
    assertBranchAccess({ auth: actor }, member.branch_id);
    const session = await ensureOpenTellerSession(actor, {
        tenantId,
        branchId: member.branch_id
    });

    let approvalGate = null;
    try {
        if (!options.skipApprovalGate) {
            approvalGate = await approvalService.ensureOperationApproval({
                actor,
                tenantId,
                branchId: member.branch_id,
                operationKey: "finance.withdraw",
                requestedAmount: payload.amount,
                approvalRequestId: payload.approval_request_id || null,
                payload: {
                    account_id: payload.account_id,
                    amount: payload.amount,
                    reference: payload.reference || null,
                    description: payload.description || null,
                    member_id: member.id,
                    branch_id: member.branch_id
                },
                entityType: "member_account",
                entityId: payload.account_id
            });

            if (approvalGate?.approval_required && approvalGate.status === "pending_approval") {
                return approvalGate;
            }
        }

        const result = await runFinancialFunction("withdraw", {
            p_tenant_id: tenantId,
            p_account_id: payload.account_id,
            p_amount: payload.amount,
            p_teller_id: payload.teller_id || actor.user.id,
            p_reference: payload.reference || null,
            p_description: payload.description || null
        });

        await finalizeReceiptsForTransaction(actor, {
            tenantId,
            branchId: member.branch_id,
            memberId: member.id,
            journalId: result.journal_id,
            transactionType: "withdraw",
            amount: payload.amount,
            receiptIds: payload.receipt_ids
        });
        await recordSessionTransaction({
            session,
            tenantId,
            branchId: member.branch_id,
            journalId: result.journal_id,
            transactionType: "withdraw",
            direction: "out",
            amount: payload.amount,
            userId: actor.user.id
        });

        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "journal_entries",
            entityType: "journal_entry",
            entityId: result.journal_id || null,
            action: "WITHDRAWAL_POSTED",
            afterData: {
                account_id: payload.account_id,
                member_id: member.id,
                amount: payload.amount,
                reference: payload.reference || null,
                journal_id: result.journal_id || null
            }
        });

        if (approvalGate?.approval_required && approvalGate.approval_request_id) {
            await approvalService.markApprovalRequestExecuted({
                actor,
                tenantId,
                requestId: approvalGate.approval_request_id,
                entityType: "journal_entry",
                entityId: result.journal_id || null
            });
        }

        return result;
    } catch (error) {
        if (isLikelyBlockedError(error)) {
            await notifyTellerTransactionBlocked({
                actor,
                tenantId,
                branchId: member.branch_id,
                operation: "withdraw",
                reason: error?.message || "policy restriction"
            });
        } else {
            await notifyTellerTransactionPostFailed({
                actor,
                tenantId,
                branchId: member.branch_id,
                operation: "withdraw",
                amount: payload.amount,
                reason: error?.message || "posting failed"
            });
        }
        throw error;
    }
}

async function shareContribution(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertPostingRuleConfigured(tenantId, "share_purchase");

    const { account, member } = await getAccountWithMember(payload.account_id, "shares");
    assertTenantAccess({ auth: actor }, account.tenant_id);
    assertBranchAccess({ auth: actor }, member.branch_id);
    const session = await ensureOpenTellerSession(actor, {
        tenantId,
        branchId: member.branch_id
    });

    const result = await runFinancialFunction("share_contribution", {
        p_tenant_id: tenantId,
        p_account_id: payload.account_id,
        p_amount: payload.amount,
        p_teller_id: payload.teller_id || actor.user.id,
        p_reference: payload.reference || null,
        p_description: payload.description || null
    });

    await finalizeReceiptsForTransaction(actor, {
        tenantId,
        branchId: member.branch_id,
        memberId: member.id,
        journalId: result.journal_id,
        transactionType: "share_contribution",
        amount: payload.amount,
        receiptIds: payload.receipt_ids
    });
    await recordSessionTransaction({
        session,
        tenantId,
        branchId: member.branch_id,
        journalId: result.journal_id,
        transactionType: "share_contribution",
        direction: "in",
        amount: payload.amount,
        userId: actor.user.id
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "member_account_transactions",
        entityType: "member_account_transaction",
        action: "share_contribution",
        afterData: {
            account_id: payload.account_id,
            member_id: member.id,
            amount: payload.amount,
            journal_id: result.journal_id,
            reference: payload.reference || null
        }
    });

    return result;
}

async function postGatewayShareContribution(paymentOrder) {
    const tenantId = paymentOrder.tenant_id;
    await assertPostingRuleConfigured(tenantId, "share_purchase");

    const { account, member } = await getAccountWithMember(paymentOrder.account_id, "shares");
    assertTenantAccess({ auth: { tenantId } }, account.tenant_id);

    if (member.id !== paymentOrder.member_id) {
        throw new AppError(409, "PAYMENT_ORDER_MEMBER_MISMATCH", "Payment order member does not match the selected share account.");
    }

    const result = await runFinancialFunction("share_contribution", {
        p_tenant_id: tenantId,
        p_account_id: paymentOrder.account_id,
        p_amount: Number(paymentOrder.amount),
        p_teller_id: paymentOrder.created_by_user_id,
        p_reference: paymentOrder.provider_ref || paymentOrder.external_id || paymentOrder.id,
        p_description: paymentOrder.description || "Member portal share contribution via mobile money"
    });

    await logAudit({
        tenantId,
        actorUserId: paymentOrder.created_by_user_id,
        table: "member_account_transactions",
        entityType: "member_account_transaction",
        entityId: result.journal_id || null,
        action: "gateway_share_contribution",
        afterData: {
            payment_order_id: paymentOrder.id,
            account_id: paymentOrder.account_id,
            member_id: member.id,
            amount: Number(paymentOrder.amount || 0),
            journal_id: result.journal_id || null,
            reference: paymentOrder.provider_ref || paymentOrder.external_id || paymentOrder.id
        }
    });

    await membersService.applyMembershipFeePayment(
        paymentOrder.member_id,
        Number(paymentOrder.amount || 0),
        paymentOrder.created_by_user_id
    );

    return result;
}

async function postGatewaySavingsDeposit(paymentOrder) {
    const tenantId = paymentOrder.tenant_id;
    await assertPostingRuleConfigured(tenantId, "deposit");

    const { account, member } = await getAccountWithMember(paymentOrder.account_id, "savings");
    assertTenantAccess({ auth: { tenantId } }, account.tenant_id);

    if (member.id !== paymentOrder.member_id) {
        throw new AppError(409, "PAYMENT_ORDER_MEMBER_MISMATCH", "Payment order member does not match the selected savings account.");
    }

    const result = await runFinancialFunction("deposit", {
        p_tenant_id: tenantId,
        p_account_id: paymentOrder.account_id,
        p_amount: Number(paymentOrder.amount),
        p_teller_id: paymentOrder.created_by_user_id,
        p_reference: paymentOrder.provider_ref || paymentOrder.external_id || paymentOrder.id,
        p_description: paymentOrder.description || "Member portal savings deposit via mobile money"
    });

    await logAudit({
        tenantId,
        actorUserId: paymentOrder.created_by_user_id,
        table: "journal_entries",
        entityType: "journal_entry",
        entityId: result.journal_id || null,
        action: "gateway_savings_deposit",
        afterData: {
            payment_order_id: paymentOrder.id,
            account_id: paymentOrder.account_id,
            member_id: member.id,
            amount: Number(paymentOrder.amount || 0),
            journal_id: result.journal_id || null,
            reference: paymentOrder.provider_ref || paymentOrder.external_id || paymentOrder.id
        }
    });

    return result;
}

async function postGatewayMembershipFee(paymentOrder) {
    const tenantId = paymentOrder.tenant_id;
    await assertPostingRuleConfigured(tenantId, "membership_fee");

    const { account, member } = await getAccountWithMember(paymentOrder.account_id);
    assertTenantAccess({ auth: { tenantId } }, account.tenant_id);

    if (member.id !== paymentOrder.member_id) {
        throw new AppError(409, "PAYMENT_ORDER_MEMBER_MISMATCH", "Payment order member does not match the selected account.");
    }

    let entryDate = null;
    if (paymentOrder.paid_at) {
        const parsed = new Date(paymentOrder.paid_at);
        if (!Number.isNaN(parsed.getTime())) {
            entryDate = parsed.toISOString().slice(0, 10);
        }
    }
    if (!entryDate) {
        entryDate = new Date().toISOString().slice(0, 10);
    }

    const { data, error } = await adminSupabase.rpc("post_membership_fee", {
        p_tenant_id: tenantId,
        p_member_id: member.id,
        p_branch_id: member.branch_id,
        p_amount: Number(paymentOrder.amount),
        p_user_id: paymentOrder.created_by_user_id,
        p_reference: paymentOrder.external_id || paymentOrder.id,
        p_description: paymentOrder.description || "Membership fee payment",
        p_entry_date: entryDate
    });

    if (error) {
        throw new AppError(
            500,
            "MEMBERSHIP_FEE_POST_FAILED",
            "Unable to post the membership fee payment.",
            error
        );
    }

    await membersService.applyMembershipFeePayment(
        member.id,
        Number(paymentOrder.amount || 0),
        paymentOrder.created_by_user_id
    );

    const journalId = Array.isArray(data) ? (data[0] || null) : data || null;
    return {
        journal_id: journalId
    };
}

async function postGatewayLoanRepayment(paymentOrder) {
    const tenantId = paymentOrder.tenant_id;
    await assertPostingRuleConfigured(tenantId, "loan_repay_principal");
    await assertPostingRuleConfigured(tenantId, "loan_repay_interest");

    if (!paymentOrder.loan_id) {
        throw new AppError(400, "PAYMENT_ORDER_TARGET_MISSING", "Loan repayment payment order is missing its loan target.");
    }

    const loan = await getLoan(paymentOrder.loan_id);
    assertTenantAccess({ auth: { tenantId } }, loan.tenant_id);

    if (loan.member_id !== paymentOrder.member_id) {
        throw new AppError(409, "PAYMENT_ORDER_MEMBER_MISMATCH", "Payment order member does not match the selected loan.");
    }

    const repaymentReference = paymentOrder.provider_ref || paymentOrder.external_id || paymentOrder.id;
    const result = await runFinancialFunction("loan_repayment", {
        p_tenant_id: tenantId,
        p_loan_id: paymentOrder.loan_id,
        p_amount: Number(paymentOrder.amount),
        p_user_id: paymentOrder.created_by_user_id,
        p_reference: repaymentReference,
        p_description: paymentOrder.description || "Member portal loan repayment via mobile money"
    });

    await logAudit({
        tenantId,
        actorUserId: paymentOrder.created_by_user_id,
        table: "loans",
        entityType: "loan",
        entityId: paymentOrder.loan_id,
        action: "gateway_loan_repayment",
        afterData: {
            payment_order_id: paymentOrder.id,
            loan_id: paymentOrder.loan_id,
            member_id: loan.member_id,
            amount: Number(paymentOrder.amount || 0),
            journal_id: result.journal_id || null,
            interest_component: result.interest_component || null,
            principal_component: result.principal_component || null,
            reference: repaymentReference
        }
    });

    return {
        ...result,
        reference: repaymentReference
    };
}

async function dividendAllocation(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertPostingRuleConfigured(tenantId, "dividend_reinvest_shares");

    const { account, member } = await getAccountWithMember(payload.account_id, "shares");
    assertTenantAccess({ auth: actor }, account.tenant_id);
    assertBranchAccess({ auth: actor }, member.branch_id);

    const result = await runFinancialFunction("dividend_allocation", {
        p_tenant_id: tenantId,
        p_account_id: payload.account_id,
        p_amount: payload.amount,
        p_user_id: payload.user_id || actor.user.id,
        p_reference: payload.reference || null,
        p_description: payload.description || null
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "member_account_transactions",
        entityType: "member_account_transaction",
        action: "dividend_allocation",
        afterData: {
            account_id: payload.account_id,
            member_id: member.id,
            amount: payload.amount,
            journal_id: result.journal_id,
            reference: payload.reference || null
        }
    });

    return result;
}

async function transfer(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertPostingRuleConfigured(tenantId, "withdrawal");
    await assertPostingRuleConfigured(tenantId, "deposit");

    const source = await getAccountWithMember(payload.from_account, "savings");
    const destination = await getAccountWithMember(payload.to_account, "savings");

    assertBranchAccess({ auth: actor }, source.member.branch_id);
    assertBranchAccess({ auth: actor }, destination.member.branch_id);

    const result = await runFinancialFunction("transfer", {
        p_tenant_id: tenantId,
        p_from_account: payload.from_account,
        p_to_account: payload.to_account,
        p_amount: payload.amount,
        p_user_id: payload.user_id || actor.user.id,
        p_reference: payload.reference || null,
        p_description: payload.description || null
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "journal_entries",
        entityType: "journal_entry",
        entityId: result.journal_id || null,
        action: "TRANSFER_POSTED",
        afterData: {
            from_account: payload.from_account,
            to_account: payload.to_account,
            amount: payload.amount,
            reference: payload.reference || null,
            journal_id: result.journal_id || null
        }
    });

    return result;
}

async function loanDisburse(actor, payload, options = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    let effectivePayload = { ...payload };

    if (!options.skipWorkflow) {
        if (!payload.application_id) {
            throw new AppError(403, "LOAN_APPLICATION_REQUIRED", "An approved loan application is required before disbursement.");
        }

        const application = await getApprovedLoanApplication(tenantId, payload.application_id);
        effectivePayload = {
            ...effectivePayload,
            tenant_id: application.tenant_id,
            member_id: application.member_id,
            branch_id: application.branch_id,
            principal_amount: application.recommended_amount || application.requested_amount,
            annual_interest_rate: application.recommended_interest_rate || application.requested_interest_rate || 0,
            term_count: application.recommended_term_count || application.requested_term_count,
            repayment_frequency: application.recommended_repayment_frequency || application.requested_repayment_frequency
        };
    }

    assertBranchAccess({ auth: actor }, effectivePayload.branch_id);
    await assertPostingRuleConfigured(tenantId, "loan_disburse");
    await assertPostingRuleConfigured(tenantId, "loan_fee");
    const session = options.skipCashControl
        ? null
        : await ensureOpenTellerSession(actor, {
            tenantId,
            branchId: effectivePayload.branch_id
        });

    let approvalGate = null;
    try {
        if (!options.skipApprovalGate) {
            approvalGate = await approvalService.ensureOperationApproval({
                actor,
                tenantId,
                branchId: effectivePayload.branch_id,
                operationKey: "finance.loan_disburse",
                requestedAmount: effectivePayload.principal_amount,
                approvalRequestId: effectivePayload.approval_request_id || null,
                payload: {
                    application_id: effectivePayload.application_id || null,
                    member_id: effectivePayload.member_id,
                    branch_id: effectivePayload.branch_id,
                    principal_amount: effectivePayload.principal_amount,
                    annual_interest_rate: effectivePayload.annual_interest_rate,
                    term_count: effectivePayload.term_count,
                    repayment_frequency: effectivePayload.repayment_frequency,
                    reference: effectivePayload.reference || null,
                    description: effectivePayload.description || null
                },
                entityType: "loan_application",
                entityId: effectivePayload.application_id || null
            });

            if (approvalGate?.approval_required && approvalGate.status === "pending_approval") {
                return approvalGate;
            }
        }

        const result = await runFinancialFunction("loan_disburse", {
            p_tenant_id: tenantId,
            p_member_id: effectivePayload.member_id,
            p_branch_id: effectivePayload.branch_id,
            p_principal_amount: effectivePayload.principal_amount,
            p_annual_interest_rate: effectivePayload.annual_interest_rate,
            p_term_count: effectivePayload.term_count,
            p_repayment_frequency: effectivePayload.repayment_frequency,
            p_disbursed_by: effectivePayload.disbursed_by || actor.user.id,
            p_reference: effectivePayload.reference || null,
            p_description: effectivePayload.description || null
        });

        if (!options.skipCashControl) {
            await finalizeReceiptsForTransaction(actor, {
                tenantId,
                branchId: effectivePayload.branch_id,
                memberId: effectivePayload.member_id,
                journalId: result.journal_id,
                transactionType: "loan_disburse",
                amount: effectivePayload.principal_amount,
                receiptIds: effectivePayload.receipt_ids
            });
            await recordSessionTransaction({
                session,
                tenantId,
                branchId: effectivePayload.branch_id,
                journalId: result.journal_id,
                transactionType: "loan_disburse",
                direction: "out",
                amount: effectivePayload.principal_amount,
                userId: actor.user.id
            });
        }

        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "loans",
            entityType: "loan",
            entityId: result.loan_id || null,
            action: "LOAN_DISBURSED",
            afterData: {
                application_id: effectivePayload.application_id || null,
                member_id: effectivePayload.member_id,
                branch_id: effectivePayload.branch_id,
                principal_amount: effectivePayload.principal_amount,
                reference: effectivePayload.reference || null,
                journal_id: result.journal_id || null,
                loan_id: result.loan_id || null,
                loan_number: result.loan_number || null
            }
        });

        if (approvalGate?.approval_required && approvalGate.approval_request_id) {
            await approvalService.markApprovalRequestExecuted({
                actor,
                tenantId,
                requestId: approvalGate.approval_request_id,
                entityType: "loan",
                entityId: result.loan_id || null
            });
        }

        return result;
    } catch (error) {
        if (isLikelyBlockedError(error)) {
            await notifyTellerTransactionBlocked({
                actor,
                tenantId,
                branchId: effectivePayload.branch_id,
                operation: "loan_disburse",
                reason: error?.message || "policy restriction"
            });
        } else {
            await notifyTellerTransactionPostFailed({
                actor,
                tenantId,
                branchId: effectivePayload.branch_id,
                operation: "loan_disburse",
                amount: effectivePayload.principal_amount,
                reason: error?.message || "posting failed"
            });
        }
        throw error;
    }
}

async function loanRepay(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertPostingRuleConfigured(tenantId, "loan_repay_principal");
    await assertPostingRuleConfigured(tenantId, "loan_repay_interest");

    const loan = await getLoan(payload.loan_id);
    assertTenantAccess({ auth: actor }, loan.tenant_id);
    assertBranchAccess({ auth: actor }, loan.branch_id);
    const session = await ensureOpenTellerSession(actor, {
        tenantId,
        branchId: loan.branch_id
    });
    const repaymentReference = payload.reference || generateTransactionReference("LRP");

    const result = await runFinancialFunction("loan_repayment", {
        p_tenant_id: tenantId,
        p_loan_id: payload.loan_id,
        p_amount: payload.amount,
        p_user_id: payload.user_id || actor.user.id,
        p_reference: repaymentReference,
        p_description: payload.description || null
    });

    await finalizeReceiptsForTransaction(actor, {
        tenantId,
        branchId: loan.branch_id,
        memberId: loan.member_id,
        journalId: result.journal_id,
        transactionType: "loan_repay",
        amount: payload.amount,
        receiptIds: payload.receipt_ids
    });
    await recordSessionTransaction({
        session,
        tenantId,
        branchId: loan.branch_id,
        journalId: result.journal_id,
        transactionType: "loan_repay",
        direction: "in",
        amount: payload.amount,
        userId: actor.user.id
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loans",
        entityType: "loan",
        entityId: payload.loan_id,
        action: "LOAN_REPAYMENT_POSTED",
        afterData: {
            loan_id: payload.loan_id,
            amount: payload.amount,
            reference: repaymentReference,
            journal_id: result.journal_id || null,
            interest_component: result.interest_component || null
        }
    });

    return {
        ...result,
        reference: repaymentReference
    };
}

async function accrueInterest(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    return executeInterestAccrual({
        tenantId,
        asOfDate: payload.as_of_date,
        actorUserId: payload.user_id || actor.user.id,
        auditAction: "INTEREST_ACCRUAL_POSTED",
        auditSource: "manual"
    });
}

async function runInterestAccrualForTenant({ tenantId, asOfDate = null, source = "scheduler" }) {
    const actor = await resolveInterestAccrualActorUserId(tenantId);

    if (!actor?.user_id) {
        return {
            tenant_id: tenantId,
            success: false,
            skipped: true,
            code: "INTEREST_ACCRUAL_ACTOR_NOT_FOUND",
            message: "No active super admin is available to post scheduled interest accrual.",
            processed_loans: 0
        };
    }

    const result = await executeInterestAccrual({
        tenantId,
        asOfDate,
        actorUserId: actor.user_id,
        auditAction: "INTEREST_ACCRUAL_SCHEDULED_POSTED",
        auditSource: source
    });

    return {
        tenant_id: tenantId,
        actor_user_id: actor.user_id,
        actor_name: actor.full_name || null,
        success: Boolean(result?.success !== false),
        skipped: false,
        processed_loans: Number(result?.processed_loans || 0),
        message: result?.message || "Interest accrual completed."
    };
}

async function runScheduledInterestAccrual() {
    const { data: tenants, error } = await adminSupabase
        .from("tenants")
        .select("id")
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(env.interestAccrualMaxTenantsPerRun);

    if (error) {
        throw new AppError(500, "TENANTS_LOOKUP_FAILED", "Unable to load tenants for scheduled interest accrual.", error);
    }

    const summaries = [];
    for (const tenant of tenants || []) {
        try {
            const summary = await runObservedJob(
                "finance.interest_accrual",
                { tenantId: tenant.id },
                () => runInterestAccrualForTenant({
                    tenantId: tenant.id,
                    asOfDate: new Date().toISOString().slice(0, 10),
                    source: "scheduler"
                })
            );
            summaries.push(summary);
        } catch (tenantError) {
            console.error("[interest-accrual] tenant cycle failed", {
                tenant_id: tenant.id,
                code: tenantError?.code,
                message: tenantError?.message
            });
            summaries.push({
                tenant_id: tenant.id,
                success: false,
                skipped: false,
                code: tenantError?.code || "INTEREST_ACCRUAL_SCHEDULER_FAILED",
                message: tenantError?.message || "Scheduled interest accrual failed.",
                processed_loans: 0
            });
        }
    }

    return {
        tenants_scanned: summaries.length,
        tenants_failed: summaries.filter((summary) => summary.success === false && !summary.skipped).length,
        tenants_skipped: summaries.filter((summary) => summary.skipped).length,
        summaries
    };
}

async function closePeriod(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const result = await runFinancialFunction("closing_procedure", {
        p_tenant_id: tenantId,
        p_period_end_date: payload.period_end_date,
        p_user_id: payload.user_id || actor.user.id
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "period_closures",
        entityType: "period_closure",
        action: "PERIOD_CLOSED",
        afterData: {
            period_end_date: payload.period_end_date
        }
    });

    return result;
}

async function getStatements(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = resolvePagination(query);
    let statementQuery = adminSupabase
        .from("member_statement_view")
        .select("*", pagination ? { count: "exact" } : undefined)
        .eq("tenant_id", tenantId)
        .order("transaction_date", { ascending: false });

    if (actor.role === "member") {
        const { data: ownMember, error: ownMemberError } = await adminSupabase
            .from("members")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("user_id", actor.user.id)
            .is("deleted_at", null)
            .single();

        if (ownMemberError || !ownMember) {
            throw new AppError(404, "MEMBER_NOT_FOUND", "Linked member record was not found.");
        }

        statementQuery = statementQuery.eq("member_id", ownMember.id);
    }

    if (query.account_id) {
        const { member } = await getAccountWithMember(query.account_id);
        assertBranchAccess({ auth: actor }, member.branch_id);
        statementQuery = statementQuery.eq("account_id", query.account_id);
    }

    if (query.member_id) {
        const { data: member, error } = await adminSupabase
            .from("members")
            .select("id, branch_id, user_id")
            .eq("id", query.member_id)
            .single();

        if (error || !member) {
            throw new AppError(404, "MEMBER_NOT_FOUND", "Member was not found.");
        }

        if (actor.role === "member" && member.user_id !== actor.user.id) {
            throw new AppError(403, "FORBIDDEN", "Members can only access their own statement.");
        }

        if (actor.role !== "member") {
            assertBranchAccess({ auth: actor }, member.branch_id);
        }
        statementQuery = statementQuery.eq("member_id", query.member_id);
    }

    if (query.from_date) {
        statementQuery = statementQuery.gte("transaction_date", query.from_date);
    }

    if (query.to_date) {
        statementQuery = statementQuery.lte("transaction_date", query.to_date);
    }

    if (pagination) {
        statementQuery = statementQuery.range(pagination.from, pagination.to);
    }

    const { data, error, count } = await statementQuery;

    if (error) {
        throw new AppError(500, "STATEMENT_FETCH_FAILED", "Unable to load statements.", error);
    }

    return {
        data: data || [],
        pagination: pagination
            ? {
                page: pagination.page,
                limit: pagination.limit,
                total: count || 0
            }
            : null
    };
}

async function getLedger(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = resolvePagination(query);
    let ledgerQuery = adminSupabase
        .from("ledger_entries_view")
        .select("*", pagination ? { count: "exact" } : undefined)
        .eq("tenant_id", tenantId)
        .order("entry_date", { ascending: false });

    if (query.from_date) {
        ledgerQuery = ledgerQuery.gte("entry_date", query.from_date);
    }

    if (query.to_date) {
        ledgerQuery = ledgerQuery.lte("entry_date", query.to_date);
    }

    if (query.account_id) {
        ledgerQuery = ledgerQuery.eq("account_id", query.account_id);
    }

    if (pagination) {
        ledgerQuery = ledgerQuery.range(pagination.from, pagination.to);
    }

    const { data, error, count } = await ledgerQuery;

    if (error) {
        throw new AppError(500, "LEDGER_FETCH_FAILED", "Unable to load ledger.", error);
    }

    return {
        data: data || [],
        pagination: pagination
            ? {
                page: pagination.page,
                limit: pagination.limit,
                total: count || 0
            }
            : null
    };
}

async function getLoans(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = resolvePagination(query);
    let loanQuery = adminSupabase
        .from("loans")
        .select("*", pagination ? { count: "exact" } : undefined)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    if (actor.role === "member") {
        const { data: ownMember, error: ownMemberError } = await adminSupabase
            .from("members")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("user_id", actor.user.id)
            .is("deleted_at", null)
            .single();

        if (ownMemberError || !ownMember) {
            throw new AppError(404, "MEMBER_NOT_FOUND", "Linked member record was not found.");
        }

        loanQuery = loanQuery.eq("member_id", ownMember.id);
    } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        loanQuery = loanQuery.in("branch_id", actor.branchIds);
    }

    if (query.member_id) {
        const { data: member, error } = await adminSupabase
            .from("members")
            .select("id, branch_id, user_id")
            .eq("id", query.member_id)
            .single();

        if (error || !member) {
            throw new AppError(404, "MEMBER_NOT_FOUND", "Member was not found.");
        }

        if (actor.role === "member" && member.user_id !== actor.user.id) {
            throw new AppError(403, "FORBIDDEN", "Members can only access their own loans.");
        }

        if (actor.role !== "member") {
            assertBranchAccess({ auth: actor }, member.branch_id);
        }
        loanQuery = loanQuery.eq("member_id", query.member_id);
    }

    if (query.branch_id) {
        if (actor.role === ROLES.MEMBER) {
            const { data: ownMember, error: ownMemberError } = await adminSupabase
                .from("members")
                .select("branch_id")
                .eq("tenant_id", tenantId)
                .eq("user_id", actor.user.id)
                .is("deleted_at", null)
                .single();

            if (ownMemberError || !ownMember) {
                throw new AppError(404, "MEMBER_NOT_FOUND", "Linked member record was not found.");
            }

            if (ownMember.branch_id !== query.branch_id) {
                throw new AppError(403, "BRANCH_ACCESS_DENIED", "You cannot access this branch.");
            }
        } else {
            assertBranchAccess({ auth: actor }, query.branch_id);
        }
        loanQuery = loanQuery.eq("branch_id", query.branch_id);
    }

    if (query.loan_id) {
        loanQuery = loanQuery.eq("id", query.loan_id);
    }

    if (query.status) {
        loanQuery = loanQuery.eq("status", query.status);
    }

    if (pagination) {
        loanQuery = loanQuery.range(pagination.from, pagination.to);
    }

    const { data, error, count } = await loanQuery;

    if (error) {
        throw new AppError(500, "LOANS_FETCH_FAILED", "Unable to load loans.", error);
    }

    return {
        data: data || [],
        pagination: pagination
            ? {
                page: pagination.page,
                limit: pagination.limit,
                total: count || 0
            }
            : null
    };
}

async function getLoanSchedules(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = resolvePagination(query);
    let visibleLoanIds = null;

    if (actor.role === "member") {
        const ownLoans = await getLoans(actor, { tenant_id: tenantId });
        visibleLoanIds = ownLoans.data.map((loan) => loan.id);
    } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        const visibleLoans = await getLoans(actor, { tenant_id: tenantId });
        visibleLoanIds = visibleLoans.data.map((loan) => loan.id);
    }

    let scheduleQuery = adminSupabase
        .from("loan_schedules")
        .select("*", pagination ? { count: "exact" } : undefined)
        .eq("tenant_id", tenantId)
        .order("due_date", { ascending: true });

    if (visibleLoanIds) {
        if (!visibleLoanIds.length) {
            return {
                data: [],
                pagination: pagination
                    ? { page: pagination.page, limit: pagination.limit, total: 0 }
                    : null
            };
        }

        scheduleQuery = scheduleQuery.in("loan_id", visibleLoanIds);
    }

    if (query.loan_id) {
        const loan = await getLoan(query.loan_id);
        assertTenantAccess({ auth: actor }, loan.tenant_id);
        assertBranchAccess({ auth: actor }, loan.branch_id);
        scheduleQuery = scheduleQuery.eq("loan_id", query.loan_id);
    }

    if (query.status) {
        scheduleQuery = scheduleQuery.eq("status", query.status);
    }

    if (pagination) {
        scheduleQuery = scheduleQuery.range(pagination.from, pagination.to);
    }

    const { data, error, count } = await scheduleQuery;

    if (error) {
        throw new AppError(500, "LOAN_SCHEDULES_FETCH_FAILED", "Unable to load loan schedules.", error);
    }

    return {
        data: data || [],
        pagination: pagination
            ? {
                page: pagination.page,
                limit: pagination.limit,
                total: count || 0
            }
            : null
    };
}

async function getLoanTransactions(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = resolvePagination(query);
    let transactionQuery = adminSupabase
        .from("loan_account_transactions")
        .select("*", pagination ? { count: "exact" } : undefined)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    let visibleLoanIds = null;

    if (actor.role === "member") {
        const ownLoans = await getLoans(actor, { tenant_id: tenantId });
        visibleLoanIds = ownLoans.data.map((loan) => loan.id);
    } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        const visibleLoans = await getLoans(actor, { tenant_id: tenantId });
        visibleLoanIds = visibleLoans.data.map((loan) => loan.id);
    }

    if (visibleLoanIds) {
        if (!visibleLoanIds.length) {
            return {
                data: [],
                pagination: pagination
                    ? { page: pagination.page, limit: pagination.limit, total: 0 }
                    : null
            };
        }

        transactionQuery = transactionQuery.in("loan_id", visibleLoanIds);
    }

    if (query.loan_id) {
        const loan = await getLoan(query.loan_id);
        assertTenantAccess({ auth: actor }, loan.tenant_id);
        assertBranchAccess({ auth: actor }, loan.branch_id);
        transactionQuery = transactionQuery.eq("loan_id", query.loan_id);
    }

    if (pagination) {
        transactionQuery = transactionQuery.range(pagination.from, pagination.to);
    }

    const { data, error, count } = await transactionQuery;

    if (error) {
        throw new AppError(500, "LOAN_TRANSACTIONS_FETCH_FAILED", "Unable to load loan transactions.", error);
    }

    return {
        data: data || [],
        pagination: pagination
            ? {
                page: pagination.page,
                limit: pagination.limit,
                total: count || 0
            }
            : null
    };
}

module.exports = {
    deposit,
    withdraw,
    shareContribution,
    postGatewayShareContribution,
    postGatewaySavingsDeposit,
    postGatewayMembershipFee,
    postGatewayLoanRepayment,
    dividendAllocation,
    transfer,
    loanDisburse,
    loanRepay,
    accrueInterest,
    runInterestAccrualForTenant,
    runScheduledInterestAccrual,
    closePeriod,
    getStatements,
    getLedger,
    getLoans,
    getLoanSchedules,
    getLoanTransactions
};
