alter table public.dividend_cycles
    add column if not exists submitted_for_approval_at timestamptz,
    add column if not exists submitted_for_approval_by uuid references auth.users (id);

create index if not exists dividend_cycles_submission_queue_idx
    on public.dividend_cycles (tenant_id, status, submitted_for_approval_at desc);
