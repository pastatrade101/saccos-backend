const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");

const TENANT_WIDE_ROLES = new Set(["super_admin", "auditor", "platform_admin"]);
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function toNumber(value) {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
}

function isTenantWideActor(actor) {
    return actor.isInternalOps || TENANT_WIDE_ROLES.has(actor.role);
}

function getScopedBranchIds(actor) {
    if (isTenantWideActor(actor)) {
        return null;
    }

    const scoped = new Set();
    (actor.branchIds || []).forEach((branchId) => scoped.add(branchId));

    if (actor.profile?.branch_id) {
        scoped.add(actor.profile.branch_id);
    }

    return Array.from(scoped).filter(Boolean);
}

function applyBranchScope(query, actor, column = "branch_id") {
    const scopedBranchIds = getScopedBranchIds(actor);

    if (!scopedBranchIds) {
        return query;
    }

    if (!scopedBranchIds.length) {
        throw new AppError(403, "BRANCH_SCOPE_REQUIRED", "No branch access scope is configured for this user.");
    }

    return query.in(column, scopedBranchIds);
}

function getReasonSeverity(reasonCode) {
    if (["REVERSAL", "MAKER_CHECKER_VIOLATION", "CASH_VARIANCE"].includes(reasonCode)) {
        return "critical";
    }

    if (["HIGH_VALUE_TX", "BACKDATED_ENTRY", "OUT_OF_HOURS_POSTING"].includes(reasonCode)) {
        return "high";
    }

    return "medium";
}

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function monthStartIsoDate(value = todayIsoDate()) {
    return `${String(value).slice(0, 7)}-01`;
}

function round2(value) {
    return Number(toNumber(value).toFixed(2));
}

function mapByAccountId(rows) {
    return new Map((rows || []).map((row) => [row.account_id, row]));
}

function shouldIncludeAccountRow(amount, comparativeAmount, includeZeroBalances) {
    if (includeZeroBalances) {
        return true;
    }

    return Math.abs(toNumber(amount)) > 0.0001 || Math.abs(toNumber(comparativeAmount)) > 0.0001;
}

function safePctChange(currentAmount, comparativeAmount) {
    const baseline = toNumber(comparativeAmount);
    if (Math.abs(baseline) < 0.0001) {
        return null;
    }

    return round2(((toNumber(currentAmount) - baseline) / baseline) * 100);
}

function resolveReportBranchScope(actor, query) {
    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        return [query.branch_id];
    }

    const scopedBranchIds = getScopedBranchIds(actor);
    if (scopedBranchIds && !scopedBranchIds.length) {
        throw new AppError(403, "BRANCH_SCOPE_REQUIRED", "No branch access scope is configured for this user.");
    }

    return scopedBranchIds;
}

function isMissingFinancialStatementsObjects(error) {
    const message = String(error?.message || "").toLowerCase();
    return (
        error?.code === "42P01"
        || error?.code === "42883"
        || message.includes("financial_statement_runs")
        || message.includes("financial_snapshot_periods")
        || message.includes("financial_statement_account_balances")
    );
}

function toFinancialStatementsSchemaError(error) {
    return new AppError(
        500,
        "FINANCIAL_STATEMENTS_SCHEMA_MISSING",
        "Financial statement schema is missing. Apply SQL migrations 041_phase3_financial_statements.sql and 042_phase3_financial_statements_rls.sql.",
        error
    );
}

async function loadFinancialStatementBalances({ tenantId, fromDate = null, toDate = null, branchIds = null }) {
    const rpcPayload = {
        p_tenant_id: tenantId,
        p_from_date: fromDate,
        p_to_date: toDate,
        p_branch_ids: branchIds && branchIds.length ? branchIds : null
    };

    const { data, error } = await adminSupabase.rpc("financial_statement_account_balances", rpcPayload);

    if (error) {
        if (isMissingFinancialStatementsObjects(error)) {
            throw toFinancialStatementsSchemaError(error);
        }

        throw new AppError(
            500,
            "FINANCIAL_STATEMENT_FETCH_FAILED",
            "Unable to load financial statement balances.",
            error
        );
    }

    return data || [];
}

function normalizeIncomeStatementWindow(query) {
    const toDate = query.to_date || todayIsoDate();
    const defaultFromDate = `${String(toDate).slice(0, 4)}-01-01`;
    const fromDate = query.from_date || defaultFromDate;

    if (fromDate > toDate) {
        throw new AppError(
            400,
            "INVALID_REPORT_PERIOD",
            "`from_date` cannot be after `to_date` for income statement."
        );
    }

    if ((query.compare_from_date && !query.compare_to_date) || (!query.compare_from_date && query.compare_to_date)) {
        throw new AppError(
            400,
            "INVALID_COMPARATIVE_PERIOD",
            "Provide both `compare_from_date` and `compare_to_date` for comparative income statement."
        );
    }

    if (query.compare_from_date && query.compare_from_date > query.compare_to_date) {
        throw new AppError(
            400,
            "INVALID_COMPARATIVE_PERIOD",
            "`compare_from_date` cannot be after `compare_to_date`."
        );
    }

    return {
        fromDate,
        toDate,
        compareFromDate: query.compare_from_date || null,
        compareToDate: query.compare_to_date || null
    };
}

function getRevenueCategoryFlags(accountId, sourceMaps) {
    return {
        fee: sourceMaps.feeRuleNamesByAccount.has(accountId),
        penalty: sourceMaps.penaltyRuleNamesByAccount.has(accountId) || sourceMaps.loanPenaltyProductNamesByAccount.has(accountId),
        loan_interest: sourceMaps.loanInterestProductNamesByAccount.has(accountId),
        loan_fee: sourceMaps.loanFeeProductNamesByAccount.has(accountId)
    };
}

function classifyRevenueAccount(accountId, sourceMaps) {
    const flags = getRevenueCategoryFlags(accountId, sourceMaps);
    const categories = Object.entries(flags)
        .filter(([, active]) => active)
        .map(([category]) => category);

    if (categories.length !== 1) {
        return {
            revenueType: categories.length ? "mixed" : "fee",
            categories
        };
    }

    return {
        revenueType: categories[0],
        categories
    };
}

function classifyRevenueRow(row, sourceMaps) {
    const accountClassification = classifyRevenueAccount(row.account_id, sourceMaps);
    const sourceType = String(row.source_type || "").trim().toLowerCase();
    const categories = accountClassification.categories;

    if (sourceType === "loan_repayment" && (categories.includes("loan_interest") || categories.length > 1)) {
        return {
            revenueType: "loan_interest",
            categories
        };
    }

    if (sourceType === "loan_disbursement" && categories.includes("loan_fee")) {
        return {
            revenueType: "loan_fee",
            categories
        };
    }

    if (sourceType === "membership_fee" && categories.includes("fee")) {
        return {
            revenueType: "fee",
            categories
        };
    }

    if (sourceType === "withdrawal" && categories.includes("fee")) {
        return {
            revenueType: "fee",
            categories
        };
    }

    return accountClassification;
}

async function chargeRevenueSummary(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const fromDate = query.from_date || monthStartIsoDate();
    const toDate = query.to_date || todayIsoDate();

    if (fromDate > toDate) {
        throw new AppError(
            400,
            "INVALID_REPORT_PERIOD",
            "`from_date` cannot be after `to_date` for charge revenue."
        );
    }

    const scopedBranchIds = resolveReportBranchScope(actor, query);

    const [feeRulesResult, penaltyRulesResult, loanProductsResult] = await Promise.all([
        adminSupabase
            .from("fee_rules")
            .select("id, name, fee_type, income_account_id")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null),
        adminSupabase
            .from("penalty_rules")
            .select("id, name, penalty_type, income_account_id")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null),
        adminSupabase
            .from("loan_products")
            .select("id, name, interest_income_account_id, fee_income_account_id, penalty_income_account_id")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
    ]);

    if (feeRulesResult.error) {
        throw new AppError(500, "CHARGE_REVENUE_RULES_FAILED", "Unable to load fee rules.", feeRulesResult.error);
    }

    if (penaltyRulesResult.error) {
        throw new AppError(500, "CHARGE_REVENUE_RULES_FAILED", "Unable to load penalty rules.", penaltyRulesResult.error);
    }

    if (loanProductsResult.error) {
        throw new AppError(500, "CHARGE_REVENUE_RULES_FAILED", "Unable to load loan products.", loanProductsResult.error);
    }

    const feeRules = (feeRulesResult.data || []).filter((row) => row.income_account_id);
    const penaltyRules = (penaltyRulesResult.data || []).filter((row) => row.income_account_id);
    const loanProducts = loanProductsResult.data || [];

    const feeRuleNamesByAccount = new Map();
    feeRules.forEach((rule) => {
        const current = feeRuleNamesByAccount.get(rule.income_account_id) || [];
        current.push(rule.name);
        feeRuleNamesByAccount.set(rule.income_account_id, current);
    });

    const penaltyRuleNamesByAccount = new Map();
    penaltyRules.forEach((rule) => {
        const current = penaltyRuleNamesByAccount.get(rule.income_account_id) || [];
        current.push(rule.name);
        penaltyRuleNamesByAccount.set(rule.income_account_id, current);
    });

    const loanInterestProductNamesByAccount = new Map();
    const loanFeeProductNamesByAccount = new Map();
    const loanPenaltyProductNamesByAccount = new Map();

    loanProducts.forEach((product) => {
        if (product.interest_income_account_id) {
            const current = loanInterestProductNamesByAccount.get(product.interest_income_account_id) || [];
            current.push(product.name);
            loanInterestProductNamesByAccount.set(product.interest_income_account_id, current);
        }

        if (product.fee_income_account_id) {
            const current = loanFeeProductNamesByAccount.get(product.fee_income_account_id) || [];
            current.push(product.name);
            loanFeeProductNamesByAccount.set(product.fee_income_account_id, current);
        }

        if (product.penalty_income_account_id) {
            const current = loanPenaltyProductNamesByAccount.get(product.penalty_income_account_id) || [];
            current.push(product.name);
            loanPenaltyProductNamesByAccount.set(product.penalty_income_account_id, current);
        }
    });

    const sourceMaps = {
        feeRuleNamesByAccount,
        penaltyRuleNamesByAccount,
        loanInterestProductNamesByAccount,
        loanFeeProductNamesByAccount,
        loanPenaltyProductNamesByAccount
    };

    const chargeAccountIds = Array.from(new Set([
        ...Array.from(feeRuleNamesByAccount.keys()),
        ...Array.from(penaltyRuleNamesByAccount.keys()),
        ...Array.from(loanInterestProductNamesByAccount.keys()),
        ...Array.from(loanFeeProductNamesByAccount.keys()),
        ...Array.from(loanPenaltyProductNamesByAccount.keys())
    ].filter(Boolean)));

    let chartOfAccountsById = new Map();
    if (chargeAccountIds.length) {
        const { data: chargeAccounts, error: chargeAccountsError } = await adminSupabase
            .from("chart_of_accounts")
            .select("id, account_code, account_name")
            .eq("tenant_id", tenantId)
            .in("id", chargeAccountIds)
            .is("deleted_at", null);

        if (chargeAccountsError) {
            throw new AppError(500, "CHARGE_REVENUE_ACCOUNT_LOOKUP_FAILED", "Unable to load charge income accounts.", chargeAccountsError);
        }

        chartOfAccountsById = new Map((chargeAccounts || []).map((row) => [row.id, row]));
    }

    const mixedAccounts = chargeAccountIds
        .filter((accountId) => classifyRevenueAccount(accountId, sourceMaps).categories.length > 1)
        .map((accountId) => ({
            account_id: accountId,
            account_code: chartOfAccountsById.get(accountId)?.account_code || null,
            account_name: chartOfAccountsById.get(accountId)?.account_name || null,
            fee_rule_names: feeRuleNamesByAccount.get(accountId) || [],
            penalty_rule_names: penaltyRuleNamesByAccount.get(accountId) || [],
            loan_interest_product_names: loanInterestProductNamesByAccount.get(accountId) || [],
            loan_fee_product_names: loanFeeProductNamesByAccount.get(accountId) || [],
            loan_penalty_product_names: loanPenaltyProductNamesByAccount.get(accountId) || []
        }));

    if (!chargeAccountIds.length) {
        return {
            scope: {
                tenant_id: tenantId,
                from_date: fromDate,
                to_date: toDate,
                branch_ids: scopedBranchIds || [],
                branch_count: scopedBranchIds?.length || 0
            },
            totals: {
                fee_revenue: 0,
                penalty_revenue: 0,
                loan_interest_revenue: 0,
                loan_fee_revenue: 0,
                mixed_revenue: 0,
                charge_revenue: 0,
                loan_revenue: 0,
                total_revenue: 0,
                posted_lines: 0,
                configured_fee_rules: feeRules.length,
                configured_penalty_rules: penaltyRules.length,
                configured_loan_products: loanProducts.length
            },
            configuration_warnings: mixedAccounts,
            trend: [],
            branch_breakdown: [],
            account_breakdown: []
        };
    }

    let ledgerQuery = adminSupabase
        .from("ledger_entries_view")
        .select("account_id, account_code, account_name, branch_id, entry_date, source_type, debit, credit")
        .eq("tenant_id", tenantId)
        .in("account_id", chargeAccountIds)
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate);

    if (scopedBranchIds && scopedBranchIds.length) {
        ledgerQuery = ledgerQuery.in("branch_id", scopedBranchIds);
    }

    const { data: ledgerRows, error: ledgerError } = await ledgerQuery;

    if (ledgerError) {
        throw new AppError(500, "CHARGE_REVENUE_FETCH_FAILED", "Unable to load charge revenue ledger rows.", ledgerError);
    }

    const rows = ledgerRows || [];
    const branchIds = Array.from(new Set(rows.map((row) => row.branch_id).filter(Boolean)));
    let branchNameById = new Map();

    if (branchIds.length) {
        const { data: branches, error: branchesError } = await adminSupabase
            .from("branches")
            .select("id, name, code")
            .in("id", branchIds);

        if (branchesError) {
            throw new AppError(500, "CHARGE_REVENUE_BRANCH_LOOKUP_FAILED", "Unable to resolve branch names.", branchesError);
        }

        branchNameById = new Map((branches || []).map((row) => [row.id, row]));
    }

    const trendMap = new Map();
    const branchBreakdownMap = new Map();
    const accountBreakdownMap = new Map();
    const totals = {
        fee_revenue: 0,
        penalty_revenue: 0,
        loan_interest_revenue: 0,
        loan_fee_revenue: 0,
        mixed_revenue: 0,
        charge_revenue: 0,
        loan_revenue: 0,
        total_revenue: 0,
        posted_lines: 0,
        configured_fee_rules: feeRules.length,
        configured_penalty_rules: penaltyRules.length,
        configured_loan_products: loanProducts.length
    };

    rows.forEach((row) => {
        const amount = round2(toNumber(row.credit) - toNumber(row.debit));
        if (Math.abs(amount) < 0.0001) {
            return;
        }

        const { revenueType } = classifyRevenueRow(row, sourceMaps);
        const branchKey = row.branch_id || "unassigned";
        const accountKey = `${row.account_id}:${revenueType}`;
        const trendKey = row.entry_date;

        totals.total_revenue = round2(totals.total_revenue + amount);
        totals.posted_lines += 1;
        if (revenueType === "fee") {
            totals.fee_revenue = round2(totals.fee_revenue + amount);
        } else if (revenueType === "penalty") {
            totals.penalty_revenue = round2(totals.penalty_revenue + amount);
        } else if (revenueType === "loan_interest") {
            totals.loan_interest_revenue = round2(totals.loan_interest_revenue + amount);
        } else if (revenueType === "loan_fee") {
            totals.loan_fee_revenue = round2(totals.loan_fee_revenue + amount);
        } else {
            totals.mixed_revenue = round2(totals.mixed_revenue + amount);
        }
        totals.charge_revenue = round2(totals.fee_revenue + totals.penalty_revenue);
        totals.loan_revenue = round2(totals.loan_interest_revenue + totals.loan_fee_revenue);

        const trendPoint = trendMap.get(trendKey) || {
            entry_date: trendKey,
            fee_revenue: 0,
            penalty_revenue: 0,
            loan_interest_revenue: 0,
            loan_fee_revenue: 0,
            mixed_revenue: 0,
            charge_revenue: 0,
            loan_revenue: 0,
            total_revenue: 0
        };
        trendPoint.total_revenue = round2(trendPoint.total_revenue + amount);
        if (revenueType === "fee") {
            trendPoint.fee_revenue = round2(trendPoint.fee_revenue + amount);
        } else if (revenueType === "penalty") {
            trendPoint.penalty_revenue = round2(trendPoint.penalty_revenue + amount);
        } else if (revenueType === "loan_interest") {
            trendPoint.loan_interest_revenue = round2(trendPoint.loan_interest_revenue + amount);
        } else if (revenueType === "loan_fee") {
            trendPoint.loan_fee_revenue = round2(trendPoint.loan_fee_revenue + amount);
        } else {
            trendPoint.mixed_revenue = round2(trendPoint.mixed_revenue + amount);
        }
        trendPoint.charge_revenue = round2(
            trendPoint.fee_revenue + trendPoint.penalty_revenue
        );
        trendPoint.loan_revenue = round2(
            trendPoint.loan_interest_revenue + trendPoint.loan_fee_revenue
        );
        trendMap.set(trendKey, trendPoint);

        const branchPoint = branchBreakdownMap.get(branchKey) || {
            branch_id: row.branch_id || null,
            branch_name: branchNameById.get(row.branch_id)?.name || (row.branch_id ? null : "Unassigned"),
            branch_code: branchNameById.get(row.branch_id)?.code || null,
            fee_revenue: 0,
            penalty_revenue: 0,
            loan_interest_revenue: 0,
            loan_fee_revenue: 0,
            mixed_revenue: 0,
            charge_revenue: 0,
            loan_revenue: 0,
            total_revenue: 0
        };
        branchPoint.total_revenue = round2(branchPoint.total_revenue + amount);
        if (revenueType === "fee") {
            branchPoint.fee_revenue = round2(branchPoint.fee_revenue + amount);
        } else if (revenueType === "penalty") {
            branchPoint.penalty_revenue = round2(branchPoint.penalty_revenue + amount);
        } else if (revenueType === "loan_interest") {
            branchPoint.loan_interest_revenue = round2(branchPoint.loan_interest_revenue + amount);
        } else if (revenueType === "loan_fee") {
            branchPoint.loan_fee_revenue = round2(branchPoint.loan_fee_revenue + amount);
        } else {
            branchPoint.mixed_revenue = round2(branchPoint.mixed_revenue + amount);
        }
        branchPoint.charge_revenue = round2(
            branchPoint.fee_revenue + branchPoint.penalty_revenue
        );
        branchPoint.loan_revenue = round2(
            branchPoint.loan_interest_revenue + branchPoint.loan_fee_revenue
        );
        branchBreakdownMap.set(branchKey, branchPoint);

        const accountPoint = accountBreakdownMap.get(accountKey) || {
            revenue_type: revenueType,
            account_id: row.account_id,
            account_code: row.account_code,
            account_name: row.account_name,
            amount: 0,
            posted_lines: 0,
            last_entry_date: row.entry_date,
            configured_rule_names: Array.from(new Set([
                ...(feeRuleNamesByAccount.get(row.account_id) || []),
                ...(penaltyRuleNamesByAccount.get(row.account_id) || []),
                ...(loanInterestProductNamesByAccount.get(row.account_id) || []),
                ...(loanFeeProductNamesByAccount.get(row.account_id) || []),
                ...(loanPenaltyProductNamesByAccount.get(row.account_id) || [])
            ])),
            fee_rule_names: feeRuleNamesByAccount.get(row.account_id) || [],
            penalty_rule_names: penaltyRuleNamesByAccount.get(row.account_id) || [],
            loan_interest_product_names: loanInterestProductNamesByAccount.get(row.account_id) || [],
            loan_fee_product_names: loanFeeProductNamesByAccount.get(row.account_id) || [],
            loan_penalty_product_names: loanPenaltyProductNamesByAccount.get(row.account_id) || []
        };
        accountPoint.amount = round2(accountPoint.amount + amount);
        accountPoint.posted_lines += 1;
        if (row.entry_date > accountPoint.last_entry_date) {
            accountPoint.last_entry_date = row.entry_date;
        }
        accountBreakdownMap.set(accountKey, accountPoint);
    });

    return {
        scope: {
            tenant_id: tenantId,
            from_date: fromDate,
            to_date: toDate,
            branch_ids: scopedBranchIds || [],
            branch_count: scopedBranchIds?.length || 0
        },
        totals,
        configuration_warnings: mixedAccounts,
        trend: Array.from(trendMap.values()).sort((left, right) => left.entry_date.localeCompare(right.entry_date)),
        branch_breakdown: Array.from(branchBreakdownMap.values()).sort((left, right) => right.total_revenue - left.total_revenue),
        account_breakdown: Array.from(accountBreakdownMap.values()).sort((left, right) => right.amount - left.amount)
    };
}

async function persistFinancialStatementRun({
    statementType,
    actor,
    tenantId,
    branchIds,
    periodStartDate = null,
    periodEndDate = null,
    asOfDate = null,
    format,
    rowCount,
    totals,
    comparativeTotals = null,
    metadata = {}
}) {
    const branchId = branchIds && branchIds.length === 1 ? branchIds[0] : null;
    const branchScopeKey = branchId || ZERO_UUID;

    const runPayload = {
        tenant_id: tenantId,
        branch_id: branchId,
        statement_type: statementType,
        period_start_date: periodStartDate,
        period_end_date: periodEndDate,
        as_of_date: asOfDate,
        format: format || "csv",
        report_key: statementType,
        requested_by: actor.user.id,
        row_count: Math.max(0, Number(rowCount || 0)),
        totals_json: totals || {},
        comparative_totals_json: comparativeTotals || null,
        metadata_json: metadata || {}
    };

    const { data: runData, error: runError } = await adminSupabase
        .from("financial_statement_runs")
        .insert(runPayload)
        .select("id")
        .single();

    if (runError || !runData?.id) {
        if (isMissingFinancialStatementsObjects(runError)) {
            throw toFinancialStatementsSchemaError(runError);
        }

        throw new AppError(
            500,
            "FINANCIAL_STATEMENT_RUN_LOG_FAILED",
            "Unable to record financial statement run metadata.",
            runError
        );
    }

    const snapshotStartDate = periodStartDate || asOfDate;
    const snapshotEndDate = periodEndDate || asOfDate;

    if (!snapshotStartDate || !snapshotEndDate) {
        return runData.id;
    }

    const snapshotPayload = {
        tenant_id: tenantId,
        branch_id: branchId,
        statement_type: statementType,
        period_start_date: snapshotStartDate,
        period_end_date: snapshotEndDate,
        branch_scope_key: branchScopeKey,
        snapshot_key: `${statementType}:${snapshotStartDate}:${snapshotEndDate}:${branchScopeKey}`,
        snapshot_json: {
            totals: totals || {},
            comparative_totals: comparativeTotals || null,
            row_count: Math.max(0, Number(rowCount || 0)),
            metadata: metadata || {}
        },
        source_run_id: runData.id,
        created_by: actor.user.id
    };

    const { error: snapshotError } = await adminSupabase
        .from("financial_snapshot_periods")
        .upsert(snapshotPayload, {
            onConflict: "tenant_id,branch_scope_key,statement_type,period_start_date,period_end_date"
        });

    if (snapshotError) {
        if (isMissingFinancialStatementsObjects(snapshotError)) {
            throw toFinancialStatementsSchemaError(snapshotError);
        }

        throw new AppError(
            500,
            "FINANCIAL_SNAPSHOT_WRITE_FAILED",
            "Unable to persist financial snapshot period.",
            snapshotError
        );
    }

    return runData.id;
}

async function fetchRows(viewName, tenantId, queryBuilder) {
    let query = adminSupabase.from(viewName).select("*").eq("tenant_id", tenantId);
    query = queryBuilder(query);

    const { data, error } = await query;

    if (error) {
        throw new AppError(500, "REPORT_FETCH_FAILED", `Unable to load report ${viewName}.`, error);
    }

    return data || [];
}

async function memberStatement(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let rows = await fetchRows("member_statement_view", tenantId, (builder) => {
        let nextQuery = builder.order("transaction_date", { ascending: false });

        if (query.member_id) {
            nextQuery = nextQuery.eq("member_id", query.member_id);
        }

        if (query.account_id) {
            nextQuery = nextQuery.eq("account_id", query.account_id);
        }

        if (query.from_date) {
            nextQuery = nextQuery.gte("transaction_date", query.from_date);
        }

        if (query.to_date) {
            nextQuery = nextQuery.lte("transaction_date", query.to_date);
        }

        return nextQuery;
    });

    if (query.account_id) {
        const { data: account, error } = await adminSupabase
            .from("member_accounts")
            .select("member_id, branch_id")
            .eq("id", query.account_id)
            .single();

        if (error || !account) {
            throw new AppError(404, "ACCOUNT_NOT_FOUND", "Account was not found.");
        }

        assertBranchAccess({ auth: actor }, account.branch_id);
    }

    if (query.member_id) {
        const { data: member, error } = await adminSupabase
            .from("members")
            .select("branch_id")
            .eq("id", query.member_id)
            .single();

        if (error || !member) {
            throw new AppError(404, "MEMBER_NOT_FOUND", "Member was not found.");
        }

        assertBranchAccess({ auth: actor }, member.branch_id);
    }

    rows = rows.map((row) => ({
        transaction_date: row.transaction_date,
        member_name: row.member_name,
        account_number: row.account_number,
        transaction_type: row.transaction_type,
        amount: row.amount,
        direction: row.direction,
        reference: row.reference,
        running_balance: row.running_balance
    }));

    return {
        title: "Member Statement",
        filename: "member-statements",
        rows
    };
}

async function trialBalance(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const rows = await fetchRows("trial_balance_view", tenantId, (builder) => builder.order("account_code"));

    return {
        title: "Trial Balance",
        filename: "trial-balance",
        rows
    };
}

async function balanceSheet(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const asOfDate = query.as_of_date || todayIsoDate();
    const compareAsOfDate = query.compare_as_of_date || null;
    const includeZeroBalances = query.include_zero_balances === true;
    const branchIds = resolveReportBranchScope(actor, query);

    const [currentRows, comparativeRows] = await Promise.all([
        loadFinancialStatementBalances({
            tenantId,
            fromDate: null,
            toDate: asOfDate,
            branchIds
        }),
        compareAsOfDate
            ? loadFinancialStatementBalances({
                tenantId,
                fromDate: null,
                toDate: compareAsOfDate,
                branchIds
            })
            : Promise.resolve([])
    ]);

    const comparativeMap = mapByAccountId(comparativeRows);
    const groupedCurrent = {
        asset: [],
        liability: [],
        equity: []
    };

    (currentRows || [])
        .filter((row) => ["asset", "liability", "equity"].includes(row.account_type))
        .forEach((row) => {
            const comparative = comparativeMap.get(row.account_id);
            const comparativeAmount = toNumber(comparative?.amount);

            if (!shouldIncludeAccountRow(row.amount, comparativeAmount, includeZeroBalances)) {
                return;
            }

            groupedCurrent[row.account_type].push({
                row_type: "account",
                section: row.account_type.toUpperCase(),
                account_code: row.account_code,
                account_name: row.account_name,
                amount: round2(row.amount),
                comparative_amount: compareAsOfDate ? round2(comparativeAmount) : null,
                change_amount: compareAsOfDate ? round2(toNumber(row.amount) - comparativeAmount) : null,
                change_pct: compareAsOfDate ? safePctChange(row.amount, comparativeAmount) : null
            });
        });

    Object.keys(groupedCurrent).forEach((key) => {
        groupedCurrent[key] = groupedCurrent[key].sort((left, right) => String(left.account_code).localeCompare(String(right.account_code)));
    });

    const totals = {
        total_assets: round2(groupedCurrent.asset.reduce((sum, row) => sum + toNumber(row.amount), 0)),
        total_liabilities: round2(groupedCurrent.liability.reduce((sum, row) => sum + toNumber(row.amount), 0)),
        total_equity: round2(groupedCurrent.equity.reduce((sum, row) => sum + toNumber(row.amount), 0))
    };

    const comparativeTotals = compareAsOfDate
        ? {
            total_assets: round2(groupedCurrent.asset.reduce((sum, row) => sum + toNumber(row.comparative_amount), 0)),
            total_liabilities: round2(groupedCurrent.liability.reduce((sum, row) => sum + toNumber(row.comparative_amount), 0)),
            total_equity: round2(groupedCurrent.equity.reduce((sum, row) => sum + toNumber(row.comparative_amount), 0))
        }
        : null;

    totals.balance_check = round2(totals.total_assets - (totals.total_liabilities + totals.total_equity));
    if (comparativeTotals) {
        comparativeTotals.balance_check = round2(
            comparativeTotals.total_assets - (comparativeTotals.total_liabilities + comparativeTotals.total_equity)
        );
    }

    const rows = [
        ...groupedCurrent.asset,
        {
            row_type: "total",
            section: "ASSET",
            account_code: "",
            account_name: "Total Assets",
            amount: totals.total_assets,
            comparative_amount: comparativeTotals ? comparativeTotals.total_assets : null,
            change_amount: comparativeTotals ? round2(totals.total_assets - comparativeTotals.total_assets) : null,
            change_pct: comparativeTotals ? safePctChange(totals.total_assets, comparativeTotals.total_assets) : null
        },
        ...groupedCurrent.liability,
        {
            row_type: "total",
            section: "LIABILITY",
            account_code: "",
            account_name: "Total Liabilities",
            amount: totals.total_liabilities,
            comparative_amount: comparativeTotals ? comparativeTotals.total_liabilities : null,
            change_amount: comparativeTotals ? round2(totals.total_liabilities - comparativeTotals.total_liabilities) : null,
            change_pct: comparativeTotals ? safePctChange(totals.total_liabilities, comparativeTotals.total_liabilities) : null
        },
        ...groupedCurrent.equity,
        {
            row_type: "total",
            section: "EQUITY",
            account_code: "",
            account_name: "Total Equity",
            amount: totals.total_equity,
            comparative_amount: comparativeTotals ? comparativeTotals.total_equity : null,
            change_amount: comparativeTotals ? round2(totals.total_equity - comparativeTotals.total_equity) : null,
            change_pct: comparativeTotals ? safePctChange(totals.total_equity, comparativeTotals.total_equity) : null
        },
        {
            row_type: "check",
            section: "BALANCE_CHECK",
            account_code: "",
            account_name: "Assets - (Liabilities + Equity)",
            amount: totals.balance_check,
            comparative_amount: comparativeTotals ? comparativeTotals.balance_check : null,
            change_amount: comparativeTotals ? round2(totals.balance_check - comparativeTotals.balance_check) : null,
            change_pct: comparativeTotals ? safePctChange(totals.balance_check, comparativeTotals.balance_check) : null
        }
    ];

    await persistFinancialStatementRun({
        statementType: "balance_sheet",
        actor,
        tenantId,
        branchIds,
        periodStartDate: asOfDate,
        periodEndDate: asOfDate,
        asOfDate,
        format: query.format,
        rowCount: rows.length,
        totals,
        comparativeTotals,
        metadata: {
            compare_as_of_date: compareAsOfDate,
            include_zero_balances: includeZeroBalances
        }
    });

    const title = compareAsOfDate
        ? `Balance Sheet (As of ${asOfDate}, Comparative ${compareAsOfDate})`
        : `Balance Sheet (As of ${asOfDate})`;

    return {
        title,
        filename: "balance-sheet",
        rows
    };
}

async function incomeStatement(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const includeZeroBalances = query.include_zero_balances === true;
    const branchIds = resolveReportBranchScope(actor, query);
    const {
        fromDate,
        toDate,
        compareFromDate,
        compareToDate
    } = normalizeIncomeStatementWindow(query);

    const [currentRows, comparativeRows] = await Promise.all([
        loadFinancialStatementBalances({
            tenantId,
            fromDate,
            toDate,
            branchIds
        }),
        compareFromDate && compareToDate
            ? loadFinancialStatementBalances({
                tenantId,
                fromDate: compareFromDate,
                toDate: compareToDate,
                branchIds
            })
            : Promise.resolve([])
    ]);

    const comparativeMap = mapByAccountId(comparativeRows);
    const groupedCurrent = {
        income: [],
        expense: []
    };

    (currentRows || [])
        .filter((row) => ["income", "expense"].includes(row.account_type))
        .forEach((row) => {
            const comparative = comparativeMap.get(row.account_id);
            const comparativeAmount = toNumber(comparative?.amount);

            if (!shouldIncludeAccountRow(row.amount, comparativeAmount, includeZeroBalances)) {
                return;
            }

            groupedCurrent[row.account_type].push({
                row_type: "account",
                section: row.account_type.toUpperCase(),
                account_code: row.account_code,
                account_name: row.account_name,
                amount: round2(row.amount),
                comparative_amount: compareFromDate && compareToDate ? round2(comparativeAmount) : null,
                change_amount: compareFromDate && compareToDate ? round2(toNumber(row.amount) - comparativeAmount) : null,
                change_pct: compareFromDate && compareToDate ? safePctChange(row.amount, comparativeAmount) : null
            });
        });

    groupedCurrent.income = groupedCurrent.income.sort((left, right) => String(left.account_code).localeCompare(String(right.account_code)));
    groupedCurrent.expense = groupedCurrent.expense.sort((left, right) => String(left.account_code).localeCompare(String(right.account_code)));

    const totals = {
        total_income: round2(groupedCurrent.income.reduce((sum, row) => sum + toNumber(row.amount), 0)),
        total_expenses: round2(groupedCurrent.expense.reduce((sum, row) => sum + toNumber(row.amount), 0))
    };
    totals.net_surplus = round2(totals.total_income - totals.total_expenses);

    const comparativeTotals = compareFromDate && compareToDate
        ? {
            total_income: round2(groupedCurrent.income.reduce((sum, row) => sum + toNumber(row.comparative_amount), 0)),
            total_expenses: round2(groupedCurrent.expense.reduce((sum, row) => sum + toNumber(row.comparative_amount), 0))
        }
        : null;
    if (comparativeTotals) {
        comparativeTotals.net_surplus = round2(comparativeTotals.total_income - comparativeTotals.total_expenses);
    }

    const rows = [
        ...groupedCurrent.income,
        {
            row_type: "total",
            section: "INCOME",
            account_code: "",
            account_name: "Total Income",
            amount: totals.total_income,
            comparative_amount: comparativeTotals ? comparativeTotals.total_income : null,
            change_amount: comparativeTotals ? round2(totals.total_income - comparativeTotals.total_income) : null,
            change_pct: comparativeTotals ? safePctChange(totals.total_income, comparativeTotals.total_income) : null
        },
        ...groupedCurrent.expense,
        {
            row_type: "total",
            section: "EXPENSE",
            account_code: "",
            account_name: "Total Expenses",
            amount: totals.total_expenses,
            comparative_amount: comparativeTotals ? comparativeTotals.total_expenses : null,
            change_amount: comparativeTotals ? round2(totals.total_expenses - comparativeTotals.total_expenses) : null,
            change_pct: comparativeTotals ? safePctChange(totals.total_expenses, comparativeTotals.total_expenses) : null
        },
        {
            row_type: "result",
            section: "NET_RESULT",
            account_code: "",
            account_name: "Net Surplus / (Deficit)",
            amount: totals.net_surplus,
            comparative_amount: comparativeTotals ? comparativeTotals.net_surplus : null,
            change_amount: comparativeTotals ? round2(totals.net_surplus - comparativeTotals.net_surplus) : null,
            change_pct: comparativeTotals ? safePctChange(totals.net_surplus, comparativeTotals.net_surplus) : null
        }
    ];

    await persistFinancialStatementRun({
        statementType: "income_statement",
        actor,
        tenantId,
        branchIds,
        periodStartDate: fromDate,
        periodEndDate: toDate,
        asOfDate: toDate,
        format: query.format,
        rowCount: rows.length,
        totals,
        comparativeTotals,
        metadata: {
            compare_from_date: compareFromDate,
            compare_to_date: compareToDate,
            include_zero_balances: includeZeroBalances
        }
    });

    const title = compareFromDate && compareToDate
        ? `Income Statement (${fromDate} to ${toDate}, Comparative ${compareFromDate} to ${compareToDate})`
        : `Income Statement (${fromDate} to ${toDate})`;

    return {
        title,
        filename: "income-statement",
        rows
    };
}

async function cashPosition(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const rows = await fetchRows("cash_position_view", tenantId, (builder) => builder.order("branch_name"));

    rows.forEach((row) => {
        if (row.branch_id) {
            assertBranchAccess({ auth: actor }, row.branch_id);
        }
    });

    return {
        title: "Cash Position",
        filename: "cash-position",
        rows
    };
}

async function parReport(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const rows = await fetchRows("loan_arrears_view", tenantId, (builder) => {
        let nextQuery = builder.order("days_past_due", { ascending: false });

        if (query.as_of_date) {
            nextQuery = nextQuery.lte("snapshot_date", query.as_of_date);
        }

        return nextQuery;
    });

    return {
        title: "Portfolio At Risk",
        filename: "portfolio-at-risk",
        rows
    };
}

async function loanAging(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const rows = await fetchRows("loan_aging_view", tenantId, (builder) => builder.order("bucket_order"));

    return {
        title: "Loan Aging",
        filename: "loan-aging",
        rows
    };
}

async function loanPortfolioSummary(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let loansQuery = adminSupabase
        .from("loans")
        .select(`
            id,
            tenant_id,
            loan_number,
            status,
            principal_amount,
            outstanding_principal,
            accrued_interest,
            annual_interest_rate,
            term_count,
            branch_id,
            member_id,
            disbursed_at,
            created_at,
            members(member_no, full_name),
            branches(code, name)
        `)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    if (query.status) {
        loansQuery = loansQuery.eq("status", query.status);
    }

    if (query.from_date) {
        loansQuery = loansQuery.gte("created_at", `${query.from_date}T00:00:00.000Z`);
    }

    if (query.to_date) {
        loansQuery = loansQuery.lte("created_at", `${query.to_date}T23:59:59.999Z`);
    }

    if (query.member_id) {
        loansQuery = loansQuery.eq("member_id", query.member_id);
    }

    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        loansQuery = loansQuery.eq("branch_id", query.branch_id);
    } else {
        loansQuery = applyBranchScope(loansQuery, actor, "branch_id");
    }

    const { data: loans, error: loansError } = await loansQuery;

    if (loansError) {
        throw new AppError(500, "LOAN_PORTFOLIO_REPORT_FAILED", "Unable to load loan portfolio summary.", loansError);
    }

    const loanIds = (loans || []).map((loan) => loan.id);
    let arrearsMap = new Map();

    if (loanIds.length) {
        let arrearsQuery = adminSupabase
            .from("loan_arrears_view")
            .select("loan_id, overdue_amount, days_past_due, par_bucket")
            .eq("tenant_id", tenantId)
            .in("loan_id", loanIds);

        if (query.as_of_date) {
            arrearsQuery = arrearsQuery.lte("snapshot_date", query.as_of_date);
        }

        const { data: arrearsRows, error: arrearsError } = await arrearsQuery;

        if (arrearsError) {
            throw new AppError(500, "LOAN_ARREARS_LOOKUP_FAILED", "Unable to load loan arrears for summary.", arrearsError);
        }

        arrearsMap = new Map((arrearsRows || []).map((row) => [row.loan_id, row]));
    }

    const grouped = new Map();
    let overall = {
        scope: "TOTAL",
        branch_code: query.branch_id ? "SELECTED" : "ALL",
        branch_name: query.branch_id ? "Selected Branch" : "All Branches",
        status: "TOTAL",
        loan_count: 0,
        principal_total: 0,
        outstanding_total: 0,
        accrued_interest_total: 0,
        overdue_total: 0,
        par30_loans_count: 0,
        par30_outstanding_total: 0,
        par30_ratio_percent: 0
    };

    (loans || []).forEach((loan) => {
        const arrears = arrearsMap.get(loan.id);
        const overdueAmount = toNumber(arrears?.overdue_amount);
        const daysPastDue = toNumber(arrears?.days_past_due);
        const outstanding = toNumber(loan.outstanding_principal);
        const isPar30 = daysPastDue >= 30 && outstanding > 0;
        const branchCode = loan.branches?.code || "UNASSIGNED";
        const branchName = loan.branches?.name || "Unassigned";
        const key = `${branchCode}|${loan.status}`;

        const current = grouped.get(key) || {
            scope: "BRANCH_STATUS",
            branch_code: branchCode,
            branch_name: branchName,
            status: loan.status,
            loan_count: 0,
            principal_total: 0,
            outstanding_total: 0,
            accrued_interest_total: 0,
            overdue_total: 0,
            par30_loans_count: 0,
            par30_outstanding_total: 0,
            par30_ratio_percent: 0
        };

        current.loan_count += 1;
        current.principal_total += toNumber(loan.principal_amount);
        current.outstanding_total += outstanding;
        current.accrued_interest_total += toNumber(loan.accrued_interest);
        current.overdue_total += overdueAmount;
        current.par30_loans_count += isPar30 ? 1 : 0;
        current.par30_outstanding_total += isPar30 ? outstanding : 0;
        grouped.set(key, current);

        overall.loan_count += 1;
        overall.principal_total += toNumber(loan.principal_amount);
        overall.outstanding_total += outstanding;
        overall.accrued_interest_total += toNumber(loan.accrued_interest);
        overall.overdue_total += overdueAmount;
        overall.par30_loans_count += isPar30 ? 1 : 0;
        overall.par30_outstanding_total += isPar30 ? outstanding : 0;
    });

    const rows = Array.from(grouped.values())
        .map((row) => ({
            ...row,
            par30_ratio_percent: row.outstanding_total > 0
                ? Number(((row.par30_outstanding_total / row.outstanding_total) * 100).toFixed(2))
                : 0
        }))
        .sort((a, b) => a.branch_name.localeCompare(b.branch_name) || a.status.localeCompare(b.status));

    overall = {
        ...overall,
        par30_ratio_percent: overall.outstanding_total > 0
            ? Number(((overall.par30_outstanding_total / overall.outstanding_total) * 100).toFixed(2))
            : 0
    };

    if (rows.length) {
        rows.push(overall);
    }

    return {
        title: "Loan Portfolio Summary",
        filename: "loan-portfolio-summary",
        rows
    };
}

async function memberBalancesSummary(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let membersQuery = adminSupabase
        .from("members")
        .select(`
            id,
            member_no,
            full_name,
            status,
            branch_id,
            created_at,
            branches(code, name)
        `)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("full_name", { ascending: true });

    if (query.member_id) {
        membersQuery = membersQuery.eq("id", query.member_id);
    }

    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        membersQuery = membersQuery.eq("branch_id", query.branch_id);
    } else {
        membersQuery = applyBranchScope(membersQuery, actor, "branch_id");
    }

    const { data: members, error: membersError } = await membersQuery;

    if (membersError) {
        throw new AppError(500, "MEMBER_BALANCES_REPORT_FAILED", "Unable to load members for balances summary.", membersError);
    }

    if (!members || !members.length) {
        return {
            title: "Member Balances Summary",
            filename: "member-balances-summary",
            rows: []
        };
    }

    const memberIds = members.map((member) => member.id);

    const { data: accounts, error: accountsError } = await adminSupabase
        .from("member_accounts")
        .select("member_id, product_type, status, available_balance, locked_balance")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .in("member_id", memberIds);

    if (accountsError) {
        throw new AppError(500, "MEMBER_ACCOUNT_LOOKUP_FAILED", "Unable to load member accounts for balances summary.", accountsError);
    }

    const { data: loans, error: loansError } = await adminSupabase
        .from("loans")
        .select("member_id, status, outstanding_principal, accrued_interest")
        .eq("tenant_id", tenantId)
        .in("member_id", memberIds);

    if (loansError) {
        throw new AppError(500, "MEMBER_LOAN_LOOKUP_FAILED", "Unable to load member loans for balances summary.", loansError);
    }

    const balanceMap = new Map();

    members.forEach((member) => {
        balanceMap.set(member.id, {
            member_no: member.member_no,
            member_name: member.full_name,
            member_status: member.status,
            branch_code: member.branches?.code || "UNASSIGNED",
            branch_name: member.branches?.name || "Unassigned",
            account_count: 0,
            active_account_count: 0,
            savings_balance: 0,
            shares_balance: 0,
            fixed_deposit_balance: 0,
            total_available_balance: 0,
            total_locked_balance: 0,
            total_member_funds: 0,
            active_loan_count: 0,
            outstanding_loan_principal: 0,
            accrued_loan_interest: 0,
            net_position: 0
        });
    });

    (accounts || []).forEach((account) => {
        const current = balanceMap.get(account.member_id);

        if (!current) {
            return;
        }

        const available = toNumber(account.available_balance);
        const locked = toNumber(account.locked_balance);

        current.account_count += 1;
        current.active_account_count += account.status === "active" ? 1 : 0;
        current.total_available_balance += available;
        current.total_locked_balance += locked;

        if (account.product_type === "savings") {
            current.savings_balance += available;
        } else if (account.product_type === "shares") {
            current.shares_balance += available;
        } else if (account.product_type === "fixed_deposit") {
            current.fixed_deposit_balance += available;
        }
    });

    (loans || []).forEach((loan) => {
        const current = balanceMap.get(loan.member_id);

        if (!current) {
            return;
        }

        const isActiveLoan = ["active", "in_arrears"].includes(loan.status);
        current.active_loan_count += isActiveLoan ? 1 : 0;
        current.outstanding_loan_principal += toNumber(loan.outstanding_principal);
        current.accrued_loan_interest += toNumber(loan.accrued_interest);
    });

    const rows = Array.from(balanceMap.values())
        .map((row) => {
            const totalMemberFunds = row.total_available_balance + row.total_locked_balance;
            const totalLoanExposure = row.outstanding_loan_principal + row.accrued_loan_interest;

            return {
                ...row,
                total_member_funds: totalMemberFunds,
                net_position: Number((totalMemberFunds - totalLoanExposure).toFixed(2))
            };
        })
        .sort((a, b) => a.member_name.localeCompare(b.member_name));

    return {
        title: "Member Balances Summary",
        filename: "member-balances-summary",
        rows
    };
}

async function auditExceptionsReport(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let exceptionsQuery = adminSupabase
        .from("v_audit_exception_feed")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    if (query.from_date) {
        exceptionsQuery = exceptionsQuery.gte("created_at", query.from_date);
    }

    if (query.to_date) {
        exceptionsQuery = exceptionsQuery.lte("created_at", `${query.to_date}T23:59:59.999Z`);
    }

    if (query.reason_code) {
        exceptionsQuery = exceptionsQuery.eq("reason_code", query.reason_code);
    }

    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        exceptionsQuery = exceptionsQuery.eq("branch_id", query.branch_id);
    } else {
        exceptionsQuery = applyBranchScope(exceptionsQuery, actor, "branch_id");
    }

    const { data: exceptionRows, error: exceptionsError } = await exceptionsQuery;

    if (exceptionsError) {
        throw new AppError(500, "AUDIT_EXCEPTIONS_REPORT_FAILED", "Unable to load audit exceptions report.", exceptionsError);
    }

    const rows = exceptionRows || [];
    const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
    const branchIds = Array.from(new Set(rows.map((row) => row.branch_id).filter(Boolean)));

    let userMap = new Map();
    let branchMap = new Map();

    if (userIds.length) {
        const { data: users, error: usersError } = await adminSupabase
            .from("user_profiles")
            .select("user_id, full_name")
            .in("user_id", userIds);

        if (usersError) {
            throw new AppError(500, "AUDIT_EXCEPTION_USER_LOOKUP_FAILED", "Unable to resolve exception actors.", usersError);
        }

        userMap = new Map((users || []).map((row) => [row.user_id, row.full_name]));
    }

    if (branchIds.length) {
        const { data: branches, error: branchesError } = await adminSupabase
            .from("branches")
            .select("id, code, name")
            .in("id", branchIds);

        if (branchesError) {
            throw new AppError(500, "AUDIT_EXCEPTION_BRANCH_LOOKUP_FAILED", "Unable to resolve exception branches.", branchesError);
        }

        branchMap = new Map((branches || []).map((row) => [row.id, row]));
    }

    return {
        title: "Audit Exceptions Report",
        filename: "audit-exceptions",
        rows: rows.map((row) => ({
            created_at: row.created_at,
            reason_code: row.reason_code,
            severity: getReasonSeverity(row.reason_code),
            reference: row.reference,
            journal_id: row.journal_id,
            amount: toNumber(row.amount),
            actor_user_id: row.user_id,
            actor_name: userMap.get(row.user_id) || "Unknown actor",
            branch_id: row.branch_id,
            branch_code: branchMap.get(row.branch_id)?.code || null,
            branch_name: branchMap.get(row.branch_id)?.name || null
        }))
    };
}

async function auditEvidencePack(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const fromDate = query.from_date || monthStartIsoDate();
    const toDate = query.to_date || todayIsoDate();

    let exceptionsQuery = adminSupabase
        .from("v_audit_exception_feed")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("created_at", fromDate)
        .lte("created_at", `${toDate}T23:59:59.999Z`)
        .order("created_at", { ascending: false });

    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        exceptionsQuery = exceptionsQuery.eq("branch_id", query.branch_id);
    } else {
        exceptionsQuery = applyBranchScope(exceptionsQuery, actor, "branch_id");
    }

    const [exceptionsResult, casesResult, branchesResult] = await Promise.all([
        exceptionsQuery,
        adminSupabase
            .from("audit_cases")
            .select("id, status, severity, reason_code, branch_id, opened_at, created_at, resolved_at")
            .eq("tenant_id", tenantId),
        adminSupabase
            .from("branches")
            .select("id, code, name")
            .eq("tenant_id", tenantId)
    ]);

    if (exceptionsResult.error) {
        throw new AppError(500, "AUDIT_EVIDENCE_PACK_FAILED", "Unable to load audit exceptions for the evidence pack.", exceptionsResult.error);
    }

    if (casesResult.error && !["PGRST205", "42P01", "42703"].includes(String(casesResult.error.code || ""))) {
        throw new AppError(500, "AUDIT_EVIDENCE_PACK_FAILED", "Unable to load audit cases for the evidence pack.", casesResult.error);
    }

    if (branchesResult.error) {
        throw new AppError(500, "AUDIT_EVIDENCE_PACK_FAILED", "Unable to resolve branch names for the evidence pack.", branchesResult.error);
    }

    const exceptions = exceptionsResult.data || [];
    const cases = casesResult.data || [];
    const branchMap = new Map((branchesResult.data || []).map((row) => [row.id, row]));

    const reasonCounts = new Map();
    const branchCounts = new Map();

    for (const row of exceptions) {
        const reason = String(row.reason_code || "UNKNOWN");
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);

        const branchId = row.branch_id || "unassigned";
        const current = branchCounts.get(branchId) || {
            branch_name: row.branch_id ? branchMap.get(row.branch_id)?.name || "Unknown branch" : "No branch",
            branch_code: row.branch_id ? branchMap.get(row.branch_id)?.code || null : null,
            total: 0,
            critical: 0
        };
        current.total += 1;
        if (getReasonSeverity(row.reason_code) === "critical") {
            current.critical += 1;
        }
        branchCounts.set(branchId, current);
    }

    const rows = [
        {
            section: "Pack",
            item: "Tenant",
            value: tenantId,
            notes: "Audit evidence pack scope"
        },
        {
            section: "Pack",
            item: "Date window",
            value: `${fromDate} to ${toDate}`,
            notes: "Exception and case review range"
        },
        {
            section: "Summary",
            item: "Total exceptions",
            value: exceptions.length,
            notes: "All exceptions within scope"
        },
        {
            section: "Summary",
            item: "Critical exceptions",
            value: exceptions.filter((row) => getReasonSeverity(row.reason_code) === "critical").length,
            notes: "Highest-risk exception items"
        },
        {
            section: "Summary",
            item: "Open audit cases",
            value: cases.filter((row) => !["resolved", "waived"].includes(row.status)).length,
            notes: "Cases still requiring investigation"
        },
        {
            section: "Summary",
            item: "Resolved or waived cases",
            value: cases.filter((row) => ["resolved", "waived"].includes(row.status)).length,
            notes: "Cases already closed"
        },
        ...Array.from(reasonCounts.entries())
            .sort((left, right) => right[1] - left[1])
            .slice(0, 10)
            .map(([reason, count]) => ({
                section: "Reason concentration",
                item: reason,
                value: count,
                notes: `Severity ${getReasonSeverity(reason)}`
            })),
        ...Array.from(branchCounts.values())
            .sort((left, right) => right.critical - left.critical || right.total - left.total)
            .slice(0, 10)
            .map((branch) => ({
                section: "Branch concentration",
                item: branch.branch_name,
                value: branch.total,
                notes: `${branch.critical} critical exception(s)${branch.branch_code ? ` • ${branch.branch_code}` : ""}`
            }))
    ];

    return {
        title: "Audit Evidence Pack",
        filename: `audit-evidence-pack-${toDate}`,
        rows
    };
}

module.exports = {
    memberStatement,
    trialBalance,
    balanceSheet,
    incomeStatement,
    chargeRevenueSummary,
    cashPosition,
    parReport,
    loanAging,
    loanPortfolioSummary,
    memberBalancesSummary,
    auditExceptionsReport,
    auditEvidencePack
};
