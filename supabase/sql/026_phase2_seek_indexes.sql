-- Phase 2: seek/cursor pagination support indexes
-- Keep hot list endpoints fast for ORDER BY created_at DESC with stable tie-breaker id DESC.

create index if not exists members_tenant_created_id_seek_idx
    on public.members (tenant_id, created_at desc, id desc)
    where deleted_at is null;

create index if not exists members_tenant_branch_status_created_id_seek_idx
    on public.members (tenant_id, branch_id, status, created_at desc, id desc)
    where deleted_at is null;

create index if not exists loan_applications_tenant_created_id_seek_idx
    on public.loan_applications (tenant_id, created_at desc, id desc);

create index if not exists loan_applications_tenant_branch_status_created_id_seek_idx
    on public.loan_applications (tenant_id, branch_id, status, created_at desc, id desc);
