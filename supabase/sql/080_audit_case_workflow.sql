create table if not exists public.audit_case_comments (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null references public.audit_cases (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    author_user_id uuid not null references auth.users (id),
    body text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists audit_case_comments_case_created_idx
    on public.audit_case_comments (case_id, created_at asc);

drop trigger if exists set_audit_case_comments_updated_at on public.audit_case_comments;
create trigger set_audit_case_comments_updated_at
before update on public.audit_case_comments
for each row execute function public.set_updated_at();

create table if not exists public.audit_case_evidence (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null references public.audit_cases (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    uploaded_by uuid not null references auth.users (id),
    storage_bucket text not null,
    storage_path text not null,
    file_name text not null,
    mime_type text not null,
    file_size_bytes bigint not null check (file_size_bytes > 0),
    checksum_sha256 text,
    status text not null default 'pending_upload' check (status in ('pending_upload', 'uploaded')),
    created_at timestamptz not null default now(),
    confirmed_at timestamptz
);

create index if not exists audit_case_evidence_case_created_idx
    on public.audit_case_evidence (case_id, created_at desc);

alter table public.audit_case_comments enable row level security;
alter table public.audit_case_evidence enable row level security;

revoke all on public.audit_case_comments from anon, authenticated;
revoke all on public.audit_case_evidence from anon, authenticated;
