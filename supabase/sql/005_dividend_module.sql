do $$
begin
    if not exists (select 1 from pg_type where typname = 'dividend_cycle_status') then
        create type public.dividend_cycle_status as enum ('draft', 'frozen', 'allocated', 'approved', 'paid', 'closed');
    end if;
    if not exists (select 1 from pg_type where typname = 'dividend_component_type') then
        create type public.dividend_component_type as enum ('share_dividend', 'savings_interest_bonus', 'patronage_refund');
    end if;
    if not exists (select 1 from pg_type where typname = 'dividend_basis_method') then
        create type public.dividend_basis_method as enum (
            'end_balance',
            'average_daily_balance',
            'average_monthly_balance',
            'minimum_balance',
            'total_interest_paid',
            'total_fees_paid',
            'transaction_volume'
        );
    end if;
    if not exists (select 1 from pg_type where typname = 'dividend_distribution_mode') then
        create type public.dividend_distribution_mode as enum ('rate', 'fixed_pool');
    end if;
    if not exists (select 1 from pg_type where typname = 'dividend_allocation_status') then
        create type public.dividend_allocation_status as enum ('pending', 'paid', 'void');
    end if;
    if not exists (select 1 from pg_type where typname = 'dividend_payment_method') then
        create type public.dividend_payment_method as enum ('cash', 'bank', 'mobile_money', 'reinvest_to_shares');
    end if;
    if not exists (select 1 from pg_type where typname = 'dividend_residual_handling') then
        create type public.dividend_residual_handling as enum ('carry_to_retained_earnings', 'allocate_pro_rata', 'allocate_to_reserve');
    end if;
end $$;

insert into public.chart_of_accounts (tenant_id, account_code, account_name, account_type, system_tag, is_system_control)
select t.id, '2030', 'Dividends Payable', 'liability', 'dividends_payable', true
from public.tenants t
where t.deleted_at is null
and not exists (
    select 1
    from public.chart_of_accounts coa
    where coa.tenant_id = t.id
      and coa.system_tag = 'dividends_payable'
      and coa.deleted_at is null
);

insert into public.chart_of_accounts (tenant_id, account_code, account_name, account_type, system_tag, is_system_control)
select t.id, '3020', 'Dividend Reserve', 'equity', 'dividend_reserve', true
from public.tenants t
where t.deleted_at is null
and not exists (
    select 1
    from public.chart_of_accounts coa
    where coa.tenant_id = t.id
      and coa.system_tag = 'dividend_reserve'
      and coa.deleted_at is null
);

create table if not exists public.dividend_cycles (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid references public.branches (id),
    period_label text not null,
    start_date date not null,
    end_date date not null,
    declaration_date date not null,
    record_date date,
    payment_date date,
    status public.dividend_cycle_status not null default 'draft',
    required_checker_count integer not null default 1 check (required_checker_count > 0),
    config_json jsonb not null default '{}'::jsonb,
    config_version integer not null default 1,
    config_hash text not null default md5(gen_random_uuid()::text),
    totals_json jsonb not null default '{}'::jsonb,
    declaration_journal_id uuid references public.journal_entries (id),
    payment_journal_id uuid references public.journal_entries (id),
    created_by uuid not null references auth.users (id),
    approved_by uuid references auth.users (id),
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists dividend_cycles_tenant_status_idx
    on public.dividend_cycles (tenant_id, status, created_at desc);

create unique index if not exists dividend_cycles_tenant_label_version_key
    on public.dividend_cycles (tenant_id, period_label, config_version);

create table if not exists public.dividend_components (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    type public.dividend_component_type not null,
    basis_method public.dividend_basis_method not null,
    distribution_mode public.dividend_distribution_mode not null,
    rate_percent numeric(9,4),
    pool_amount numeric(18,2),
    retained_earnings_account_id uuid not null references public.chart_of_accounts (id),
    dividends_payable_account_id uuid not null references public.chart_of_accounts (id),
    payout_account_id uuid references public.chart_of_accounts (id),
    reserve_account_id uuid references public.chart_of_accounts (id),
    eligibility_rules_json jsonb not null default '{}'::jsonb,
    rounding_rules_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists dividend_components_cycle_idx
    on public.dividend_components (cycle_id);

create table if not exists public.dividend_member_snapshots (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    member_id uuid not null references public.members (id),
    eligibility_status boolean not null default false,
    eligibility_reason text,
    snapshot_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists dividend_member_snapshots_cycle_member_key
    on public.dividend_member_snapshots (cycle_id, member_id);

create table if not exists public.dividend_allocations (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    component_id uuid not null references public.dividend_components (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    member_id uuid not null references public.members (id),
    basis_value numeric(18,2) not null default 0,
    payout_amount numeric(18,2) not null default 0,
    status public.dividend_allocation_status not null default 'pending',
    payment_ref text,
    paid_at timestamptz,
    created_at timestamptz not null default now()
);

create unique index if not exists dividend_allocations_cycle_component_member_key
    on public.dividend_allocations (cycle_id, component_id, member_id);

create table if not exists public.dividend_approvals (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    approved_by uuid not null references auth.users (id),
    approved_at timestamptz not null default now(),
    decision text not null check (decision in ('approved', 'rejected')),
    notes text,
    signature_hash text
);

create unique index if not exists dividend_approvals_cycle_user_key
    on public.dividend_approvals (cycle_id, approved_by);

create table if not exists public.dividend_payments (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    payment_method public.dividend_payment_method not null,
    total_amount numeric(18,2) not null check (total_amount >= 0),
    processed_by uuid not null references auth.users (id),
    processed_at timestamptz not null default now(),
    journal_entry_id uuid references public.journal_entries (id),
    reference text,
    notes text
);

create index if not exists dividend_payments_cycle_idx
    on public.dividend_payments (cycle_id, processed_at desc);

do $$
begin
    if not exists (
        select 1
        from pg_trigger
        where tgname = 'set_dividend_cycles_updated_at'
    ) then
        create trigger set_dividend_cycles_updated_at
        before update on public.dividend_cycles
        for each row execute function public.set_updated_at();
    end if;
end $$;

alter table public.dividend_cycles enable row level security;
alter table public.dividend_components enable row level security;
alter table public.dividend_member_snapshots enable row level security;
alter table public.dividend_allocations enable row level security;
alter table public.dividend_approvals enable row level security;
alter table public.dividend_payments enable row level security;

revoke all on public.dividend_cycles from anon, authenticated;
revoke all on public.dividend_components from anon, authenticated;
revoke all on public.dividend_member_snapshots from anon, authenticated;
revoke all on public.dividend_allocations from anon, authenticated;
revoke all on public.dividend_approvals from anon, authenticated;
revoke all on public.dividend_payments from anon, authenticated;

drop policy if exists dividend_cycles_select_policy on public.dividend_cycles;
create policy dividend_cycles_select_policy
on public.dividend_cycles
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager', 'auditor'])
        and (branch_id is null or public.has_branch_scope(branch_id))
    )
);

drop policy if exists dividend_cycles_write_policy on public.dividend_cycles;
create policy dividend_cycles_write_policy
on public.dividend_cycles
for all
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager'])
        and (branch_id is null or public.has_branch_scope(branch_id))
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager'])
        and (branch_id is null or public.has_branch_scope(branch_id))
    )
);

drop policy if exists dividend_components_select_policy on public.dividend_components;
create policy dividend_components_select_policy
on public.dividend_components
for select
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_components.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager', 'auditor'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
);

drop policy if exists dividend_components_write_policy on public.dividend_components;
create policy dividend_components_write_policy
on public.dividend_components
for all
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_components.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
)
with check (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_components.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
);

drop policy if exists dividend_member_snapshots_select_policy on public.dividend_member_snapshots;
create policy dividend_member_snapshots_select_policy
on public.dividend_member_snapshots
for select
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_member_snapshots.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and (
                public.has_role(array['super_admin', 'branch_manager', 'auditor'])
                and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
                or exists (
                    select 1 from public.members m
                    where m.id = dividend_member_snapshots.member_id
                      and m.user_id = auth.uid()
                )
           )
    )
);

drop policy if exists dividend_member_snapshots_write_policy on public.dividend_member_snapshots;
create policy dividend_member_snapshots_write_policy
on public.dividend_member_snapshots
for all
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_member_snapshots.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
)
with check (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_member_snapshots.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
);

drop policy if exists dividend_allocations_select_policy on public.dividend_allocations;
create policy dividend_allocations_select_policy
on public.dividend_allocations
for select
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_allocations.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and (
                public.has_role(array['super_admin', 'branch_manager', 'auditor'])
                and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
                or exists (
                    select 1 from public.members m
                    where m.id = dividend_allocations.member_id
                      and m.user_id = auth.uid()
                      and dc.status in ('approved', 'paid', 'closed')
                )
           )
    )
);

drop policy if exists dividend_allocations_write_policy on public.dividend_allocations;
create policy dividend_allocations_write_policy
on public.dividend_allocations
for all
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_allocations.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
)
with check (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_allocations.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
);

drop policy if exists dividend_approvals_select_policy on public.dividend_approvals;
create policy dividend_approvals_select_policy
on public.dividend_approvals
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager', 'auditor'])
    )
);

drop policy if exists dividend_approvals_write_policy on public.dividend_approvals;
create policy dividend_approvals_write_policy
on public.dividend_approvals
for all
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

drop policy if exists dividend_payments_select_policy on public.dividend_payments;
create policy dividend_payments_select_policy
on public.dividend_payments
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager', 'auditor'])
    )
);

drop policy if exists dividend_payments_write_policy on public.dividend_payments;
create policy dividend_payments_write_policy
on public.dividend_payments
for all
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create or replace function public.approve_dividend_cycle(
    p_cycle_id uuid,
    p_user_id uuid,
    p_notes text default null,
    p_signature_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cycle record;
    v_component record;
    v_approval_count integer := 0;
    v_journal_id uuid;
    v_lines jsonb := '[]'::jsonb;
begin
    select * into v_cycle from public.dividend_cycles where id = p_cycle_id for update;
    if not found then
        return jsonb_build_object('success', false, 'code', 'DIVIDEND_CYCLE_NOT_FOUND', 'message', 'Dividend cycle was not found.');
    end if;
    if v_cycle.status <> 'allocated' then
        return jsonb_build_object('success', false, 'code', 'INVALID_DIVIDEND_STATE', 'message', 'Dividend cycle must be allocated before approval.');
    end if;
    if v_cycle.created_by = p_user_id then
        return jsonb_build_object('success', false, 'code', 'MAKER_CHECKER_VIOLATION', 'message', 'The maker cannot approve the same dividend cycle.');
    end if;

    insert into public.dividend_approvals (cycle_id, tenant_id, approved_by, decision, notes, signature_hash)
    values (p_cycle_id, v_cycle.tenant_id, p_user_id, 'approved', p_notes, p_signature_hash)
    on conflict (cycle_id, approved_by) do nothing;

    select count(*) into v_approval_count
    from public.dividend_approvals
    where cycle_id = p_cycle_id and decision = 'approved';

    if v_approval_count < v_cycle.required_checker_count then
        return jsonb_build_object('success', true, 'message', 'Approval recorded. Additional checker approval is still required.', 'approval_count', v_approval_count, 'required_checker_count', v_cycle.required_checker_count);
    end if;

    for v_component in
        select dc.*, coalesce(sum(da.payout_amount), 0)::numeric(18,2) as total_payout
        from public.dividend_components dc
        left join public.dividend_allocations da on da.component_id = dc.id and da.status = 'pending'
        where dc.cycle_id = p_cycle_id
        group by dc.id
    loop
        if v_component.total_payout <= 0 then
            continue;
        end if;

        v_lines := v_lines || jsonb_build_array(
            jsonb_build_object('account_id', v_component.retained_earnings_account_id, 'debit', v_component.total_payout, 'credit', 0, 'branch_id', v_cycle.branch_id),
            jsonb_build_object('account_id', v_component.dividends_payable_account_id, 'debit', 0, 'credit', v_component.total_payout, 'branch_id', v_cycle.branch_id)
        );
    end loop;

    if jsonb_array_length(v_lines) = 0 then
        return jsonb_build_object('success', false, 'code', 'NO_ALLOCATIONS_TO_APPROVE', 'message', 'No pending dividend allocations were found.');
    end if;

    v_journal_id := public.post_journal_entry(
        v_cycle.tenant_id,
        'DIV-DECL-' || replace(v_cycle.period_label, ' ', '-'),
        'Dividend declaration for ' || v_cycle.period_label,
        v_cycle.declaration_date,
        p_user_id,
        'adjustment',
        v_lines
    );

    update public.dividend_cycles
       set status = 'approved',
           approved_by = p_user_id,
           approved_at = now(),
           declaration_journal_id = v_journal_id,
           updated_at = now()
     where id = p_cycle_id;

    return jsonb_build_object('success', true, 'message', 'Dividend cycle approved and liability declared.', 'approval_count', v_approval_count, 'journal_id', v_journal_id);
end;
$$;

create or replace function public.pay_dividend_cycle(
    p_cycle_id uuid,
    p_payment_method public.dividend_payment_method,
    p_user_id uuid,
    p_reference text default null,
    p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cycle record;
    v_component record;
    v_allocation record;
    v_journal_id uuid;
    v_payment_id uuid := gen_random_uuid();
    v_lines jsonb := '[]'::jsonb;
    v_total_amount numeric(18,2) := 0;
    v_share_account record;
    v_running_balance numeric(18,2);
begin
    select * into v_cycle from public.dividend_cycles where id = p_cycle_id for update;
    if not found then
        return jsonb_build_object('success', false, 'code', 'DIVIDEND_CYCLE_NOT_FOUND', 'message', 'Dividend cycle was not found.');
    end if;
    if v_cycle.status <> 'approved' then
        return jsonb_build_object('success', false, 'code', 'INVALID_DIVIDEND_STATE', 'message', 'Dividend cycle must be approved before payment.');
    end if;

    for v_component in
        select dc.*, coalesce(sum(da.payout_amount), 0)::numeric(18,2) as total_payout
        from public.dividend_components dc
        join public.dividend_allocations da on da.component_id = dc.id and da.status = 'pending'
        where dc.cycle_id = p_cycle_id
        group by dc.id
    loop
        if v_component.total_payout <= 0 then
            continue;
        end if;

        v_total_amount := v_total_amount + v_component.total_payout;
        v_lines := v_lines || jsonb_build_array(
            jsonb_build_object('account_id', v_component.dividends_payable_account_id, 'debit', v_component.total_payout, 'credit', 0, 'branch_id', v_cycle.branch_id)
        );

        if p_payment_method = 'reinvest_to_shares' then
            for v_allocation in
                select da.*, m.branch_id
                from public.dividend_allocations da
                join public.members m on m.id = da.member_id
                where da.cycle_id = p_cycle_id
                  and da.component_id = v_component.id
                  and da.status = 'pending'
            loop
                select * into v_share_account
                from public.member_accounts
                where member_id = v_allocation.member_id
                  and tenant_id = v_cycle.tenant_id
                  and product_type = 'shares'
                  and deleted_at is null
                limit 1;

                if not found then
                    return jsonb_build_object('success', false, 'code', 'SHARE_ACCOUNT_NOT_FOUND', 'message', 'A share account is required for reinvested dividend payment.');
                end if;

                v_lines := v_lines || jsonb_build_array(
                    jsonb_build_object(
                        'account_id', v_share_account.gl_account_id,
                        'debit', 0,
                        'credit', v_allocation.payout_amount,
                        'member_account_id', v_share_account.id,
                        'branch_id', v_share_account.branch_id
                    )
                );
            end loop;
        else
            if v_component.payout_account_id is null then
                return jsonb_build_object('success', false, 'code', 'PAYOUT_ACCOUNT_REQUIRED', 'message', 'A payout account must be configured for this dividend component.');
            end if;

            v_lines := v_lines || jsonb_build_array(
                jsonb_build_object('account_id', v_component.payout_account_id, 'debit', 0, 'credit', v_component.total_payout, 'branch_id', v_cycle.branch_id)
            );
        end if;
    end loop;

    if jsonb_array_length(v_lines) = 0 or v_total_amount <= 0 then
        return jsonb_build_object('success', false, 'code', 'NO_ALLOCATIONS_TO_PAY', 'message', 'No pending dividend allocations were found for payment.');
    end if;

    v_journal_id := public.post_journal_entry(
        v_cycle.tenant_id,
        coalesce(p_reference, 'DIV-PAY-' || replace(v_cycle.period_label, ' ', '-')),
        coalesce(p_description, 'Dividend payment for ' || v_cycle.period_label),
        coalesce(v_cycle.payment_date, current_date),
        p_user_id,
        'adjustment',
        v_lines
    );

    insert into public.dividend_payments (id, cycle_id, tenant_id, payment_method, total_amount, processed_by, journal_entry_id, reference, notes)
    values (v_payment_id, p_cycle_id, v_cycle.tenant_id, p_payment_method, v_total_amount, p_user_id, v_journal_id, p_reference, p_description);

    if p_payment_method = 'reinvest_to_shares' then
        for v_allocation in
            select da.*, m.branch_id, ma.id as share_account_id
            from public.dividend_allocations da
            join public.members m on m.id = da.member_id
            join public.member_accounts ma on ma.member_id = da.member_id and ma.tenant_id = da.tenant_id and ma.product_type = 'shares' and ma.deleted_at is null
            where da.cycle_id = p_cycle_id
              and da.status = 'pending'
        loop
            update public.member_accounts
               set available_balance = available_balance + v_allocation.payout_amount
             where id = v_allocation.share_account_id
             returning available_balance into v_running_balance;

            insert into public.member_account_transactions (
                tenant_id, member_account_id, branch_id, journal_id, transaction_type, direction, amount, running_balance, reference, created_by
            )
            values (
                v_cycle.tenant_id, v_allocation.share_account_id, v_allocation.branch_id, v_journal_id, 'dividend_allocation', 'in', v_allocation.payout_amount, v_running_balance, p_reference, p_user_id
            );
        end loop;
    end if;

    update public.dividend_allocations
       set status = 'paid',
           payment_ref = p_reference,
           paid_at = now()
     where cycle_id = p_cycle_id
       and status = 'pending';

    update public.dividend_cycles
       set status = 'paid',
           payment_journal_id = v_journal_id,
           updated_at = now()
     where id = p_cycle_id;

    return jsonb_build_object('success', true, 'message', 'Dividend payment batch posted successfully.', 'payment_id', v_payment_id, 'journal_id', v_journal_id, 'total_amount', v_total_amount);
end;
$$;

grant execute on function public.approve_dividend_cycle(uuid, uuid, text, text) to service_role;
grant execute on function public.pay_dividend_cycle(uuid, public.dividend_payment_method, uuid, text, text) to service_role;
