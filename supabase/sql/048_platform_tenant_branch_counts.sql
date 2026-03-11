-- Performance helper for platform tenant listing:
-- branch counts grouped in SQL to avoid transferring all branch rows.

create or replace function public.tenant_branch_counts(p_tenant_ids uuid[])
returns table (
    tenant_id uuid,
    branch_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select
        b.tenant_id,
        count(*)::bigint as branch_count
    from public.branches b
    where b.deleted_at is null
      and b.tenant_id = any(coalesce(p_tenant_ids, array[]::uuid[]))
    group by b.tenant_id;
$$;

revoke all on function public.tenant_branch_counts(uuid[]) from public;
revoke all on function public.tenant_branch_counts(uuid[]) from anon;
revoke all on function public.tenant_branch_counts(uuid[]) from authenticated;
grant execute on function public.tenant_branch_counts(uuid[]) to service_role;
