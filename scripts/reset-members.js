require("dotenv").config();

const { adminSupabase } = require("../src/config/supabase");

function getArg(name) {
    const prefix = `--${name}=`;
    const found = process.argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
}

function parseFlags() {
    const tenantId = getArg("tenant-id") || process.env.TENANT_ID || null;
    const execute = process.argv.includes("--execute") || process.env.EXECUTE_RESET === "true";
    return { tenantId, execute };
}

async function fetchTenant(tenantId) {
    const { data, error } = await adminSupabase
        .from("tenants")
        .select("id, name, registration_number")
        .eq("id", tenantId)
        .single();

    if (error || !data) {
        throw new Error(`Tenant ${tenantId} was not found.`);
    }

    return data;
}

async function fetchIds(table, column, values) {
    if (!values.length) {
        return [];
    }

    const { data, error } = await adminSupabase
        .from(table)
        .select(column)
        .in(column, values);

    if (error) {
        throw new Error(`Failed to read ${table}: ${error.message}`);
    }

    return (data || []).map((row) => row[column]).filter(Boolean);
}

async function gatherResetScope(tenantId) {
    const { data: members, error: membersError } = await adminSupabase
        .from("members")
        .select("id, user_id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null);

    if (membersError) {
        throw new Error(`Failed to load members: ${membersError.message}`);
    }

    const memberIds = (members || []).map((row) => row.id);
    const memberUserIds = (members || []).map((row) => row.user_id).filter(Boolean);

    const { data: memberProfiles, error: profilesError } = await adminSupabase
        .from("user_profiles")
        .select("user_id, member_id")
        .eq("tenant_id", tenantId)
        .eq("role", "member")
        .is("deleted_at", null);

    if (profilesError) {
        throw new Error(`Failed to load member user profiles: ${profilesError.message}`);
    }

    const profileUserIds = (memberProfiles || []).map((row) => row.user_id).filter(Boolean);
    const profileMemberIds = (memberProfiles || []).map((row) => row.member_id).filter(Boolean);

    const allMemberIds = Array.from(new Set([...memberIds, ...profileMemberIds]));
    const allMemberUserIds = Array.from(new Set([...memberUserIds, ...profileUserIds]));

    const { data: memberAccounts, error: memberAccountsError } = await adminSupabase
        .from("member_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("member_id", allMemberIds.length ? allMemberIds : ["00000000-0000-0000-0000-000000000000"])
        .is("deleted_at", null);

    if (memberAccountsError) {
        throw new Error(`Failed to load member accounts: ${memberAccountsError.message}`);
    }

    const { data: loans, error: loansError } = await adminSupabase
        .from("loans")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("member_id", allMemberIds.length ? allMemberIds : ["00000000-0000-0000-0000-000000000000"]);

    if (loansError) {
        throw new Error(`Failed to load loans: ${loansError.message}`);
    }

    const { data: loanAccounts, error: loanAccountsError } = await adminSupabase
        .from("loan_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("member_id", allMemberIds.length ? allMemberIds : ["00000000-0000-0000-0000-000000000000"]);

    if (loanAccountsError) {
        throw new Error(`Failed to load loan accounts: ${loanAccountsError.message}`);
    }

    const memberAccountIds = (memberAccounts || []).map((row) => row.id);
    const loanIds = (loans || []).map((row) => row.id);
    const loanAccountIds = (loanAccounts || []).map((row) => row.id);

    const { data: memberTransactions, error: memberTransactionsError } = await adminSupabase
        .from("member_account_transactions")
        .select("id, journal_id")
        .eq("tenant_id", tenantId)
        .in("member_account_id", memberAccountIds.length ? memberAccountIds : ["00000000-0000-0000-0000-000000000000"]);

    if (memberTransactionsError) {
        throw new Error(`Failed to load member account transactions: ${memberTransactionsError.message}`);
    }

    const { data: loanTransactions, error: loanTransactionsError } = await adminSupabase
        .from("loan_account_transactions")
        .select("id, journal_id")
        .eq("tenant_id", tenantId)
        .in("loan_id", loanIds.length ? loanIds : ["00000000-0000-0000-0000-000000000000"]);

    if (loanTransactionsError) {
        throw new Error(`Failed to load loan account transactions: ${loanTransactionsError.message}`);
    }

    const journalIds = Array.from(
        new Set([
            ...(memberTransactions || []).map((row) => row.journal_id),
            ...(loanTransactions || []).map((row) => row.journal_id)
        ].filter(Boolean))
    );

    return {
        memberIds: allMemberIds,
        memberUserIds: allMemberUserIds,
        memberAccountIds,
        loanIds,
        loanAccountIds,
        journalIds,
        counts: {
            members: allMemberIds.length,
            memberUsers: allMemberUserIds.length,
            memberAccounts: memberAccountIds.length,
            loans: loanIds.length,
            loanAccounts: loanAccountIds.length,
            memberTransactions: (memberTransactions || []).length,
            loanTransactions: (loanTransactions || []).length,
            journals: journalIds.length
        }
    };
}

async function deleteIn(table, column, values) {
    if (!values.length) {
        return 0;
    }

    const { error, count } = await adminSupabase
        .from(table)
        .delete({ count: "exact" })
        .in(column, values);

    if (error) {
        throw new Error(`Failed to delete from ${table}: ${error.message}`);
    }

    return count || 0;
}

async function deleteEq(table, column, value) {
    const { error, count } = await adminSupabase
        .from(table)
        .delete({ count: "exact" })
        .eq(column, value);

    if (error) {
        throw new Error(`Failed to delete from ${table}: ${error.message}`);
    }

    return count || 0;
}

async function rebuildAccountBalances(tenantId) {
    const { error: deleteError } = await adminSupabase
        .from("account_balances")
        .delete()
        .eq("tenant_id", tenantId);

    if (deleteError) {
        throw new Error(`Failed to clear account balances: ${deleteError.message}`);
    }

    const { data: lines, error: linesError } = await adminSupabase
        .from("journal_lines")
        .select("account_id, debit, credit")
        .eq("tenant_id", tenantId);

    if (linesError) {
        throw new Error(`Failed to rebuild account balances: ${linesError.message}`);
    }

    const balances = new Map();

    for (const line of lines || []) {
        const current = balances.get(line.account_id) || 0;
        balances.set(line.account_id, current + Number(line.debit || 0) - Number(line.credit || 0));
    }

    const rows = Array.from(balances.entries()).map(([accountId, balance]) => ({
        tenant_id: tenantId,
        account_id: accountId,
        balance,
        updated_at: new Date().toISOString()
    }));

    if (rows.length) {
        const { error: insertError } = await adminSupabase.from("account_balances").insert(rows);

        if (insertError) {
            throw new Error(`Failed to insert rebuilt account balances: ${insertError.message}`);
        }
    }
}

async function deleteAuthUsers(userIds) {
    for (const userId of userIds) {
        const { error } = await adminSupabase.auth.admin.deleteUser(userId);

        if (error) {
            throw new Error(`Failed to delete auth user ${userId}: ${error.message}`);
        }
    }
}

async function executeReset(tenantId, scope) {
    await deleteIn("credential_handoffs", "member_id", scope.memberIds);
    await deleteIn("credential_handoffs", "user_id", scope.memberUserIds);
    await deleteEq("import_jobs", "tenant_id", tenantId);
    await deleteIn("audit_logs", "entity_id", scope.journalIds);
    await deleteIn("audit_logs", "entity_id", scope.loanIds);
    await deleteIn("audit_logs", "entity_id", scope.memberIds);
    const { error: clearApprovedMembersError } = await adminSupabase
        .from("member_applications")
        .update({ approved_member_id: null })
        .eq("tenant_id", tenantId)
        .in("approved_member_id", scope.memberIds.length ? scope.memberIds : ["00000000-0000-0000-0000-000000000000"]);

    if (clearApprovedMembersError) {
        throw new Error(`Failed to clear approved member references from member_applications: ${clearApprovedMembersError.message}`);
    }

    await deleteIn("membership_status_history", "member_id", scope.memberIds);
    await deleteEq("member_application_attachments", "tenant_id", tenantId);
    await deleteEq("member_applications", "tenant_id", tenantId);
    await deleteIn("dividend_allocations", "member_id", scope.memberIds);
    await deleteIn("dividend_member_snapshots", "member_id", scope.memberIds);
    await deleteIn("loan_account_transactions", "loan_id", scope.loanIds);
    await deleteIn("member_account_transactions", "member_account_id", scope.memberAccountIds);
    await deleteIn("journal_entries", "id", scope.journalIds);
    await deleteIn("loan_accounts", "loan_id", scope.loanIds);
    await deleteIn("loans", "id", scope.loanIds);
    await deleteIn("member_accounts", "member_id", scope.memberIds);
    await deleteIn("user_profiles", "user_id", scope.memberUserIds);
    await deleteIn("members", "id", scope.memberIds);
    await deleteAuthUsers(scope.memberUserIds);
    await rebuildAccountBalances(tenantId);
}

async function main() {
    const { tenantId, execute } = parseFlags();

    if (!tenantId) {
        throw new Error("Provide --tenant-id=<uuid> or set TENANT_ID.");
    }

    const tenant = await fetchTenant(tenantId);
    const scope = await gatherResetScope(tenantId);

    console.log("[reset:members] tenant", {
        id: tenant.id,
        name: tenant.name,
        registration_number: tenant.registration_number
    });
    console.log("[reset:members] scope", scope.counts);

    if (!execute) {
        console.log("[reset:members] dry run only. Re-run with --execute to delete this tenant's member data.");
        return;
    }

    await executeReset(tenantId, scope);
    console.log("[reset:members] completed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
