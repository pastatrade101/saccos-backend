const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");

const TENANT_WIDE_ROLES = new Set(["super_admin", "auditor", "platform_admin"]);

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

module.exports = {
    memberStatement,
    trialBalance,
    cashPosition,
    parReport,
    loanAging,
    loanPortfolioSummary,
    memberBalancesSummary,
    auditExceptionsReport
};
