import { Pool, PoolClient, QueryResult } from "pg";

import { clearTrackedState, testState } from "./state";
import { deleteAuthUser } from "./supabaseAdmin";

function requireTestMode() {
    if (process.env.NODE_ENV !== "test") {
        throw new Error("Refusing to run destructive test helpers outside NODE_ENV=test");
    }

    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is required for the automated test suite.");
    }
}

requireTestMode();

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : undefined
});

let poolClosed = false;

async function safeEndPool() {
    if (poolClosed) {
        return;
    }

    poolClosed = true;
    await pool.end();
}

process.once("beforeExit", () => {
    safeEndPool().catch(() => undefined);
});

export async function query<T = any>(text: string, params: any[] = []): Promise<QueryResult<T>> {
    return pool.query<T>(text, params);
}

export async function queryOne<T = any>(text: string, params: any[] = []): Promise<T> {
    const result = await pool.query<T>(text, params);
    if (!result.rows.length) {
        throw new Error(`Expected one row but none were returned for query: ${text}`);
    }

    return result.rows[0];
}

export async function withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        return await callback(client);
    } finally {
        client.release();
    }
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return withClient(async (client) => {
        await client.query("begin");

        try {
            const result = await callback(client);
            await client.query("commit");
            return result;
        } catch (error) {
            await client.query("rollback");
            throw error;
        }
    });
}

export async function cleanupTestData(): Promise<void> {
    requireTestMode();

    const tenantIds = [...testState.tenantIds];
    const userIds = [...testState.userIds];
    const emails = [...testState.emails];

    await withTransaction(async (client) => {
        if (tenantIds.length) {
            const tenantScopedTables = [
                "api_idempotency_requests",
                "transaction_receipts",
                "teller_session_transactions",
                "teller_sessions",
                "receipt_policies",
                "cash_control_settings",
                "import_job_rows",
                "import_jobs",
                "credential_handoffs",
                "member_application_attachments",
                "member_applications",
                "membership_status_history",
                "loan_account_transactions",
                "loan_accounts",
                "loan_schedules",
                "loans",
                "member_account_transactions",
                "member_accounts",
                "dividend_payments",
                "dividend_approvals",
                "dividend_allocations",
                "dividend_member_snapshots",
                "dividend_components",
                "dividend_cycles",
                "period_closures",
                "daily_account_snapshots",
                "audit_logs",
                "account_balances",
                "journal_lines",
                "journal_entries",
                "posting_rules",
                "fee_rules",
                "penalty_rules",
                "share_products",
                "savings_products",
                "user_profiles",
                "tenant_settings",
                "chart_of_accounts",
                "tenant_subscriptions",
                "subscriptions",
                "branch_staff_assignments",
                "members",
                "branches"
            ];

            for (const tableName of tenantScopedTables) {
                await client.query(`delete from public.${tableName} where tenant_id = any($1::uuid[])`, [tenantIds]);
            }

            await client.query("delete from public.tenants where id = any($1::uuid[])", [tenantIds]);
        }

        if (userIds.length) {
            await client.query("delete from public.user_profiles where user_id = any($1::uuid[])", [userIds]);
        }

        if (emails.length) {
            await client.query(
                "delete from public.user_profiles where user_id in (select id from auth.users where email = any($1::text[]))",
                [emails]
            );
        }
    });

    for (const userId of userIds) {
        try {
            await deleteAuthUser(userId);
        } catch (error) {
            // Ignore already deleted users to keep teardown resilient.
        }
    }

    clearTrackedState();
}

export async function closePool(): Promise<void> {
    await safeEndPool();
}
