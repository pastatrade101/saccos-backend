require("dotenv").config();

const { adminSupabase } = require("../src/config/supabase");

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

function getArg(name) {
    const prefix = `--${name}=`;
    const found = process.argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
}

function parseFlags() {
    return {
        execute: process.argv.includes("--execute") || process.env.EXECUTE_RESET === "true",
        confirm: getArg("confirm") || process.env.RESET_CONFIRM || null
    };
}

async function loadTenants() {
    const { data, error } = await adminSupabase
        .from("tenants")
        .select("id, name, registration_number, created_at")
        .order("created_at", { ascending: true });

    if (error) {
        throw new Error(`Failed to load tenants: ${error.message}`);
    }

    return data || [];
}

async function loadUserProfiles(tenantIds) {
    if (!tenantIds.length) {
        return [];
    }

    const { data, error } = await adminSupabase
        .from("user_profiles")
        .select("user_id, tenant_id, role, member_id")
        .in("tenant_id", tenantIds);

    if (error) {
        throw new Error(`Failed to load tenant user profiles: ${error.message}`);
    }

    return data || [];
}

async function gatherScope(tenantIds) {
    const tenantIdFilter = tenantIds.length ? tenantIds : [EMPTY_UUID];

    const profiles = await loadUserProfiles(tenantIds);
    const userIds = Array.from(new Set(profiles.map((row) => row.user_id).filter(Boolean)));

    const memberUserIds = Array.from(
        new Set(
            profiles
                .filter((row) => row.role === "member")
                .map((row) => row.user_id)
                .filter(Boolean)
        )
    );

    const staffUserIds = Array.from(
        new Set(
            profiles
                .filter((row) => row.role !== "member")
                .map((row) => row.user_id)
                .filter(Boolean)
        )
    );

    const { data: members, error: membersError } = await adminSupabase
        .from("members")
        .select("id, user_id")
        .in("tenant_id", tenantIdFilter);

    if (membersError) {
        throw new Error(`Failed to load members: ${membersError.message}`);
    }

    const memberIds = Array.from(new Set((members || []).map((row) => row.id).filter(Boolean)));
    const memberLinkedUserIds = Array.from(new Set((members || []).map((row) => row.user_id).filter(Boolean)));

    const allMemberUserIds = Array.from(new Set([...memberUserIds, ...memberLinkedUserIds]));

    const { data: memberAccounts, error: memberAccountsError } = await adminSupabase
        .from("member_accounts")
        .select("id")
        .in("tenant_id", tenantIdFilter);

    if (memberAccountsError) {
        throw new Error(`Failed to load member accounts: ${memberAccountsError.message}`);
    }

    const memberAccountIds = (memberAccounts || []).map((row) => row.id);

    const { data: loans, error: loansError } = await adminSupabase
        .from("loans")
        .select("id")
        .in("tenant_id", tenantIdFilter);

    if (loansError) {
        throw new Error(`Failed to load loans: ${loansError.message}`);
    }

    const loanIds = (loans || []).map((row) => row.id);

    const { data: loanAccounts, error: loanAccountsError } = await adminSupabase
        .from("loan_accounts")
        .select("id")
        .in("tenant_id", tenantIdFilter);

    if (loanAccountsError) {
        throw new Error(`Failed to load loan accounts: ${loanAccountsError.message}`);
    }

    const loanAccountIds = (loanAccounts || []).map((row) => row.id);

    const { data: journalEntries, error: journalEntriesError } = await adminSupabase
        .from("journal_entries")
        .select("id")
        .in("tenant_id", tenantIdFilter);

    if (journalEntriesError) {
        throw new Error(`Failed to load journals: ${journalEntriesError.message}`);
    }

    const journalIds = (journalEntries || []).map((row) => row.id);

    return {
        tenantIds,
        userIds,
        staffUserIds,
        memberUserIds: allMemberUserIds,
        memberIds,
        memberAccountIds,
        loanIds,
        loanAccountIds,
        journalIds,
        counts: {
            tenants: tenantIds.length,
            users: userIds.length,
            staffUsers: staffUserIds.length,
            memberUsers: allMemberUserIds.length,
            members: memberIds.length,
            memberAccounts: memberAccountIds.length,
            loans: loanIds.length,
            loanAccounts: loanAccountIds.length,
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

async function deleteByTenant(table, tenantIds) {
    if (!tenantIds.length) {
        return 0;
    }

    const { error, count } = await adminSupabase
        .from(table)
        .delete({ count: "exact" })
        .in("tenant_id", tenantIds);

    if (error) {
        throw new Error(`Failed to delete from ${table}: ${error.message}`);
    }

    return count || 0;
}

async function deleteAuthUsers(userIds) {
    for (const userId of userIds) {
        const { data, error } = await adminSupabase.auth.admin.getUserById(userId);

        if (error) {
            throw new Error(`Failed to inspect auth user ${userId}: ${error.message}`);
        }

        const platformRole = data.user?.app_metadata?.platform_role;

        if (platformRole === "internal_ops") {
            continue;
        }

        const { error: deleteError } = await adminSupabase.auth.admin.deleteUser(userId);

        if (deleteError) {
            throw new Error(`Failed to delete auth user ${userId}: ${deleteError.message}`);
        }
    }
}

async function executeReset(scope) {
    const { tenantIds, userIds, memberIds, memberAccountIds, loanIds, journalIds } = scope;

    await deleteIn("credential_handoffs", "member_id", memberIds);
    await deleteIn("credential_handoffs", "user_id", userIds);
    await deleteByTenant("transaction_receipts", tenantIds);
    await deleteByTenant("teller_session_transactions", tenantIds);
    await deleteByTenant("teller_sessions", tenantIds);
    await deleteByTenant("receipt_policies", tenantIds);
    await deleteByTenant("cash_control_settings", tenantIds);
    await deleteByTenant("api_idempotency_requests", tenantIds);
    await deleteByTenant("import_jobs", tenantIds);
    await deleteByTenant("member_application_attachments", tenantIds);
    await deleteByTenant("member_applications", tenantIds);
    await deleteByTenant("membership_status_history", tenantIds);
    await deleteByTenant("dividend_payments", tenantIds);
    await deleteByTenant("dividend_approvals", tenantIds);
    await deleteByTenant("dividend_allocations", tenantIds);
    await deleteByTenant("dividend_member_snapshots", tenantIds);
    await deleteByTenant("dividend_components", tenantIds);
    await deleteByTenant("dividend_cycles", tenantIds);
    await deleteByTenant("journal_lines", tenantIds);
    await deleteIn("journal_entries", "id", journalIds);
    await deleteByTenant("loan_account_transactions", tenantIds);
    await deleteByTenant("loan_accounts", tenantIds);
    await deleteByTenant("loan_schedules", tenantIds);
    await deleteByTenant("loans", tenantIds);
    await deleteByTenant("member_account_transactions", tenantIds);
    await deleteByTenant("member_accounts", tenantIds);
    await deleteByTenant("period_closures", tenantIds);
    await deleteByTenant("daily_account_snapshots", tenantIds);
    await deleteByTenant("audit_logs", tenantIds);
    await deleteByTenant("account_balances", tenantIds);
    await deleteByTenant("posting_rules", tenantIds);
    await deleteByTenant("fee_rules", tenantIds);
    await deleteByTenant("penalty_rules", tenantIds);
    await deleteByTenant("share_products", tenantIds);
    await deleteByTenant("savings_products", tenantIds);
    await deleteByTenant("branch_staff_assignments", tenantIds);
    await deleteByTenant("members", tenantIds);
    await deleteByTenant("branches", tenantIds);
    await deleteByTenant("user_profiles", tenantIds);
    await deleteByTenant("tenant_settings", tenantIds);
    await deleteByTenant("chart_of_accounts", tenantIds);
    await deleteByTenant("tenant_subscriptions", tenantIds);
    await deleteByTenant("subscriptions", tenantIds);
    await deleteIn("tenants", "id", tenantIds);
    await deleteAuthUsers(userIds);
}

async function main() {
    const { execute, confirm } = parseFlags();
    const tenants = await loadTenants();
    const tenantIds = tenants.map((tenant) => tenant.id);
    const scope = await gatherScope(tenantIds);

    console.log("[reset:tenants] tenants");
    for (const tenant of tenants) {
        console.log(`- ${tenant.name} (${tenant.id}) [${tenant.registration_number}]`);
    }
    console.log("[reset:tenants] scope", scope.counts);

    if (!execute) {
        console.log("[reset:tenants] dry run only. Re-run with --execute --confirm=DELETE_ALL_TENANTS");
        return;
    }

    if (confirm !== "DELETE_ALL_TENANTS") {
        throw new Error("Refusing to execute without --confirm=DELETE_ALL_TENANTS");
    }

    await executeReset(scope);
    console.log("[reset:tenants] completed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
