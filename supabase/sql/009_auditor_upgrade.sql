alter table public.journal_entries
    add column if not exists is_reversal boolean not null default false,
    add column if not exists reversed_journal_id uuid references public.journal_entries (id),
    add column if not exists posted_at timestamptz not null default now();

create index if not exists journal_entries_tenant_created_at_idx
    on public.journal_entries (tenant_id, created_at desc);

alter table public.audit_logs
    add column if not exists actor_user_id uuid references auth.users (id),
    add column if not exists entity_type text not null default 'unknown',
    add column if not exists entity_id uuid,
    add column if not exists ip text,
    add column if not exists user_agent text,
    add column if not exists created_at timestamptz not null default now();

update public.audit_logs
   set actor_user_id = coalesce(actor_user_id, user_id),
       created_at = coalesce(created_at, timestamp),
       entity_type = coalesce(nullif(entity_type, ''), "table")
 where actor_user_id is null
    or created_at is null
    or entity_type = 'unknown';

create index if not exists audit_logs_tenant_created_at_idx
    on public.audit_logs (tenant_id, created_at desc);

create index if not exists audit_logs_tenant_action_idx
    on public.audit_logs (tenant_id, action);

create or replace view public.v_audit_integrity_summary
with (security_invoker = true)
as
with scoped_journals as (
    select *
      from public.journal_entries
     where created_at >= now() - interval '30 days'
),
scoped_lines as (
    select jl.*
      from public.journal_lines jl
      join scoped_journals je on je.id = jl.journal_id
)
select
    je.tenant_id,
    abs(coalesce(sum(sl.debit), 0) - coalesce(sum(sl.credit), 0)) < 0.005 as trial_balance_balanced,
    count(*) filter (where je.posted = false) as unposted_journals_count,
    count(*) filter (where je.entry_date < je.created_at::date) as backdated_entries_count,
    count(*) filter (where je.is_reversal = true) as reversals_count,
    count(*) filter (where je.reference = 'MANUAL' or je.source_type = 'adjustment') as manual_journals_count
from scoped_journals je
left join scoped_lines sl on sl.journal_id = je.id
group by je.tenant_id;

create or replace view public.v_audit_exception_feed
with (security_invoker = true)
as
with journal_amounts as (
    select
        je.id as journal_id,
        je.tenant_id,
        je.reference,
        je.created_by as user_id,
        min(jl.branch_id::text)::uuid as branch_id,
        greatest(coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0))::numeric(18,2) as amount,
        je.created_at,
        je.entry_date,
        je.posted_at,
        je.is_reversal,
        je.source_type
    from public.journal_entries je
    join public.journal_lines jl on jl.journal_id = je.id
    group by je.id
),
maker_checker_flags as (
    select
        dc.tenant_id,
        null::uuid as journal_id,
        'DIVIDEND-' || dc.id::text as reference,
        dc.created_by as user_id,
        dc.branch_id,
        coalesce(sum(da.payout_amount), 0)::numeric(18,2) as amount,
        max(da.created_at) as created_at,
        dc.end_date as entry_date,
        max(da.created_at) as posted_at,
        false as is_reversal,
        'dividend_cycle'::text as source_type,
        'MAKER_CHECKER_VIOLATION'::text as reason_code
    from public.dividend_cycles dc
    join public.dividend_approvals appr on appr.cycle_id = dc.id and appr.approved_by = dc.created_by
    left join public.dividend_allocations da on da.cycle_id = dc.id
    group by dc.tenant_id, dc.id, dc.created_by, dc.branch_id, dc.end_date
)
select
    tenant_id,
    journal_id,
    reference,
    user_id,
    branch_id,
    amount,
    created_at,
    'HIGH_VALUE_TX'::text as reason_code
from journal_amounts
where amount >= 2000000
union all
select
    tenant_id,
    journal_id,
    reference,
    user_id,
    branch_id,
    amount,
    created_at,
    'BACKDATED_ENTRY'::text as reason_code
from journal_amounts
where entry_date < created_at::date
union all
select
    tenant_id,
    journal_id,
    reference,
    user_id,
    branch_id,
    amount,
    created_at,
    'REVERSAL'::text as reason_code
from journal_amounts
where is_reversal = true
union all
select
    tenant_id,
    journal_id,
    reference,
    user_id,
    branch_id,
    amount,
    created_at,
    'OUT_OF_HOURS_POSTING'::text as reason_code
from journal_amounts
where (
    (extract(hour from coalesce(posted_at, created_at)) >= 18)
    or (extract(hour from coalesce(posted_at, created_at)) < 7)
)
union all
select
    tenant_id,
    journal_id,
    reference,
    user_id,
    branch_id,
    amount,
    created_at,
    'MANUAL_JOURNAL'::text as reason_code
from journal_amounts
where reference = 'MANUAL' or source_type = 'adjustment'
union all
select
    tenant_id,
    journal_id,
    reference,
    user_id,
    branch_id,
    amount,
    created_at,
    reason_code
from maker_checker_flags;
