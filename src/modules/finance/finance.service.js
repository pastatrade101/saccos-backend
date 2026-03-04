const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");

async function getAccountWithMember(accountId, expectedProductType = null) {
    const { data, error } = await adminSupabase
        .from("member_accounts")
        .select("*")
        .eq("id", accountId)
        .is("deleted_at", null)
        .single();

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

async function deposit(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { account, member } = await getAccountWithMember(payload.account_id, "savings");
    assertTenantAccess({ auth: actor }, account.tenant_id);
    assertBranchAccess({ auth: actor }, member.branch_id);

    const result = await runFinancialFunction("deposit", {
        p_tenant_id: tenantId,
        p_account_id: payload.account_id,
        p_amount: payload.amount,
        p_teller_id: payload.teller_id || actor.user.id,
        p_reference: payload.reference || null,
        p_description: payload.description || null
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
            reference: payload.reference || null,
            journal_id: result.journal_id || null
        }
    });

    return result;
}

async function withdraw(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { account, member } = await getAccountWithMember(payload.account_id, "savings");
    assertTenantAccess({ auth: actor }, account.tenant_id);
    assertBranchAccess({ auth: actor }, member.branch_id);

    const result = await runFinancialFunction("withdraw", {
        p_tenant_id: tenantId,
        p_account_id: payload.account_id,
        p_amount: payload.amount,
        p_teller_id: payload.teller_id || actor.user.id,
        p_reference: payload.reference || null,
        p_description: payload.description || null
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

    return result;
}

async function shareContribution(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { account, member } = await getAccountWithMember(payload.account_id, "shares");
    assertTenantAccess({ auth: actor }, account.tenant_id);
    assertBranchAccess({ auth: actor }, member.branch_id);

    const result = await runFinancialFunction("share_contribution", {
        p_tenant_id: tenantId,
        p_account_id: payload.account_id,
        p_amount: payload.amount,
        p_teller_id: payload.teller_id || actor.user.id,
        p_reference: payload.reference || null,
        p_description: payload.description || null
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

async function dividendAllocation(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

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

async function loanDisburse(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    assertBranchAccess({ auth: actor }, payload.branch_id);

    const result = await runFinancialFunction("loan_disburse", {
        p_tenant_id: tenantId,
        p_member_id: payload.member_id,
        p_branch_id: payload.branch_id,
        p_principal_amount: payload.principal_amount,
        p_annual_interest_rate: payload.annual_interest_rate,
        p_term_count: payload.term_count,
        p_repayment_frequency: payload.repayment_frequency,
        p_disbursed_by: payload.disbursed_by || actor.user.id,
        p_reference: payload.reference || null,
        p_description: payload.description || null
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loans",
        entityType: "loan",
        entityId: result.loan_id || null,
        action: "LOAN_DISBURSED",
        afterData: {
            member_id: payload.member_id,
            branch_id: payload.branch_id,
            principal_amount: payload.principal_amount,
            reference: payload.reference || null,
            journal_id: result.journal_id || null,
            loan_id: result.loan_id || null,
            loan_number: result.loan_number || null
        }
    });

    return result;
}

async function loanRepay(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const loan = await getLoan(payload.loan_id);
    assertTenantAccess({ auth: actor }, loan.tenant_id);
    assertBranchAccess({ auth: actor }, loan.branch_id);

    const result = await runFinancialFunction("loan_repayment", {
        p_tenant_id: tenantId,
        p_loan_id: payload.loan_id,
        p_amount: payload.amount,
        p_user_id: payload.user_id || actor.user.id,
        p_reference: payload.reference || null,
        p_description: payload.description || null
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
            reference: payload.reference || null,
            journal_id: result.journal_id || null,
            interest_component: result.interest_component || null
        }
    });

    return result;
}

async function accrueInterest(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const result = await runFinancialFunction("interest_accrual", {
        p_tenant_id: tenantId,
        p_as_of_date: payload.as_of_date || new Date().toISOString().slice(0, 10),
        p_user_id: payload.user_id || actor.user.id
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "journal_entries",
        entityType: "interest_accrual",
        action: "INTEREST_ACCRUAL_POSTED",
        afterData: {
            as_of_date: payload.as_of_date || new Date().toISOString().slice(0, 10)
        }
    });

    return result;
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

    let statementQuery = adminSupabase
        .from("member_statement_view")
        .select("*")
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

        assertBranchAccess({ auth: actor }, member.branch_id);
        statementQuery = statementQuery.eq("member_id", query.member_id);
    }

    if (query.from_date) {
        statementQuery = statementQuery.gte("transaction_date", query.from_date);
    }

    if (query.to_date) {
        statementQuery = statementQuery.lte("transaction_date", query.to_date);
    }

    const { data, error } = await statementQuery;

    if (error) {
        throw new AppError(500, "STATEMENT_FETCH_FAILED", "Unable to load statements.", error);
    }

    return data || [];
}

async function getLedger(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let ledgerQuery = adminSupabase
        .from("ledger_entries_view")
        .select("*")
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

    const { data, error } = await ledgerQuery;

    if (error) {
        throw new AppError(500, "LEDGER_FETCH_FAILED", "Unable to load ledger.", error);
    }

    return data || [];
}

async function getLoans(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let loanQuery = adminSupabase
        .from("loans")
        .select("*")
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

        assertBranchAccess({ auth: actor }, member.branch_id);
        loanQuery = loanQuery.eq("member_id", query.member_id);
    }

    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        loanQuery = loanQuery.eq("branch_id", query.branch_id);
    }

    if (query.loan_id) {
        loanQuery = loanQuery.eq("id", query.loan_id);
    }

    if (query.status) {
        loanQuery = loanQuery.eq("status", query.status);
    }

    const { data, error } = await loanQuery;

    if (error) {
        throw new AppError(500, "LOANS_FETCH_FAILED", "Unable to load loans.", error);
    }

    return data || [];
}

async function getLoanSchedules(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let visibleLoanIds = null;

    if (actor.role === "member") {
        const ownLoans = await getLoans(actor, { tenant_id: tenantId });
        visibleLoanIds = ownLoans.map((loan) => loan.id);
    } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        const visibleLoans = await getLoans(actor, { tenant_id: tenantId });
        visibleLoanIds = visibleLoans.map((loan) => loan.id);
    }

    let scheduleQuery = adminSupabase
        .from("loan_schedules")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("due_date", { ascending: true });

    if (visibleLoanIds) {
        if (!visibleLoanIds.length) {
            return [];
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

    const { data, error } = await scheduleQuery;

    if (error) {
        throw new AppError(500, "LOAN_SCHEDULES_FETCH_FAILED", "Unable to load loan schedules.", error);
    }

    return data || [];
}

async function getLoanTransactions(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let transactionQuery = adminSupabase
        .from("loan_account_transactions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    let visibleLoanIds = null;

    if (actor.role === "member") {
        const ownLoans = await getLoans(actor, { tenant_id: tenantId });
        visibleLoanIds = ownLoans.map((loan) => loan.id);
    } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        const visibleLoans = await getLoans(actor, { tenant_id: tenantId });
        visibleLoanIds = visibleLoans.map((loan) => loan.id);
    }

    if (visibleLoanIds) {
        if (!visibleLoanIds.length) {
            return [];
        }

        transactionQuery = transactionQuery.in("loan_id", visibleLoanIds);
    }

    if (query.loan_id) {
        const loan = await getLoan(query.loan_id);
        assertTenantAccess({ auth: actor }, loan.tenant_id);
        assertBranchAccess({ auth: actor }, loan.branch_id);
        transactionQuery = transactionQuery.eq("loan_id", query.loan_id);
    }

    const { data, error } = await transactionQuery;

    if (error) {
        throw new AppError(500, "LOAN_TRANSACTIONS_FETCH_FAILED", "Unable to load loan transactions.", error);
    }

    return data || [];
}

module.exports = {
    deposit,
    withdraw,
    shareContribution,
    dividendAllocation,
    transfer,
    loanDisburse,
    loanRepay,
    accrueInterest,
    closePeriod,
    getStatements,
    getLedger,
    getLoans,
    getLoanSchedules,
    getLoanTransactions
};
