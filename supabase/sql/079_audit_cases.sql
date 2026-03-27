create table if not exists public.audit_cases (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    case_key text not null,
    reason_code text not null,
    severity text not null check (severity in ('info', 'warning', 'critical')),
    status text not null default 'open' check (status in ('open', 'under_review', 'resolved', 'waived')),
    journal_id uuid null references public.journal_entries (id) on delete set null,
    branch_id uuid null references public.branches (id) on delete set null,
    subject_user_id uuid null,
    reference text null,
    opened_at timestamptz not null default now(),
    assignee_user_id uuid null,
    notes text null,
    resolved_at timestamptz null,
    resolved_by uuid null,
    created_by uuid null,
    updated_by uuid null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, case_key)
);

create index if not exists audit_cases_tenant_status_idx
    on public.audit_cases (tenant_id, status, opened_at desc);

create index if not exists audit_cases_tenant_assignee_idx
    on public.audit_cases (tenant_id, assignee_user_id, status);

drop trigger if exists set_audit_cases_updated_at on public.audit_cases;
create trigger set_audit_cases_updated_at
before update on public.audit_cases
for each row execute function public.set_updated_at();

alter table public.audit_cases enable row level security;

revoke all on public.audit_cases from anon, authenticated;
