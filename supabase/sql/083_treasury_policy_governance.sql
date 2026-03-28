alter table public.treasury_policies
    add column if not exists minimum_cash_buffer numeric(18,2) not null default 0 check (minimum_cash_buffer >= 0),
    add column if not exists loan_liquidity_protection_ratio numeric(5,2) not null default 0 check (loan_liquidity_protection_ratio >= 0 and loan_liquidity_protection_ratio <= 100),
    add column if not exists max_asset_allocation_percent numeric(5,2) check (max_asset_allocation_percent is null or (max_asset_allocation_percent >= 0 and max_asset_allocation_percent <= 100)),
    add column if not exists max_single_asset_percent numeric(5,2) check (max_single_asset_percent is null or (max_single_asset_percent >= 0 and max_single_asset_percent <= 100)),
    add column if not exists approval_threshold numeric(18,2) not null default 0 check (approval_threshold >= 0),
    add column if not exists valuation_update_frequency_days integer not null default 30 check (valuation_update_frequency_days > 0),
    add column if not exists policy_version integer not null default 1 check (policy_version >= 1),
    add column if not exists updated_by uuid references auth.users (id);

alter table public.treasury_policies
    drop constraint if exists treasury_policies_single_asset_le_asset_allocation_chk;

alter table public.treasury_policies
    add constraint treasury_policies_single_asset_le_asset_allocation_chk
    check (
        max_single_asset_percent is null
        or max_asset_allocation_percent is null
        or max_single_asset_percent <= max_asset_allocation_percent
    );

update public.treasury_policies
   set minimum_cash_buffer = coalesce(minimum_cash_buffer, minimum_liquidity_reserve, 0),
       approval_threshold = coalesce(
           approval_threshold,
           (
               select ap.threshold_amount
                 from public.approval_policies ap
                where ap.tenant_id = treasury_policies.tenant_id
                  and ap.operation_key = 'treasury.order_execute'
                limit 1
           ),
           0
       ),
       updated_at = now()
 where true;

create table if not exists public.treasury_policy_history (
    id uuid primary key default gen_random_uuid(),
    policy_id uuid not null references public.treasury_policies (tenant_id) on delete cascade,
    previous_values jsonb not null default '{}'::jsonb,
    new_values jsonb not null default '{}'::jsonb,
    changed_by uuid references auth.users (id),
    change_reason text,
    changed_at timestamptz not null default now()
);

create index if not exists treasury_policy_history_policy_changed_idx
    on public.treasury_policy_history (policy_id, changed_at desc);

alter table public.treasury_policy_history enable row level security;
revoke all on public.treasury_policy_history from anon, authenticated;
