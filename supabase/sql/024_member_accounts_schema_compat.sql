-- Compatibility patch for environments created with older schema versions.
-- Fixes import and account lookups that rely on member_accounts.deleted_at and related columns.

begin;

alter table if exists public.member_accounts
    add column if not exists deleted_at timestamptz,
    add column if not exists deleted_by uuid references auth.users (id),
    add column if not exists savings_product_id uuid references public.savings_products (id),
    add column if not exists share_product_id uuid references public.share_products (id);

create index if not exists member_accounts_tenant_member_active_idx
    on public.member_accounts (tenant_id, member_id)
    where deleted_at is null;

create index if not exists member_accounts_tenant_product_active_idx
    on public.member_accounts (tenant_id, product_type)
    where deleted_at is null;

commit;

-- Refresh PostgREST schema cache in Supabase API.
select pg_notify('pgrst', 'reload schema');
