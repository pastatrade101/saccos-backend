const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { logAudit } = require("../../services/audit.service");
const { assertTwoFactorStepUp } = require("../../services/two-factor.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { ensureOperationApproval, markApprovalRequestExecuted } = require("../approvals/approvals.service");
const { getPolicyForOperation } = require("../approvals/approvals.service");
const { createInAppNotifications } = require("../notifications/notifications.service");
const AppError = require("../../utils/app-error");

const POLICY_ACCOUNT_FIELDS = [
    "settlement_account_id",
    "investment_control_account_id",
    "investment_income_account_id"
];

function roundMoney(value) {
    return Number(Number(value || 0).toFixed(2));
}

function roundUnits(value) {
    return Number(Number(value || 0).toFixed(6));
}

function normalizePercent(value, fallback = null) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Number((numeric <= 1 ? numeric * 100 : numeric).toFixed(2));
}

function normalizeWholeNumber(value, fallback = null) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.round(numeric);
}

function buildPolicyViolation({
    rule,
    severity,
    message,
    currentValue,
    requiredValue,
    details = {}
}) {
    return {
        violation: true,
        policy_violation: true,
        rule,
        severity,
        message,
        current_value: currentValue,
        required_value: requiredValue,
        ...details
    };
}

function normalizePagination(query = {}) {
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 25), 1), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    return { page, limit, from, to };
}

function buildReference(prefix) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${stamp}-${nonce}`;
}

async function getTreasuryPolicyRecord(tenantId) {
    const { data, error } = await adminSupabase
        .from("treasury_policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "TREASURY_POLICY_FETCH_FAILED", "Unable to load treasury policy.", error);
    }

    if (!data) {
        throw new AppError(409, "TREASURY_POLICY_MISSING", "Treasury policy is not configured. Apply migration 081 and seed treasury defaults.");
    }

    return data;
}

async function listAccounts(tenantId, accountIds = []) {
    const normalizedIds = [...new Set(accountIds.filter(Boolean))];
    if (!normalizedIds.length) {
        return [];
    }

    const { data, error } = await adminSupabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type, system_tag")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .in("id", normalizedIds);

    if (error) {
        throw new AppError(500, "TREASURY_ACCOUNT_FETCH_FAILED", "Unable to load treasury accounts.", error);
    }

    return data || [];
}

async function assertTenantAccounts(tenantId, accountIds = []) {
    const accounts = await listAccounts(tenantId, accountIds);
    if (accounts.length !== [...new Set(accountIds.filter(Boolean))].length) {
        throw new AppError(400, "TREASURY_ACCOUNT_INVALID", "One or more selected ledger accounts are invalid for this workspace.");
    }

    return accounts;
}

async function getPolicyWithAccounts(tenantId) {
    const [policy, approvalPolicy] = await Promise.all([
        getTreasuryPolicyRecord(tenantId),
        getPolicyForOperation(tenantId, "treasury.order_execute")
    ]);
    const accounts = await listAccounts(tenantId, POLICY_ACCOUNT_FIELDS.map((field) => policy[field]));
    const accountMap = new Map(accounts.map((account) => [account.id, account]));

    return {
        ...policy,
        minimum_cash_buffer: roundMoney(policy.minimum_cash_buffer ?? policy.minimum_liquidity_reserve ?? 0),
        loan_liquidity_protection_ratio: Number(policy.loan_liquidity_protection_ratio || 0),
        max_asset_allocation_percent: policy.max_asset_allocation_percent != null ? Number(policy.max_asset_allocation_percent) : null,
        max_single_asset_percent: policy.max_single_asset_percent != null ? Number(policy.max_single_asset_percent) : null,
        valuation_update_frequency_days: Number(policy.valuation_update_frequency_days || 30),
        policy_version: Number(policy.policy_version || 1),
        approval_threshold: roundMoney(policy.approval_threshold ?? approvalPolicy?.threshold_amount ?? 0),
        approval_threshold_amount: roundMoney(policy.approval_threshold ?? approvalPolicy?.threshold_amount ?? 0),
        accounts: {
            settlement: accountMap.get(policy.settlement_account_id) || null,
            investments: accountMap.get(policy.investment_control_account_id) || null,
            income: accountMap.get(policy.investment_income_account_id) || null
        }
    };
}

async function syncTreasuryApprovalThreshold(tenantId, thresholdAmount) {
    const currentPolicy = await getPolicyForOperation(tenantId, "treasury.order_execute");

    const { error } = await adminSupabase
        .from("approval_policies")
        .upsert({
            tenant_id: tenantId,
            operation_key: "treasury.order_execute",
            enabled: currentPolicy.enabled,
            threshold_amount: roundMoney(thresholdAmount || 0),
            required_checker_count: currentPolicy.required_checker_count,
            allowed_maker_roles: currentPolicy.allowed_maker_roles,
            allowed_checker_roles: currentPolicy.allowed_checker_roles,
            sla_minutes: currentPolicy.sla_minutes
        }, { onConflict: "tenant_id,operation_key" });

    if (error) {
        throw new AppError(500, "TREASURY_APPROVAL_SYNC_FAILED", "Unable to synchronize treasury approval threshold.", error);
    }
}

async function insertPolicyHistory({
    policyId,
    previousValues,
    newValues,
    changedBy,
    changeReason
}) {
    const { error } = await adminSupabase
        .from("treasury_policy_history")
        .insert({
            policy_id: policyId,
            previous_values: previousValues,
            new_values: newValues,
            changed_by: changedBy,
            change_reason: changeReason || null
        });

    if (error) {
        throw new AppError(500, "TREASURY_POLICY_HISTORY_FAILED", "Unable to write treasury policy history.", error);
    }
}

async function loadTreasuryRecipients(tenantId, { roles = [], excludeUserIds = [] } = {}) {
    const distinctRoles = Array.from(new Set((roles || []).filter(Boolean)));
    if (!tenantId || !distinctRoles.length) {
        return [];
    }

    const { data, error } = await adminSupabase
        .from("user_profiles")
        .select("user_id, full_name, role")
        .eq("tenant_id", tenantId)
        .in("role", distinctRoles)
        .eq("is_active", true)
        .is("deleted_at", null);

    if (error) {
        throw new AppError(500, "TREASURY_NOTIFICATION_RECIPIENTS_FAILED", "Unable to load treasury notification recipients.", error);
    }

    const excluded = new Set((excludeUserIds || []).filter(Boolean));

    return (data || [])
        .filter((row) => row.user_id && !excluded.has(row.user_id))
        .map((row) => ({
            user_id: row.user_id,
            full_name: row.full_name || "Treasury staff",
            role: row.role || null
        }));
}

async function notifyTreasuryUsers({
    tenantId,
    branchId = null,
    eventType,
    eventKey,
    message,
    metadata = {},
    roles = [ROLES.TREASURY_OFFICER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
    excludeUserIds = []
}) {
    try {
        const recipients = await loadTreasuryRecipients(tenantId, { roles, excludeUserIds });
        if (!recipients.length) {
            return { in_app_delivered: 0, in_app_skipped: 0 };
        }

        const result = await createInAppNotifications({
            tenantId,
            branchId,
            eventType,
            eventKey,
            message,
            metadata,
            recipients
        });

        return {
            in_app_delivered: result.delivered,
            in_app_skipped: result.skipped
        };
    } catch (error) {
        console.warn("[treasury] notification dispatch failed", {
            tenantId,
            eventType,
            message: error?.message || "unknown_error"
        });
        return { in_app_delivered: 0, in_app_skipped: 0 };
    }
}

async function getAssetOrThrow(tenantId, assetId) {
    const { data, error } = await adminSupabase
        .from("treasury_assets")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", assetId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "TREASURY_ASSET_FETCH_FAILED", "Unable to load treasury asset.", error);
    }

    if (!data) {
        throw new AppError(404, "TREASURY_ASSET_NOT_FOUND", "Treasury asset was not found.");
    }

    return data;
}

async function getOrderOrThrow(tenantId, orderId) {
    const { data, error } = await adminSupabase
        .from("treasury_orders")
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)")
        .eq("tenant_id", tenantId)
        .eq("id", orderId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "TREASURY_ORDER_FETCH_FAILED", "Unable to load treasury order.", error);
    }

    if (!data) {
        throw new AppError(404, "TREASURY_ORDER_NOT_FOUND", "Treasury order was not found.");
    }

    return data;
}

async function getPositionRecord(tenantId, assetId) {
    const { data, error } = await adminSupabase
        .from("treasury_portfolio_positions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("asset_id", assetId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "TREASURY_POSITION_FETCH_FAILED", "Unable to load treasury position.", error);
    }

    return data || null;
}

async function getCashPosition(tenantId) {
    const { data, error } = await adminSupabase
        .from("cash_position_view")
        .select("cash_balance, account_id, account_code, account_name")
        .eq("tenant_id", tenantId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "TREASURY_CASH_POSITION_FAILED", "Unable to load treasury cash position.", error);
    }

    return {
        cash_balance: roundMoney(data?.cash_balance),
        account_id: data?.account_id || null,
        account_code: data?.account_code || null,
        account_name: data?.account_name || "Cash on Hand"
    };
}

async function getOutstandingLoanObligations(tenantId) {
    const { data, error } = await adminSupabase
        .from("loans")
        .select("outstanding_principal, accrued_interest")
        .eq("tenant_id", tenantId)
        .in("status", ["active", "in_arrears"]);

    if (error) {
        throw new AppError(500, "TREASURY_LOAN_OBLIGATIONS_FAILED", "Unable to compute outstanding loan obligations.", error);
    }

    return roundMoney((data || []).reduce(
        (sum, row) => sum + Number(row.outstanding_principal || 0) + Number(row.accrued_interest || 0),
        0
    ));
}

async function getOutstandingLoanPrincipal(tenantId) {
    const { data, error } = await adminSupabase
        .from("loans")
        .select("outstanding_principal")
        .eq("tenant_id", tenantId)
        .in("status", ["active", "in_arrears"]);

    if (error) {
        throw new AppError(500, "TREASURY_LOAN_EXPOSURE_FAILED", "Unable to compute treasury loan exposure.", error);
    }

    return roundMoney((data || []).reduce(
        (sum, row) => sum + Number(row.outstanding_principal || 0),
        0
    ));
}

async function getPortfolioTotals(tenantId) {
    const { data, error } = await adminSupabase
        .from("treasury_portfolio_positions")
        .select("total_cost, current_market_value, unrealized_gain")
        .eq("tenant_id", tenantId);

    if (error) {
        throw new AppError(500, "TREASURY_PORTFOLIO_TOTALS_FAILED", "Unable to load treasury portfolio totals.", error);
    }

    return (data || []).reduce((accumulator, row) => ({
        total_cost: roundMoney(accumulator.total_cost + Number(row.total_cost || 0)),
        current_market_value: roundMoney(accumulator.current_market_value + Number(row.current_market_value || 0)),
        unrealized_gain: roundMoney(accumulator.unrealized_gain + Number(row.unrealized_gain || 0))
    }), {
        total_cost: 0,
        current_market_value: 0,
        unrealized_gain: 0
    });
}

async function getInvestmentIncomeYtd(tenantId) {
    const currentYearStart = `${new Date().getUTCFullYear()}-01-01`;
    const { data, error } = await adminSupabase
        .from("treasury_income")
        .select("amount")
        .eq("tenant_id", tenantId)
        .gte("received_date", currentYearStart);

    if (error) {
        throw new AppError(500, "TREASURY_INCOME_TOTAL_FAILED", "Unable to load treasury income totals.", error);
    }

    return roundMoney((data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
}

async function getExpectedLoanDisbursements(tenantId) {
    const { data, error } = await adminSupabase
        .from("loan_applications")
        .select("requested_amount, recommended_amount")
        .eq("tenant_id", tenantId)
        .eq("status", "approved")
        .is("loan_id", null);

    if (error) {
        throw new AppError(500, "TREASURY_EXPECTED_DISBURSEMENTS_FAILED", "Unable to load expected loan disbursements.", error);
    }

    return roundMoney((data || []).reduce((sum, row) => (
        sum + Number(row.recommended_amount || row.requested_amount || 0)
    ), 0));
}

async function getExpectedRepayments(tenantId, withinDays = 30) {
    const today = new Date();
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + Math.max(0, Number(withinDays || 0)));

    const { data, error } = await adminSupabase
        .from("loan_schedules")
        .select("principal_due, interest_due, principal_paid, interest_paid")
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "partial", "overdue"])
        .gte("due_date", today.toISOString().slice(0, 10))
        .lte("due_date", horizon.toISOString().slice(0, 10));

    if (error) {
        throw new AppError(500, "TREASURY_EXPECTED_REPAYMENTS_FAILED", "Unable to load expected repayments.", error);
    }

    return roundMoney((data || []).reduce((sum, row) => {
        const principalOutstanding = Number(row.principal_due || 0) - Number(row.principal_paid || 0);
        const interestOutstanding = Number(row.interest_due || 0) - Number(row.interest_paid || 0);
        return sum + Math.max(0, principalOutstanding) + Math.max(0, interestOutstanding);
    }, 0));
}

async function getOpenTreasuryOrdersAmount(tenantId) {
    const { data, error } = await adminSupabase
        .from("treasury_orders")
        .select("total_amount")
        .eq("tenant_id", tenantId)
        .in("status", ["pending_review", "pending_approval", "approved"]);

    if (error) {
        throw new AppError(500, "TREASURY_OPEN_ORDERS_FAILED", "Unable to load open treasury orders.", error);
    }

    return roundMoney((data || []).reduce((sum, row) => sum + Number(row.total_amount || 0), 0));
}

async function calculateInvestableAmount(tenantId) {
    const [policy, cashPosition, outstandingLoans, portfolioTotals] = await Promise.all([
        getTreasuryPolicyRecord(tenantId),
        getCashPosition(tenantId),
        getOutstandingLoanObligations(tenantId),
        getPortfolioTotals(tenantId)
    ]);

    const totalCash = roundMoney(cashPosition.cash_balance);
    const ratioReserve = roundMoney(totalCash * (Number(policy.liquidity_reserve_ratio || 0) / 100));
    const minimumBuffer = roundMoney(policy.minimum_cash_buffer ?? policy.minimum_liquidity_reserve ?? 0);
    const loanProtectionAmount = roundMoney(outstandingLoans * (Number(policy.loan_liquidity_protection_ratio || 0) / 100));
    const minimumReserveRequired = Math.max(ratioReserve, minimumBuffer, loanProtectionAmount);
    const investableAmount = Math.max(0, roundMoney(totalCash - minimumReserveRequired));

    return {
        total_cash: totalCash,
        outstanding_loan_obligations: outstandingLoans,
        outstanding_loans: outstandingLoans,
        liquidity_reserve_ratio: Number(policy.liquidity_reserve_ratio || 0),
        reserve_ratio: Number(policy.liquidity_reserve_ratio || 0),
        minimum_liquidity_reserve: roundMoney(policy.minimum_liquidity_reserve),
        minimum_cash_buffer: minimumBuffer,
        loan_liquidity_protection_ratio: Number(policy.loan_liquidity_protection_ratio || 0),
        loan_liquidity_protection_amount: loanProtectionAmount,
        minimum_reserve_required: minimumReserveRequired,
        required_liquidity_reserve: minimumReserveRequired,
        protected_liquidity: minimumReserveRequired,
        available_investable_cash: investableAmount,
        investable_cash: investableAmount,
        total_invested_cost: portfolioTotals.total_cost,
        total_portfolio_value: portfolioTotals.current_market_value,
        total_unrealized_gain: portfolioTotals.unrealized_gain,
        safeguard_status: investableAmount > 0 ? "healthy" : "blocked"
    };
}

async function evaluateOrderPolicy(tenantId, {
    asset,
    orderType,
    totalAmount,
    units
}) {
    const [policy, liquidity, position, portfolioRows] = await Promise.all([
        getPolicyWithAccounts(tenantId),
        calculateInvestableAmount(tenantId),
        getPositionRecord(tenantId, asset.id),
        adminSupabase
            .from("treasury_portfolio_positions")
            .select("asset_id, current_market_value, treasury_assets(asset_type)")
            .eq("tenant_id", tenantId)
    ]);

    if (portfolioRows.error) {
        throw new AppError(500, "TREASURY_POLICY_PORTFOLIO_FAILED", "Unable to evaluate treasury portfolio exposure.", portfolioRows.error);
    }

    const numericAmount = roundMoney(totalAmount);
    const violations = [];

    if (policy.max_single_order_amount !== null && numericAmount > Number(policy.max_single_order_amount || 0)) {
        violations.push(buildPolicyViolation({
            rule: "max_single_order_amount",
            severity: "warning",
            message: "Order exceeds the treasury single-order amount limit.",
            currentValue: numericAmount,
            requiredValue: roundMoney(policy.max_single_order_amount)
        }));
    }

    if (orderType === "buy") {
        const remainingCash = roundMoney(Number(liquidity.total_cash || 0) - numericAmount);
        const postOrderLiquidityRatio = Number(liquidity.total_cash || 0) > 0
            ? Number(((remainingCash / Number(liquidity.total_cash || 0)) * 100).toFixed(2))
            : 0;
        const reserveAmountRequired = roundMoney(Number(liquidity.total_cash || 0) * (Number(policy.liquidity_reserve_ratio || 0) / 100));
        const loanProtectionRequired = roundMoney(Number(liquidity.outstanding_loans || 0) * (Number(policy.loan_liquidity_protection_ratio || 0) / 100));

        if (remainingCash < reserveAmountRequired) {
            violations.push(buildPolicyViolation({
                rule: "liquidity_reserve",
                severity: "block",
                message: "This order would breach the treasury liquidity reserve ratio.",
                currentValue: remainingCash,
                requiredValue: reserveAmountRequired,
                details: {
                    reserve_ratio: Number(policy.liquidity_reserve_ratio || 0),
                    post_order_ratio: postOrderLiquidityRatio
                }
            }));
        }

        if (remainingCash < Number(policy.minimum_cash_buffer || 0)) {
            violations.push(buildPolicyViolation({
                rule: "minimum_cash_buffer",
                severity: "block",
                message: "This order would reduce cash below the minimum treasury cash buffer.",
                currentValue: remainingCash,
                requiredValue: roundMoney(policy.minimum_cash_buffer || 0)
            }));
        }

        if (remainingCash < loanProtectionRequired) {
            violations.push(buildPolicyViolation({
                rule: "loan_liquidity_protection",
                severity: "block",
                message: "This order would reduce cash below the loan liquidity protection threshold.",
                currentValue: remainingCash,
                requiredValue: loanProtectionRequired
            }));
        }

        const rows = portfolioRows.data || [];
        const currentAssetMarketValue = Number(position?.current_market_value || 0);
        const projectedAssetMarketValue = currentAssetMarketValue + numericAmount;
        const projectedPortfolioValue = Number(liquidity.total_portfolio_value || 0) + numericAmount;
        const currentAssetTypeMarketValue = rows.reduce((sum, row) => {
            return (row?.treasury_assets?.asset_type || "") === (asset.asset_type || "")
                ? sum + Number(row.current_market_value || 0)
                : sum;
        }, 0);
        const projectedAssetTypeMarketValue = currentAssetTypeMarketValue + numericAmount;
        const projectedAssetAllocationPercent = projectedPortfolioValue > 0
            ? Number(((projectedAssetTypeMarketValue / projectedPortfolioValue) * 100).toFixed(2))
            : 0;
        const projectedSingleAssetPercent = projectedPortfolioValue > 0
            ? Number(((projectedAssetMarketValue / projectedPortfolioValue) * 100).toFixed(2))
            : 0;

        if (
            policy.max_asset_allocation_percent !== null
            && projectedAssetAllocationPercent > Number(policy.max_asset_allocation_percent || 0)
        ) {
            violations.push(buildPolicyViolation({
                rule: "max_asset_allocation",
                severity: "warning",
                message: "Order exceeds treasury allocation policy for this asset type.",
                currentValue: projectedAssetAllocationPercent,
                requiredValue: Number(policy.max_asset_allocation_percent || 0),
                details: {
                    asset_type: asset.asset_type || null
                }
            }));
        }

        if (
            policy.max_single_asset_percent !== null
            && projectedSingleAssetPercent > Number(policy.max_single_asset_percent || 0)
        ) {
            violations.push(buildPolicyViolation({
                rule: "max_single_asset",
                severity: "warning",
                message: "Order exceeds treasury concentration policy for a single asset.",
                currentValue: projectedSingleAssetPercent,
                requiredValue: Number(policy.max_single_asset_percent || 0),
                details: {
                    asset_id: asset.id
                }
            }));
        }
    }

    return {
        policy,
        liquidity,
        position,
        order_amount: numericAmount,
        units: roundUnits(units),
        violations,
        blocking_violations: violations.filter((item) => item.severity === "block"),
        warning_violations: violations.filter((item) => item.severity === "warning")
    };
}

function buildPolicySnapshot(policy = {}) {
    return {
        liquidity_reserve_ratio: Number(policy.liquidity_reserve_ratio || 0),
        minimum_liquidity_reserve: roundMoney(policy.minimum_liquidity_reserve || 0),
        minimum_cash_buffer: roundMoney(policy.minimum_cash_buffer || 0),
        loan_liquidity_protection_ratio: Number(policy.loan_liquidity_protection_ratio || 0),
        max_asset_allocation_percent: policy.max_asset_allocation_percent != null ? Number(policy.max_asset_allocation_percent) : null,
        max_single_asset_percent: policy.max_single_asset_percent != null ? Number(policy.max_single_asset_percent) : null,
        max_single_order_amount: policy.max_single_order_amount != null ? roundMoney(policy.max_single_order_amount) : null,
        approval_threshold: roundMoney(policy.approval_threshold || 0),
        valuation_update_frequency_days: Number(policy.valuation_update_frequency_days || 30),
        policy_version: Number(policy.policy_version || 1)
    };
}

function buildPolicyUpdateSnapshot(row = {}) {
    return {
        tenant_id: row.tenant_id,
        liquidity_reserve_ratio: Number(row.liquidity_reserve_ratio || 0),
        minimum_liquidity_reserve: roundMoney(row.minimum_liquidity_reserve || 0),
        minimum_cash_buffer: roundMoney(row.minimum_cash_buffer || 0),
        loan_liquidity_protection_ratio: Number(row.loan_liquidity_protection_ratio || 0),
        max_asset_allocation_percent: row.max_asset_allocation_percent != null ? Number(row.max_asset_allocation_percent) : null,
        max_single_asset_percent: row.max_single_asset_percent != null ? Number(row.max_single_asset_percent) : null,
        max_single_order_amount: row.max_single_order_amount != null ? roundMoney(row.max_single_order_amount) : null,
        approval_threshold: roundMoney(row.approval_threshold || 0),
        valuation_update_frequency_days: Number(row.valuation_update_frequency_days || 30),
        policy_version: Number(row.policy_version || 1),
        settlement_account_id: row.settlement_account_id || null,
        investment_control_account_id: row.investment_control_account_id || null,
        investment_income_account_id: row.investment_income_account_id || null,
        updated_by: row.updated_by || null,
        updated_at: row.updated_at || null
    };
}

async function ensureLiquidityGuardrail(tenantId, amount) {
    const policyCheck = await evaluateOrderPolicy(tenantId, {
        asset: { id: "__liquidity__", asset_type: "__liquidity__" },
        orderType: "buy",
        totalAmount: amount,
        units: 0
    });

    if (policyCheck.blocking_violations.length) {
        const primary = policyCheck.blocking_violations[0];
        throw new AppError(
            409,
            "TREASURY_POLICY_BLOCKED",
            primary.message,
            {
                ...primary,
                violations: policyCheck.violations,
                liquidity: policyCheck.liquidity
            }
        );
    }

    return policyCheck.liquidity;
}

async function validatePolicyAccounts(tenantId, payload) {
    const accountIds = POLICY_ACCOUNT_FIELDS.map((field) => payload[field]).filter(Boolean);
    if (accountIds.length) {
        await assertTenantAccounts(tenantId, accountIds);
    }
}

async function ensureAssetLedgerAccounts(tenantId, asset, policy) {
    const accountIds = [
        asset.asset_account_id || policy.investment_control_account_id,
        asset.income_account_id || policy.investment_income_account_id,
        policy.settlement_account_id
    ].filter(Boolean);
    const accounts = await assertTenantAccounts(tenantId, accountIds);
    const accountMap = new Map(accounts.map((account) => [account.id, account]));

    return {
        settlement: accountMap.get(policy.settlement_account_id) || null,
        investments: accountMap.get(asset.asset_account_id || policy.investment_control_account_id) || null,
        income: accountMap.get(asset.income_account_id || policy.investment_income_account_id) || null
    };
}

async function postTreasuryJournalEntry({
    tenantId,
    actorUserId,
    sourceType,
    reference,
    description,
    transactionDate,
    lines
}) {
    const { data, error } = await adminSupabase.rpc("post_journal_entry", {
        p_tenant_id: tenantId,
        p_reference: reference,
        p_description: description,
        p_entry_date: transactionDate,
        p_created_by: actorUserId,
        p_source_type: sourceType,
        p_lines: lines
    });

    if (error || !data) {
        throw new AppError(500, "TREASURY_LEDGER_POST_FAILED", "Unable to post treasury entry to the ledger.", error);
    }

    return data;
}

async function persistPosition({
    tenantId,
    assetId,
    unitsOwned,
    averagePrice,
    totalCost,
    currentPrice,
    valuedAt = null
}) {
    const normalizedUnits = roundUnits(unitsOwned);
    const normalizedAverage = roundMoney(averagePrice);
    const normalizedCost = roundMoney(totalCost);
    const normalizedCurrentPrice = roundMoney(currentPrice);
    const currentMarketValue = roundMoney(normalizedUnits * normalizedCurrentPrice);
    const unrealizedGain = roundMoney(currentMarketValue - normalizedCost);
    const portfolioReturnPercent = normalizedCost > 0
        ? Number(((unrealizedGain / normalizedCost) * 100).toFixed(4))
        : 0;

    const patch = {
        tenant_id: tenantId,
        asset_id: assetId,
        units_owned: normalizedUnits,
        average_price: normalizedAverage,
        total_cost: normalizedCost,
        current_price: normalizedCurrentPrice,
        current_market_value: currentMarketValue,
        unrealized_gain: unrealizedGain,
        portfolio_return_percent: portfolioReturnPercent,
        last_valuation_at: valuedAt || (normalizedCurrentPrice > 0 ? new Date().toISOString() : null)
    };

    const { data, error } = await adminSupabase
        .from("treasury_portfolio_positions")
        .upsert(patch, { onConflict: "tenant_id,asset_id" })
        .select("*, treasury_assets(asset_name, asset_type, symbol, market, currency)")
        .single();

    if (error || !data) {
        throw new AppError(500, "TREASURY_POSITION_UPDATE_FAILED", "Unable to update treasury portfolio position.", error);
    }

    return data;
}

function buildPositionAfterTrade(position, order) {
    const currentUnits = Number(position?.units_owned || 0);
    const currentCost = Number(position?.total_cost || 0);
    const currentAverage = currentUnits > 0 ? currentCost / currentUnits : Number(position?.average_price || 0);
    const units = Number(order.units || 0);
    const totalAmount = Number(order.total_amount || 0);

    if (order.order_type === "buy") {
        const nextUnits = roundUnits(currentUnits + units);
        const nextCost = roundMoney(currentCost + totalAmount);
        const nextAverage = nextUnits > 0 ? roundMoney(nextCost / nextUnits) : 0;
        return {
            units_owned: nextUnits,
            total_cost: nextCost,
            average_price: nextAverage
        };
    }

    if (units > currentUnits + 0.000001) {
        throw new AppError(409, "TREASURY_POSITION_INSUFFICIENT_UNITS", "The SACCO does not own enough units to sell this position.");
    }

    const releasedCost = roundMoney(currentAverage * units);
    const nextUnits = roundUnits(Math.max(currentUnits - units, 0));
    const nextCost = roundMoney(Math.max(currentCost - releasedCost, 0));
    const nextAverage = nextUnits > 0 ? roundMoney(nextCost / nextUnits) : 0;

    return {
        units_owned: nextUnits,
        total_cost: nextCost,
        average_price: nextAverage
    };
}

async function listAssets(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from("treasury_assets")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("asset_name", { ascending: true });

    if (error) {
        throw new AppError(500, "TREASURY_ASSETS_FETCH_FAILED", "Unable to load treasury assets.", error);
    }

    return data || [];
}

async function createAsset(actor, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const policy = await getTreasuryPolicyRecord(tenantId);
    await assertTenantAccounts(tenantId, [
        payload.asset_account_id || policy.investment_control_account_id,
        payload.income_account_id || policy.investment_income_account_id
    ]);

    const insertRow = {
        tenant_id: tenantId,
        asset_name: payload.asset_name,
        asset_type: payload.asset_type,
        symbol: payload.symbol || null,
        market: payload.market || null,
        currency: payload.currency || "TZS",
        status: payload.status || "active",
        asset_account_id: payload.asset_account_id || policy.investment_control_account_id,
        income_account_id: payload.income_account_id || policy.investment_income_account_id,
        created_by: actor.user.id
    };

    const { data, error } = await adminSupabase
        .from("treasury_assets")
        .insert(insertRow)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "TREASURY_ASSET_CREATE_FAILED", "Unable to create treasury asset.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "treasury_assets",
        action: "create_treasury_asset",
        entityType: "treasury_asset",
        entityId: data.id,
        afterData: data
    });

    return data;
}

async function getPortfolio(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from("treasury_portfolio_positions")
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency, status)")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false });

    if (error) {
        throw new AppError(500, "TREASURY_PORTFOLIO_FETCH_FAILED", "Unable to load treasury portfolio.", error);
    }

    const rows = data || [];
    const totalMarketValue = rows.reduce((sum, row) => sum + Number(row.current_market_value || 0), 0);

    return rows.map((row) => ({
        ...row,
        allocation_percent: totalMarketValue > 0
            ? Number((((Number(row.current_market_value || 0)) / totalMarketValue) * 100).toFixed(2))
            : 0
    }));
}

async function updateValuation(actor, assetId, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const asset = await getAssetOrThrow(tenantId, assetId);
    const position = await getPositionRecord(tenantId, asset.id);

    if (!position) {
        throw new AppError(404, "TREASURY_POSITION_NOT_FOUND", "No treasury position exists for this asset yet.");
    }

    const updated = await persistPosition({
        tenantId,
        assetId: asset.id,
        unitsOwned: position.units_owned,
        averagePrice: position.average_price,
        totalCost: position.total_cost,
        currentPrice: payload.current_price,
        valuedAt: payload.valued_at || new Date().toISOString()
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "treasury_portfolio_positions",
        action: "update_treasury_valuation",
        entityType: "treasury_position",
        entityId: updated.id,
        beforeData: position,
        afterData: updated
    });

    return updated;
}

async function listOrders(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = normalizePagination(query);
    let builder = adminSupabase
        .from("treasury_orders")
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    if (query.status) {
        builder = builder.eq("status", query.status);
    }

    if (query.asset_id) {
        builder = builder.eq("asset_id", query.asset_id);
    }

    const { data, error, count } = await builder.range(pagination.from, pagination.to);

    if (error) {
        throw new AppError(500, "TREASURY_ORDERS_FETCH_FAILED", "Unable to load treasury orders.", error);
    }

    return {
        data: data || [],
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: count || 0
        }
    };
}

async function createOrder(actor, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    if (payload.branch_id) {
        assertBranchAccess({ auth: actor }, payload.branch_id);
    }

    const asset = await getAssetOrThrow(tenantId, payload.asset_id);
    if (asset.status !== "active") {
        throw new AppError(409, "TREASURY_ASSET_INACTIVE", "Only active treasury assets can be ordered.");
    }

    const totalAmount = roundMoney(payload.total_amount ?? (Number(payload.units || 0) * Number(payload.unit_price || 0)));
    let policyCheck = null;

    if (payload.order_type === "buy") {
        policyCheck = await evaluateOrderPolicy(tenantId, {
            asset,
            orderType: payload.order_type,
            totalAmount,
            units: payload.units
        });
        if (policyCheck.blocking_violations.length) {
            const primary = policyCheck.blocking_violations[0];
            throw new AppError(409, "TREASURY_POLICY_BLOCKED", primary.message, primary);
        }
    } else {
        const position = await getPositionRecord(tenantId, asset.id);
        buildPositionAfterTrade(position, {
            order_type: payload.order_type,
            units: payload.units,
            total_amount: totalAmount
        });
    }

    const liquiditySnapshot = await calculateInvestableAmount(tenantId);
    const insertRow = {
        tenant_id: tenantId,
        branch_id: payload.branch_id || actor.profile?.branch_id || null,
        asset_id: asset.id,
        order_type: payload.order_type,
        units: roundUnits(payload.units),
        unit_price: roundMoney(payload.unit_price),
        total_amount: totalAmount,
        order_date: payload.order_date || new Date().toISOString().slice(0, 10),
        reference: payload.reference || buildReference("TRS-ORD"),
        status: "pending_review",
        liquidity_snapshot: {
            ...liquiditySnapshot,
            policy_snapshot: buildPolicySnapshot(policyCheck?.policy || {}),
            policy_violations: policyCheck?.violations || []
        },
        created_by: actor.user.id,
        notes: payload.notes || null
    };

    const { data, error } = await adminSupabase
        .from("treasury_orders")
        .insert(insertRow)
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)")
        .single();

    if (error || !data) {
        throw new AppError(500, "TREASURY_ORDER_CREATE_FAILED", "Unable to create treasury order.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "treasury_orders",
        action: "create_treasury_order",
        entityType: "treasury_order",
        entityId: data.id,
        afterData: data
    });

    await notifyTreasuryUsers({
        tenantId,
        branchId: data.branch_id || null,
        eventType: "treasury_order_created",
        eventKey: `treasury_order_created:${data.id}`,
        message: `${actor.profile?.full_name || "Treasury staff"} created a ${data.order_type} order for ${asset.asset_name} worth ${roundMoney(data.total_amount).toLocaleString("en-TZ")} TZS.`,
        metadata: {
            treasury_order_id: data.id,
            asset_id: data.asset_id,
            asset_name: asset.asset_name,
            reference: data.reference
        }
    });

    if (policyCheck?.warning_violations?.length) {
        await notifyTreasuryUsers({
            tenantId,
            branchId: data.branch_id || null,
            eventType: "treasury_policy_violation",
            eventKey: `treasury_policy_violation:create:${data.id}`,
            message: `Treasury order ${data.reference} exceeds configured treasury policy limits and needs escalation review.`,
            metadata: {
                treasury_order_id: data.id,
                reference: data.reference,
                violations: policyCheck.warning_violations
            }
        });
    }

    return {
        ...data,
        policy_check: policyCheck
            ? {
                violations: policyCheck.violations,
                blocking_violations: policyCheck.blocking_violations,
                warning_violations: policyCheck.warning_violations
            }
            : null
    };
}

async function reviewOrder(actor, orderId, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const order = await getOrderOrThrow(tenantId, orderId);

    if (!["pending_review", "draft"].includes(order.status)) {
        throw new AppError(409, "TREASURY_ORDER_REVIEW_INVALID", "Only draft or pending-review orders can be reviewed.");
    }

    if (payload.decision === "rejected") {
        const patch = {
            status: "rejected",
            reviewed_by: actor.user.id,
            reviewed_at: new Date().toISOString(),
            rejected_by: actor.user.id,
            rejected_at: new Date().toISOString(),
            rejection_reason: payload.reason,
            notes: payload.notes || order.notes || null
        };

        const { data, error } = await adminSupabase
            .from("treasury_orders")
            .update(patch)
            .eq("tenant_id", tenantId)
            .eq("id", order.id)
            .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)")
            .single();

        if (error || !data) {
            throw new AppError(500, "TREASURY_ORDER_REJECT_FAILED", "Unable to reject treasury order.", error);
        }

        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "treasury_orders",
            action: "reject_treasury_order",
            entityType: "treasury_order",
            entityId: data.id,
            beforeData: order,
            afterData: data
        });

        await notifyTreasuryUsers({
            tenantId,
            branchId: data.branch_id || null,
            eventType: "treasury_order_rejected",
            eventKey: `treasury_order_rejected:${data.id}`,
            message: `Treasury order ${data.reference} was rejected.${payload.reason ? ` Reason: ${payload.reason}` : ""}`,
            metadata: {
                treasury_order_id: data.id,
                reference: data.reference,
                rejection_reason: payload.reason || null
            }
        });

        return data;
    }

    let policyCheck = null;
    if (order.order_type === "buy") {
        policyCheck = await evaluateOrderPolicy(tenantId, {
            asset: order.treasury_assets || await getAssetOrThrow(tenantId, order.asset_id),
            orderType: order.order_type,
            totalAmount: order.total_amount,
            units: order.units
        });
        if (policyCheck.blocking_violations.length) {
            const primary = policyCheck.blocking_violations[0];
            throw new AppError(409, "TREASURY_POLICY_BLOCKED", primary.message, primary);
        }
    }

    const approvalRequiredForWarnings = Boolean(policyCheck?.warning_violations?.length && actor.role !== ROLES.SUPER_ADMIN);
    const approval = approvalRequiredForWarnings || actor.role !== ROLES.SUPER_ADMIN
        ? await ensureOperationApproval({
            actor,
            tenantId,
            branchId: order.branch_id,
            operationKey: "treasury.order_execute",
            requestedAmount: approvalRequiredForWarnings
                ? Math.max(Number(order.total_amount || 0), Number(policyCheck?.policy?.approval_threshold || 0))
                : order.total_amount,
            payload: {
                treasury_order_id: order.id,
                order_type: order.order_type,
                asset_id: order.asset_id,
                asset_name: order.treasury_assets?.asset_name || null,
                reference: order.reference,
                policy_violations: policyCheck?.warning_violations || []
            },
            entityType: "treasury_order",
            entityId: order.id
        })
        : { approval_required: false };

    const nextStatus = approval.approval_required ? "pending_approval" : "approved";
    const patch = {
        status: nextStatus,
        reviewed_by: actor.user.id,
        reviewed_at: new Date().toISOString(),
        approval_request_id: approval.approval_required ? approval.approval_request_id : order.approval_request_id,
        notes: payload.notes || order.notes || null
    };

    const { data, error } = await adminSupabase
        .from("treasury_orders")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", order.id)
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)")
        .single();

    if (error || !data) {
        throw new AppError(500, "TREASURY_ORDER_REVIEW_FAILED", "Unable to update treasury review status.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "treasury_orders",
        action: "review_treasury_order",
        entityType: "treasury_order",
        entityId: data.id,
        beforeData: order,
        afterData: data
    });

    await notifyTreasuryUsers({
        tenantId,
        branchId: data.branch_id || null,
        eventType: "treasury_order_approved",
        eventKey: `treasury_order_approved:${data.id}:${nextStatus}`,
        message: approval.approval_required
            ? `Treasury order ${data.reference} was reviewed and escalated for approval.`
            : `Treasury order ${data.reference} was approved for execution.`,
        metadata: {
            treasury_order_id: data.id,
            reference: data.reference,
            approval_request_id: approval.approval_request_id || null
        }
    });

    if (policyCheck?.warning_violations?.length) {
        await notifyTreasuryUsers({
            tenantId,
            branchId: data.branch_id || null,
            eventType: "treasury_policy_violation",
            eventKey: `treasury_policy_violation:review:${data.id}`,
            message: `Treasury order ${data.reference} exceeds policy limits and has been routed through approval governance.`,
            metadata: {
                treasury_order_id: data.id,
                reference: data.reference,
                violations: policyCheck.warning_violations
            }
        });
    }

    return {
        ...data,
        approval_required: approval.approval_required,
        policy_check: policyCheck
            ? {
                violations: policyCheck.violations,
                blocking_violations: policyCheck.blocking_violations,
                warning_violations: policyCheck.warning_violations
            }
            : null
    };
}

async function executeOrder(actor, orderId, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertTwoFactorStepUp(actor, payload, { action: "treasury_execute_order" });

    const order = await getOrderOrThrow(tenantId, orderId);
    if (!["approved", "pending_approval"].includes(order.status)) {
        throw new AppError(409, "TREASURY_ORDER_EXECUTE_INVALID", "Only approved treasury orders can be executed.");
    }

    let policyCheck = null;
    if (order.order_type === "buy") {
        policyCheck = await evaluateOrderPolicy(tenantId, {
            asset: order.treasury_assets || await getAssetOrThrow(tenantId, order.asset_id),
            orderType: order.order_type,
            totalAmount: order.total_amount,
            units: order.units
        });

        if (policyCheck.blocking_violations.length) {
            const primary = policyCheck.blocking_violations[0];
            throw new AppError(409, "TREASURY_POLICY_BLOCKED", primary.message, primary);
        }

        if (policyCheck.warning_violations.length && !order.approval_request_id && actor.role !== ROLES.SUPER_ADMIN) {
            throw new AppError(409, "TREASURY_POLICY_ESCALATION_REQUIRED", "This order exceeds treasury policy limits and needs escalation approval before execution.", {
                violation: true,
                rule: policyCheck.warning_violations[0].rule,
                severity: "warning",
                message: policyCheck.warning_violations[0].message,
                violations: policyCheck.warning_violations
            });
        }
    }

    let approvalRequestId = order.approval_request_id || null;
    if (order.status === "pending_approval") {
        if (!approvalRequestId) {
            throw new AppError(409, "TREASURY_ORDER_APPROVAL_MISSING", "This treasury order is still waiting for approval.");
        }

        const approval = await ensureOperationApproval({
            actor,
            tenantId,
            branchId: order.branch_id,
            operationKey: "treasury.order_execute",
            requestedAmount: order.total_amount,
            payload: {
                treasury_order_id: order.id,
                reference: order.reference
            },
            approvalRequestId,
            entityType: "treasury_order",
            entityId: order.id
        });

        approvalRequestId = approval.approval_request_id || approvalRequestId;
    }

    const policy = await getTreasuryPolicyRecord(tenantId);
    const asset = await getAssetOrThrow(tenantId, order.asset_id);
    const ledgerAccounts = await ensureAssetLedgerAccounts(tenantId, asset, policy);
    const existingPosition = await getPositionRecord(tenantId, asset.id);
    const nextPosition = buildPositionAfterTrade(existingPosition, order);
    const reference = payload.reference || order.reference || buildReference("TRS-TXN");
    const transactionDate = payload.transaction_date || new Date().toISOString().slice(0, 10);

    const lines = order.order_type === "buy"
        ? [
            { account_id: ledgerAccounts.investments.id, debit: roundMoney(order.total_amount), credit: 0 },
            { account_id: ledgerAccounts.settlement.id, debit: 0, credit: roundMoney(order.total_amount) }
        ]
        : [
            { account_id: ledgerAccounts.settlement.id, debit: roundMoney(order.total_amount), credit: 0 },
            { account_id: ledgerAccounts.investments.id, debit: 0, credit: roundMoney(order.total_amount) }
        ];

    const journalId = await postTreasuryJournalEntry({
        tenantId,
        actorUserId: actor.user.id,
        sourceType: "treasury_investment",
        reference,
        description: `${order.order_type === "buy" ? "Treasury purchase" : "Treasury sale"} for ${asset.asset_name}`,
        transactionDate,
        lines
    });

    const { data: transaction, error: transactionError } = await adminSupabase
        .from("treasury_transactions")
        .insert({
            tenant_id: tenantId,
            asset_id: asset.id,
            order_id: order.id,
            transaction_type: order.order_type,
            units: order.units,
            price: order.unit_price,
            total_amount: order.total_amount,
            transaction_date: transactionDate,
            reference,
            ledger_journal_id: journalId,
            created_by: actor.user.id,
            status: "posted",
            metadata: {
                approval_request_id: approvalRequestId,
                executed_from_order: true
            }
        })
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)")
        .single();

    if (transactionError || !transaction) {
        throw new AppError(500, "TREASURY_TRANSACTION_CREATE_FAILED", "Unable to persist treasury transaction.", transactionError);
    }

    const currentPrice = Number(existingPosition?.current_price || order.unit_price || 0);
    const position = await persistPosition({
        tenantId,
        assetId: asset.id,
        unitsOwned: nextPosition.units_owned,
        averagePrice: nextPosition.average_price,
        totalCost: nextPosition.total_cost,
        currentPrice
    });

    const { data: updatedOrder, error: orderUpdateError } = await adminSupabase
        .from("treasury_orders")
        .update({
            status: "executed",
            executed_by: actor.user.id,
            executed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq("tenant_id", tenantId)
        .eq("id", order.id)
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)")
        .single();

    if (orderUpdateError || !updatedOrder) {
        throw new AppError(500, "TREASURY_ORDER_EXECUTE_FAILED", "Unable to finalize treasury order execution.", orderUpdateError);
    }

    if (approvalRequestId) {
        await markApprovalRequestExecuted({
            actor,
            tenantId,
            requestId: approvalRequestId,
            entityType: "treasury_order",
            entityId: order.id
        });
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "treasury_orders",
        action: "execute_treasury_order",
        entityType: "treasury_order",
        entityId: order.id,
        beforeData: order,
        afterData: {
            order: updatedOrder,
            transaction_id: transaction.id,
            ledger_journal_id: journalId,
            position_id: position.id
        }
    });

    await notifyTreasuryUsers({
        tenantId,
        branchId: updatedOrder.branch_id || null,
        eventType: "treasury_order_executed",
        eventKey: `treasury_order_executed:${updatedOrder.id}`,
        message: `Treasury order ${updatedOrder.reference} was executed and posted to the ledger.`,
        metadata: {
            treasury_order_id: updatedOrder.id,
            reference: updatedOrder.reference,
            ledger_journal_id: journalId
        }
    });

    return {
        order: updatedOrder,
        transaction,
        position,
        ledger_journal_id: journalId
    };
}

async function listTransactions(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = normalizePagination(query);
    let builder = adminSupabase
        .from("treasury_transactions")
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false });

    if (query.asset_id) {
        builder = builder.eq("asset_id", query.asset_id);
    }

    if (query.transaction_type) {
        builder = builder.eq("transaction_type", query.transaction_type);
    }

    const { data, error, count } = await builder.range(pagination.from, pagination.to);

    if (error) {
        throw new AppError(500, "TREASURY_TRANSACTIONS_FETCH_FAILED", "Unable to load treasury transactions.", error);
    }

    return {
        data: data || [],
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: count || 0
        }
    };
}

async function listIncome(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = normalizePagination(query);
    let builder = adminSupabase
        .from("treasury_income")
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("received_date", { ascending: false })
        .order("created_at", { ascending: false });

    if (query.asset_id) {
        builder = builder.eq("asset_id", query.asset_id);
    }

    if (query.income_type) {
        builder = builder.eq("income_type", query.income_type);
    }

    const { data, error, count } = await builder.range(pagination.from, pagination.to);

    if (error) {
        throw new AppError(500, "TREASURY_INCOME_FETCH_FAILED", "Unable to load treasury income.", error);
    }

    return {
        data: data || [],
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: count || 0
        }
    };
}

async function recordIncome(actor, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const asset = await getAssetOrThrow(tenantId, payload.asset_id);
    const policy = await getTreasuryPolicyRecord(tenantId);
    const ledgerAccounts = await ensureAssetLedgerAccounts(tenantId, asset, policy);

    const reference = payload.reference || buildReference("TRS-INC");
    const receivedDate = payload.received_date || new Date().toISOString().slice(0, 10);
    const journalId = await postTreasuryJournalEntry({
        tenantId,
        actorUserId: actor.user.id,
        sourceType: "treasury_income",
        reference,
        description: `${payload.income_type} received from ${asset.asset_name}`,
        transactionDate: receivedDate,
        lines: [
            { account_id: ledgerAccounts.settlement.id, debit: roundMoney(payload.amount), credit: 0 },
            { account_id: ledgerAccounts.income.id, debit: 0, credit: roundMoney(payload.amount) }
        ]
    });

    const transactionType = payload.income_type === "interest" ? "interest" : "dividend";
    const { data: transaction, error: transactionError } = await adminSupabase
        .from("treasury_transactions")
        .insert({
            tenant_id: tenantId,
            asset_id: asset.id,
            transaction_type: transactionType,
            units: 0,
            price: 0,
            total_amount: roundMoney(payload.amount),
            transaction_date: receivedDate,
            reference,
            ledger_journal_id: journalId,
            created_by: actor.user.id,
            status: "posted",
            metadata: {
                income_type: payload.income_type
            }
        })
        .select("*")
        .single();

    if (transactionError || !transaction) {
        throw new AppError(500, "TREASURY_INCOME_TRANSACTION_FAILED", "Unable to persist treasury income transaction.", transactionError);
    }

    const { data, error } = await adminSupabase
        .from("treasury_income")
        .insert({
            tenant_id: tenantId,
            asset_id: asset.id,
            transaction_id: transaction.id,
            income_type: payload.income_type,
            amount: roundMoney(payload.amount),
            received_date: receivedDate,
            description: payload.description || null,
            posted_to_ledger: true,
            ledger_journal_id: journalId,
            recorded_by: actor.user.id
        })
        .select("*, treasury_assets(id, asset_name, asset_type, symbol, market, currency)")
        .single();

    if (error || !data) {
        throw new AppError(500, "TREASURY_INCOME_CREATE_FAILED", "Unable to record treasury income.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "treasury_income",
        action: "record_treasury_income",
        entityType: "treasury_income",
        entityId: data.id,
        afterData: {
            ...data,
            ledger_journal_id: journalId,
            transaction_id: transaction.id
        }
    });

    return {
        income: data,
        transaction,
        ledger_journal_id: journalId
    };
}

async function getLiquidityOverview(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const [policy, liquidity, outstandingLoanPrincipal, expectedLoanDisbursements, expectedRepayments, openTreasuryOrdersAmount] = await Promise.all([
        getPolicyWithAccounts(tenantId),
        calculateInvestableAmount(tenantId),
        getOutstandingLoanPrincipal(tenantId),
        getExpectedLoanDisbursements(tenantId),
        getExpectedRepayments(tenantId),
        getOpenTreasuryOrdersAmount(tenantId)
    ]);

    return {
        ...liquidity,
        outstanding_loan_principal: outstandingLoanPrincipal,
        expected_loan_disbursements: expectedLoanDisbursements,
        expected_repayments: expectedRepayments,
        open_treasury_orders_amount: openTreasuryOrdersAmount,
        policy
    };
}

async function getOverview(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const [
        liquidity,
        portfolioTotals,
        incomeYtd,
        orders,
        portfolio,
        outstandingLoanPrincipal,
        expectedLoanDisbursements,
        expectedRepayments,
        openTreasuryOrdersAmount,
        policy
    ] = await Promise.all([
        calculateInvestableAmount(tenantId),
        getPortfolioTotals(tenantId),
        getInvestmentIncomeYtd(tenantId),
        adminSupabase
            .from("treasury_orders")
            .select("status")
            .eq("tenant_id", tenantId),
        adminSupabase
            .from("treasury_portfolio_positions")
            .select("asset_id", { count: "exact" })
            .eq("tenant_id", tenantId)
            .gt("units_owned", 0),
        getOutstandingLoanPrincipal(tenantId),
        getExpectedLoanDisbursements(tenantId),
        getExpectedRepayments(tenantId),
        getOpenTreasuryOrdersAmount(tenantId),
        getPolicyWithAccounts(tenantId)
    ]);

    if (orders.error) {
        throw new AppError(500, "TREASURY_OVERVIEW_ORDERS_FAILED", "Unable to load treasury overview orders.", orders.error);
    }

    if (portfolio.error) {
        throw new AppError(500, "TREASURY_OVERVIEW_PORTFOLIO_FAILED", "Unable to load treasury overview portfolio breadth.", portfolio.error);
    }

    const orderCounts = (orders.data || []).reduce((accumulator, row) => {
        accumulator[row.status] = (accumulator[row.status] || 0) + 1;
        return accumulator;
    }, {});

    const totalInvestments = portfolioTotals.total_cost;
    const totalPortfolioValue = portfolioTotals.current_market_value;
    const investmentReturnPercent = totalInvestments > 0
        ? Number((((totalPortfolioValue - totalInvestments) / totalInvestments) * 100).toFixed(2))
        : 0;
    const pendingOrders = Number(orderCounts.pending_review || 0) + Number(orderCounts.pending_approval || 0);

    return {
        total_investments: totalInvestments,
        total_portfolio_value: totalPortfolioValue,
        investment_income_ytd: incomeYtd,
        unrealized_gains: portfolioTotals.unrealized_gain,
        available_investable_cash: liquidity.available_investable_cash,
        liquidity_reserve_required: liquidity.required_liquidity_reserve,
        loan_exposure: outstandingLoanPrincipal,
        investment_return_percent: investmentReturnPercent,
        active_positions_count: portfolio.count || 0,
        pending_orders: pendingOrders,
        pending_review_orders: Number(orderCounts.pending_review || 0),
        pending_approval_orders: Number(orderCounts.pending_approval || 0),
        approved_orders: Number(orderCounts.approved || 0),
        executed_orders: Number(orderCounts.executed || 0),
        expected_loan_disbursements: expectedLoanDisbursements,
        expected_repayments: expectedRepayments,
        open_treasury_orders_amount: openTreasuryOrdersAmount,
        policy,
        safeguard_status: liquidity.safeguard_status
    };
}

async function getTreasuryPolicy(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    return getPolicyWithAccounts(tenantId);
}

async function updateTreasuryPolicy(actor, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertTwoFactorStepUp(actor, payload, { action: "treasury_update_policy" });

    const current = await getTreasuryPolicyRecord(tenantId);
    await validatePolicyAccounts(tenantId, payload);

    const nextLiquidityReserveRatio = normalizePercent(payload.liquidity_reserve_ratio, Number(current.liquidity_reserve_ratio || 0));
    const nextLoanLiquidityProtectionRatio = normalizePercent(
        payload.loan_liquidity_protection_ratio,
        Number(current.loan_liquidity_protection_ratio || 0)
    );
    const nextMaxAssetAllocationPercent = Object.prototype.hasOwnProperty.call(payload, "max_asset_allocation_percent")
        ? normalizePercent(payload.max_asset_allocation_percent, null)
        : (current.max_asset_allocation_percent != null ? Number(current.max_asset_allocation_percent) : null);
    const nextMaxSingleAssetPercent = Object.prototype.hasOwnProperty.call(payload, "max_single_asset_percent")
        ? normalizePercent(payload.max_single_asset_percent, null)
        : (current.max_single_asset_percent != null ? Number(current.max_single_asset_percent) : null);
    const nextValuationFrequency = normalizeWholeNumber(
        payload.valuation_update_frequency_days,
        Number(current.valuation_update_frequency_days || 30)
    );
    const nextApprovalThreshold = Object.prototype.hasOwnProperty.call(payload, "approval_threshold")
        ? roundMoney(payload.approval_threshold || 0)
        : roundMoney(current.approval_threshold || 0);
    const nextMinimumCashBuffer = Object.prototype.hasOwnProperty.call(payload, "minimum_cash_buffer")
        ? roundMoney(payload.minimum_cash_buffer || 0)
        : roundMoney(current.minimum_cash_buffer ?? current.minimum_liquidity_reserve ?? 0);
    const nextMinimumLiquidityReserve = Object.prototype.hasOwnProperty.call(payload, "minimum_liquidity_reserve")
        ? roundMoney(payload.minimum_liquidity_reserve || 0)
        : roundMoney(current.minimum_liquidity_reserve || nextMinimumCashBuffer);

    const patch = {
        liquidity_reserve_ratio: nextLiquidityReserveRatio,
        minimum_liquidity_reserve: nextMinimumLiquidityReserve,
        minimum_cash_buffer: nextMinimumCashBuffer,
        loan_liquidity_protection_ratio: nextLoanLiquidityProtectionRatio,
        max_asset_allocation_percent: nextMaxAssetAllocationPercent,
        max_single_asset_percent: nextMaxSingleAssetPercent,
        max_single_order_amount: Object.prototype.hasOwnProperty.call(payload, "max_single_order_amount")
            ? payload.max_single_order_amount
            : current.max_single_order_amount,
        approval_threshold: nextApprovalThreshold,
        settlement_account_id: payload.settlement_account_id || current.settlement_account_id,
        investment_control_account_id: payload.investment_control_account_id || current.investment_control_account_id,
        investment_income_account_id: payload.investment_income_account_id || current.investment_income_account_id,
        valuation_update_frequency_days: nextValuationFrequency,
        policy_version: Number(current.policy_version || 1) + 1,
        updated_by: actor.user.id,
        updated_at: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
        .from("treasury_policies")
        .update(patch)
        .eq("tenant_id", tenantId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "TREASURY_POLICY_UPDATE_FAILED", "Unable to update treasury policy.", error);
    }

    await syncTreasuryApprovalThreshold(tenantId, nextApprovalThreshold);
    await insertPolicyHistory({
        policyId: tenantId,
        previousValues: buildPolicyUpdateSnapshot(current),
        newValues: buildPolicyUpdateSnapshot(data),
        changedBy: actor.user.id,
        changeReason: payload.change_reason
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "treasury_policies",
        action: "update_treasury_policy",
        entityType: "treasury_policy",
        entityId: tenantId,
        beforeData: current,
        afterData: data
    });

    await notifyTreasuryUsers({
        tenantId,
        eventType: "treasury_policy_updated",
        eventKey: `treasury_policy_updated:${tenantId}:${data.policy_version}`,
        message: `${actor.profile?.full_name || "Treasury manager"} updated treasury policy version ${data.policy_version}.`,
        metadata: {
            treasury_policy_id: tenantId,
            policy_version: data.policy_version,
            change_reason: payload.change_reason
        }
    });

    return getPolicyWithAccounts(tenantId);
}

async function getTreasuryAuditLog(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = normalizePagination(query);
    const treasuryTables = [
        "treasury_orders",
        "treasury_policies",
        "treasury_portfolio_positions",
        "treasury_income",
        "treasury_transactions"
    ];
    const treasuryEntityTypes = [
        "treasury_order",
        "treasury_policy",
        "treasury_position",
        "treasury_income",
        "treasury_transaction"
    ];

    let builder = adminSupabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .or(`table.in.(${treasuryTables.join(",")}),entity_type.in.(${treasuryEntityTypes.join(",")})`);

    if (query.action) {
        builder = builder.eq("action", query.action);
    }

    if (query.entity_type) {
        builder = builder.eq("entity_type", query.entity_type);
    }

    const { data, error, count } = await builder
        .order("created_at", { ascending: false })
        .range(pagination.from, pagination.to);

    if (error) {
        throw new AppError(500, "TREASURY_AUDIT_LOG_FETCH_FAILED", "Unable to load treasury audit logs.", error);
    }

    const rows = data || [];
    const actorIds = Array.from(new Set(rows.map((row) => row.actor_user_id || row.user_id).filter(Boolean)));
    let actorNameMap = new Map();

    if (actorIds.length) {
        const { data: actorProfiles, error: actorProfilesError } = await adminSupabase
            .from("user_profiles")
            .select("user_id, full_name, role")
            .in("user_id", actorIds);

        if (actorProfilesError) {
            throw new AppError(500, "TREASURY_AUDIT_LOG_ACTORS_FAILED", "Unable to resolve treasury audit actors.", actorProfilesError);
        }

        actorNameMap = new Map((actorProfiles || []).map((row) => [row.user_id, row]));
    }

    return {
        data: rows.map((row) => {
            const actorUserId = row.actor_user_id || row.user_id || null;
            const actorProfile = actorNameMap.get(actorUserId) || null;
            const afterData = row.after_data && typeof row.after_data === "object" ? row.after_data : {};

            return {
                ...row,
                actor_user_id: actorUserId,
                actor_name: actorProfile?.full_name || null,
                actor_role: actorProfile?.role || null,
                event_at: row.timestamp || row.created_at || null,
                ledger_journal_id: afterData.ledger_journal_id
                    || afterData?.order?.ledger_journal_id
                    || afterData?.transaction?.ledger_journal_id
                    || null
            };
        }),
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: count || 0
        }
    };
}

module.exports = {
    calculateInvestableAmount,
    getOverview,
    getLiquidityOverview,
    getTreasuryPolicy,
    getTreasuryAuditLog,
    updateTreasuryPolicy,
    listAssets,
    createAsset,
    getPortfolio,
    updateValuation,
    listOrders,
    createOrder,
    reviewOrder,
    executeOrder,
    listTransactions,
    listIncome,
    recordIncome
};
