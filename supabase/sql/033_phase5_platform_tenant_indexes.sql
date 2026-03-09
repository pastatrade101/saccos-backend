-- Phase 5: platform tenant listing indexes
-- Improves /api/platform/tenants filtering and search at larger tenant counts.

create extension if not exists pg_trgm;

create index if not exists tenants_active_created_at_idx
    on public.tenants (created_at desc)
    where deleted_at is null;

create index if not exists tenants_active_status_created_at_idx
    on public.tenants (status, created_at desc)
    where deleted_at is null;

create index if not exists tenants_active_name_trgm_idx
    on public.tenants using gin (name gin_trgm_ops)
    where deleted_at is null;

create index if not exists tenants_active_registration_number_trgm_idx
    on public.tenants using gin (registration_number gin_trgm_ops)
    where deleted_at is null;
