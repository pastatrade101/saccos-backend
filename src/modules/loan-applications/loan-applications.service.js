const { randomUUID } = require("crypto");
const env = require("../../config/env");
const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { getSubscriptionStatus } = require("../../services/subscription.service");
const { normalizePhone } = require("../../services/otp.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");
const approvalService = require("../approvals/approvals.service");
const {
    notifyLoanOfficerGuarantorDeclined,
    notifyMemberLoanApplicationApproved,
    notifyMemberLoanApplicationRejected,
    notifyMemberLoanDisbursed,
    notifyBranchManagersLoanDisbursed,
    notifyLoanOfficersApprovedForDisbursement,
    notifyLoanOfficersNewApplication,
    notifyLoanOfficersReappraisalNeeded
} = require("../../services/branch-alerts.service");
const financeService = require("../finance/finance.service");
const creditRiskService = require("../credit-risk/credit-risk.service");
const loanCapacityService = require("../loan-capacity/loan-capacity.service");
const { ensureMemberAccounts } = require("../members/members.service");
const { createPayoutIntent, getPayoutStatus } = require("../../services/snippe.service");
const { assertTwoFactorStepUp } = require("../../services/two-factor.service");
const AppError = require("../../utils/app-error");
const LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS = Math.max(0, Number(process.env.LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS || 15000));
const loanApplicationsCountCache = new Map();
const loanApplicationsCountInFlight = new Map();
const SUPPORTED_REPAYMENT_FREQUENCIES = ["daily", "weekly", "monthly"];
const LOAN_PURPOSE_PATTERN = /^[A-Za-z0-9\s,.]+$/;
const APPLICATION_REFERENCE_PATTERN = /^[A-Za-z0-9_-]+$/;
const OPEN_MOBILE_DISBURSEMENT_STATUSES = new Set(["created", "pending", "completed"]);

const LOAN_APPLICATION_LIST_COLUMNS = `
    id,
    tenant_id,
    branch_id,
    member_id,
    product_id,
    external_reference,
    purpose,
    requested_amount,
    contribution_limit,
    product_limit,
    liquidity_limit,
    borrow_limit,
    borrow_utilization_percent,
    liquidity_status,
    capacity_captured_at,
    requested_term_count,
    requested_repayment_frequency,
    requested_interest_rate,
    created_via,
    status,
    requested_by,
    requested_on_behalf_by,
    submitted_at,
    appraised_by,
    appraised_at,
    appraisal_notes,
    risk_rating,
    recommended_amount,
    recommended_term_count,
    recommended_interest_rate,
    recommended_repayment_frequency,
    required_approval_count,
    approval_count,
    approval_cycle,
    approval_notes,
    approved_by,
    approved_at,
    disbursement_ready_at,
    rejected_by,
    rejected_at,
    rejection_reason,
    disbursed_by,
    disbursed_at,
    loan_id,
    created_at,
    updated_at,
    members(id, full_name, member_no, branch_id, user_id),
    loan_products(id, code, name)
`;

function isMissingDeletedAtColumn(error) {
    const message = error?.message || "";
    return error?.code === "42703" && message.toLowerCase().includes("deleted_at");
}

function isMissingColumnError(error, columnName) {
    return error?.code === "PGRST204"
        && typeof error?.message === "string"
        && error.message.includes(`'${columnName}'`);
}

function isMissingLoanDisbursementRelationError(error) {
    const code = String(error?.code || "");
    return code === "PGRST205" || code === "42P01" || code === "42703";
}

function wrapLoanDisbursementOrderError(statusCode, code, fallbackMessage, error) {
    if (isMissingLoanDisbursementRelationError(error)) {
        return new AppError(
            503,
            "LOAN_DISBURSEMENT_SCHEMA_MISSING",
            "Loan mobile disbursement requires database migration 086_loan_mobile_disbursement_orders.sql.",
            error
        );
    }

    return new AppError(statusCode, code, fallbackMessage, error);
}

function buildLoanDisbursementExternalId(orderId) {
    return `saccos_loan_disb_${orderId}`;
}

function normalizePayoutStatus(rawStatus) {
    const normalized = String(rawStatus || "").trim().toLowerCase();

    if (["completed", "success", "successful", "paid"].includes(normalized)) {
        return "completed";
    }

    if (["failed", "rejected", "cancelled", "canceled", "declined"].includes(normalized)) {
        return "failed";
    }

    if (["expired"].includes(normalized)) {
        return "expired";
    }

    return "pending";
}

function buildLoanDisbursementOrderView(order) {
    const metadata = order?.metadata && typeof order.metadata === "object" ? order.metadata : {};
    const member = order?.members && typeof order.members === "object" ? order.members : null;

    return {
        id: order.id,
        tenant_id: order.tenant_id,
        branch_id: order.branch_id,
        application_id: order.application_id,
        member_id: order.member_id,
        created_by_user_id: order.created_by_user_id,
        approval_request_id: order.approval_request_id || null,
        gateway: order.gateway,
        channel: order.channel,
        provider: order.provider || null,
        msisdn: order.msisdn,
        amount: Number(order.amount || 0),
        currency: order.currency,
        status: order.status,
        external_id: order.external_id,
        provider_ref: order.provider_ref || null,
        reference: order.reference || null,
        description: order.description || null,
        member_name: member?.full_name || metadata.member_name || null,
        member_no: member?.member_no || metadata.member_no || null,
        callback_received_at: order.callback_received_at || null,
        completed_at: order.completed_at || null,
        posted_at: order.posted_at || null,
        failed_at: order.failed_at || null,
        expired_at: order.expired_at || null,
        expires_at: order.expires_at || null,
        loan_id: order.loan_id || null,
        journal_id: order.journal_id || null,
        error_code: order.error_code || null,
        error_message: order.error_message || null,
        latest_provider_status: metadata.latest_provider_status || null,
        created_at: order.created_at,
        updated_at: order.updated_at
    };
}

function stripHtml(value) {
    return String(value || "")
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeLoanPurpose(value) {
    return normalizeWhitespace(stripHtml(value));
}

function sanitizeApplicationReference(value) {
    return normalizeWhitespace(stripHtml(value));
}

function toPositiveNumber(value, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}

function roundPercent(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return Math.round(parsed * 100) / 100;
}

function deriveLiquidityStatus(summary) {
    if (!summary) {
        return "unknown";
    }

    if (summary.loan_pool_frozen) {
        return "frozen";
    }

    const totalDeposits = Number(summary.total_deposits || 0);
    const availableForLoans = Number(summary.available_for_loans || 0);
    const liquidityRatio = totalDeposits > 0 ? availableForLoans / totalDeposits : 0;

    if (liquidityRatio > 0.4) {
        return "healthy";
    }

    if (liquidityRatio >= 0.2) {
        return "warning";
    }

    return "risk";
}

function buildCapacitySnapshot(summary, requestedAmount) {
    const borrowLimit = Number(summary?.borrow_limit || 0);
    const requested = Number(requestedAmount || 0);
    return {
        contribution_limit: Number(summary?.contribution_limit || 0),
        product_limit: Number(summary?.product_limit || 0),
        liquidity_limit: Number(summary?.liquidity_limit || 0),
        borrow_limit: borrowLimit,
        borrow_utilization_percent: borrowLimit > 0 ? roundPercent((requested / borrowLimit) * 100) : null,
        liquidity_status: deriveLiquidityStatus(summary),
        capacity_captured_at: new Date().toISOString()
    };
}

function getEligibilityRuleNumber(rules, keys, fallback = null) {
    for (const key of keys) {
        if (rules && Object.prototype.hasOwnProperty.call(rules, key)) {
            const parsed = toPositiveNumber(rules[key], fallback);
            if (parsed !== null) {
                return parsed;
            }
        }
    }

    return fallback;
}

function getEligibilityRuleFrequencies(rules) {
    const candidates = [
        rules?.allowed_repayment_frequencies,
        rules?.allowedRepaymentFrequencies,
        rules?.repayment_frequencies,
        rules?.repaymentFrequencies
    ];

    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) {
            continue;
        }

        const normalized = candidate
            .map((value) => String(value || "").trim().toLowerCase())
            .filter((value) => SUPPORTED_REPAYMENT_FREQUENCIES.includes(value));

        if (normalized.length) {
            return Array.from(new Set(normalized));
        }
    }

    return [...SUPPORTED_REPAYMENT_FREQUENCIES];
}

function resolveLoanProductPolicy(product) {
    const rules = product?.eligibility_rules_json || {};

    return {
        allowedRepaymentFrequencies: getEligibilityRuleFrequencies(rules),
        savingsMultiplier: getEligibilityRuleNumber(rules, [
            "savings_multiplier",
            "savingsMultiplier",
            "savings_balance_multiplier",
            "savingsBalanceMultiplier",
            "savings_eligibility_multiplier",
            "savingsEligibilityMultiplier"
        ], 1),
        sharesMultiplier: getEligibilityRuleNumber(rules, [
            "share_multiplier",
            "shareMultiplier",
            "shares_multiplier",
            "sharesMultiplier",
            "share_balance_multiplier",
            "shareBalanceMultiplier",
            "shares_balance_multiplier",
            "sharesBalanceMultiplier",
            "share_eligibility_multiplier",
            "shareEligibilityMultiplier"
        ], 1),
        baseEligibilityAmount: getEligibilityRuleNumber(rules, [
            "base_eligibility_amount",
            "baseEligibilityAmount"
        ], 0),
        eligibilityCapAmount: getEligibilityRuleNumber(rules, [
            "eligibility_cap_amount",
            "eligibilityCapAmount",
            "max_eligible_amount",
            "maxEligibleAmount"
        ], null)
    };
}

async function getMemberEligibilityBalances(tenantId, memberId) {
    const member = await getMemberRecord(tenantId, memberId);
    await ensureMemberAccounts({
        tenantId,
        branchId: member.branch_id,
        member
    });

    let { data, error } = await adminSupabase
        .from("member_accounts")
        .select("id, product_type, available_balance")
        .eq("tenant_id", tenantId)
        .eq("member_id", memberId)
        .eq("status", "active")
        .is("deleted_at", null);

    if (error && isMissingDeletedAtColumn(error)) {
        ({ data, error } = await adminSupabase
            .from("member_accounts")
            .select("id, product_type, available_balance")
            .eq("tenant_id", tenantId)
            .eq("member_id", memberId)
            .eq("status", "active"));
    }

    if (error) {
        throw new AppError(500, "MEMBER_ACCOUNTS_LOOKUP_FAILED", "Unable to load member accounts for loan eligibility.", error);
    }

    const accounts = data || [];
    const accountIds = accounts.map((account) => account.id).filter(Boolean);
    const latestRunningBalanceByAccountId = new Map();

    if (accountIds.length) {
        const { data: transactions, error: transactionError } = await adminSupabase
            .from("member_account_transactions")
            .select("member_account_id, running_balance, created_at")
            .eq("tenant_id", tenantId)
            .in("member_account_id", accountIds)
            .order("created_at", { ascending: false });

        if (transactionError) {
            throw new AppError(
                500,
                "MEMBER_ACCOUNT_TRANSACTIONS_LOOKUP_FAILED",
                "Unable to load member account transactions for loan eligibility.",
                transactionError
            );
        }

        for (const transaction of transactions || []) {
            if (!latestRunningBalanceByAccountId.has(transaction.member_account_id)) {
                latestRunningBalanceByAccountId.set(
                    transaction.member_account_id,
                    Number(transaction.running_balance || 0)
                );
            }
        }
    }

    return accounts.reduce((summary, account) => {
        const balance = latestRunningBalanceByAccountId.has(account.id)
            ? Number(latestRunningBalanceByAccountId.get(account.id) || 0)
            : Number(account.available_balance || 0);
        if (account.product_type === "savings") {
            summary.savingsBalance += balance;
        } else if (account.product_type === "shares") {
            summary.sharesBalance += balance;
        }

        return summary;
    }, { savingsBalance: 0, sharesBalance: 0 });
}

function calculateEligibleLoanAmount(product, balances) {
    const policy = resolveLoanProductPolicy(product);
    let eligibleAmount = Number(policy.baseEligibilityAmount || 0)
        + Number(balances.savingsBalance || 0) * Number(policy.savingsMultiplier || 0)
        + Number(balances.sharesBalance || 0) * Number(policy.sharesMultiplier || 0);

    if (policy.eligibilityCapAmount !== null) {
        eligibleAmount = Math.min(eligibleAmount, policy.eligibilityCapAmount);
    }

    if (product.max_amount) {
        eligibleAmount = Math.min(eligibleAmount, Number(product.max_amount));
    }

    return {
        eligibleAmount: Math.max(0, eligibleAmount),
        policy
    };
}

async function assertNoProblemLoans(tenantId, memberId) {
    const { count, error } = await adminSupabase
        .from("loans")
        .select("id", { head: true, count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("member_id", memberId)
        .in("status", ["in_arrears", "written_off"]);

    if (error) {
        throw new AppError(500, "LOAN_STATUS_LOOKUP_FAILED", "Unable to verify existing loan performance.", error);
    }

    if ((count || 0) > 0) {
        throw new AppError(
            409,
            "MEMBER_HAS_DEFAULTED_LOANS",
            "Members with defaulted or in-arrears loans cannot submit a new loan application."
        );
    }
}

async function assertNoOpenApplicationForMember(tenantId, memberId, excludeApplicationId = null) {
    let builder = adminSupabase
        .from("loan_applications")
        .select("id", { head: true, count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("member_id", memberId)
        .in("status", ["submitted", "appraised", "approved"]);

    if (excludeApplicationId) {
        builder = builder.neq("id", excludeApplicationId);
    }

    const { count, error } = await builder;

    if (error) {
        throw new AppError(500, "LOAN_APPLICATION_CONFLICT_LOOKUP_FAILED", "Unable to verify other loan applications for this product.", error);
    }

    if ((count || 0) > 0) {
        throw new AppError(
            409,
            "PENDING_LOAN_APPLICATION_EXISTS",
            "You already have another open loan application."
        );
    }
}

async function assertLoanApplicationPolicy({
    tenantId,
    member,
    product,
    branchId,
    applicationId = null,
    requestedAmount,
    requestedTermCount,
    requestedRepaymentFrequency,
    guarantors = [],
    collateralItems = [],
    enforceSubmissionGuards = false
}) {
    if (member.status !== "active") {
        throw new AppError(409, "MEMBER_NOT_ACTIVE", "Only active members can apply for loans.");
    }

    const minimumTerm = Math.max(1, Number(product.min_term_count || 1));
    const maximumTerm = product.max_term_count ? Number(product.max_term_count) : null;
    if (Number(requestedTermCount) < minimumTerm || (maximumTerm && Number(requestedTermCount) > maximumTerm)) {
        throw new AppError(
            400,
            "LOAN_TERM_OUT_OF_RANGE",
            maximumTerm
                ? `Loan term must be between ${minimumTerm} and ${maximumTerm} months.`
                : `Loan term must be at least ${minimumTerm} months.`
        );
    }

    const { allowedRepaymentFrequencies } = resolveLoanProductPolicy(product);
    if (!allowedRepaymentFrequencies.includes(requestedRepaymentFrequency)) {
        throw new AppError(
            400,
            "LOAN_REPAYMENT_FREQUENCY_INVALID",
            "Selected repayment frequency is not available for this loan product.",
            { allowed_repayment_frequencies: allowedRepaymentFrequencies }
        );
    }
    const capacitySummary = await loanCapacityService.evaluateBorrowCapacity({
        tenantId,
        member,
        loanProduct: product,
        branchId,
        requestedAmount,
        source: enforceSubmissionGuards ? "loan_application_submit_validation" : "loan_application_draft_validation"
    });

    if (capacitySummary.loan_pool_frozen) {
        throw new AppError(
            409,
            "LOAN_POOL_TEMPORARILY_EXHAUSTED",
            "SACCO loan pool temporarily exhausted. Please try again later.",
            {
                allowed_limit: capacitySummary.borrow_limit,
                liquidity_limit: capacitySummary.liquidity_limit
            }
        );
    }

    if (Number(requestedAmount) < capacitySummary.minimum_loan_amount) {
        throw new AppError(
            400,
            "LOAN_AMOUNT_BELOW_MINIMUM",
            `Requested amount must be at least ${loanCapacityService.formatCurrency(capacitySummary.minimum_loan_amount)}.`,
            {
                minimum_amount: capacitySummary.minimum_loan_amount,
                allowed_limit: capacitySummary.borrow_limit
            }
        );
    }

    if (Number(requestedAmount) > capacitySummary.borrow_limit) {
        throw new AppError(
            400,
            "LOAN_BORROW_LIMIT_EXCEEDED",
            "Requested loan exceeds allowed borrowing capacity",
            {
                allowed_limit: capacitySummary.borrow_limit,
                contribution_limit: capacitySummary.contribution_limit,
                product_limit: capacitySummary.product_limit,
                liquidity_limit: capacitySummary.liquidity_limit
            }
        );
    }

    if (enforceSubmissionGuards) {
        await assertNoProblemLoans(tenantId, member.id);
        await assertNoOpenApplicationForMember(tenantId, member.id, applicationId);
    }

    return {
        capacitySummary,
        allowedRepaymentFrequencies,
        minimumAmount: capacitySummary.minimum_loan_amount,
        minimumTerm,
        maximumTerm
    };
}

function sanitizeLoanApplicationPayload(payload = {}) {
    const purpose = sanitizeLoanPurpose(payload.purpose);
    if (purpose.length < 20) {
        throw new AppError(400, "LOAN_PURPOSE_TOO_SHORT", "Loan purpose must be at least 20 characters.");
    }

    if (purpose.length > 500) {
        throw new AppError(400, "LOAN_PURPOSE_TOO_LONG", "Loan purpose cannot exceed 500 characters.");
    }

    if (!LOAN_PURPOSE_PATTERN.test(purpose)) {
        throw new AppError(400, "LOAN_PURPOSE_INVALID", "Loan purpose may contain only letters, numbers, spaces, commas, and periods.");
    }

    const externalReference = payload.external_reference ? sanitizeApplicationReference(payload.external_reference) : null;
    if (externalReference && externalReference.length > 100) {
        throw new AppError(400, "APPLICATION_REFERENCE_TOO_LONG", "Application reference cannot exceed 100 characters.");
    }

    if (externalReference && !APPLICATION_REFERENCE_PATTERN.test(externalReference)) {
        throw new AppError(400, "APPLICATION_REFERENCE_INVALID", "Application reference may contain only letters, numbers, dashes, and underscores.");
    }

    return {
        ...payload,
        purpose,
        external_reference: externalReference || null
    };
}

async function generateUniqueLoanApplicationReference(tenantId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = `LAPP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
        const { count, error } = await adminSupabase
            .from("loan_applications")
            .select("id", { head: true, count: "exact" })
            .eq("tenant_id", tenantId)
            .eq("external_reference", candidate);

        if (error) {
            throw new AppError(500, "LOAN_APPLICATION_REFERENCE_LOOKUP_FAILED", "Unable to generate a unique loan application reference.", error);
        }

        if ((count || 0) === 0) {
            return candidate;
        }
    }

    throw new AppError(500, "LOAN_APPLICATION_REFERENCE_GENERATION_FAILED", "Unable to generate a unique loan application reference.");
}

async function getActiveLoanProduct(tenantId, productId) {
    const { data, error } = await adminSupabase
        .from("loan_products")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", productId)
        .is("deleted_at", null)
        .eq("status", "active")
        .single();

    if (error || !data) {
        throw new AppError(404, "LOAN_PRODUCT_NOT_FOUND", "Loan product was not found.");
    }

    return data;
}

async function getMemberRecord(tenantId, memberId) {
    const { data, error } = await adminSupabase
        .from("members")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", memberId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        throw new AppError(404, "MEMBER_NOT_FOUND", "Member was not found.");
    }

    return data;
}

async function getMemberByUser(tenantId, userId) {
    let { data: profile, error: profileError } = await adminSupabase
        .from("user_profiles")
        .select("member_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .maybeSingle();

    if (profileError) {
        throw new AppError(500, "MEMBER_PROFILE_LOOKUP_FAILED", "Unable to resolve member linkage for this account.", profileError);
    }

    if (profile?.member_id) {
        return getMemberRecord(tenantId, profile.member_id);
    }

    let { data, error } = await adminSupabase
        .from("members")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "MEMBER_PROFILE_LOOKUP_FAILED", "Unable to resolve member profile for this account.", error);
    }

    if (data) {
        return data;
    }

    let applicationQuery = adminSupabase
        .from("member_applications")
        .select("approved_member_id")
        .eq("tenant_id", tenantId)
        .eq("auth_user_id", userId)
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
            .eq("created_by", userId)
            .is("deleted_at", null)
            .not("approved_member_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        ({ data, error } = await applicationQuery);
    }

    if (error) {
        throw new AppError(500, "MEMBER_PROFILE_LOOKUP_FAILED", "Unable to resolve approved member linkage for this account.", error);
    }

    if (data?.approved_member_id) {
        return getMemberRecord(tenantId, data.approved_member_id);
    }

    if (!data) {
        throw new AppError(404, "MEMBER_PROFILE_NOT_FOUND", "Member profile was not found for this account.");
    }

    return data;
}

async function getApprovalRequirement(tenantId) {
    const [subscription, { data: policy, error: policyError }] = await Promise.all([
        getSubscriptionStatus(tenantId),
        adminSupabase.from("loan_policy_settings").select("*").eq("tenant_id", tenantId).maybeSingle()
    ]);

    if (policyError) {
        throw new AppError(500, "LOAN_POLICY_LOOKUP_FAILED", "Unable to load loan policy settings.", policyError);
    }

    const multiApprovalEnabled = Boolean(subscription.features?.multi_approval_enabled);
    const committeeCount = Number(policy?.committee_approval_count || 1);

    return {
        multiApprovalEnabled,
        requiredApprovalCount: multiApprovalEnabled && Boolean(policy?.multi_approval_required)
            ? Math.max(2, committeeCount)
            : 1
    };
}

async function replaceChildren(applicationId, tenantId, guarantors = [], collateralItems = []) {
    await adminSupabase.from("loan_guarantors").delete().eq("application_id", applicationId);
    await adminSupabase.from("collateral_items").delete().eq("application_id", applicationId);

    if (guarantors.length) {
        const { error } = await adminSupabase.from("loan_guarantors").insert(
            guarantors.map((row) => ({
                application_id: applicationId,
                tenant_id: tenantId,
                member_id: row.member_id,
                guaranteed_amount: row.guaranteed_amount || 0,
                notes: row.notes || null
            }))
        );

        if (error) {
            throw new AppError(500, "LOAN_GUARANTORS_SAVE_FAILED", "Unable to save loan guarantors.", error);
        }
    }

    if (collateralItems.length) {
        const { error } = await adminSupabase.from("collateral_items").insert(
            collateralItems.map((row) => ({
                application_id: applicationId,
                tenant_id: tenantId,
                collateral_type: row.collateral_type,
                description: row.description,
                valuation_amount: row.valuation_amount || 0,
                lien_reference: row.lien_reference || null,
                documents_json: row.documents_json || []
            }))
        );

        if (error) {
            throw new AppError(500, "COLLATERAL_SAVE_FAILED", "Unable to save collateral items.", error);
        }
    }
}

function getGuarantorMember(row) {
    if (!row?.members) {
        return null;
    }

    return Array.isArray(row.members) ? (row.members[0] || null) : row.members;
}

function attachGuarantorConsentReference(application) {
    const guarantors = Array.isArray(application?.loan_guarantors) ? application.loan_guarantors : [];
    const normalizedGuarantors = guarantors.map((row) => {
        const member = getGuarantorMember(row);
        return {
            ...row,
            guarantor_name: member?.full_name || row?.guarantor_name || null,
            guarantorName: member?.full_name || row?.guarantor_name || null
        };
    });
    const acceptedCount = normalizedGuarantors.filter((row) => row.consent_status === "accepted").length;
    const rejectedCount = normalizedGuarantors.filter((row) => row.consent_status === "rejected").length;
    const pendingCount = normalizedGuarantors.filter((row) => row.consent_status !== "accepted" && row.consent_status !== "rejected").length;
    const totalCount = normalizedGuarantors.length;
    const referenceNames = normalizedGuarantors
        .map((row) => row.guarantor_name)
        .filter(Boolean);
    const referenceLabel = referenceNames.length ? referenceNames.join(", ") : "No guarantors";
    const consentSummary = `${acceptedCount}/${totalCount} accepted - ${referenceLabel}`;

    return {
        ...application,
        loan_guarantors: normalizedGuarantors,
        guarantor_consent_reference: normalizedGuarantors.map((row) => ({
            member_id: row.member_id,
            guarantor_name: row.guarantor_name || null,
            guarantorName: row.guarantor_name || null,
            member_name: row.guarantor_name || null,
            consent_status: row.consent_status || "pending"
        })),
        guarantor_consent_summary: consentSummary,
        guarantor_consent: consentSummary,
        guarantorConsent: consentSummary,
        guarantor_reference_names: referenceNames,
        guarantorReferenceNames: referenceNames,
        guarantor_consent_counts: {
            accepted: acceptedCount,
            rejected: rejectedCount,
            pending: pendingCount,
            total: totalCount
        },
        guarantorConsentCounts: {
            accepted: acceptedCount,
            rejected: rejectedCount,
            pending: pendingCount,
            total: totalCount
        }
    };
}

async function createLoanDisbursementOrder(record) {
    const { data, error } = await adminSupabase
        .from("loan_disbursement_orders")
        .insert(record)
        .select("*")
        .single();

    if (error || !data) {
        throw wrapLoanDisbursementOrderError(
            500,
            "LOAN_DISBURSEMENT_ORDER_CREATE_FAILED",
            "Unable to create the mobile loan disbursement order.",
            error
        );
    }

    return data;
}

async function updateLoanDisbursementOrder(orderId, patch) {
    const updatePayload = {
        ...patch,
        updated_at: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
        .from("loan_disbursement_orders")
        .update(updatePayload)
        .eq("id", orderId)
        .select("*")
        .single();

    if (error || !data) {
        throw wrapLoanDisbursementOrderError(
            500,
            "LOAN_DISBURSEMENT_ORDER_UPDATE_FAILED",
            "Unable to update the mobile loan disbursement order.",
            error
        );
    }

    return data;
}

async function getLoanDisbursementOrderById(orderId) {
    const { data, error } = await adminSupabase
        .from("loan_disbursement_orders")
        .select("*, members(full_name, member_no, branch_id)")
        .eq("id", orderId)
        .maybeSingle();

    if (error) {
        throw wrapLoanDisbursementOrderError(
            500,
            "LOAN_DISBURSEMENT_ORDER_LOOKUP_FAILED",
            "Unable to load the mobile loan disbursement order.",
            error
        );
    }

    return data || null;
}

async function logLoanDisbursementOrderCallback({
    disbursementOrderId = null,
    externalId = null,
    providerRef = null,
    payload = {},
    source = "callback",
    gateway = "snippe"
}) {
    const { error } = await adminSupabase
        .from("loan_disbursement_order_callbacks")
        .insert({
            disbursement_order_id: disbursementOrderId,
            gateway,
            source,
            external_id: externalId,
            provider_ref: providerRef,
            payload
        });

    if (error) {
        console.warn("[loan-disbursements] callback log failed", { disbursementOrderId, externalId, providerRef });
    }
}

async function resolveLoanDisbursementOrderFromIdentifiers(identifiers = {}) {
    if (identifiers.internalOrderId) {
        const direct = await getLoanDisbursementOrderById(String(identifiers.internalOrderId));
        if (direct) {
            return { order: direct, identifiers };
        }
    }

    if (identifiers.externalId) {
        const { data, error } = await adminSupabase
            .from("loan_disbursement_orders")
            .select("*, members(full_name, member_no, branch_id)")
            .eq("external_id", String(identifiers.externalId))
            .maybeSingle();

        if (error) {
            throw wrapLoanDisbursementOrderError(
                500,
                "LOAN_DISBURSEMENT_ORDER_LOOKUP_FAILED",
                "Unable to resolve mobile disbursement order by external ID.",
                error
            );
        }

        if (data) {
            return { order: data, identifiers };
        }
    }

    if (identifiers.providerRef) {
        const { data, error } = await adminSupabase
            .from("loan_disbursement_orders")
            .select("*, members(full_name, member_no, branch_id)")
            .eq("provider_ref", String(identifiers.providerRef))
            .maybeSingle();

        if (error) {
            throw wrapLoanDisbursementOrderError(
                500,
                "LOAN_DISBURSEMENT_ORDER_LOOKUP_FAILED",
                "Unable to resolve mobile disbursement order by provider reference.",
                error
            );
        }

        if (data) {
            return { order: data, identifiers };
        }
    }

    return { order: null, identifiers };
}

async function attachLatestMobileDisbursementOrders(rows, tenantId) {
    const applicationIds = Array.from(new Set((rows || []).map((row) => row.id).filter(Boolean)));
    if (!applicationIds.length) {
        return rows || [];
    }

    const { data, error } = await adminSupabase
        .from("loan_disbursement_orders")
        .select("*, members(full_name, member_no, branch_id)")
        .eq("tenant_id", tenantId)
        .in("application_id", applicationIds)
        .order("created_at", { ascending: false });

    if (error) {
        if (isMissingLoanDisbursementRelationError(error)) {
            return (rows || []).map((row) => ({
                ...row,
                latest_mobile_disbursement: null
            }));
        }

        throw wrapLoanDisbursementOrderError(
            500,
            "LOAN_DISBURSEMENT_ORDER_ENRICH_FAILED",
            "Unable to load mobile loan disbursement status.",
            error
        );
    }

    const latestByApplication = new Map();
    for (const row of data || []) {
        if (!latestByApplication.has(row.application_id)) {
            latestByApplication.set(row.application_id, buildLoanDisbursementOrderView(row));
        }
    }

    return (rows || []).map((row) => ({
        ...row,
        latest_mobile_disbursement: latestByApplication.get(row.id) || null
    }));
}

async function getLoanDisbursementApprovalPayload(tenantId, approvalRequestId, applicationId) {
    if (!approvalRequestId) {
        return {};
    }

    const { data, error } = await adminSupabase
        .from("approval_requests")
        .select("id, operation_key, entity_type, entity_id, payload_json")
        .eq("tenant_id", tenantId)
        .eq("id", approvalRequestId)
        .maybeSingle();

    if (error) {
        throw new AppError(
            500,
            "LOAN_DISBURSEMENT_APPROVAL_LOOKUP_FAILED",
            "Unable to load approved loan disbursement context.",
            error
        );
    }

    if (!data) {
        throw new AppError(404, "APPROVAL_REQUEST_NOT_FOUND", "Approval request was not found.");
    }

    if (data.operation_key !== "finance.loan_disburse") {
        throw new AppError(
            400,
            "APPROVAL_REQUEST_OPERATION_MISMATCH",
            "Approval request does not belong to a loan disbursement operation."
        );
    }

    if (data.entity_type && data.entity_type !== "loan_application") {
        throw new AppError(
            400,
            "APPROVAL_REQUEST_ENTITY_MISMATCH",
            "Approval request is not linked to a loan application."
        );
    }

    if (data.entity_id && applicationId && data.entity_id !== applicationId) {
        throw new AppError(
            400,
            "APPROVAL_REQUEST_APPLICATION_MISMATCH",
            "Approval request does not match this loan application."
        );
    }

    return data.payload_json && typeof data.payload_json === "object" ? data.payload_json : {};
}

async function getExpandedApplication(tenantId, applicationId) {
    const { data, error } = await adminSupabase
        .from("loan_applications")
        .select(`
            *,
            members(id, full_name, phone, email, member_no, branch_id, user_id),
            loan_products(id, code, name),
            loan_approvals(*),
            loan_guarantors(*, members(id, full_name, member_no)),
            collateral_items(*)
        `)
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .single();

    if (error || !data) {
        throw new AppError(404, "LOAN_APPLICATION_NOT_FOUND", "Loan application was not found.");
    }

    const [expanded] = await attachLatestMobileDisbursementOrders([
        attachGuarantorConsentReference(data)
    ], tenantId);

    return expanded;
}

function ensureApplicationEditAllowed(actor, application) {
    if (actor.role === ROLES.MEMBER) {
        if (application.members?.user_id !== actor.user.id) {
            throw new AppError(403, "LOAN_APPLICATION_ACCESS_DENIED", "You cannot modify another member's loan application.");
        }
    } else if (![ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)) {
        throw new AppError(403, "FORBIDDEN", "You cannot modify loan applications.");
    }

    if (!["draft", "rejected"].includes(application.status)) {
        throw new AppError(400, "LOAN_APPLICATION_LOCKED", "Only draft or rejected applications can be edited.");
    }
}

function assertAllGuarantorsAccepted(application) {
    const guarantors = Array.isArray(application?.loan_guarantors) ? application.loan_guarantors : [];
    if (!guarantors.length) {
        return;
    }

    const unresolved = guarantors.filter((guarantor) => guarantor.consent_status !== "accepted");
    if (!unresolved.length) {
        return;
    }

    throw new AppError(
        400,
        "GUARANTOR_CONSENT_PENDING",
        "All guarantors must accept before loan can proceed.",
        {
            unresolved_guarantors: unresolved.map((guarantor) => ({
                member_id: guarantor.member_id,
                consent_status: guarantor.consent_status || "pending",
                guaranteed_amount: Number(guarantor.guaranteed_amount || 0)
            }))
        }
    );
}

async function getOpenLoanDisbursementOrderForApplication(applicationId) {
    const { data, error } = await adminSupabase
        .from("loan_disbursement_orders")
        .select("*, members(full_name, member_no, branch_id)")
        .eq("application_id", applicationId)
        .in("status", Array.from(OPEN_MOBILE_DISBURSEMENT_STATUSES))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw wrapLoanDisbursementOrderError(
            500,
            "LOAN_DISBURSEMENT_ORDER_LOOKUP_FAILED",
            "Unable to load the active mobile loan disbursement order.",
            error
        );
    }

    return data || null;
}

function assertLoanDisbursementOrderAccess(actor, order) {
    assertTenantAccess({ auth: actor }, order.tenant_id);
    assertBranchAccess({ auth: actor }, order.branch_id);
}

function buildLoanDisbursementProcessingActor(order) {
    return {
        tenantId: order.tenant_id,
        role: ROLES.TELLER,
        isInternalOps: true,
        branchIds: [order.branch_id],
        user: {
            id: order.created_by_user_id
        },
        profile: null
    };
}

async function applyLoanApplicationDisbursedState({
    tenantId,
    actorUserId,
    application,
    disburseResult
}) {
    const applicationId = application.id;
    const updatePayload = {
        status: "disbursed",
        disbursed_by: actorUserId,
        disbursed_at: new Date().toISOString(),
        loan_id: disburseResult.loan_id
    };

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .update(updatePayload)
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_DISBURSE_UPDATE_FAILED", "Loan disbursement posted but application status could not be updated.", error);
    }

    await adminSupabase
        .from("loans")
        .update({ application_id: applicationId })
        .eq("id", disburseResult.loan_id);

    await creditRiskService.recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: (application.loan_guarantors || []).map((row) => row.member_id),
        actorUserId,
        source: "application_disburse"
    });

    await logAudit({
        tenantId,
        actorUserId,
        table: "loan_applications",
        action: "LOAN_APPLICATION_DISBURSED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: application,
        afterData: {
            ...data,
            loan_number: disburseResult.loan_number,
            journal_id: disburseResult.journal_id
        }
    });

    invalidateLoanApplicationsCountCache();
    const expanded = await getExpandedApplication(tenantId, applicationId);
    const alertActor = {
        tenantId,
        user: { id: actorUserId },
        role: ROLES.TELLER,
        branchIds: [application.branch_id],
        isInternalOps: true
    };
    await notifyMemberLoanDisbursed({
        actor: alertActor,
        application: expanded,
        disbursement: disburseResult
    });
    await notifyBranchManagersLoanDisbursed({
        actor: alertActor,
        application: expanded,
        disbursement: disburseResult
    });

    return expanded;
}

function buildLoanDisbursementAmountViolation(order, amountValue, amountCurrency) {
    const expectedAmount = Number(order.amount || 0);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
        return {
            rule: "amount_match",
            message: "Payout amount is missing or invalid.",
            currentValue: amountValue,
            requiredValue: expectedAmount
        };
    }

    if (Number(amountValue) !== expectedAmount) {
        return {
            rule: "amount_match",
            message: "Payout amount does not match the loan disbursement order amount.",
            currentValue: Number(amountValue),
            requiredValue: expectedAmount
        };
    }

    const expectedCurrency = String(order.currency || "").trim().toUpperCase();
    if (expectedCurrency && amountCurrency && expectedCurrency !== String(amountCurrency).trim().toUpperCase()) {
        return {
            rule: "currency_match",
            message: "Payout currency does not match the loan disbursement order currency.",
            currentValue: String(amountCurrency).trim().toUpperCase(),
            requiredValue: expectedCurrency
        };
    }

    return null;
}

async function finalizeCompletedLoanDisbursementOrder(order, payout = {}, source = "snippe_status_poll") {
    if (order.status === "posted" && order.loan_id && order.journal_id) {
        return order;
    }

    const application = await getExpandedApplication(order.tenant_id, order.application_id);
    if (application.loan_id && application.status === "disbursed") {
        return updateLoanDisbursementOrder(order.id, {
            status: "posted",
            posted_at: order.posted_at || new Date().toISOString(),
            loan_id: order.loan_id || application.loan_id,
            completed_at: order.completed_at || payout.completedAt || new Date().toISOString(),
            provider_ref: payout.providerRef || order.provider_ref,
            provider: payout.provider || order.provider,
            error_code: null,
            error_message: null
        });
    }

    const actor = buildLoanDisbursementProcessingActor(order);
    const disburseResult = await financeService.loanDisburse(
        actor,
        {
            tenant_id: order.tenant_id,
            application_id: order.application_id,
            approval_request_id: order.approval_request_id || null,
            member_id: application.member_id,
            branch_id: application.branch_id,
            principal_amount: application.recommended_amount || application.requested_amount,
            annual_interest_rate: application.recommended_interest_rate || application.requested_interest_rate || 0,
            term_count: application.recommended_term_count || application.requested_term_count,
            repayment_frequency: application.recommended_repayment_frequency || application.requested_repayment_frequency,
            reference: order.reference || application.external_reference || null,
            description: order.description || `Loan mobile disbursement for application ${order.application_id}`,
            disbursed_by: order.created_by_user_id
        },
        {
            skipWorkflow: true,
            skipApprovalGate: true,
            skipCashControl: true
        }
    );

    const expanded = await applyLoanApplicationDisbursedState({
        tenantId: order.tenant_id,
        actorUserId: order.created_by_user_id,
        application,
        disburseResult
    });

    if (order.approval_request_id) {
        await approvalService.markApprovalRequestExecuted({
            actor,
            tenantId: order.tenant_id,
            requestId: order.approval_request_id,
            entityType: "loan",
            entityId: disburseResult.loan_id
        }).catch((error) => {
            console.warn("[loan-disbursements] approval execute mark failed", {
                orderId: order.id,
                requestId: order.approval_request_id,
                message: error?.message || error
            });
        });
    }

    const postedOrder = await updateLoanDisbursementOrder(order.id, {
        status: "posted",
        posted_at: order.posted_at || new Date().toISOString(),
        completed_at: order.completed_at || payout.completedAt || new Date().toISOString(),
        provider_ref: payout.providerRef || order.provider_ref,
        provider: payout.provider || order.provider,
        loan_id: disburseResult.loan_id,
        journal_id: disburseResult.journal_id,
        error_code: null,
        error_message: null,
        metadata: {
            ...(order.metadata && typeof order.metadata === "object" ? order.metadata : {}),
            latest_provider_status: payout.status || "completed",
            source
        }
    });

    await logAudit({
        tenantId: postedOrder.tenant_id,
        actorUserId: postedOrder.created_by_user_id,
        table: "loan_disbursement_orders",
        action: "LOAN_MOBILE_DISBURSEMENT_POSTED",
        entityType: "loan_disbursement_order",
        entityId: postedOrder.id,
        afterData: {
            application_id: postedOrder.application_id,
            provider_ref: postedOrder.provider_ref,
            status: postedOrder.status,
            journal_id: postedOrder.journal_id,
            loan_id: postedOrder.loan_id,
            source
        }
    });

    return {
        ...postedOrder,
        application: expanded
    };
}

async function markLoanDisbursementOrderFailed(order, failure = {}, source = "snippe_status_poll") {
    const nextStatus = failure.status === "expired" ? "expired" : "failed";
    const nowIso = new Date().toISOString();
    const updatedOrder = await updateLoanDisbursementOrder(order.id, {
        status: nextStatus,
        provider_ref: failure.providerRef || order.provider_ref,
        provider: failure.provider || order.provider,
        callback_received_at: failure.payload ? nowIso : order.callback_received_at,
        latest_callback_payload: failure.payload || order.latest_callback_payload,
        failed_at: nextStatus === "failed" ? (order.failed_at || nowIso) : order.failed_at,
        expired_at: nextStatus === "expired" ? (order.expired_at || nowIso) : order.expired_at,
        error_code: nextStatus === "expired" ? "SNIPPE_PAYOUT_EXPIRED" : "SNIPPE_PAYOUT_FAILED",
        error_message: failure.message || (nextStatus === "expired" ? "The mobile money disbursement expired before completion." : "The mobile money disbursement failed."),
        metadata: {
            ...(order.metadata && typeof order.metadata === "object" ? order.metadata : {}),
            latest_provider_status: failure.status || nextStatus,
            source
        }
    });

    await logAudit({
        tenantId: updatedOrder.tenant_id,
        actorUserId: updatedOrder.created_by_user_id,
        table: "loan_disbursement_orders",
        action: nextStatus === "expired" ? "LOAN_MOBILE_DISBURSEMENT_EXPIRED" : "LOAN_MOBILE_DISBURSEMENT_FAILED",
        entityType: "loan_disbursement_order",
        entityId: updatedOrder.id,
        afterData: {
            application_id: updatedOrder.application_id,
            provider_ref: updatedOrder.provider_ref,
            status: updatedOrder.status,
            failure_reason: updatedOrder.error_message,
            source
        }
    });

    return updatedOrder;
}

async function syncPendingLoanDisbursementOrder(order, source = "status_poll") {
    if (!order) {
        return null;
    }

    if (order.status === "posted" || order.status === "failed" || order.status === "expired") {
        return order;
    }

    if (order.status === "completed") {
        return finalizeCompletedLoanDisbursementOrder(order, {
            providerRef: order.provider_ref,
            provider: order.provider,
            status: "completed"
        }, source);
    }

    if (!order.provider_ref) {
        return order;
    }

    const payoutStatus = await getPayoutStatus(order.provider_ref);
    if (!payoutStatus.found) {
        return order;
    }

    const amountViolation = buildLoanDisbursementAmountViolation(order, payoutStatus.amountValue, payoutStatus.amountCurrency);
    if (amountViolation) {
        throw new AppError(
            409,
            "LOAN_DISBURSEMENT_AMOUNT_MISMATCH",
            amountViolation.message,
            amountViolation
        );
    }

    const normalizedStatus = normalizePayoutStatus(payoutStatus.status);
    const patch = {
        provider_ref: payoutStatus.providerRef || order.provider_ref,
        provider: payoutStatus.provider || order.provider,
        expires_at: payoutStatus.expiresAt || order.expires_at,
        metadata: {
            ...(order.metadata && typeof order.metadata === "object" ? order.metadata : {}),
            latest_provider_status: payoutStatus.status || null,
            latest_provider_reference: payoutStatus.providerRef || order.provider_ref || null
        }
    };

    let refreshedOrder = order;
    if (
        patch.provider_ref !== order.provider_ref
        || patch.provider !== order.provider
        || patch.expires_at !== order.expires_at
        || JSON.stringify(patch.metadata) !== JSON.stringify(order.metadata || {})
    ) {
        refreshedOrder = await updateLoanDisbursementOrder(order.id, patch);
    }

    await logLoanDisbursementOrderCallback({
        disbursementOrderId: refreshedOrder.id,
        externalId: payoutStatus.externalReference || refreshedOrder.external_id,
        providerRef: payoutStatus.providerRef || refreshedOrder.provider_ref,
        payload: payoutStatus.responsePayload,
        source: "snippe_status_poll",
        gateway: "snippe"
    });

    if (normalizedStatus === "completed") {
        const completedOrder = await updateLoanDisbursementOrder(refreshedOrder.id, {
            status: "completed",
            completed_at: refreshedOrder.completed_at || payoutStatus.completedAt || new Date().toISOString(),
            provider_ref: payoutStatus.providerRef || refreshedOrder.provider_ref,
            provider: payoutStatus.provider || refreshedOrder.provider,
            error_code: null,
            error_message: null,
            metadata: patch.metadata
        });
        return finalizeCompletedLoanDisbursementOrder(completedOrder, {
            ...payoutStatus,
            status: normalizedStatus
        }, source);
    }

    if (normalizedStatus === "failed" || normalizedStatus === "expired") {
        return markLoanDisbursementOrderFailed(refreshedOrder, {
            status: normalizedStatus,
            providerRef: payoutStatus.providerRef,
            provider: payoutStatus.provider,
            message: payoutStatus.responsePayload?.message || payoutStatus.status || null,
            payload: payoutStatus.responsePayload
        }, source);
    }

    if (payoutStatus.expiresAt && new Date(payoutStatus.expiresAt).getTime() <= Date.now()) {
        return markLoanDisbursementOrderFailed(refreshedOrder, {
            status: "expired",
            providerRef: payoutStatus.providerRef,
            provider: payoutStatus.provider,
            message: "The mobile money disbursement expired before confirmation.",
            payload: payoutStatus.responsePayload
        }, source);
    }

    return refreshedOrder;
}

async function getLoanDisbursementOrderStatus(actor, orderId) {
    const order = await getLoanDisbursementOrderById(orderId);
    if (!order) {
        throw new AppError(404, "LOAN_DISBURSEMENT_ORDER_NOT_FOUND", "Mobile loan disbursement order was not found.");
    }

    assertLoanDisbursementOrderAccess(actor, order);
    const syncedOrder = await syncPendingLoanDisbursementOrder(order, "status_poll");
    return {
        order: buildLoanDisbursementOrderView(syncedOrder)
    };
}

async function processSnippeLoanDisbursementPayoutEvent(event, ip = null, userAgent = null) {
    const identifiers = {
        internalOrderId: event.orderId,
        externalId: event.externalReference,
        providerRef: event.providerRef
    };
    const { order } = await resolveLoanDisbursementOrderFromIdentifiers(identifiers);

    await logLoanDisbursementOrderCallback({
        disbursementOrderId: order?.id || null,
        externalId: identifiers.externalId || event.externalReference,
        providerRef: identifiers.providerRef || event.providerRef,
        payload: event.payload,
        source: "snippe_webhook",
        gateway: "snippe"
    });

    if (!order) {
        await logAudit({
            tenantId: event.tenantId || null,
            actorUserId: null,
            table: "loan_disbursement_orders",
            action: "LOAN_MOBILE_DISBURSEMENT_ORDER_NOT_FOUND",
            entityType: "loan_disbursement_order",
            entityId: event.orderId || event.providerRef || event.externalReference || null,
            afterData: {
                event_type: event.eventType,
                order_id: event.orderId,
                provider_ref: event.providerRef,
                external_reference: event.externalReference
            },
            ip,
            userAgent
        }).catch(() => null);

        return {
            httpStatus: 200,
            data: {
                success: false,
                ignored: true,
                code: "LOAN_DISBURSEMENT_ORDER_NOT_FOUND",
                identifiers
            }
        };
    }

    const amountViolation = buildLoanDisbursementAmountViolation(order, event.amountValue, event.amountCurrency);
    if (amountViolation) {
        await logAudit({
            tenantId: order.tenant_id,
            actorUserId: order.created_by_user_id,
            table: "loan_disbursement_orders",
            action: "LOAN_MOBILE_DISBURSEMENT_AMOUNT_MISMATCH",
            entityType: "loan_disbursement_order",
            entityId: order.id,
            afterData: {
                provider_ref: event.providerRef,
                event_type: event.eventType,
                amount_received: amountViolation.currentValue,
                amount_expected: amountViolation.requiredValue
            },
            ip,
            userAgent
        });

        return {
            httpStatus: 200,
            data: {
                success: false,
                ignored: true,
                code: "LOAN_DISBURSEMENT_AMOUNT_MISMATCH"
            }
        };
    }

    let updatedOrder;
    if (event.eventType === "payout.completed") {
        const completedOrder = await updateLoanDisbursementOrder(order.id, {
            status: order.status === "posted" ? "posted" : "completed",
            callback_received_at: new Date().toISOString(),
            latest_callback_payload: event.rawBody,
            provider_ref: event.providerRef || order.provider_ref,
            provider: event.normalized.provider || order.provider,
            completed_at: order.completed_at || event.completedAt || new Date().toISOString(),
            error_code: null,
            error_message: null,
            metadata: {
                ...(order.metadata && typeof order.metadata === "object" ? order.metadata : {}),
                latest_provider_status: event.status || event.eventType,
                source: "snippe_webhook"
            }
        });
        updatedOrder = await finalizeCompletedLoanDisbursementOrder(completedOrder, {
            providerRef: event.providerRef,
            provider: event.normalized.provider || order.provider,
            completedAt: event.completedAt,
            status: event.status || "completed"
        }, "snippe_webhook");
    } else {
        updatedOrder = await markLoanDisbursementOrderFailed(order, {
            status: normalizePayoutStatus(event.status || event.eventType),
            providerRef: event.providerRef,
            provider: event.normalized.provider || order.provider,
            message: event.failureReason || event.status || "The mobile money disbursement failed.",
            payload: event.rawBody
        }, "snippe_webhook");
    }

    return {
        httpStatus: 200,
        data: {
            success: true,
            event_id: event.eventId,
            event_type: event.eventType,
            order_id: updatedOrder.id,
            status: updatedOrder.status,
            provider_ref: updatedOrder.provider_ref || null
        }
    };
}

async function listGuarantorRequests(actor, query = {}) {
    if (actor.role !== ROLES.MEMBER) {
        throw new AppError(403, "FORBIDDEN", "Only members can view guarantor consent requests.");
    }

    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const ownMember = await getMemberByUser(tenantId, actor.user.id);
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let builder = adminSupabase
        .from("loan_guarantors")
        .select(`
            id,
            application_id,
            tenant_id,
            member_id,
            guaranteed_amount,
            consent_status,
            consented_at,
            notes,
            created_at,
            loan_applications!inner(
                id,
                tenant_id,
                branch_id,
                member_id,
                product_id,
                purpose,
                requested_amount,
                requested_term_count,
                requested_repayment_frequency,
                requested_interest_rate,
                status,
                created_at,
                updated_at,
                members(id, full_name, member_no)
            )
        `, { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("member_id", ownMember.id);

    if (query.status) {
        builder = builder.eq("consent_status", query.status);
    }

    const { data, error, count } = await builder
        .order("created_at", { ascending: false })
        .range(from, to);

    if (error) {
        throw new AppError(500, "GUARANTOR_REQUESTS_FETCH_FAILED", "Unable to load guarantor requests.", error);
    }

    return {
        data: (data || []).map((row) => {
            const application = row.loan_applications || null;
            return {
                ...row,
                borrower: application?.members || null,
                loan_application: application || null
            };
        }),
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
}

async function enrichLoanApplicationListDetails(rows, tenantId) {
    const applicationIds = Array.from(new Set((rows || []).map((row) => row.id).filter(Boolean)));
    if (!applicationIds.length) {
        return rows || [];
    }

    const [{ data: guarantors, error: guarantorsError }, { data: collateralItems, error: collateralError }] = await Promise.all([
        adminSupabase
            .from("loan_guarantors")
            .select(`
                id,
                application_id,
                tenant_id,
                member_id,
                guaranteed_amount,
                consent_status,
                consented_at,
                notes,
                created_at,
                members(id, full_name, member_no)
            `)
            .eq("tenant_id", tenantId)
            .in("application_id", applicationIds),
        adminSupabase
            .from("collateral_items")
            .select(`
                id,
                application_id,
                tenant_id,
                collateral_type,
                description,
                valuation_amount,
                lien_reference,
                documents_json,
                created_at
            `)
            .eq("tenant_id", tenantId)
            .in("application_id", applicationIds)
    ]);

    if (guarantorsError) {
        throw new AppError(500, "LOAN_GUARANTORS_FETCH_FAILED", "Unable to load loan guarantors.", guarantorsError);
    }

    if (collateralError) {
        throw new AppError(500, "COLLATERAL_ITEMS_FETCH_FAILED", "Unable to load collateral details.", collateralError);
    }

    const guarantorsByApplication = new Map();
    for (const row of guarantors || []) {
        const existing = guarantorsByApplication.get(row.application_id) || [];
        existing.push(row);
        guarantorsByApplication.set(row.application_id, existing);
    }

    const collateralByApplication = new Map();
    for (const row of collateralItems || []) {
        const existing = collateralByApplication.get(row.application_id) || [];
        existing.push(row);
        collateralByApplication.set(row.application_id, existing);
    }

    const enrichedRows = (rows || []).map((row) => attachGuarantorConsentReference({
        ...row,
        loan_guarantors: guarantorsByApplication.get(row.id) || [],
        collateral_items: collateralByApplication.get(row.id) || []
    }));

    return attachLatestMobileDisbursementOrders(enrichedRows, tenantId);
}

async function listLoanApplications(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const hasCursor = Boolean(query.cursor);
    const hasPagination = query.page !== undefined || query.limit !== undefined || hasCursor;
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const cursor = hasCursor ? String(query.cursor) : null;

    const ownMemberId = actor.role === ROLES.MEMBER
        ? (await getMemberByUser(tenantId, actor.user.id)).id
        : null;

    let builder = applyLoanApplicationListFilters(
        adminSupabase
            .from("loan_applications")
            .select(LOAN_APPLICATION_LIST_COLUMNS),
        { actor, query, tenantId, ownMemberId }
    )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

    if (hasCursor) {
        builder = builder.lt("created_at", cursor).limit(limit);
    } else if (hasPagination) {
        builder = builder.range(from, to);
    }

    const { data, error } = await builder;

    if (error) {
        throw new AppError(500, "LOAN_APPLICATIONS_FETCH_FAILED", "Unable to load loan applications.", error);
    }

    const rows = data || [];
    const hydratedRows = [ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)
        ? await enrichLoanApplicationListDetails(rows, tenantId)
        : rows;
    if (hasCursor) {
        const lastRow = hydratedRows.length ? hydratedRows[hydratedRows.length - 1] : null;
        return {
            data: hydratedRows,
            pagination: {
                mode: "cursor",
                limit,
                cursor,
                next_cursor: hydratedRows.length === limit ? lastRow?.created_at || null : null,
                total: null
            }
        };
    }

    const total = hasPagination
        ? await getCachedLoanApplicationsTotal({ actor, query, tenantId, ownMemberId })
        : null;

    return {
        data: hydratedRows,
        pagination: hasPagination
            ? {
                page,
                limit,
                total: total || 0
            }
            : null
    };
}

function applyLoanApplicationListFilters(builder, { actor, query, tenantId, ownMemberId }) {
    let scoped = builder.eq("tenant_id", tenantId);

    if (actor.role === ROLES.MEMBER && ownMemberId) {
        scoped = scoped.eq("member_id", ownMemberId);
    } else if (
        !actor.isInternalOps
        && [ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)
        && actor.branchIds.length
    ) {
        scoped = scoped.in("branch_id", actor.branchIds);
    }

    if (query.status) {
        scoped = scoped.eq("status", query.status);
    } else if (actor.role === ROLES.BRANCH_MANAGER) {
        // Branch managers should only work the approval queue after loan officers finish appraisal.
        scoped = scoped.eq("status", "appraised");
    } else if (actor.role === ROLES.TELLER) {
        // Teller queue should only show loans pending disbursement.
        scoped = scoped.eq("status", "approved");
    }
    if (query.member_id) scoped = scoped.eq("member_id", query.member_id);
    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        scoped = scoped.eq("branch_id", query.branch_id);
    }
    if (query.product_id) scoped = scoped.eq("product_id", query.product_id);

    return scoped;
}

function getLoanApplicationsCountCacheKey({ actor, query, tenantId, ownMemberId }) {
    const branchScope = Array.isArray(actor.branchIds) && actor.branchIds.length
        ? actor.branchIds.slice().sort().join(",")
        : "";

    return [
        tenantId,
        actor.role || "",
        actor.user?.id || "",
        ownMemberId || "",
        actor.isInternalOps ? "1" : "0",
        branchScope,
        query.status || "",
        query.member_id || "",
        query.branch_id || "",
        query.product_id || ""
    ].join("|");
}

async function getCachedLoanApplicationsTotal({ actor, query, tenantId, ownMemberId }) {
    const cacheKey = getLoanApplicationsCountCacheKey({ actor, query, tenantId, ownMemberId });
    const now = Date.now();

    if (LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS > 0) {
        const cached = loanApplicationsCountCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return cached.value;
        }
    }

    const inFlight = loanApplicationsCountInFlight.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }

    const task = (async () => {
        try {
            const countQuery = applyLoanApplicationListFilters(
                adminSupabase
                    .from("loan_applications")
                    .select("id", { count: "planned", head: true }),
                { actor, query, tenantId, ownMemberId }
            );

            const { count, error } = await countQuery;
            if (error) {
                throw new AppError(
                    500,
                    "LOAN_APPLICATIONS_COUNT_FAILED",
                    "Unable to count loan applications.",
                    error
                );
            }

            const total = count || 0;
            if (LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS > 0) {
                loanApplicationsCountCache.set(cacheKey, {
                    value: total,
                    expiresAt: now + LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS
                });
            }

            return total;
        } finally {
            loanApplicationsCountInFlight.delete(cacheKey);
        }
    })();

    loanApplicationsCountInFlight.set(cacheKey, task);
    return task;
}

function invalidateLoanApplicationsCountCache() {
    loanApplicationsCountCache.clear();
    loanApplicationsCountInFlight.clear();
}

function toLoanApprovalRpcError(code, message, details) {
    switch (code) {
    case "LOAN_APPLICATION_NOT_FOUND":
        return new AppError(404, code, message, details);
    case "LOAN_APPLICATION_NOT_APPROVABLE":
    case "MAKER_CHECKER_VIOLATION":
    case "LOAN_APPLICATION_ALREADY_APPROVED":
    case "LOAN_APPLICATION_ALREADY_REJECTED":
    case "LOAN_APPLICATION_APPROVAL_INPUT_INVALID":
        return new AppError(400, code, message, details);
    default:
        return new AppError(500, code || "LOAN_APPLICATION_APPROVE_FAILED", message || "Unable to approve the loan application.", details);
    }
}

async function approveLoanApplicationDecision({ tenantId, applicationId, actorUserId, notes }) {
    const { data, error } = await adminSupabase.rpc("approve_loan_application", {
        p_tenant_id: tenantId,
        p_application_id: applicationId,
        p_actor_user_id: actorUserId,
        p_notes: notes || null
    });

    if (error) {
        throw new AppError(
            500,
            "LOAN_APPLICATION_APPROVE_FAILED",
            "Unable to approve the loan application.",
            error
        );
    }

    const row = Array.isArray(data) ? (data[0] || null) : data;

    if (!row) {
        throw new AppError(
            500,
            "LOAN_APPLICATION_APPROVE_FAILED",
            "Loan approval did not return a result."
        );
    }

    if (!row.ok) {
        throw toLoanApprovalRpcError(row.error_code, row.error_message, row);
    }

    return row;
}

function toLoanRejectionRpcError(code, message, details) {
    switch (code) {
    case "LOAN_APPLICATION_NOT_FOUND":
        return new AppError(404, code, message, details);
    case "LOAN_APPLICATION_NOT_REJECTABLE":
    case "MAKER_CHECKER_VIOLATION":
    case "LOAN_APPLICATION_ALREADY_APPROVED":
    case "LOAN_APPLICATION_ALREADY_REJECTED":
    case "LOAN_APPLICATION_REJECTION_INPUT_INVALID":
        return new AppError(400, code, message, details);
    default:
        return new AppError(500, code || "LOAN_APPLICATION_REJECT_FAILED", message || "Unable to reject the loan application.", details);
    }
}

async function rejectLoanApplicationDecision({ tenantId, applicationId, actorUserId, reason, notes }) {
    const { data, error } = await adminSupabase.rpc("reject_loan_application", {
        p_tenant_id: tenantId,
        p_application_id: applicationId,
        p_actor_user_id: actorUserId,
        p_reason: reason,
        p_notes: notes || null
    });

    if (error) {
        throw new AppError(
            500,
            "LOAN_APPLICATION_REJECT_FAILED",
            "Unable to reject the loan application.",
            error
        );
    }

    const row = Array.isArray(data) ? (data[0] || null) : data;

    if (!row) {
        throw new AppError(
            500,
            "LOAN_APPLICATION_REJECT_FAILED",
            "Loan rejection did not return a result."
        );
    }

    if (!row.ok) {
        throw toLoanRejectionRpcError(row.error_code, row.error_message, row);
    }

    return row;
}

function toLoanSubmissionRpcError(code, message, details) {
    switch (code) {
    case "LOAN_APPLICATION_NOT_FOUND":
        return new AppError(404, code, message, details);
    case "LOAN_APPLICATION_NOT_SUBMITTABLE":
    case "LOAN_APPLICATION_SUBMISSION_INPUT_INVALID":
        return new AppError(400, code, message, details);
    default:
        return new AppError(500, code || "LOAN_APPLICATION_SUBMIT_FAILED", message || "Unable to submit loan application.", details);
    }
}

async function submitLoanApplicationDecision({ tenantId, applicationId, actorUserId }) {
    const { data, error } = await adminSupabase.rpc("submit_loan_application", {
        p_tenant_id: tenantId,
        p_application_id: applicationId,
        p_actor_user_id: actorUserId
    });

    if (error) {
        throw new AppError(
            500,
            "LOAN_APPLICATION_SUBMIT_FAILED",
            "Unable to submit loan application.",
            error
        );
    }

    const row = Array.isArray(data) ? (data[0] || null) : data;

    if (!row) {
        throw new AppError(
            500,
            "LOAN_APPLICATION_SUBMIT_FAILED",
            "Loan submission did not return a result."
        );
    }

    if (!row.ok) {
        throw toLoanSubmissionRpcError(row.error_code, row.error_message, row);
    }

    return row;
}

function toLoanAppraisalRpcError(code, message, details) {
    switch (code) {
    case "LOAN_APPLICATION_NOT_FOUND":
        return new AppError(404, code, message, details);
    case "LOAN_APPLICATION_NOT_APPRAISABLE":
    case "LOAN_APPLICATION_APPRAISAL_INPUT_INVALID":
        return new AppError(400, code, message, details);
    default:
        return new AppError(500, code || "LOAN_APPLICATION_APPRAISAL_FAILED", message || "Unable to save the loan appraisal.", details);
    }
}

async function appraiseLoanApplicationDecision({
    tenantId,
    applicationId,
    actorUserId,
    appraisalNotes,
    riskRating,
    recommendedAmount,
    recommendedTermCount,
    recommendedInterestRate,
    recommendedRepaymentFrequency
}) {
    const { data, error } = await adminSupabase.rpc("appraise_loan_application", {
        p_tenant_id: tenantId,
        p_application_id: applicationId,
        p_actor_user_id: actorUserId,
        p_appraisal_notes: appraisalNotes,
        p_risk_rating: riskRating,
        p_recommended_amount: recommendedAmount,
        p_recommended_term_count: recommendedTermCount,
        p_recommended_interest_rate: recommendedInterestRate,
        p_recommended_repayment_frequency: recommendedRepaymentFrequency
    });

    if (error) {
        throw new AppError(
            500,
            "LOAN_APPLICATION_APPRAISAL_FAILED",
            "Unable to save the loan appraisal.",
            error
        );
    }

    const row = Array.isArray(data) ? (data[0] || null) : data;

    if (!row) {
        throw new AppError(
            500,
            "LOAN_APPLICATION_APPRAISAL_FAILED",
            "Loan appraisal did not return a result."
        );
    }

    if (!row.ok) {
        throw toLoanAppraisalRpcError(row.error_code, row.error_message, row);
    }

    return row;
}

async function createLoanApplication(actor, payload) {
    if (actor.role === ROLES.BRANCH_MANAGER) {
        throw new AppError(403, "FORBIDDEN", "Branch managers cannot create loan applications on behalf of members.");
    }

    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const sanitizedPayload = sanitizeLoanApplicationPayload(payload);

    let member;
    if (actor.role === ROLES.MEMBER) {
        member = await getMemberByUser(tenantId, actor.user.id);
    } else {
        if (!sanitizedPayload.member_id) {
            throw new AppError(400, "MEMBER_ID_REQUIRED", "Member is required for staff-originated loan applications.");
        }
        member = await getMemberRecord(tenantId, sanitizedPayload.member_id);
    }

    const product = await getActiveLoanProduct(tenantId, sanitizedPayload.product_id);
    const branchId = actor.role === ROLES.MEMBER ? member.branch_id : sanitizedPayload.branch_id || member.branch_id;

    if (actor.role !== ROLES.MEMBER) {
        assertBranchAccess({ auth: actor }, branchId);
    }

    const applicationReference = await generateUniqueLoanApplicationReference(tenantId);
    const { capacitySummary } = await assertLoanApplicationPolicy({
        tenantId,
        member,
        product,
        branchId,
        requestedAmount: sanitizedPayload.requested_amount,
        requestedTermCount: sanitizedPayload.requested_term_count,
        requestedRepaymentFrequency: sanitizedPayload.requested_repayment_frequency,
        guarantors: sanitizedPayload.guarantors,
        collateralItems: sanitizedPayload.collateral_items,
        enforceSubmissionGuards: false
    });

    const approvalRequirement = await getApprovalRequirement(tenantId);

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .insert({
            tenant_id: tenantId,
            branch_id: branchId,
            member_id: member.id,
            product_id: product.id,
            external_reference: applicationReference,
            purpose: sanitizedPayload.purpose,
            requested_amount: sanitizedPayload.requested_amount,
            ...buildCapacitySnapshot(capacitySummary, sanitizedPayload.requested_amount),
            requested_term_count: sanitizedPayload.requested_term_count,
            requested_repayment_frequency: sanitizedPayload.requested_repayment_frequency,
            requested_interest_rate: product.annual_interest_rate,
            created_via: actor.role === ROLES.MEMBER ? "member_portal" : "staff",
            requested_by: actor.user.id,
            requested_on_behalf_by: actor.role === ROLES.MEMBER ? null : actor.user.id,
            required_approval_count: approvalRequirement.requiredApprovalCount
        })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_CREATE_FAILED", "Unable to create loan application.", error);
    }

    await replaceChildren(data.id, tenantId, sanitizedPayload.guarantors, sanitizedPayload.collateral_items);

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_CREATED",
        entityType: "loan_application",
        entityId: data.id,
        afterData: data
    });

    invalidateLoanApplicationsCountCache();
    return getExpandedApplication(tenantId, data.id);
}

async function updateLoanApplication(actor, applicationId, payload) {
    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);
    ensureApplicationEditAllowed(actor, existing);
    const sanitizedPayload = sanitizeLoanApplicationPayload({
        ...existing,
        ...payload
    });

    const nextProductId = sanitizedPayload.product_id || existing.product_id;
    const product = await getActiveLoanProduct(tenantId, nextProductId);
    const nextBranchId = sanitizedPayload.branch_id || existing.branch_id;
    assertBranchAccess({ auth: actor }, nextBranchId);
    const applicationReference = existing.external_reference || await generateUniqueLoanApplicationReference(tenantId);

    const member = await getMemberRecord(tenantId, existing.member_id);
    const { capacitySummary } = await assertLoanApplicationPolicy({
        tenantId,
        member,
        product,
        branchId: nextBranchId,
        applicationId,
        requestedAmount: sanitizedPayload.requested_amount,
        requestedTermCount: sanitizedPayload.requested_term_count,
        requestedRepaymentFrequency: sanitizedPayload.requested_repayment_frequency,
        guarantors: sanitizedPayload.guarantors ?? existing.loan_guarantors ?? [],
        collateralItems: sanitizedPayload.collateral_items ?? existing.collateral_items ?? [],
        enforceSubmissionGuards: false
    });

    const updatePayload = {
        purpose: sanitizedPayload.purpose,
        external_reference: applicationReference,
        requested_amount: sanitizedPayload.requested_amount,
        ...buildCapacitySnapshot(capacitySummary, sanitizedPayload.requested_amount),
        requested_term_count: sanitizedPayload.requested_term_count,
        requested_repayment_frequency: sanitizedPayload.requested_repayment_frequency,
        requested_interest_rate: product.annual_interest_rate,
        branch_id: nextBranchId,
        member_id: existing.member_id,
        product_id: nextProductId,
        status: "draft",
        rejection_reason: null,
        rejected_at: null,
        rejected_by: null,
        submitted_at: null,
        approval_count: 0,
        approved_at: null,
        approved_by: null,
        disbursement_ready_at: null
    };

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .update(updatePayload)
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_UPDATE_FAILED", "Unable to update loan application.", error);
    }

    await replaceChildren(applicationId, tenantId, payload.guarantors ?? existing.loan_guarantors, payload.collateral_items ?? existing.collateral_items);

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_UPDATED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: data
    });

    invalidateLoanApplicationsCountCache();
    return getExpandedApplication(tenantId, applicationId);
}

async function deleteLoanApplication(actor, applicationId) {
    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);
    ensureApplicationEditAllowed(actor, existing);

    if (existing.status !== "draft") {
        throw new AppError(400, "LOAN_APPLICATION_NOT_DELETABLE", "Only draft loan applications can be deleted.");
    }

    const { error } = await adminSupabase
        .from("loan_applications")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", applicationId);

    if (error) {
        throw new AppError(500, "LOAN_APPLICATION_DELETE_FAILED", "Unable to delete loan application.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_DELETED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing
    });

    invalidateLoanApplicationsCountCache();
    return {
        id: applicationId,
        deleted: true
    };
}

async function submitLoanApplication(actor, applicationId) {
    if (actor.role === ROLES.BRANCH_MANAGER) {
        throw new AppError(403, "FORBIDDEN", "Branch managers cannot submit loan applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (!["draft", "rejected"].includes(existing.status)) {
        throw new AppError(400, "LOAN_APPLICATION_NOT_SUBMITTABLE", "Only draft or rejected applications can be submitted.");
    }

    ensureApplicationEditAllowed(actor, { ...existing, status: "draft" });

    const member = await getMemberRecord(tenantId, existing.member_id);
    const product = await getActiveLoanProduct(tenantId, existing.product_id);
    const { capacitySummary } = await assertLoanApplicationPolicy({
        tenantId,
        member,
        product,
        branchId: existing.branch_id,
        applicationId,
        requestedAmount: existing.requested_amount,
        requestedTermCount: existing.requested_term_count,
        requestedRepaymentFrequency: existing.requested_repayment_frequency,
        guarantors: existing.loan_guarantors || [],
        collateralItems: existing.collateral_items || [],
        enforceSubmissionGuards: true
    });

    const capacitySnapshot = buildCapacitySnapshot(capacitySummary, existing.requested_amount);

    const submissionDecision = await submitLoanApplicationDecision({
        tenantId,
        applicationId,
        actorUserId: actor.user.id
    });

    const { error: capacitySnapshotError } = await adminSupabase
        .from("loan_applications")
        .update(capacitySnapshot)
        .eq("tenant_id", tenantId)
        .eq("id", applicationId);

    if (capacitySnapshotError) {
        throw new AppError(500, "LOAN_APPLICATION_CAPACITY_SNAPSHOT_SAVE_FAILED", "Unable to persist loan capacity indicators for this application.", capacitySnapshotError);
    }

    await creditRiskService.recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: (existing.loan_guarantors || []).map((row) => row.member_id),
        actorUserId: actor.user.id,
        source: "application_submit"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_SUBMITTED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: {
            application_id: submissionDecision.application_id,
            status: submissionDecision.status,
            submitted_at: submissionDecision.submitted_at,
            approval_count: submissionDecision.approval_count,
            approval_cycle: submissionDecision.approval_cycle,
            required_approval_count: submissionDecision.required_approval_count,
            approved_by: submissionDecision.approved_by,
            approved_at: submissionDecision.approved_at,
            rejected_by: submissionDecision.rejected_by,
            rejected_at: submissionDecision.rejected_at,
            rejection_reason: submissionDecision.rejection_reason,
            disbursement_ready_at: submissionDecision.disbursement_ready_at,
            ...capacitySnapshot
        }
    });

    invalidateLoanApplicationsCountCache();
    const expanded = await getExpandedApplication(tenantId, applicationId);
    await notifyLoanOfficersNewApplication({
        actor,
        application: expanded
    });

    return expanded;
}

async function appraiseLoanApplication(actor, applicationId, payload) {
    if (actor.role !== ROLES.LOAN_OFFICER) {
        throw new AppError(403, "FORBIDDEN", "Only loan officers can appraise applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (!["submitted", "appraised"].includes(existing.status)) {
        throw new AppError(400, "LOAN_APPLICATION_NOT_APPRAISABLE", "Only submitted applications can be appraised.");
    }

    assertBranchAccess({ auth: actor }, existing.branch_id);
    const product = await getActiveLoanProduct(tenantId, existing.product_id);

    if (payload.recommended_amount < product.min_amount || (product.max_amount && payload.recommended_amount > product.max_amount)) {
        throw new AppError(400, "LOAN_AMOUNT_OUT_OF_POLICY", "Recommended amount is outside the configured product limits.");
    }

    const appraisalDecision = await appraiseLoanApplicationDecision({
        tenantId,
        applicationId,
        actorUserId: actor.user.id,
        appraisalNotes: payload.appraisal_notes,
        riskRating: payload.risk_rating,
        recommendedAmount: payload.recommended_amount,
        recommendedTermCount: payload.recommended_term_count,
        recommendedInterestRate: payload.recommended_interest_rate,
        recommendedRepaymentFrequency: payload.recommended_repayment_frequency
    });

    const nextGuarantors = payload.guarantors ?? existing.loan_guarantors ?? [];
    const nextCollateralItems = payload.collateral_items ?? existing.collateral_items ?? [];
    await replaceChildren(applicationId, tenantId, nextGuarantors, nextCollateralItems);

    const guarantorMemberIds = Array.from(new Set([
        ...(existing.loan_guarantors || []).map((row) => row.member_id).filter(Boolean),
        ...nextGuarantors.map((row) => row.member_id).filter(Boolean)
    ]));

    await creditRiskService.recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: guarantorMemberIds,
        actorUserId: actor.user.id,
        source: "application_appraisal"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_APPRAISED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: {
            application_id: appraisalDecision.application_id,
            status: appraisalDecision.status,
            approval_cycle: appraisalDecision.approval_cycle,
            appraised_by: appraisalDecision.appraised_by,
            appraised_at: appraisalDecision.appraised_at,
            appraisal_notes: appraisalDecision.appraisal_notes,
            risk_rating: appraisalDecision.risk_rating,
            recommended_amount: appraisalDecision.recommended_amount,
            recommended_term_count: appraisalDecision.recommended_term_count,
            recommended_interest_rate: appraisalDecision.recommended_interest_rate,
            recommended_repayment_frequency: appraisalDecision.recommended_repayment_frequency
        }
    });

    invalidateLoanApplicationsCountCache();
    return getExpandedApplication(tenantId, applicationId);
}

async function approveLoanApplication(actor, applicationId, payload) {
    if (actor.role !== ROLES.BRANCH_MANAGER) {
        throw new AppError(403, "FORBIDDEN", "Only branch managers can approve loan applications.");
    }
    await assertTwoFactorStepUp(actor, payload, { action: "loan_application_approve" });

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (!["appraised", "approved"].includes(existing.status)) {
        throw new AppError(400, "LOAN_APPLICATION_NOT_APPROVABLE", "Only appraised applications can be approved.");
    }

    assertBranchAccess({ auth: actor }, existing.branch_id);

    if (existing.requested_by === actor.user.id) {
        throw new AppError(400, "MAKER_CHECKER_VIOLATION", "The application maker cannot approve the same application.");
    }

    const [member, product] = await Promise.all([
        getMemberRecord(tenantId, existing.member_id),
        getActiveLoanProduct(tenantId, existing.product_id)
    ]);
    const capacitySummary = await loanCapacityService.evaluateBorrowCapacity({
        tenantId,
        member,
        loanProduct: product,
        branchId: existing.branch_id,
        requestedAmount: existing.recommended_amount || existing.requested_amount,
        source: "loan_application_approval_validation"
    });

    if (capacitySummary.requires_guarantor && (existing.loan_guarantors || []).length < capacitySummary.minimum_guarantor_count) {
        throw new AppError(
            400,
            "LOAN_GUARANTOR_REQUIRED",
            `This loan product requires at least ${capacitySummary.minimum_guarantor_count} guarantor(s) before approval.`
        );
    }

    if (capacitySummary.requires_collateral && (existing.collateral_items || []).length < 1) {
        throw new AppError(
            400,
            "LOAN_COLLATERAL_REQUIRED",
            "This loan product requires collateral before approval."
        );
    }

    assertAllGuarantorsAccepted(existing);

    await creditRiskService.assertGuarantorExposureWithinLimits({
        tenantId,
        guarantors: existing.loan_guarantors || [],
        actorUserId: actor.user.id,
        source: "application_approval"
    });

    const approvalDecision = await approveLoanApplicationDecision({
        tenantId,
        applicationId,
        actorUserId: actor.user.id,
        notes: payload.notes || null
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_APPROVED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: {
            application_id: approvalDecision.application_id,
            status: approvalDecision.status,
            approval_count: approvalDecision.approval_count,
            approval_cycle: approvalDecision.approval_cycle,
            required_approval_count: approvalDecision.required_approval_count,
            approved_by: approvalDecision.approved_by,
            approved_at: approvalDecision.approved_at,
            disbursement_ready_at: approvalDecision.disbursement_ready_at,
            awaiting_additional_approvals: Boolean(approvalDecision.awaiting_additional_approvals)
        }
    });

    invalidateLoanApplicationsCountCache();
    const expanded = await getExpandedApplication(tenantId, applicationId);
    if (!approvalDecision.awaiting_additional_approvals) {
        await notifyLoanOfficersApprovedForDisbursement({
            actor,
            application: expanded
        });
        await notifyMemberLoanApplicationApproved({
            actor,
            application: expanded
        });
    }

    return expanded;
}

async function rejectLoanApplication(actor, applicationId, payload) {
    if (![ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER].includes(actor.role)) {
        throw new AppError(403, "FORBIDDEN", "Only branch managers or loan officers can reject loan applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (!["submitted", "appraised", "approved"].includes(existing.status)) {
        throw new AppError(400, "LOAN_APPLICATION_NOT_REJECTABLE", "Only submitted, appraised, or approved applications can be rejected.");
    }

    assertBranchAccess({ auth: actor }, existing.branch_id);

    if (existing.requested_by === actor.user.id) {
        throw new AppError(400, "MAKER_CHECKER_VIOLATION", "The application maker cannot reject the same application.");
    }

    const rejectionDecision = await rejectLoanApplicationDecision({
        tenantId,
        applicationId,
        actorUserId: actor.user.id,
        reason: payload.reason,
        notes: payload.notes || null
    });

    await creditRiskService.recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: (existing.loan_guarantors || []).map((row) => row.member_id),
        actorUserId: actor.user.id,
        source: "application_reject"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_REJECTED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: {
            application_id: rejectionDecision.application_id,
            status: rejectionDecision.status,
            approval_count: rejectionDecision.approval_count,
            approval_cycle: rejectionDecision.approval_cycle,
            required_approval_count: rejectionDecision.required_approval_count,
            rejected_by: rejectionDecision.rejected_by,
            rejected_at: rejectionDecision.rejected_at,
            rejection_reason: rejectionDecision.rejection_reason,
            approval_notes: rejectionDecision.approval_notes
        }
    });

    invalidateLoanApplicationsCountCache();
    const expanded = await getExpandedApplication(tenantId, applicationId);
    await notifyLoanOfficersReappraisalNeeded({
        actor,
        application: expanded,
        reason: payload.reason || payload.notes || ""
    });
    await notifyMemberLoanApplicationRejected({
        actor,
        application: expanded
    });

    return expanded;
}

async function initiateMobileLoanDisbursement(actor, existing, payload = {}) {
    const tenantId = actor.tenantId;
    const existingOrder = await getOpenLoanDisbursementOrderForApplication(existing.id);
    if (existingOrder) {
        const syncedOrder = await syncPendingLoanDisbursementOrder(existingOrder, "resume_existing");
        return {
            application: await getExpandedApplication(tenantId, existing.id),
            mobile_disbursement: buildLoanDisbursementOrderView(syncedOrder),
            existing_order: true
        };
    }

    const approvalGate = await approvalService.ensureOperationApproval({
        actor,
        tenantId,
        branchId: existing.branch_id,
        operationKey: "finance.loan_disburse",
        requestedAmount: existing.recommended_amount || existing.requested_amount,
        approvalRequestId: payload.approval_request_id || null,
        payload: {
            application_id: existing.id,
            member_id: existing.member_id,
            branch_id: existing.branch_id,
            principal_amount: existing.recommended_amount || existing.requested_amount,
            annual_interest_rate: existing.recommended_interest_rate || existing.requested_interest_rate || 0,
            term_count: existing.recommended_term_count || existing.requested_term_count,
            repayment_frequency: existing.recommended_repayment_frequency || existing.requested_repayment_frequency,
            disbursement_channel: "mobile_money",
            recipient_msisdn: payload.recipient_msisdn || existing.members?.phone || null,
            reference: payload.reference || existing.external_reference || null,
            description: payload.description || `Loan mobile disbursement for application ${existing.id}`
        },
        entityType: "loan_application",
        entityId: existing.id
    });

    if (approvalGate?.approval_required && approvalGate.status === "pending_approval") {
        return {
            approval_required: true,
            application_id: existing.id,
            ...approvalGate
        };
    }

    const approvalPayload = approvalGate?.request?.payload_json && typeof approvalGate.request.payload_json === "object"
        ? approvalGate.request.payload_json
        : {};
    const recipientMsisdn = normalizePhone(payload.recipient_msisdn || approvalPayload.recipient_msisdn || existing.members?.phone || "");
    if (!recipientMsisdn) {
        throw new AppError(400, "LOAN_DISBURSEMENT_PHONE_REQUIRED", "Member mobile number is required for mobile money disbursement.");
    }

    const amount = Number(existing.recommended_amount || existing.requested_amount || 0);
    const reference = payload.reference || approvalPayload.reference || existing.external_reference || null;
    const description = payload.description || approvalPayload.description || `Loan mobile disbursement for application ${existing.id}`;
    const orderId = randomUUID();
    const externalId = buildLoanDisbursementExternalId(orderId);
    const baseMetadata = {
        order_id: orderId,
        application_id: existing.id,
        member_id: existing.member_id,
        tenant_id: tenantId,
        purpose: "loan_disbursement",
        created_by_user_id: actor.user.id,
        member_name: existing.members?.full_name || null,
        member_no: existing.members?.member_no || null
    };

    let order = await createLoanDisbursementOrder({
        id: orderId,
        tenant_id: tenantId,
        branch_id: existing.branch_id,
        application_id: existing.id,
        member_id: existing.member_id,
        created_by_user_id: actor.user.id,
        approval_request_id: approvalGate?.approval_request_id || null,
        gateway: "snippe",
        channel: "mobile_money",
        provider: null,
        msisdn: recipientMsisdn,
        amount,
        currency: env.snippeCurrency,
        status: "created",
        external_id: externalId,
        provider_ref: null,
        reference,
        description,
        metadata: baseMetadata
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_disbursement_orders",
        action: "LOAN_MOBILE_DISBURSEMENT_CREATED",
        entityType: "loan_disbursement_order",
        entityId: order.id,
        afterData: {
            application_id: existing.id,
            member_id: existing.member_id,
            amount,
            msisdn: recipientMsisdn,
            approval_request_id: approvalGate?.approval_request_id || null
        }
    });

    try {
        const payoutIntent = await createPayoutIntent({
            amount,
            currency: env.snippeCurrency,
            externalId,
            accountNumber: recipientMsisdn,
            customer: {
                name: existing.members?.full_name || "SACCO Member",
                email: existing.members?.email || null
            },
            metadata: baseMetadata,
            idempotencyKey: order.id
        });

        const normalizedStatus = normalizePayoutStatus(payoutIntent.status);
        order = await updateLoanDisbursementOrder(order.id, {
            status: normalizedStatus === "completed" ? "completed" : normalizedStatus === "failed" ? "failed" : normalizedStatus === "expired" ? "expired" : "pending",
            provider_ref: payoutIntent.providerRef,
            provider: payoutIntent.provider,
            gateway_request: payoutIntent.requestPayload,
            gateway_response: payoutIntent.responsePayload,
            expires_at: payoutIntent.expiresAt || null,
            completed_at: normalizedStatus === "completed" ? (payoutIntent.completedAt || new Date().toISOString()) : null,
            failed_at: normalizedStatus === "failed" ? new Date().toISOString() : null,
            expired_at: normalizedStatus === "expired" ? new Date().toISOString() : null,
            error_code: normalizedStatus === "failed" ? "SNIPPE_PAYOUT_FAILED" : normalizedStatus === "expired" ? "SNIPPE_PAYOUT_EXPIRED" : null,
            error_message: normalizedStatus === "failed" ? "The mobile money disbursement failed." : normalizedStatus === "expired" ? "The mobile money disbursement expired." : null,
            metadata: {
                ...baseMetadata,
                latest_provider_status: payoutIntent.status || null
            }
        });

        if (normalizedStatus === "completed") {
            order = await finalizeCompletedLoanDisbursementOrder(order, {
                providerRef: payoutIntent.providerRef,
                provider: payoutIntent.provider,
                completedAt: payoutIntent.completedAt,
                status: payoutIntent.status || "completed"
            }, "snippe_initiate");
        }

        return {
            application: await getExpandedApplication(tenantId, existing.id),
            mobile_disbursement: buildLoanDisbursementOrderView(order)
        };
    } catch (error) {
        await updateLoanDisbursementOrder(order.id, {
            status: "failed",
            failed_at: new Date().toISOString(),
            error_code: error?.code || "SNIPPE_PAYOUT_INIT_FAILED",
            error_message: error?.message || "Unable to initiate mobile money disbursement."
        }).catch(() => null);
        throw error;
    }
}

async function disburseLoanApplication(actor, applicationId, payload) {
    if (![ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)) {
        throw new AppError(403, "FORBIDDEN", "You are not allowed to disburse approved loan applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (existing.status !== "approved") {
        throw new AppError(400, "LOAN_APPLICATION_NOT_APPROVED", "Only approved applications can be disbursed.");
    }

    if (existing.loan_id) {
        throw new AppError(400, "LOAN_ALREADY_DISBURSED", "This application has already been disbursed.");
    }

    const disbursementAmount = Number(existing.recommended_amount || existing.requested_amount || 0);
    if (disbursementAmount >= env.highValueThresholdTzs) {
        await assertTwoFactorStepUp(actor, payload, { action: "loan_application_disburse" });
    }

    assertAllGuarantorsAccepted(existing);

    assertBranchAccess({ auth: actor }, existing.branch_id);

    const approvedPayload = payload.approval_request_id
        ? await getLoanDisbursementApprovalPayload(tenantId, payload.approval_request_id, applicationId)
        : {};
    const effectivePayload = {
        ...payload,
        reference: approvedPayload.reference || payload.reference || null,
        description: approvedPayload.description || payload.description || null,
        disbursement_channel: approvedPayload.disbursement_channel || payload.disbursement_channel || "cash",
        recipient_msisdn: approvedPayload.recipient_msisdn || payload.recipient_msisdn || null
    };

    if (effectivePayload.disbursement_channel === "mobile_money") {
        return initiateMobileLoanDisbursement(actor, existing, effectivePayload);
    }

    const disburseResult = await financeService.loanDisburse(
        actor,
        {
            tenant_id: tenantId,
            application_id: applicationId,
            approval_request_id: effectivePayload.approval_request_id || null,
            member_id: existing.member_id,
            branch_id: existing.branch_id,
            principal_amount: existing.recommended_amount || existing.requested_amount,
            annual_interest_rate: existing.recommended_interest_rate || existing.requested_interest_rate || 0,
            term_count: existing.recommended_term_count || existing.requested_term_count,
            repayment_frequency: existing.recommended_repayment_frequency || existing.requested_repayment_frequency,
            reference: effectivePayload.reference || existing.external_reference || null,
            description: effectivePayload.description || `Loan disbursement for application ${applicationId}`,
            receipt_ids: effectivePayload.receipt_ids || []
        },
        {
            skipWorkflow: true,
            skipApprovalGate: true
        }
    );

    if (disburseResult?.approval_required) {
        return {
            approval_required: true,
            application_id: applicationId,
            ...disburseResult
        };
    }
    const expanded = await applyLoanApplicationDisbursedState({
        tenantId,
        actorUserId: actor.user.id,
        application: existing,
        disburseResult
    });

    return {
        application: expanded,
        disbursement: disburseResult
    };
}

async function respondGuarantorConsent(actor, applicationId, payload = {}) {
    if (actor.role !== ROLES.MEMBER) {
        throw new AppError(403, "FORBIDDEN", "Only guarantor members can respond to guarantor requests.");
    }

    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const guarantorMember = await getMemberByUser(tenantId, actor.user.id);
    const application = await getExpandedApplication(tenantId, applicationId);

    if (!["submitted", "appraised"].includes(application.status)) {
        throw new AppError(
            400,
            "GUARANTOR_CONSENT_WINDOW_CLOSED",
            "Guarantor response is only allowed while application is submitted or appraised."
        );
    }

    const { data: current, error: currentError } = await adminSupabase
        .from("loan_guarantors")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("application_id", applicationId)
        .eq("member_id", guarantorMember.id)
        .maybeSingle();

    if (currentError) {
        throw new AppError(500, "GUARANTOR_CONSENT_LOOKUP_FAILED", "Unable to load guarantor assignment.", currentError);
    }

    if (!current) {
        throw new AppError(404, "GUARANTOR_REQUEST_NOT_FOUND", "No guarantor request was found for your member profile.");
    }

    const patch = {
        consent_status: payload.decision,
        consented_at: new Date().toISOString(),
        notes: Object.prototype.hasOwnProperty.call(payload, "notes")
            ? (payload.notes || null)
            : current.notes || null
    };

    const { error: updateError } = await adminSupabase
        .from("loan_guarantors")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("application_id", applicationId)
        .eq("member_id", guarantorMember.id);

    if (updateError) {
        throw new AppError(500, "GUARANTOR_CONSENT_UPDATE_FAILED", "Unable to update guarantor consent.", updateError);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_guarantors",
        action: payload.decision === "accepted"
            ? "LOAN_GUARANTOR_CONSENT_ACCEPTED"
            : "LOAN_GUARANTOR_CONSENT_REJECTED",
        entityType: "loan_guarantor",
        entityId: current.id,
        beforeData: current,
        afterData: {
            ...current,
            ...patch
        }
    });

    const expanded = await getExpandedApplication(tenantId, applicationId);
    if (payload.decision === "rejected") {
        await notifyLoanOfficerGuarantorDeclined({
            actor,
            application: expanded,
            guarantorMemberId: guarantorMember.id
        });
    }

    return expanded;
}

module.exports = {
    listLoanApplications,
    listGuarantorRequests,
    createLoanApplication,
    updateLoanApplication,
    deleteLoanApplication,
    submitLoanApplication,
    appraiseLoanApplication,
    approveLoanApplication,
    rejectLoanApplication,
    disburseLoanApplication,
    getLoanDisbursementOrderStatus,
    processSnippeLoanDisbursementPayoutEvent,
    respondGuarantorConsent
};
