const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");

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

module.exports = {
    memberStatement,
    trialBalance,
    cashPosition,
    parReport,
    loanAging
};
