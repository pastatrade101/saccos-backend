const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { logAudit } = require("../../services/audit.service");
const { assertTwoFactorStepUp } = require("../../services/two-factor.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const AppError = require("../../utils/app-error");

const DEFAULT_BRANCH_MAX_LENDING_RATIO = 70;
const DEFAULT_MINIMUM_LIQUIDITY_RESERVE = 0;
const DEFAULT_AUTO_LOAN_FREEZE_THRESHOLD = 0;
const DEFAULT_LIQUIDITY_BUFFER_PERCENT = 0;
const DEFAULT_UNBOUNDED_PRODUCT_LIMIT = 9999999999999.99;
const ACTIVE_LOAN_STATUSES = ["active", "in_arrears"];
const CONTRIBUTION_ACCOUNT_TYPES = new Set(["savings", "shares"]);
const MANAGER_ROLES = new Set([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER]);
const DAY_MS = 24 * 60 * 60 * 1000;
const POLICY_CHANGE_LABELS = {
    contribution_multiplier: "Loan Multiplier",
    max_loan_amount: "Product Loan Cap",
    min_loan_amount: "Minimum Loan Amount",
    liquidity_buffer_percent: "Liquidity Buffer %",
    requires_guarantor: "Requires Guarantor",
    requires_collateral: "Requires Collateral",
    max_lending_ratio: "Max Lending Ratio %",
    minimum_liquidity_reserve: "Minimum Liquidity Reserve",
    auto_loan_freeze_threshold: "Auto Loan Freeze Threshold"
};

function roundMoney(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) {
        return 0;
    }

    return Math.round(numeric * 100) / 100;
}

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clampPercent(value, fallback = 0) {
    return Math.min(100, Math.max(0, toFiniteNumber(value, fallback)));
}

function readNumericRule(rules, keys, fallback = null) {
    for (const key of keys) {
        if (rules && Object.prototype.hasOwnProperty.call(rules, key)) {
            const numeric = Number(rules[key]);
            if (Number.isFinite(numeric)) {
                return numeric;
            }
        }
    }

    return fallback;
}

function readBooleanRule(rules, keys, fallback = false) {
    for (const key of keys) {
        if (rules && Object.prototype.hasOwnProperty.call(rules, key)) {
            return Boolean(rules[key]);
        }
    }

    return fallback;
}

function formatCurrency(amount) {
    return `TZS ${roundMoney(amount).toLocaleString("en-TZ", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function toDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 10);
}

function toPercentValue(value) {
    return roundMoney(Math.max(0, value) * 100);
}

function formatPolicyValue(key, value) {
    if (value === null || typeof value === "undefined" || value === "") {
        return "Not set";
    }

    if (key === "contribution_multiplier") {
        return `${roundMoney(value)}x`;
    }

    if (["max_lending_ratio", "liquidity_buffer_percent"].includes(key)) {
        return `${roundMoney(value)}%`;
    }

    if (["max_loan_amount", "min_loan_amount", "minimum_liquidity_reserve", "auto_loan_freeze_threshold"].includes(key)) {
        return formatCurrency(value);
    }

    if (["requires_guarantor", "requires_collateral"].includes(key)) {
        return value ? "Required" : "Not required";
    }

    return String(value);
}

function ensureManager(actor) {
    if (!MANAGER_ROLES.has(actor.role)) {
        throw new AppError(403, "FORBIDDEN", "Only branch managers and super admins can manage loan capacity policies.");
    }
}

async function getMemberRecord(tenantId, memberId) {
    const { data, error } = await adminSupabase
        .from("members")
        .select("id, tenant_id, branch_id, user_id, full_name, status")
        .eq("tenant_id", tenantId)
        .eq("id", memberId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        throw new AppError(404, "MEMBER_NOT_FOUND", "Member was not found.");
    }

    return data;
}

async function getBranchRecord(tenantId, branchId) {
    const { data, error } = await adminSupabase
        .from("branches")
        .select("id, tenant_id, name, code")
        .eq("tenant_id", tenantId)
        .eq("id", branchId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        throw new AppError(404, "BRANCH_NOT_FOUND", "Branch was not found.");
    }

    return data;
}

async function getLoanProductRecord(tenantId, loanProductId, { requireActive = true } = {}) {
    let builder = adminSupabase
        .from("loan_products")
        .select("id, tenant_id, code, name, status, min_amount, max_amount, maximum_loan_multiple, required_guarantors_count, eligibility_rules_json")
        .eq("tenant_id", tenantId)
        .eq("id", loanProductId)
        .is("deleted_at", null);

    if (requireActive) {
        builder = builder.eq("status", "active");
    }

    const { data, error } = await builder.single();

    if (error || !data) {
        throw new AppError(404, "LOAN_PRODUCT_NOT_FOUND", "Loan product was not found.");
    }

    return data;
}

async function getLoanProductPolicyRow(tenantId, loanProductId) {
    const { data, error } = await adminSupabase
        .from("loan_product_policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("loan_product_id", loanProductId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "LOAN_PRODUCT_POLICY_LOOKUP_FAILED", "Unable to load loan product borrowing policy.", error);
    }

    return data || null;
}

async function getBranchLiquidityPolicyRow(tenantId, branchId) {
    const { data, error } = await adminSupabase
        .from("branch_liquidity_policy")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "BRANCH_LIQUIDITY_POLICY_LOOKUP_FAILED", "Unable to load branch liquidity policy.", error);
    }

    return data || null;
}

function normalizeLoanProductPolicy(loanProduct, row) {
    const eligibilityRules = loanProduct?.eligibility_rules_json || {};
    const configuredMultiplier = row?.contribution_multiplier ?? loanProduct?.maximum_loan_multiple ?? 3;
    const configuredMinAmount = row?.min_loan_amount ?? loanProduct?.min_amount ?? 0;
    const rowMaxAmount = row?.max_loan_amount;
    const productMaxAmount = loanProduct?.max_amount;
    const derivedMaxAmount = rowMaxAmount ?? productMaxAmount ?? DEFAULT_UNBOUNDED_PRODUCT_LIMIT;
    const effectiveMaxAmount = productMaxAmount === null || typeof productMaxAmount === "undefined"
        ? derivedMaxAmount
        : Math.min(derivedMaxAmount, productMaxAmount);
    const requiresGuarantorFallback = Number(loanProduct?.required_guarantors_count || 0) > 0;

    return {
        id: row?.id || null,
        tenant_id: row?.tenant_id || loanProduct?.tenant_id || null,
        loan_product_id: loanProduct?.id || row?.loan_product_id || null,
        contribution_multiplier: Math.max(0, toFiniteNumber(configuredMultiplier, 3)),
        max_loan_amount: roundMoney(Math.max(0, effectiveMaxAmount)),
        min_loan_amount: roundMoney(Math.max(0, configuredMinAmount, loanProduct?.min_amount || 0)),
        liquidity_buffer_percent: clampPercent(
            row?.liquidity_buffer_percent ?? readNumericRule(
                eligibilityRules,
                ["liquidity_buffer_percent", "liquidityBufferPercent"],
                DEFAULT_LIQUIDITY_BUFFER_PERCENT
            ),
            DEFAULT_LIQUIDITY_BUFFER_PERCENT
        ),
        requires_guarantor: row?.requires_guarantor ?? requiresGuarantorFallback,
        requires_collateral: row?.requires_collateral ?? readBooleanRule(
            eligibilityRules,
            ["requires_collateral", "requiresCollateral"],
            false
        ),
        source: row ? "configured" : "derived_from_loan_product",
        created_at: row?.created_at || null,
        updated_at: row?.updated_at || null
    };
}

function normalizeBranchLiquidityPolicy(tenantId, branchId, row) {
    return {
        id: row?.id || null,
        tenant_id: row?.tenant_id || tenantId,
        branch_id: row?.branch_id || branchId,
        max_lending_ratio: clampPercent(row?.max_lending_ratio, DEFAULT_BRANCH_MAX_LENDING_RATIO),
        minimum_liquidity_reserve: roundMoney(Math.max(0, toFiniteNumber(row?.minimum_liquidity_reserve, DEFAULT_MINIMUM_LIQUIDITY_RESERVE))),
        auto_loan_freeze_threshold: roundMoney(Math.max(0, toFiniteNumber(row?.auto_loan_freeze_threshold, DEFAULT_AUTO_LOAN_FREEZE_THRESHOLD))),
        source: row ? "configured" : "default",
        created_at: row?.created_at || null,
        updated_at: row?.updated_at || null
    };
}

async function refreshMemberFinancialProfile(tenantId, memberId) {
    const [{ data: accountRows, error: accountError }, { data: loanRows, error: loanError }, { data: exposureRow, error: exposureError }] = await Promise.all([
        adminSupabase
            .from("member_accounts")
            .select("product_type, available_balance, locked_balance")
            .eq("tenant_id", tenantId)
            .eq("member_id", memberId)
            .eq("status", "active")
            .is("deleted_at", null),
        adminSupabase
            .from("loans")
            .select("outstanding_principal, accrued_interest")
            .eq("tenant_id", tenantId)
            .eq("member_id", memberId)
            .in("status", ACTIVE_LOAN_STATUSES),
        adminSupabase
            .from("guarantor_exposures")
            .select("committed_amount, invoked_amount")
            .eq("tenant_id", tenantId)
            .eq("guarantor_member_id", memberId)
            .maybeSingle()
    ]);

    if (accountError) {
        throw new AppError(500, "MEMBER_FINANCIAL_PROFILE_ACCOUNTS_LOOKUP_FAILED", "Unable to load member contribution balances.", accountError);
    }

    if (loanError) {
        throw new AppError(500, "MEMBER_FINANCIAL_PROFILE_LOANS_LOOKUP_FAILED", "Unable to load member loan exposure.", loanError);
    }

    if (exposureError) {
        throw new AppError(500, "MEMBER_FINANCIAL_PROFILE_GUARANTOR_LOOKUP_FAILED", "Unable to load member guarantor exposure.", exposureError);
    }

    let totalContributions = 0;
    let lockedSavings = 0;
    let withdrawableBalance = 0;

    for (const row of accountRows || []) {
        const availableBalance = roundMoney(row.available_balance);
        const lockedBalance = roundMoney(row.locked_balance);

        if (CONTRIBUTION_ACCOUNT_TYPES.has(row.product_type)) {
            totalContributions += availableBalance + lockedBalance;
        }

        if (row.product_type === "savings") {
            lockedSavings += lockedBalance;
            withdrawableBalance += availableBalance;
        }
    }

    const currentLoanExposure = (loanRows || []).reduce((sum, row) => {
        return sum + roundMoney(row.outstanding_principal) + roundMoney(row.accrued_interest);
    }, 0);

    const guarantorExposure = roundMoney(exposureRow?.committed_amount) + roundMoney(exposureRow?.invoked_amount);
    const profilePayload = {
        tenant_id: tenantId,
        member_id: memberId,
        total_contributions: roundMoney(totalContributions),
        locked_savings: roundMoney(lockedSavings),
        withdrawable_balance: roundMoney(withdrawableBalance),
        current_loan_exposure: roundMoney(currentLoanExposure),
        guarantor_exposure: roundMoney(guarantorExposure)
    };

    const { data, error } = await adminSupabase
        .from("member_financial_profile")
        .upsert(profilePayload, { onConflict: "tenant_id,member_id" })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "MEMBER_FINANCIAL_PROFILE_UPSERT_FAILED", "Unable to refresh member financial profile.", error);
    }

    return {
        ...data,
        total_contributions: roundMoney(data.total_contributions),
        locked_savings: roundMoney(data.locked_savings),
        withdrawable_balance: roundMoney(data.withdrawable_balance),
        current_loan_exposure: roundMoney(data.current_loan_exposure),
        guarantor_exposure: roundMoney(data.guarantor_exposure)
    };
}

async function refreshBranchFundPool(tenantId, branchId, branchPolicy) {
    const [{ data: currentRow, error: currentError }, { data: accountRows, error: accountError }, { data: loanRows, error: loanError }] = await Promise.all([
        adminSupabase
            .from("loan_fund_pool")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("branch_id", branchId)
            .maybeSingle(),
        adminSupabase
            .from("member_accounts")
            .select("product_type, available_balance, locked_balance")
            .eq("tenant_id", tenantId)
            .eq("branch_id", branchId)
            .eq("status", "active")
            .is("deleted_at", null),
        adminSupabase
            .from("loans")
            .select("outstanding_principal, accrued_interest")
            .eq("tenant_id", tenantId)
            .eq("branch_id", branchId)
            .in("status", ACTIVE_LOAN_STATUSES)
    ]);

    if (currentError) {
        throw new AppError(500, "LOAN_FUND_POOL_LOOKUP_FAILED", "Unable to load branch loan fund pool.", currentError);
    }

    if (accountError) {
        throw new AppError(500, "BRANCH_DEPOSITS_LOOKUP_FAILED", "Unable to load branch deposit balances.", accountError);
    }

    if (loanError) {
        throw new AppError(500, "BRANCH_ACTIVE_LOANS_LOOKUP_FAILED", "Unable to load branch active loan totals.", loanError);
    }

    const totalDeposits = roundMoney((accountRows || []).reduce((sum, row) => {
        if (!CONTRIBUTION_ACCOUNT_TYPES.has(row.product_type)) {
            return sum;
        }

        return sum + roundMoney(row.available_balance) + roundMoney(row.locked_balance);
    }, 0));

    const activeLoansTotal = roundMoney((loanRows || []).reduce((sum, row) => {
        return sum + roundMoney(row.outstanding_principal) + roundMoney(row.accrued_interest);
    }, 0));

    const reservedLiquidity = roundMoney(Math.max(
        toFiniteNumber(currentRow?.reserved_liquidity, 0),
        toFiniteNumber(branchPolicy?.minimum_liquidity_reserve, 0),
        0
    ));

    const upsertPayload = {
        tenant_id: tenantId,
        branch_id: branchId,
        total_deposits: totalDeposits,
        reserved_liquidity: reservedLiquidity,
        active_loans_total: activeLoansTotal,
        last_updated: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
        .from("loan_fund_pool")
        .upsert(upsertPayload, { onConflict: "tenant_id,branch_id" })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_FUND_POOL_REFRESH_FAILED", "Unable to refresh branch loan fund pool.", error);
    }

    const normalized = {
        ...data,
        total_deposits: roundMoney(data.total_deposits),
        reserved_liquidity: roundMoney(data.reserved_liquidity),
        active_loans_total: roundMoney(data.active_loans_total),
        available_for_loans: roundMoney(data.available_for_loans)
    };

    try {
        const { error: snapshotError } = await adminSupabase
            .from("loan_fund_pool_snapshots")
            .upsert({
                tenant_id: tenantId,
                branch_id: branchId,
                snapshot_date: toDateKey(normalized.last_updated || new Date()),
                total_deposits: normalized.total_deposits,
                reserved_liquidity: normalized.reserved_liquidity,
                active_loans_total: normalized.active_loans_total
            }, { onConflict: "tenant_id,branch_id,snapshot_date" });

        if (snapshotError) {
            throw snapshotError;
        }
    } catch (snapshotError) {
        console.warn("[loan-capacity] skipped fund pool snapshot refresh", {
            tenantId,
            branchId,
            message: snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
        });
    }

    return normalized;
}

function computeLiquidityLimit(fundPool, branchPolicy, productPolicy) {
    const totalDeposits = roundMoney(fundPool.total_deposits);
    const activeLoansTotal = roundMoney(fundPool.active_loans_total);
    const availableForLoans = roundMoney(fundPool.available_for_loans);
    const maxLendingRatio = clampPercent(branchPolicy.max_lending_ratio, DEFAULT_BRANCH_MAX_LENDING_RATIO);
    const minimumReserve = roundMoney(branchPolicy.minimum_liquidity_reserve);
    const liquidityBufferPercent = clampPercent(productPolicy.liquidity_buffer_percent, DEFAULT_LIQUIDITY_BUFFER_PERCENT);
    const ratioHeadroom = roundMoney(Math.max(0, (totalDeposits * (maxLendingRatio / 100)) - activeLoansTotal));
    const reserveHeadroom = roundMoney(Math.max(0, totalDeposits - minimumReserve - activeLoansTotal));
    const bufferHeadroom = roundMoney(Math.max(0, availableForLoans * (1 - (liquidityBufferPercent / 100))));
    const liquidityLimit = roundMoney(Math.max(0, Math.min(
        availableForLoans,
        ratioHeadroom,
        reserveHeadroom,
        bufferHeadroom
    )));
    const freezeThreshold = roundMoney(branchPolicy.auto_loan_freeze_threshold);

    return {
        total_deposits: totalDeposits,
        active_loans_total: activeLoansTotal,
        available_for_loans: availableForLoans,
        ratio_headroom: ratioHeadroom,
        reserve_headroom: reserveHeadroom,
        buffer_headroom: bufferHeadroom,
        liquidity_limit: liquidityLimit,
        freeze_threshold: freezeThreshold,
        is_frozen: availableForLoans <= freezeThreshold
    };
}

async function getLiquidityTrend(tenantId, branchId, days, currentFundPool) {
    const startDate = new Date();
    startDate.setUTCHours(0, 0, 0, 0);
    startDate.setUTCDate(startDate.getUTCDate() - Math.max(0, days - 1));
    const startDateKey = toDateKey(startDate);
    const todayKey = toDateKey(new Date());

    const { data, error } = await adminSupabase
        .from("loan_fund_pool_snapshots")
        .select("snapshot_date, total_deposits, reserved_liquidity, active_loans_total, available_for_loans")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .gte("snapshot_date", startDateKey)
        .order("snapshot_date", { ascending: true });

    if (error) {
        throw new AppError(500, "LOAN_POOL_TREND_FAILED", "Unable to load loan pool trend data.", error);
    }

    const rowMap = new Map((data || []).map((row) => [row.snapshot_date, row]));
    const points = [];
    let coverageDays = 0;

    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const pointDate = new Date();
        pointDate.setUTCHours(0, 0, 0, 0);
        pointDate.setUTCDate(pointDate.getUTCDate() - offset);
        const dateKey = toDateKey(pointDate);
        const snapshotRow = rowMap.get(dateKey);
        const effectiveRow = snapshotRow || (dateKey === todayKey ? currentFundPool : null);

        if (effectiveRow) {
            coverageDays += 1;
        }

        points.push({
            snapshot_date: dateKey,
            total_deposits: effectiveRow ? roundMoney(effectiveRow.total_deposits) : null,
            reserved_liquidity: effectiveRow ? roundMoney(effectiveRow.reserved_liquidity) : null,
            active_loans_total: effectiveRow ? roundMoney(effectiveRow.active_loans_total) : null,
            available_for_loans: effectiveRow ? roundMoney(effectiveRow.available_for_loans) : null,
            has_snapshot: Boolean(snapshotRow) || dateKey === todayKey
        });
    }

    return {
        requested_days: days,
        coverage_days: coverageDays,
        points
    };
}

async function getPolicyChangeHistory(tenantId, loanProductId, branchId, limit = 12) {
    const { data, error } = await adminSupabase
        .from("audit_logs")
        .select("id, action, entity_type, before_data, after_data, actor_user_id, user_id, timestamp, created_at")
        .eq("tenant_id", tenantId)
        .in("action", ["UPDATE_LOAN_PRODUCT_POLICY", "UPDATE_BRANCH_LIQUIDITY_POLICY"])
        .order("timestamp", { ascending: false })
        .limit(Math.max(limit * 8, 48));

    if (error) {
        throw new AppError(500, "LOAN_POLICY_HISTORY_FAILED", "Unable to load loan policy change history.", error);
    }

    const auditRows = data || [];
    const actorIds = Array.from(new Set(auditRows.map((row) => row.actor_user_id || row.user_id).filter(Boolean)));
    let actorNameMap = new Map();

    if (actorIds.length) {
        const { data: profiles, error: profilesError } = await adminSupabase
            .from("user_profiles")
            .select("user_id, full_name")
            .in("user_id", actorIds);

        if (profilesError) {
            throw new AppError(500, "LOAN_POLICY_HISTORY_ACTORS_FAILED", "Unable to resolve policy history actors.", profilesError);
        }

        actorNameMap = new Map((profiles || []).map((row) => [row.user_id, row.full_name]));
    }

    const historyRows = [];

    for (const row of auditRows) {
        const beforeData = row.before_data || {};
        const afterData = row.after_data || {};
        const isProductPolicy = row.action === "UPDATE_LOAN_PRODUCT_POLICY";
        const matchesContext = isProductPolicy
            ? (afterData.loan_product_id || beforeData.loan_product_id) === loanProductId
            : (afterData.branch_id || beforeData.branch_id) === branchId;

        if (!matchesContext) {
            continue;
        }

        for (const [policyKey, policyLabel] of Object.entries(POLICY_CHANGE_LABELS)) {
            if (!Object.prototype.hasOwnProperty.call(beforeData, policyKey) && !Object.prototype.hasOwnProperty.call(afterData, policyKey)) {
                continue;
            }

            const previousValue = Object.prototype.hasOwnProperty.call(beforeData, policyKey) ? beforeData[policyKey] : null;
            const nextValue = Object.prototype.hasOwnProperty.call(afterData, policyKey) ? afterData[policyKey] : null;

            if (String(previousValue ?? "") === String(nextValue ?? "")) {
                continue;
            }

            const actorUserId = row.actor_user_id || row.user_id || null;
            const eventAt = row.timestamp || row.created_at || null;
            historyRows.push({
                id: `${row.id}:${policyKey}`,
                source_audit_id: row.id,
                event_at: eventAt,
                actor_user_id: actorUserId,
                actor_name: actorNameMap.get(actorUserId) || null,
                policy_key: policyKey,
                policy_label: policyLabel,
                policy_scope: isProductPolicy ? "borrowing_policy" : "liquidity_guardrail",
                old_value: formatPolicyValue(policyKey, previousValue),
                new_value: formatPolicyValue(policyKey, nextValue)
            });

            if (historyRows.length >= limit) {
                return historyRows;
            }
        }
    }

    return historyRows;
}

async function getLoanExposureOverview({
    tenantId,
    branchId,
    productPolicy,
    liquidityLimit
}) {
    const { data: loanRows, error: loanError } = await adminSupabase
        .from("loans")
        .select("id, member_id, principal_amount, outstanding_principal, accrued_interest, members(member_no, full_name)")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .in("status", ACTIVE_LOAN_STATUSES);

    if (loanError) {
        throw new AppError(500, "LOAN_EXPOSURE_OVERVIEW_FAILED", "Unable to load active loan exposure.", loanError);
    }

    const activeLoans = loanRows || [];
    const memberIds = Array.from(new Set(activeLoans.map((row) => row.member_id).filter(Boolean)));
    const contributionMap = new Map();

    if (memberIds.length) {
        const { data: accountRows, error: accountError } = await adminSupabase
            .from("member_accounts")
            .select("member_id, product_type, available_balance, locked_balance")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
            .is("deleted_at", null)
            .in("member_id", memberIds);

        if (accountError) {
            throw new AppError(500, "LOAN_EXPOSURE_ACCOUNTS_FAILED", "Unable to load member contribution balances.", accountError);
        }

        for (const row of accountRows || []) {
            if (!CONTRIBUTION_ACCOUNT_TYPES.has(row.product_type)) {
                continue;
            }

            const current = contributionMap.get(row.member_id) || 0;
            contributionMap.set(
                row.member_id,
                roundMoney(current + roundMoney(row.available_balance) + roundMoney(row.locked_balance))
            );
        }
    }

    const totalActiveLoans = roundMoney(activeLoans.reduce((sum, row) => {
        return sum + roundMoney(row.outstanding_principal) + roundMoney(row.accrued_interest);
    }, 0));
    const averageLoanSize = activeLoans.length ? roundMoney(totalActiveLoans / activeLoans.length) : 0;
    const borrowerMap = new Map();

    for (const row of activeLoans) {
        const exposure = roundMoney(roundMoney(row.outstanding_principal) + roundMoney(row.accrued_interest));
        const current = borrowerMap.get(row.member_id) || {
            member_id: row.member_id,
            member_name: row.members?.full_name || "Member",
            member_no: row.members?.member_no || null,
            total_exposure: 0,
            loan_count: 0
        };
        current.total_exposure = roundMoney(current.total_exposure + exposure);
        current.loan_count += 1;
        borrowerMap.set(row.member_id, current);
    }

    const borrowers = Array.from(borrowerMap.values()).map((row) => {
        const contributions = roundMoney(contributionMap.get(row.member_id) || 0);
        const contributionLimit = roundMoney(contributions * productPolicy.contribution_multiplier);
        const borrowLimit = roundMoney(Math.max(0, Math.min(
            contributionLimit,
            productPolicy.max_loan_amount,
            liquidityLimit
        )));
        const capacityUsageRatio = borrowLimit > 0 ? row.total_exposure / borrowLimit : null;

        return {
            ...row,
            contributions,
            borrow_limit: borrowLimit,
            capacity_usage_percent: capacityUsageRatio === null ? null : toPercentValue(capacityUsageRatio)
        };
    });

    const membersNearBorrowLimit = borrowers.filter((row) => {
        return row.borrow_limit > 0 && row.total_exposure >= roundMoney(row.borrow_limit * 0.8);
    }).length;

    return {
        total_active_loans: totalActiveLoans,
        active_loan_count: activeLoans.length,
        members_with_active_loans: memberIds.length,
        average_loan_size: averageLoanSize,
        members_near_borrow_limit: membersNearBorrowLimit,
        top_borrowers: borrowers
            .sort((left, right) => right.total_exposure - left.total_exposure)
            .slice(0, 5)
    };
}

async function recordCapacityAudit({
    tenantId,
    branchId,
    memberId,
    loanProductId,
    requestedAmount,
    borrowLimit,
    contributionLimit,
    productLimit,
    liquidityLimit,
    snapshot
}) {
    const { error } = await adminSupabase
        .from("loan_capacity_audit")
        .insert({
            tenant_id: tenantId,
            branch_id: branchId,
            member_id: memberId,
            loan_product_id: loanProductId,
            requested_amount: requestedAmount === null || typeof requestedAmount === "undefined"
                ? null
                : roundMoney(requestedAmount),
            calculated_limit: roundMoney(borrowLimit),
            contribution_limit: roundMoney(contributionLimit),
            product_limit: roundMoney(productLimit),
            liquidity_limit: roundMoney(liquidityLimit),
            policy_snapshot: snapshot
        });

    if (error) {
        throw new AppError(500, "LOAN_CAPACITY_AUDIT_WRITE_FAILED", "Unable to persist loan capacity audit trail.", error);
    }
}

async function evaluateBorrowCapacity({
    tenantId,
    member,
    loanProduct,
    branchId,
    requestedAmount = null,
    source = "capacity_lookup"
}) {
    const [productPolicyRow, branchPolicyRow] = await Promise.all([
        getLoanProductPolicyRow(tenantId, loanProduct.id),
        getBranchLiquidityPolicyRow(tenantId, branchId)
    ]);

    const productPolicy = normalizeLoanProductPolicy(loanProduct, productPolicyRow);
    const branchPolicy = normalizeBranchLiquidityPolicy(tenantId, branchId, branchPolicyRow);
    const [memberProfile, fundPool] = await Promise.all([
        refreshMemberFinancialProfile(tenantId, member.id),
        refreshBranchFundPool(tenantId, branchId, branchPolicy)
    ]);

    const contributionLimit = roundMoney(memberProfile.total_contributions * productPolicy.contribution_multiplier);
    const productLimit = roundMoney(productPolicy.max_loan_amount);
    const liquidityMetrics = computeLiquidityLimit(fundPool, branchPolicy, productPolicy);
    const borrowLimit = roundMoney(Math.max(0, Math.min(
        contributionLimit,
        productLimit,
        liquidityMetrics.liquidity_limit
    )));
    const minimumLoanAmount = roundMoney(Math.max(10000, productPolicy.min_loan_amount));
    const minimumGuarantorCount = productPolicy.requires_guarantor
        ? Math.max(1, Number(loanProduct.required_guarantors_count || 0))
        : 0;

    const summary = {
        tenant_id: tenantId,
        branch_id: branchId,
        member_id: member.id,
        loan_product_id: loanProduct.id,
        total_contributions: roundMoney(memberProfile.total_contributions),
        locked_savings: roundMoney(memberProfile.locked_savings),
        withdrawable_balance: roundMoney(memberProfile.withdrawable_balance),
        current_loan_exposure: roundMoney(memberProfile.current_loan_exposure),
        guarantor_exposure: roundMoney(memberProfile.guarantor_exposure),
        contribution_limit: contributionLimit,
        product_limit: productLimit,
        liquidity_limit: liquidityMetrics.liquidity_limit,
        borrow_limit: borrowLimit,
        minimum_loan_amount: minimumLoanAmount,
        requires_guarantor: Boolean(productPolicy.requires_guarantor),
        requires_collateral: Boolean(productPolicy.requires_collateral),
        minimum_guarantor_count: minimumGuarantorCount,
        available_for_loans: liquidityMetrics.available_for_loans,
        total_deposits: liquidityMetrics.total_deposits,
        reserved_liquidity: roundMoney(fundPool.reserved_liquidity),
        active_loans_total: liquidityMetrics.active_loans_total,
        max_lending_ratio: roundMoney(branchPolicy.max_lending_ratio),
        minimum_liquidity_reserve: roundMoney(branchPolicy.minimum_liquidity_reserve),
        auto_loan_freeze_threshold: roundMoney(branchPolicy.auto_loan_freeze_threshold),
        liquidity_buffer_percent: roundMoney(productPolicy.liquidity_buffer_percent),
        loan_pool_frozen: liquidityMetrics.is_frozen,
        loan_pool_status: liquidityMetrics.is_frozen ? "frozen" : "available",
        is_currently_eligible: !liquidityMetrics.is_frozen && borrowLimit >= minimumLoanAmount
    };

    await recordCapacityAudit({
        tenantId,
        branchId,
        memberId: member.id,
        loanProductId: loanProduct.id,
        requestedAmount,
        borrowLimit,
        contributionLimit,
        productLimit,
        liquidityLimit: liquidityMetrics.liquidity_limit,
        snapshot: {
            source,
            member_financial_profile: memberProfile,
            loan_product_policy: productPolicy,
            branch_liquidity_policy: branchPolicy,
            loan_fund_pool: fundPool,
            liquidity_metrics: liquidityMetrics,
            calculations: {
                contribution_limit: contributionLimit,
                product_limit: productLimit,
                liquidity_limit: liquidityMetrics.liquidity_limit,
                borrow_limit: borrowLimit,
                minimum_loan_amount: minimumLoanAmount,
                requested_amount: requestedAmount === null || typeof requestedAmount === "undefined"
                    ? null
                    : roundMoney(requestedAmount)
            }
        }
    });

    return summary;
}

function assertOwnMemberAccess(actor, member, branchId) {
    if (actor.role !== ROLES.MEMBER) {
        assertBranchAccess({ auth: actor }, branchId);
        return;
    }

    if (!member.user_id || member.user_id !== actor.user.id) {
        throw new AppError(403, "MEMBER_ACCESS_DENIED", "You can only view your own borrowing capacity.");
    }

    if (member.branch_id !== branchId) {
        throw new AppError(403, "BRANCH_ACCESS_DENIED", "Members can only view borrowing capacity for their home branch.");
    }
}

async function calculateBorrowLimit(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const [member, loanProduct] = await Promise.all([
        getMemberRecord(tenantId, query.member_id),
        getLoanProductRecord(tenantId, query.loan_product_id)
    ]);

    await getBranchRecord(tenantId, query.branch_id);
    assertOwnMemberAccess(actor, member, query.branch_id);

    return evaluateBorrowCapacity({
        tenantId,
        member,
        loanProduct,
        branchId: query.branch_id,
        source: "capacity_endpoint"
    });
}

async function getLoanProductPolicy(actor, loanProductId, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const loanProduct = await getLoanProductRecord(tenantId, loanProductId, { requireActive: false });
    const row = await getLoanProductPolicyRow(tenantId, loanProductId);

    return normalizeLoanProductPolicy(loanProduct, row);
}

async function updateLoanProductPolicy(actor, loanProductId, payload = {}) {
    ensureManager(actor);
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertTwoFactorStepUp(actor, payload, { action: "loan_product_policy_update" });

    const loanProduct = await getLoanProductRecord(tenantId, loanProductId, { requireActive: false });
    const currentRow = await getLoanProductPolicyRow(tenantId, loanProductId);
    const current = normalizeLoanProductPolicy(loanProduct, currentRow);
    const next = {
        contribution_multiplier: payload.contribution_multiplier ?? current.contribution_multiplier,
        max_loan_amount: payload.max_loan_amount ?? current.max_loan_amount,
        min_loan_amount: payload.min_loan_amount ?? current.min_loan_amount,
        liquidity_buffer_percent: payload.liquidity_buffer_percent ?? current.liquidity_buffer_percent,
        requires_guarantor: typeof payload.requires_guarantor === "boolean" ? payload.requires_guarantor : current.requires_guarantor,
        requires_collateral: typeof payload.requires_collateral === "boolean" ? payload.requires_collateral : current.requires_collateral
    };

    if (Number(next.max_loan_amount) < Number(next.min_loan_amount)) {
        throw new AppError(400, "LOAN_PRODUCT_POLICY_INVALID", "Maximum loan amount must be greater than or equal to minimum loan amount.");
    }

    const { data, error } = await adminSupabase
        .from("loan_product_policies")
        .upsert({
            tenant_id: tenantId,
            loan_product_id: loanProductId,
            contribution_multiplier: next.contribution_multiplier,
            max_loan_amount: roundMoney(next.max_loan_amount),
            min_loan_amount: roundMoney(next.min_loan_amount),
            liquidity_buffer_percent: clampPercent(next.liquidity_buffer_percent, DEFAULT_LIQUIDITY_BUFFER_PERCENT),
            requires_guarantor: Boolean(next.requires_guarantor),
            requires_collateral: Boolean(next.requires_collateral)
        }, { onConflict: "tenant_id,loan_product_id" })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_PRODUCT_POLICY_UPDATE_FAILED", "Unable to update loan product borrowing policy.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_product_policies",
        action: "UPDATE_LOAN_PRODUCT_POLICY",
        entityType: "loan_product_policy",
        entityId: data.id,
        beforeData: currentRow,
        afterData: data
    });

    return normalizeLoanProductPolicy(loanProduct, data);
}

async function getBranchLiquidityPolicy(actor, branchId, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    assertBranchAccess({ auth: actor }, branchId);
    await getBranchRecord(tenantId, branchId);
    const row = await getBranchLiquidityPolicyRow(tenantId, branchId);

    return normalizeBranchLiquidityPolicy(tenantId, branchId, row);
}

async function updateBranchLiquidityPolicy(actor, branchId, payload = {}) {
    ensureManager(actor);
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertTwoFactorStepUp(actor, payload, { action: "branch_liquidity_policy_update" });
    assertBranchAccess({ auth: actor }, branchId);
    await getBranchRecord(tenantId, branchId);

    const currentRow = await getBranchLiquidityPolicyRow(tenantId, branchId);
    const current = normalizeBranchLiquidityPolicy(tenantId, branchId, currentRow);
    const next = {
        max_lending_ratio: payload.max_lending_ratio ?? current.max_lending_ratio,
        minimum_liquidity_reserve: payload.minimum_liquidity_reserve ?? current.minimum_liquidity_reserve,
        auto_loan_freeze_threshold: payload.auto_loan_freeze_threshold ?? current.auto_loan_freeze_threshold
    };

    const { data, error } = await adminSupabase
        .from("branch_liquidity_policy")
        .upsert({
            tenant_id: tenantId,
            branch_id: branchId,
            max_lending_ratio: clampPercent(next.max_lending_ratio, DEFAULT_BRANCH_MAX_LENDING_RATIO),
            minimum_liquidity_reserve: roundMoney(next.minimum_liquidity_reserve),
            auto_loan_freeze_threshold: roundMoney(next.auto_loan_freeze_threshold)
        }, { onConflict: "tenant_id,branch_id" })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "BRANCH_LIQUIDITY_POLICY_UPDATE_FAILED", "Unable to update branch liquidity policy.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "branch_liquidity_policy",
        action: "UPDATE_BRANCH_LIQUIDITY_POLICY",
        entityType: "branch_liquidity_policy",
        entityId: data.id,
        beforeData: currentRow,
        afterData: data
    });

    return normalizeBranchLiquidityPolicy(tenantId, branchId, data);
}

async function getBranchFundPool(actor, branchId, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    assertBranchAccess({ auth: actor }, branchId);
    await getBranchRecord(tenantId, branchId);
    const branchPolicy = normalizeBranchLiquidityPolicy(
        tenantId,
        branchId,
        await getBranchLiquidityPolicyRow(tenantId, branchId)
    );

    const fundPool = await refreshBranchFundPool(tenantId, branchId, branchPolicy);
    const liquidityMetrics = computeLiquidityLimit(fundPool, branchPolicy, {
        liquidity_buffer_percent: DEFAULT_LIQUIDITY_BUFFER_PERCENT
    });

    return {
        ...fundPool,
        max_lending_ratio: branchPolicy.max_lending_ratio,
        minimum_liquidity_reserve: branchPolicy.minimum_liquidity_reserve,
        auto_loan_freeze_threshold: branchPolicy.auto_loan_freeze_threshold,
        ratio_headroom: liquidityMetrics.ratio_headroom,
        reserve_headroom: liquidityMetrics.reserve_headroom,
        is_frozen: liquidityMetrics.is_frozen
    };
}

async function getBranchDashboard(actor, branchId, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    const requestedDays = Math.max(7, Math.min(90, Number(query.days || 30)));
    assertTenantAccess({ auth: actor }, tenantId);
    assertBranchAccess({ auth: actor }, branchId);

    const [loanProduct, branch] = await Promise.all([
        getLoanProductRecord(tenantId, query.loan_product_id, { requireActive: false }),
        getBranchRecord(tenantId, branchId)
    ]);

    const [productPolicyRow, branchPolicyRow] = await Promise.all([
        getLoanProductPolicyRow(tenantId, loanProduct.id),
        getBranchLiquidityPolicyRow(tenantId, branchId)
    ]);

    const productPolicy = normalizeLoanProductPolicy(loanProduct, productPolicyRow);
    const branchPolicy = normalizeBranchLiquidityPolicy(tenantId, branchId, branchPolicyRow);
    const fundPool = await refreshBranchFundPool(tenantId, branchId, branchPolicy);
    const liquidityMetrics = computeLiquidityLimit(fundPool, branchPolicy, productPolicy);
    const totalDeposits = roundMoney(fundPool.total_deposits);
    const activeLoansTotal = roundMoney(fundPool.active_loans_total);
    const availableForLoans = roundMoney(fundPool.available_for_loans);
    const liquidityRatio = totalDeposits > 0 ? availableForLoans / totalDeposits : 0;
    const loanUtilizationRatio = totalDeposits > 0 ? activeLoansTotal / totalDeposits : 0;
    const liquidityHealthStatus = liquidityRatio > 0.4 ? "healthy" : liquidityRatio >= 0.2 ? "warning" : "risk";

    const [trend, exposureOverview, policyChangeHistory] = await Promise.all([
        getLiquidityTrend(tenantId, branchId, requestedDays, fundPool),
        getLoanExposureOverview({
            tenantId,
            branchId,
            productPolicy,
            liquidityLimit: liquidityMetrics.liquidity_limit
        }),
        getPolicyChangeHistory(tenantId, loanProduct.id, branchId)
    ]);

    return {
        tenant_id: tenantId,
        branch_id: branchId,
        branch_name: branch.name,
        loan_product_id: loanProduct.id,
        loan_product_name: loanProduct.name,
        requested_days: requestedDays,
        loan_product_policy: {
            contribution_multiplier: roundMoney(productPolicy.contribution_multiplier),
            max_loan_amount: roundMoney(productPolicy.max_loan_amount),
            min_loan_amount: roundMoney(productPolicy.min_loan_amount),
            liquidity_buffer_percent: roundMoney(productPolicy.liquidity_buffer_percent),
            requires_guarantor: Boolean(productPolicy.requires_guarantor),
            requires_collateral: Boolean(productPolicy.requires_collateral)
        },
        branch_liquidity_policy: {
            max_lending_ratio: roundMoney(branchPolicy.max_lending_ratio),
            minimum_liquidity_reserve: roundMoney(branchPolicy.minimum_liquidity_reserve),
            auto_loan_freeze_threshold: roundMoney(branchPolicy.auto_loan_freeze_threshold)
        },
        fund_pool: {
            total_deposits: totalDeposits,
            reserved_liquidity: roundMoney(fundPool.reserved_liquidity),
            active_loans_total: activeLoansTotal,
            available_for_loans: availableForLoans,
            last_updated: fundPool.last_updated || null
        },
        liquidity_limit: roundMoney(liquidityMetrics.liquidity_limit),
        liquidity_health: {
            ratio: roundMoney(liquidityRatio),
            percent: toPercentValue(liquidityRatio),
            status: liquidityHealthStatus,
            label: liquidityHealthStatus === "healthy"
                ? "Healthy"
                : liquidityHealthStatus === "warning"
                    ? "Warning"
                    : "Risk"
        },
        loan_utilization: {
            ratio: roundMoney(loanUtilizationRatio),
            percent: toPercentValue(loanUtilizationRatio),
            active_loans_total: activeLoansTotal,
            total_deposits: totalDeposits
        },
        loan_status: {
            status: liquidityMetrics.is_frozen ? "frozen" : "active",
            is_frozen: liquidityMetrics.is_frozen,
            freeze_threshold: roundMoney(branchPolicy.auto_loan_freeze_threshold),
            message: liquidityMetrics.is_frozen
                ? "New loan applications are temporarily disabled due to low liquidity."
                : "Loan applications are active."
        },
        exposure_overview: exposureOverview,
        trend,
        policy_change_history: policyChangeHistory
    };
}

module.exports = {
    calculateBorrowLimit,
    evaluateBorrowCapacity,
    getLoanProductPolicy,
    updateLoanProductPolicy,
    getBranchLiquidityPolicy,
    updateBranchLiquidityPolicy,
    getBranchFundPool,
    getBranchDashboard,
    formatCurrency
};
