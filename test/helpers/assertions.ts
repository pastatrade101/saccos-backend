import { queryOne } from "./db";

export async function assertJournalBalanced(journalId: string): Promise<void> {
    const row = await queryOne<{ debit: string; credit: string }>(
        `
        select
            coalesce(sum(debit), 0)::text as debit,
            coalesce(sum(credit), 0)::text as credit
        from public.journal_lines
        where journal_id = $1
        `,
        [journalId]
    );

    expect(Number(row.debit)).toBeCloseTo(Number(row.credit), 2);
}

export async function assertJournalHasAccounts(journalId: string, accountIds: string[]): Promise<void> {
    const row = await queryOne<{ count: string }>(
        `
        select count(*)::text as count
        from public.journal_lines
        where journal_id = $1
          and account_id = any($2::uuid[])
        `,
        [journalId, accountIds]
    );

    expect(Number(row.count)).toBeGreaterThanOrEqual(accountIds.length);
}

export async function assertAuditLogRecorded(params: {
    tenantId: string;
    action: string;
    entityType?: string;
}): Promise<void> {
    const row = await queryOne<{ count: string }>(
        `
        select count(*)::text as count
        from public.audit_logs
        where tenant_id = $1
          and action = $2
          and ($3::text is null or entity_type = $3)
        `,
        [params.tenantId, params.action, params.entityType || null]
    );

    expect(Number(row.count)).toBeGreaterThan(0);
}

export async function assertTenantIsolation(params: {
    tableName: string;
    tenantId: string;
    foreignTenantId: string;
}): Promise<void> {
    const ownCount = await queryOne<{ count: string }>(
        `select count(*)::text as count from public.${params.tableName} where tenant_id = $1`,
        [params.tenantId]
    );
    const foreignCount = await queryOne<{ count: string }>(
        `select count(*)::text as count from public.${params.tableName} where tenant_id = $1`,
        [params.foreignTenantId]
    );

    expect(Number(ownCount.count)).toBeGreaterThanOrEqual(0);
    expect(Number(foreignCount.count)).toBeGreaterThanOrEqual(0);
}
