create or replace function public.seed_tenant_defaults(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cash_account_id uuid;
    v_member_savings_account_id uuid;
    v_loan_portfolio_account_id uuid;
    v_interest_receivable_account_id uuid;
    v_interest_income_account_id uuid;
    v_retained_earnings_account_id uuid;
begin
    if not exists (select 1 from public.tenants where id = p_tenant_id and deleted_at is null) then
        raise exception 'Tenant % does not exist', p_tenant_id;
    end if;

    insert into public.chart_of_accounts (tenant_id, account_code, account_name, account_type, system_tag, is_system_control)
    values
        (p_tenant_id, '1010', 'Cash on Hand', 'asset', 'cash', true),
        (p_tenant_id, '1200', 'Loan Portfolio', 'asset', 'loan_portfolio', true),
        (p_tenant_id, '1210', 'Interest Receivable', 'asset', 'interest_receivable', true),
        (p_tenant_id, '2010', 'Member Savings Control', 'liability', 'member_savings_control', true),
        (p_tenant_id, '2030', 'Dividends Payable', 'liability', 'dividends_payable', true),
        (p_tenant_id, '3030', 'Member Share Capital', 'equity', 'member_share_capital_control', true),
        (p_tenant_id, '3020', 'Dividend Reserve', 'equity', 'dividend_reserve', true),
        (p_tenant_id, '4010', 'Loan Interest Income', 'income', 'interest_income', true),
        (p_tenant_id, '3010', 'Retained Earnings', 'equity', 'retained_earnings', true)
    on conflict do nothing;

    select id into v_cash_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id and system_tag = 'cash'
     limit 1;

    select id into v_loan_portfolio_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id and system_tag = 'loan_portfolio'
     limit 1;

    select id into v_interest_receivable_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id and system_tag = 'interest_receivable'
     limit 1;

    select id into v_member_savings_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id and system_tag = 'member_savings_control'
     limit 1;

    select id into v_interest_income_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id and system_tag = 'interest_income'
     limit 1;

    select id into v_retained_earnings_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id and system_tag = 'retained_earnings'
     limit 1;

    insert into public.tenant_settings (
        tenant_id,
        default_cash_account_id,
        default_member_savings_control_account_id,
        default_loan_portfolio_account_id,
        default_interest_receivable_account_id,
        default_interest_income_account_id,
        default_retained_earnings_account_id
    )
    values (
        p_tenant_id,
        v_cash_account_id,
        v_member_savings_account_id,
        v_loan_portfolio_account_id,
        v_interest_receivable_account_id,
        v_interest_income_account_id,
        v_retained_earnings_account_id
    )
    on conflict (tenant_id) do update
        set default_cash_account_id = excluded.default_cash_account_id,
            default_member_savings_control_account_id = excluded.default_member_savings_control_account_id,
            default_loan_portfolio_account_id = excluded.default_loan_portfolio_account_id,
            default_interest_receivable_account_id = excluded.default_interest_receivable_account_id,
            default_interest_income_account_id = excluded.default_interest_income_account_id,
            default_retained_earnings_account_id = excluded.default_retained_earnings_account_id;

    insert into public.branches (tenant_id, name, code, address_line1, city, state, country)
    values (p_tenant_id, 'Main Branch', 'MAIN', 'Head Office', 'Dar es Salaam', 'Dar es Salaam', 'Tanzania')
    on conflict (tenant_id, code) do nothing;

    return jsonb_build_object(
        'tenant_id', p_tenant_id,
        'cash_account_id', v_cash_account_id,
        'member_savings_account_id', v_member_savings_account_id,
        'loan_portfolio_account_id', v_loan_portfolio_account_id,
        'member_share_capital_account_id', (
            select id
              from public.chart_of_accounts
             where tenant_id = p_tenant_id
               and system_tag = 'member_share_capital_control'
             limit 1
        )
    );
end;
$$;

create or replace function public.post_journal_entry(
    p_tenant_id uuid,
    p_reference text,
    p_description text,
    p_entry_date date,
    p_created_by uuid,
    p_source_type public.journal_source,
    p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_journal_id uuid := gen_random_uuid();
    v_line jsonb;
    v_total_debit numeric(18,2) := 0;
    v_total_credit numeric(18,2) := 0;
    v_account_type public.account_type;
    v_effect numeric(18,2);
    v_account_id uuid;
begin
    if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
        raise exception 'Journal entry requires at least two lines';
    end if;

    insert into public.journal_entries (
        id,
        tenant_id,
        reference,
        description,
        entry_date,
        posted,
        is_reversal,
        reversed_journal_id,
        source_type,
        created_by
    )
    values (
        v_journal_id,
        p_tenant_id,
        coalesce(p_reference, 'AUTO-' || to_char(now(), 'YYYYMMDDHH24MISS')),
        p_description,
        coalesce(p_entry_date, current_date),
        true,
        false,
        null,
        p_source_type,
        p_created_by
    );

    for v_line in
        select value from jsonb_array_elements(p_lines)
    loop
        v_account_id := (v_line ->> 'account_id')::uuid;

        select account_type
          into v_account_type
          from public.chart_of_accounts
         where id = v_account_id
           and tenant_id = p_tenant_id
           and deleted_at is null;

        if not found then
            raise exception 'Invalid account % for tenant %', v_account_id, p_tenant_id;
        end if;

        if (
            coalesce((v_line ->> 'debit')::numeric, 0) <= 0
            and coalesce((v_line ->> 'credit')::numeric, 0) <= 0
        ) then
            raise exception 'Journal line must contain a debit or credit amount';
        end if;

        insert into public.journal_lines (
            journal_id,
            tenant_id,
            account_id,
            member_account_id,
            branch_id,
            debit,
            credit
        )
        values (
            v_journal_id,
            p_tenant_id,
            v_account_id,
            (v_line ->> 'member_account_id')::uuid,
            (v_line ->> 'branch_id')::uuid,
            coalesce((v_line ->> 'debit')::numeric, 0),
            coalesce((v_line ->> 'credit')::numeric, 0)
        );

        v_total_debit := v_total_debit + coalesce((v_line ->> 'debit')::numeric, 0);
        v_total_credit := v_total_credit + coalesce((v_line ->> 'credit')::numeric, 0);

        v_effect := case
            when v_account_type in ('asset', 'expense') then
                coalesce((v_line ->> 'debit')::numeric, 0) - coalesce((v_line ->> 'credit')::numeric, 0)
            else
                coalesce((v_line ->> 'credit')::numeric, 0) - coalesce((v_line ->> 'debit')::numeric, 0)
        end;

        insert into public.account_balances (tenant_id, account_id, balance)
        values (p_tenant_id, v_account_id, v_effect)
        on conflict (tenant_id, account_id) do update
            set balance = public.account_balances.balance + excluded.balance,
                updated_at = now();
    end loop;

    if round(v_total_debit, 2) <> round(v_total_credit, 2) then
        raise exception 'Journal entry is not balanced';
    end if;

    return v_journal_id;
end;
$$;

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

create or replace function public.deposit(
    p_tenant_id uuid,
    p_account_id uuid,
    p_amount numeric,
    p_teller_id uuid,
    p_reference text default null,
    p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_account record;
    v_settings record;
    v_journal_id uuid;
    v_balance numeric(18,2);
begin
    if p_amount is null or p_amount <= 0 then
        return jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'message', 'Amount must be greater than zero.');
    end if;

    select ma.*, m.branch_id
      into v_account
      from public.member_accounts ma
      join public.members m on m.id = ma.member_id
     where ma.id = p_account_id
       and ma.tenant_id = p_tenant_id
       and ma.status = 'active'
       and ma.deleted_at is null
       and m.deleted_at is null;

    if not found then
        return jsonb_build_object('success', false, 'code', 'ACCOUNT_NOT_FOUND', 'message', 'Savings account not found.');
    end if;

    select *
      into v_settings
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    if v_settings.default_cash_account_id is null then
        return jsonb_build_object('success', false, 'code', 'TENANT_SETTINGS_INVALID', 'message', 'Cash control account is not configured.');
    end if;

    v_journal_id := public.post_journal_entry(
        p_tenant_id,
        p_reference,
        coalesce(p_description, 'Savings deposit'),
        current_date,
        p_teller_id,
        'deposit',
        jsonb_build_array(
            jsonb_build_object(
                'account_id', v_settings.default_cash_account_id,
                'debit', p_amount,
                'credit', 0,
                'branch_id', v_account.branch_id
            ),
            jsonb_build_object(
                'account_id', v_account.gl_account_id,
                'debit', 0,
                'credit', p_amount,
                'member_account_id', v_account.id,
                'branch_id', v_account.branch_id
            )
        )
    );

    update public.member_accounts
       set available_balance = available_balance + p_amount
     where id = p_account_id
     returning available_balance into v_balance;

    insert into public.member_account_transactions (
        tenant_id,
        member_account_id,
        branch_id,
        journal_id,
        transaction_type,
        direction,
        amount,
        running_balance,
        reference,
        created_by
    )
    values (
        p_tenant_id,
        p_account_id,
        v_account.branch_id,
        v_journal_id,
        'deposit',
        'in',
        p_amount,
        v_balance,
        p_reference,
        p_teller_id
    );

    return jsonb_build_object(
        'success', true,
        'message', 'Deposit posted successfully.',
        'journal_id', v_journal_id,
        'account_id', p_account_id,
        'new_balance', v_balance
    );
end;
$$;

create or replace function public.withdraw(
    p_tenant_id uuid,
    p_account_id uuid,
    p_amount numeric,
    p_teller_id uuid,
    p_reference text default null,
    p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_account record;
    v_settings record;
    v_journal_id uuid;
    v_balance numeric(18,2);
begin
    if p_amount is null or p_amount <= 0 then
        return jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'message', 'Amount must be greater than zero.');
    end if;

    select ma.*, m.branch_id
      into v_account
      from public.member_accounts ma
      join public.members m on m.id = ma.member_id
     where ma.id = p_account_id
       and ma.tenant_id = p_tenant_id
       and ma.status = 'active'
       and ma.deleted_at is null
       and m.deleted_at is null;

    if not found then
        return jsonb_build_object('success', false, 'code', 'ACCOUNT_NOT_FOUND', 'message', 'Savings account not found.');
    end if;

    if v_account.available_balance < p_amount then
        return jsonb_build_object('success', false, 'code', 'INSUFFICIENT_FUNDS', 'message', 'Available balance is insufficient.');
    end if;

    select *
      into v_settings
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    if v_settings.default_cash_account_id is null then
        return jsonb_build_object('success', false, 'code', 'TENANT_SETTINGS_INVALID', 'message', 'Cash control account is not configured.');
    end if;

    v_journal_id := public.post_journal_entry(
        p_tenant_id,
        p_reference,
        coalesce(p_description, 'Savings withdrawal'),
        current_date,
        p_teller_id,
        'withdrawal',
        jsonb_build_array(
            jsonb_build_object(
                'account_id', v_account.gl_account_id,
                'debit', p_amount,
                'credit', 0,
                'member_account_id', v_account.id,
                'branch_id', v_account.branch_id
            ),
            jsonb_build_object(
                'account_id', v_settings.default_cash_account_id,
                'debit', 0,
                'credit', p_amount,
                'branch_id', v_account.branch_id
            )
        )
    );

    update public.member_accounts
       set available_balance = available_balance - p_amount
     where id = p_account_id
     returning available_balance into v_balance;

    insert into public.member_account_transactions (
        tenant_id,
        member_account_id,
        branch_id,
        journal_id,
        transaction_type,
        direction,
        amount,
        running_balance,
        reference,
        created_by
    )
    values (
        p_tenant_id,
        p_account_id,
        v_account.branch_id,
        v_journal_id,
        'withdrawal',
        'out',
        p_amount,
        v_balance,
        p_reference,
        p_teller_id
    );

    return jsonb_build_object(
        'success', true,
        'message', 'Withdrawal posted successfully.',
        'journal_id', v_journal_id,
        'account_id', p_account_id,
        'new_balance', v_balance
    );
end;
$$;

create or replace function public.transfer(
    p_tenant_id uuid,
    p_from_account uuid,
    p_to_account uuid,
    p_amount numeric,
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
    v_source record;
    v_destination record;
    v_journal_id uuid;
    v_source_balance numeric(18,2);
    v_destination_balance numeric(18,2);
begin
    if p_from_account = p_to_account then
        return jsonb_build_object('success', false, 'code', 'INVALID_TRANSFER', 'message', 'Source and destination accounts must differ.');
    end if;

    if p_amount is null or p_amount <= 0 then
        return jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'message', 'Amount must be greater than zero.');
    end if;

    select ma.*, m.branch_id
      into v_source
      from public.member_accounts ma
      join public.members m on m.id = ma.member_id
     where ma.id = p_from_account
       and ma.tenant_id = p_tenant_id
       and ma.status = 'active'
       and ma.deleted_at is null;

    if not found then
        return jsonb_build_object('success', false, 'code', 'SOURCE_ACCOUNT_NOT_FOUND', 'message', 'Source account was not found.');
    end if;

    select ma.*, m.branch_id
      into v_destination
      from public.member_accounts ma
      join public.members m on m.id = ma.member_id
     where ma.id = p_to_account
       and ma.tenant_id = p_tenant_id
       and ma.status = 'active'
       and ma.deleted_at is null;

    if not found then
        return jsonb_build_object('success', false, 'code', 'DESTINATION_ACCOUNT_NOT_FOUND', 'message', 'Destination account was not found.');
    end if;

    if v_source.available_balance < p_amount then
        return jsonb_build_object('success', false, 'code', 'INSUFFICIENT_FUNDS', 'message', 'Source account has insufficient funds.');
    end if;

    v_journal_id := public.post_journal_entry(
        p_tenant_id,
        p_reference,
        coalesce(p_description, 'Savings transfer'),
        current_date,
        p_user_id,
        'transfer',
        jsonb_build_array(
            jsonb_build_object(
                'account_id', v_source.gl_account_id,
                'debit', p_amount,
                'credit', 0,
                'member_account_id', v_source.id,
                'branch_id', v_source.branch_id
            ),
            jsonb_build_object(
                'account_id', v_destination.gl_account_id,
                'debit', 0,
                'credit', p_amount,
                'member_account_id', v_destination.id,
                'branch_id', v_destination.branch_id
            )
        )
    );

    update public.member_accounts
       set available_balance = available_balance - p_amount
     where id = p_from_account
     returning available_balance into v_source_balance;

    update public.member_accounts
       set available_balance = available_balance + p_amount
     where id = p_to_account
     returning available_balance into v_destination_balance;

    insert into public.member_account_transactions (
        tenant_id, member_account_id, branch_id, journal_id, transaction_type, direction, amount, running_balance, reference, created_by
    )
    values
        (p_tenant_id, p_from_account, v_source.branch_id, v_journal_id, 'transfer_out', 'out', p_amount, v_source_balance, p_reference, p_user_id),
        (p_tenant_id, p_to_account, v_destination.branch_id, v_journal_id, 'transfer_in', 'in', p_amount, v_destination_balance, p_reference, p_user_id);

    return jsonb_build_object(
        'success', true,
        'message', 'Transfer posted successfully.',
        'journal_id', v_journal_id,
        'source_balance', v_source_balance,
        'destination_balance', v_destination_balance
    );
end;
$$;

create or replace function public.share_contribution(
    p_tenant_id uuid,
    p_account_id uuid,
    p_amount numeric,
    p_teller_id uuid,
    p_reference text default null,
    p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_account record;
    v_settings record;
    v_journal_id uuid;
    v_balance numeric(18,2);
begin
    if p_amount is null or p_amount <= 0 then
        return jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'message', 'Amount must be greater than zero.');
    end if;

    select ma.*, m.branch_id
      into v_account
      from public.member_accounts ma
      join public.members m on m.id = ma.member_id
     where ma.id = p_account_id
       and ma.tenant_id = p_tenant_id
       and ma.product_type = 'shares'
       and ma.status = 'active'
       and ma.deleted_at is null
       and m.deleted_at is null;

    if not found then
        return jsonb_build_object('success', false, 'code', 'SHARE_ACCOUNT_NOT_FOUND', 'message', 'Share account was not found.');
    end if;

    select *
      into v_settings
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    if v_settings.default_cash_account_id is null then
        return jsonb_build_object('success', false, 'code', 'TENANT_SETTINGS_INVALID', 'message', 'Cash control account is not configured.');
    end if;

    v_journal_id := public.post_journal_entry(
        p_tenant_id,
        p_reference,
        coalesce(p_description, 'Member share contribution'),
        current_date,
        p_teller_id,
        'share_contribution',
        jsonb_build_array(
            jsonb_build_object(
                'account_id', v_settings.default_cash_account_id,
                'debit', p_amount,
                'credit', 0,
                'branch_id', v_account.branch_id
            ),
            jsonb_build_object(
                'account_id', v_account.gl_account_id,
                'debit', 0,
                'credit', p_amount,
                'member_account_id', v_account.id,
                'branch_id', v_account.branch_id
            )
        )
    );

    update public.member_accounts
       set available_balance = available_balance + p_amount
     where id = p_account_id
     returning available_balance into v_balance;

    insert into public.member_account_transactions (
        tenant_id,
        member_account_id,
        branch_id,
        journal_id,
        transaction_type,
        direction,
        amount,
        running_balance,
        reference,
        created_by
    )
    values (
        p_tenant_id,
        p_account_id,
        v_account.branch_id,
        v_journal_id,
        'share_contribution',
        'in',
        p_amount,
        v_balance,
        p_reference,
        p_teller_id
    );

    return jsonb_build_object(
        'success', true,
        'message', 'Share contribution posted successfully.',
        'journal_id', v_journal_id,
        'account_id', p_account_id,
        'new_balance', v_balance
    );
end;
$$;

create or replace function public.dividend_allocation(
    p_tenant_id uuid,
    p_account_id uuid,
    p_amount numeric,
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
    v_account record;
    v_settings record;
    v_journal_id uuid;
    v_balance numeric(18,2);
begin
    if p_amount is null or p_amount <= 0 then
        return jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'message', 'Amount must be greater than zero.');
    end if;

    select ma.*, m.branch_id
      into v_account
      from public.member_accounts ma
      join public.members m on m.id = ma.member_id
     where ma.id = p_account_id
       and ma.tenant_id = p_tenant_id
       and ma.product_type = 'shares'
       and ma.status = 'active'
       and ma.deleted_at is null
       and m.deleted_at is null;

    if not found then
        return jsonb_build_object('success', false, 'code', 'SHARE_ACCOUNT_NOT_FOUND', 'message', 'Share account was not found.');
    end if;

    select *
      into v_settings
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    if v_settings.default_retained_earnings_account_id is null then
        return jsonb_build_object('success', false, 'code', 'TENANT_SETTINGS_INVALID', 'message', 'Retained earnings control account is not configured.');
    end if;

    v_journal_id := public.post_journal_entry(
        p_tenant_id,
        p_reference,
        coalesce(p_description, 'Dividend allocation to member shares'),
        current_date,
        p_user_id,
        'dividend_allocation',
        jsonb_build_array(
            jsonb_build_object(
                'account_id', v_settings.default_retained_earnings_account_id,
                'debit', p_amount,
                'credit', 0,
                'branch_id', v_account.branch_id
            ),
            jsonb_build_object(
                'account_id', v_account.gl_account_id,
                'debit', 0,
                'credit', p_amount,
                'member_account_id', v_account.id,
                'branch_id', v_account.branch_id
            )
        )
    );

    update public.member_accounts
       set available_balance = available_balance + p_amount
     where id = p_account_id
     returning available_balance into v_balance;

    insert into public.member_account_transactions (
        tenant_id,
        member_account_id,
        branch_id,
        journal_id,
        transaction_type,
        direction,
        amount,
        running_balance,
        reference,
        created_by
    )
    values (
        p_tenant_id,
        p_account_id,
        v_account.branch_id,
        v_journal_id,
        'dividend_allocation',
        'in',
        p_amount,
        v_balance,
        p_reference,
        p_user_id
    );

    return jsonb_build_object(
        'success', true,
        'message', 'Dividend allocated successfully.',
        'journal_id', v_journal_id,
        'account_id', p_account_id,
        'new_balance', v_balance
    );
end;
$$;

create or replace function public.loan_disburse(
    p_tenant_id uuid,
    p_member_id uuid,
    p_branch_id uuid,
    p_principal_amount numeric,
    p_annual_interest_rate numeric,
    p_term_count integer,
    p_repayment_frequency public.repayment_frequency,
    p_disbursed_by uuid,
    p_reference text default null,
    p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_member record;
    v_settings record;
    v_loan_id uuid := gen_random_uuid();
    v_loan_account_id uuid := gen_random_uuid();
    v_loan_number text := 'LN-' || to_char(now(), 'YYYYMMDD') || '-' || substr(replace(v_loan_id::text, '-', ''), 1, 8);
    v_loan_account_number text := 'LA-' || to_char(now(), 'YYYYMMDD') || '-' || substr(replace(v_loan_account_id::text, '-', ''), 1, 8);
    v_journal_id uuid;
    v_balance numeric(18,8) := p_principal_amount;
    v_rate_per_period numeric(18,8);
    v_installment numeric(18,2);
    v_regular_installment numeric(18,2);
    v_interest_due numeric(18,2);
    v_principal_due numeric(18,2);
    v_due_date date := current_date;
    i integer;
begin
    if p_principal_amount is null or p_principal_amount <= 0 then
        return jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'message', 'Principal amount must be greater than zero.');
    end if;

    select *
      into v_member
      from public.members
     where id = p_member_id
       and tenant_id = p_tenant_id
       and branch_id = p_branch_id
       and status = 'active'
       and deleted_at is null;

    if not found then
        return jsonb_build_object('success', false, 'code', 'MEMBER_NOT_FOUND', 'message', 'Member was not found for this branch.');
    end if;

    select *
      into v_settings
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    if v_settings.default_cash_account_id is null
        or v_settings.default_loan_portfolio_account_id is null
        or v_settings.default_interest_receivable_account_id is null
        or v_settings.default_interest_income_account_id is null then
        return jsonb_build_object('success', false, 'code', 'TENANT_SETTINGS_INVALID', 'message', 'Loan control accounts are not fully configured.');
    end if;

    v_rate_per_period := case p_repayment_frequency
        when 'daily' then (p_annual_interest_rate / 100.0) / 365.0
        when 'weekly' then (p_annual_interest_rate / 100.0) / 52.0
        else (p_annual_interest_rate / 100.0) / 12.0
    end;

    if v_rate_per_period = 0 then
        v_installment := round(p_principal_amount / p_term_count, 2);
    else
        v_installment := round(
            p_principal_amount
            * v_rate_per_period
            / (1 - power(1 + v_rate_per_period, -p_term_count)),
            2
        );
    end if;

    v_regular_installment := v_installment;

    insert into public.loans (
        id,
        tenant_id,
        member_id,
        branch_id,
        loan_number,
        principal_amount,
        annual_interest_rate,
        term_count,
        repayment_frequency,
        status,
        outstanding_principal,
        accrued_interest,
        last_interest_accrual_at,
        disbursed_at,
        created_by
    )
    values (
        v_loan_id,
        p_tenant_id,
        p_member_id,
        p_branch_id,
        v_loan_number,
        p_principal_amount,
        p_annual_interest_rate,
        p_term_count,
        p_repayment_frequency,
        'active',
        p_principal_amount,
        0,
        current_date,
        now(),
        p_disbursed_by
    );

    insert into public.loan_accounts (
        id,
        tenant_id,
        loan_id,
        member_id,
        branch_id,
        account_number,
        account_name,
        gl_account_id,
        status,
        principal_balance,
        accrued_interest_balance
    )
    values (
        v_loan_account_id,
        p_tenant_id,
        v_loan_id,
        p_member_id,
        p_branch_id,
        v_loan_account_number,
        v_member.full_name || ' Loan Account',
        v_settings.default_loan_portfolio_account_id,
        'active',
        p_principal_amount,
        0
    );

    for i in 1..p_term_count loop
        v_interest_due := round(v_balance * v_rate_per_period, 2);
        v_principal_due := round(v_installment - v_interest_due, 2);

        if i = p_term_count then
            v_principal_due := round(v_balance, 2);
            v_installment := round(v_principal_due + v_interest_due, 2);
        end if;

        v_due_date := case p_repayment_frequency
            when 'daily' then v_due_date + interval '1 day'
            when 'weekly' then v_due_date + interval '7 days'
            else v_due_date + interval '1 month'
        end;

        insert into public.loan_schedules (
            tenant_id,
            loan_id,
            installment_number,
            due_date,
            opening_principal,
            principal_due,
            interest_due,
            installment_amount
        )
        values (
            p_tenant_id,
            v_loan_id,
            i,
            v_due_date,
            round(v_balance, 2),
            v_principal_due,
            v_interest_due,
            v_installment
        );

        v_balance := v_balance - v_principal_due;
    end loop;

    v_journal_id := public.post_journal_entry(
        p_tenant_id,
        p_reference,
        coalesce(p_description, 'Loan disbursement'),
        current_date,
        p_disbursed_by,
        'loan_disbursement',
        jsonb_build_array(
            jsonb_build_object(
                'account_id', v_settings.default_loan_portfolio_account_id,
                'debit', p_principal_amount,
                'credit', 0,
                'branch_id', p_branch_id
            ),
            jsonb_build_object(
                'account_id', v_settings.default_cash_account_id,
                'debit', 0,
                'credit', p_principal_amount,
                'branch_id', p_branch_id
            )
        )
    );

    insert into public.loan_account_transactions (
        tenant_id,
        loan_account_id,
        loan_id,
        member_id,
        branch_id,
        journal_id,
        transaction_type,
        direction,
        amount,
        principal_component,
        interest_component,
        running_principal_balance,
        running_interest_balance,
        reference,
        created_by
    )
    values (
        p_tenant_id,
        v_loan_account_id,
        v_loan_id,
        p_member_id,
        p_branch_id,
        v_journal_id,
        'loan_disbursement',
        'out',
        p_principal_amount,
        p_principal_amount,
        0,
        p_principal_amount,
        0,
        p_reference,
        p_disbursed_by
    );

    return jsonb_build_object(
        'success', true,
        'message', 'Loan disbursed successfully.',
        'loan_id', v_loan_id,
        'loan_account_id', v_loan_account_id,
        'loan_number', v_loan_number,
        'journal_id', v_journal_id,
        'installment_amount', v_regular_installment
    );
end;
$$;

create or replace function public.loan_repayment(
    p_tenant_id uuid,
    p_loan_id uuid,
    p_amount numeric,
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
    v_loan record;
    v_loan_account record;
    v_settings record;
    v_interest_component numeric(18,2);
    v_interest_receivable_component numeric(18,2);
    v_interest_income_component numeric(18,2);
    v_principal_component numeric(18,2);
    v_remaining_interest numeric(18,2);
    v_remaining_principal numeric(18,2);
    v_journal_id uuid;
    v_schedule record;
    v_interest_to_apply numeric(18,2);
    v_principal_to_apply numeric(18,2);
    v_scheduled_interest_outstanding numeric(18,2) := 0;
    v_repayable_balance numeric(18,2) := 0;
begin
    if p_amount is null or p_amount <= 0 then
        return jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'message', 'Repayment amount must be greater than zero.');
    end if;

    select *
      into v_loan
      from public.loans
     where id = p_loan_id
       and tenant_id = p_tenant_id
       and status in ('active', 'in_arrears');

    if not found then
        return jsonb_build_object('success', false, 'code', 'LOAN_NOT_FOUND', 'message', 'Loan was not found or is not repayable.');
    end if;

    select coalesce(sum(greatest(interest_due - interest_paid, 0)), 0)
      into v_scheduled_interest_outstanding
      from public.loan_schedules
     where loan_id = p_loan_id
       and status in ('pending', 'partial', 'overdue');

    v_repayable_balance := v_loan.outstanding_principal + greatest(v_loan.accrued_interest, v_scheduled_interest_outstanding);

    if p_amount > v_repayable_balance then
        return jsonb_build_object('success', false, 'code', 'OVERPAYMENT_NOT_ALLOWED', 'message', 'Repayment exceeds outstanding loan balance.');
    end if;

    select *
      into v_loan_account
      from public.loan_accounts
     where loan_id = p_loan_id
       and tenant_id = p_tenant_id
       and deleted_at is null;

    if not found then
        return jsonb_build_object('success', false, 'code', 'LOAN_ACCOUNT_NOT_FOUND', 'message', 'Loan account was not found.');
    end if;

    select *
      into v_settings
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    v_interest_component := least(p_amount, greatest(v_loan.accrued_interest, v_scheduled_interest_outstanding));
    v_interest_receivable_component := least(v_interest_component, v_loan.accrued_interest);
    v_interest_income_component := greatest(v_interest_component - v_interest_receivable_component, 0);
    v_principal_component := p_amount - v_interest_component;

    v_journal_id := public.post_journal_entry(
        p_tenant_id,
        p_reference,
        coalesce(p_description, 'Loan repayment'),
        current_date,
        p_user_id,
        'loan_repayment',
        (
            jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_settings.default_cash_account_id,
                    'debit', p_amount,
                    'credit', 0,
                    'branch_id', v_loan.branch_id
                )
            )
            || case
                when v_interest_receivable_component > 0 then jsonb_build_array(
                    jsonb_build_object(
                        'account_id', v_settings.default_interest_receivable_account_id,
                        'debit', 0,
                        'credit', v_interest_receivable_component,
                        'branch_id', v_loan.branch_id
                    )
                )
                else '[]'::jsonb
            end
            || case
                when v_interest_income_component > 0 then jsonb_build_array(
                    jsonb_build_object(
                        'account_id', v_settings.default_interest_income_account_id,
                        'debit', 0,
                        'credit', v_interest_income_component,
                        'branch_id', v_loan.branch_id
                    )
                )
                else '[]'::jsonb
            end
            || case
                when v_principal_component > 0 then jsonb_build_array(
                    jsonb_build_object(
                        'account_id', v_settings.default_loan_portfolio_account_id,
                        'debit', 0,
                        'credit', v_principal_component,
                        'branch_id', v_loan.branch_id
                    )
                )
                else '[]'::jsonb
            end
        )
    );

    v_remaining_interest := v_interest_component;
    v_remaining_principal := v_principal_component;

    for v_schedule in
        select *
          from public.loan_schedules
         where loan_id = p_loan_id
           and status in ('pending', 'partial', 'overdue')
         order by due_date asc, installment_number asc
    loop
        exit when v_remaining_interest <= 0 and v_remaining_principal <= 0;

        v_interest_to_apply := least(v_remaining_interest, greatest(v_schedule.interest_due - v_schedule.interest_paid, 0));
        v_principal_to_apply := least(v_remaining_principal, greatest(v_schedule.principal_due - v_schedule.principal_paid, 0));

        update public.loan_schedules
           set interest_paid = interest_paid + v_interest_to_apply,
               principal_paid = principal_paid + v_principal_to_apply,
               status = case
                   when (interest_paid + v_interest_to_apply) >= interest_due
                    and (principal_paid + v_principal_to_apply) >= principal_due then 'paid'::public.schedule_status
                   when (interest_paid + v_interest_to_apply) > 0
                     or (principal_paid + v_principal_to_apply) > 0 then 'partial'::public.schedule_status
                   else status
               end
         where id = v_schedule.id;

        v_remaining_interest := v_remaining_interest - v_interest_to_apply;
        v_remaining_principal := v_remaining_principal - v_principal_to_apply;
    end loop;

    update public.loans
       set accrued_interest = greatest(accrued_interest - v_interest_receivable_component, 0),
           outstanding_principal = greatest(outstanding_principal - v_principal_component, 0),
           status = case
               when greatest(outstanding_principal - v_principal_component, 0) <= 0
                and not exists (
                    select 1
                      from public.loan_schedules
                     where loan_id = p_loan_id
                       and (principal_due - principal_paid) + (interest_due - interest_paid) > 0
                ) then 'closed'::public.loan_status
               when exists (
                   select 1
                     from public.loan_schedules
                    where loan_id = p_loan_id
                      and due_date < current_date
                      and (principal_due - principal_paid) + (interest_due - interest_paid) > 0
               ) then 'in_arrears'::public.loan_status
               else 'active'::public.loan_status
           end
     where id = p_loan_id;

    update public.loan_accounts
       set principal_balance = greatest(principal_balance - v_principal_component, 0),
           accrued_interest_balance = greatest(accrued_interest_balance - v_interest_receivable_component, 0),
           status = (
               select status
                 from public.loans
                where id = p_loan_id
           )
     where id = v_loan_account.id;

    insert into public.loan_account_transactions (
        tenant_id,
        loan_account_id,
        loan_id,
        member_id,
        branch_id,
        journal_id,
        transaction_type,
        direction,
        amount,
        principal_component,
        interest_component,
        running_principal_balance,
        running_interest_balance,
        reference,
        created_by
    )
    values (
        p_tenant_id,
        v_loan_account.id,
        p_loan_id,
        v_loan.member_id,
        v_loan.branch_id,
        v_journal_id,
        'loan_repayment',
        'in',
        p_amount,
        v_principal_component,
        v_interest_component,
        greatest(v_loan_account.principal_balance - v_principal_component, 0),
        greatest(v_loan_account.accrued_interest_balance - v_interest_receivable_component, 0),
        p_reference,
        p_user_id
    );

    return jsonb_build_object(
        'success', true,
        'message', 'Loan repayment posted successfully.',
        'journal_id', v_journal_id,
        'loan_account_id', v_loan_account.id,
        'interest_component', v_interest_component,
        'principal_component', v_principal_component
    );
end;
$$;

create or replace function public.interest_accrual(
    p_tenant_id uuid,
    p_as_of_date date,
    p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_settings record;
    v_loan record;
    v_loan_account_id uuid;
    v_accrual_journal_id uuid;
    v_days integer;
    v_interest numeric(18,2);
    v_processed integer := 0;
begin
    select *
      into v_settings
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    for v_loan in
        select *
          from public.loans
         where tenant_id = p_tenant_id
           and status in ('active', 'in_arrears')
           and outstanding_principal > 0
    loop
        v_days := greatest(p_as_of_date - coalesce(v_loan.last_interest_accrual_at, v_loan.disbursed_at::date), 0);

        if v_days = 0 then
            continue;
        end if;

        v_interest := round(v_loan.outstanding_principal * (v_loan.annual_interest_rate / 100.0) / 365.0 * v_days, 2);

        if v_interest <= 0 then
            continue;
        end if;

        v_accrual_journal_id := public.post_journal_entry(
            p_tenant_id,
            'ACCRUAL-' || v_loan.loan_number || '-' || to_char(p_as_of_date, 'YYYYMMDD'),
            'Nightly interest accrual',
            p_as_of_date,
            p_user_id,
            'interest_accrual',
            jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_settings.default_interest_receivable_account_id,
                    'debit', v_interest,
                    'credit', 0,
                    'branch_id', v_loan.branch_id
                ),
                jsonb_build_object(
                    'account_id', v_settings.default_interest_income_account_id,
                    'debit', 0,
                    'credit', v_interest,
                    'branch_id', v_loan.branch_id
                )
            )
        );

        update public.loans
           set accrued_interest = accrued_interest + v_interest,
               last_interest_accrual_at = p_as_of_date
         where id = v_loan.id;

        update public.loan_accounts
           set accrued_interest_balance = accrued_interest_balance + v_interest,
               status = v_loan.status
         where loan_id = v_loan.id
           and tenant_id = p_tenant_id
           and deleted_at is null
         returning id into v_loan_account_id;

        if v_loan_account_id is not null then
            insert into public.loan_account_transactions (
                tenant_id,
                loan_account_id,
                loan_id,
                member_id,
                branch_id,
                journal_id,
                transaction_type,
                direction,
                amount,
                principal_component,
                interest_component,
                running_principal_balance,
                running_interest_balance,
                reference,
                created_by
            )
            values (
                p_tenant_id,
                v_loan_account_id,
                v_loan.id,
                v_loan.member_id,
                v_loan.branch_id,
                v_accrual_journal_id,
                'interest_accrual',
                'out',
                v_interest,
                0,
                v_interest,
                v_loan.outstanding_principal,
                v_loan.accrued_interest + v_interest,
                'ACCRUAL-' || v_loan.loan_number || '-' || to_char(p_as_of_date, 'YYYYMMDD'),
                p_user_id
            );
        end if;

        v_processed := v_processed + 1;
    end loop;

    return jsonb_build_object(
        'success', true,
        'message', 'Interest accrual completed.',
        'processed_loans', v_processed,
        'as_of_date', p_as_of_date
    );
end;
$$;

create or replace function public.closing_procedure(
    p_tenant_id uuid,
    p_period_end_date date,
    p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_settings record;
    v_lines jsonb := '[]'::jsonb;
    v_net_income numeric(18,2) := 0;
    v_row record;
    v_journal_id uuid;
    v_entry_count integer;
begin
    if exists (
        select 1
          from public.period_closures
         where tenant_id = p_tenant_id
           and period_end_date = p_period_end_date
    ) then
        return jsonb_build_object('success', false, 'code', 'PERIOD_ALREADY_CLOSED', 'message', 'Financial period has already been closed.');
    end if;

    select *
      into v_settings
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    for v_row in
        select coa.id, coa.account_type, coa.account_name, coalesce(ab.balance, 0)::numeric(18,2) as balance
          from public.chart_of_accounts coa
          left join public.account_balances ab
            on ab.account_id = coa.id
           and ab.tenant_id = coa.tenant_id
         where coa.tenant_id = p_tenant_id
           and coa.deleted_at is null
           and coa.account_type in ('income', 'expense')
           and coalesce(ab.balance, 0) <> 0
    loop
        if v_row.account_type = 'income' then
            v_lines := v_lines || jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_row.id,
                    'debit', v_row.balance,
                    'credit', 0
                )
            );
            v_net_income := v_net_income + v_row.balance;
        else
            v_lines := v_lines || jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_row.id,
                    'debit', 0,
                    'credit', v_row.balance
                )
            );
            v_net_income := v_net_income - v_row.balance;
        end if;
    end loop;

    if jsonb_array_length(v_lines) > 0 then
        if v_net_income <> 0 then
            v_lines := v_lines || jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_settings.default_retained_earnings_account_id,
                    'debit', case when v_net_income < 0 then abs(v_net_income) else 0 end,
                    'credit', case when v_net_income >= 0 then v_net_income else 0 end
                )
            );
        end if;

        v_journal_id := public.post_journal_entry(
            p_tenant_id,
            'CLOSE-' || to_char(p_period_end_date, 'YYYYMMDD'),
            'Period closing entry',
            p_period_end_date,
            p_user_id,
            'closing',
            v_lines
        );
    end if;

    insert into public.daily_account_snapshots (tenant_id, account_id, snapshot_date, balance)
    select tenant_id, account_id, p_period_end_date, balance
      from public.account_balances
     where tenant_id = p_tenant_id
    on conflict (tenant_id, account_id, snapshot_date) do update
        set balance = excluded.balance;

    select count(*)
      into v_entry_count
      from public.journal_entries
     where tenant_id = p_tenant_id
       and entry_date <= p_period_end_date
       and posted = true;

    insert into public.period_closures (tenant_id, period_end_date, closed_by, journal_entries_count)
    values (p_tenant_id, p_period_end_date, p_user_id, v_entry_count);

    return jsonb_build_object(
        'success', true,
        'message', 'Closing procedure completed.',
        'period_end_date', p_period_end_date,
        'journal_id', v_journal_id,
        'journal_entries_count', v_entry_count
    );
end;
$$;

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
    select *
      into v_cycle
      from public.dividend_cycles
     where id = p_cycle_id
     for update;

    if not found then
        return jsonb_build_object('success', false, 'code', 'DIVIDEND_CYCLE_NOT_FOUND', 'message', 'Dividend cycle was not found.');
    end if;

    if v_cycle.status <> 'allocated' then
        return jsonb_build_object('success', false, 'code', 'INVALID_DIVIDEND_STATE', 'message', 'Dividend cycle must be allocated before approval.');
    end if;

    if v_cycle.created_by = p_user_id then
        return jsonb_build_object('success', false, 'code', 'MAKER_CHECKER_VIOLATION', 'message', 'The maker cannot approve the same dividend cycle.');
    end if;

    insert into public.dividend_approvals (
        cycle_id,
        tenant_id,
        approved_by,
        decision,
        notes,
        signature_hash
    )
    values (
        p_cycle_id,
        v_cycle.tenant_id,
        p_user_id,
        'approved',
        p_notes,
        p_signature_hash
    )
    on conflict (cycle_id, approved_by) do nothing;

    select count(*)
      into v_approval_count
      from public.dividend_approvals
     where cycle_id = p_cycle_id
       and decision = 'approved';

    if v_approval_count < v_cycle.required_checker_count then
        return jsonb_build_object(
            'success', true,
            'message', 'Approval recorded. Additional checker approval is still required.',
            'approval_count', v_approval_count,
            'required_checker_count', v_cycle.required_checker_count
        );
    end if;

    for v_component in
        select
            dc.*,
            coalesce(sum(da.payout_amount), 0)::numeric(18,2) as total_payout
          from public.dividend_components dc
          left join public.dividend_allocations da
            on da.component_id = dc.id
           and da.status = 'pending'
         where dc.cycle_id = p_cycle_id
         group by dc.id
    loop
        if v_component.total_payout <= 0 then
            continue;
        end if;

        v_lines := v_lines || jsonb_build_array(
            jsonb_build_object(
                'account_id', v_component.retained_earnings_account_id,
                'debit', v_component.total_payout,
                'credit', 0,
                'branch_id', v_cycle.branch_id
            ),
            jsonb_build_object(
                'account_id', v_component.dividends_payable_account_id,
                'debit', 0,
                'credit', v_component.total_payout,
                'branch_id', v_cycle.branch_id
            )
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

    return jsonb_build_object(
        'success', true,
        'message', 'Dividend cycle approved and liability declared.',
        'approval_count', v_approval_count,
        'journal_id', v_journal_id
    );
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
    select *
      into v_cycle
      from public.dividend_cycles
     where id = p_cycle_id
     for update;

    if not found then
        return jsonb_build_object('success', false, 'code', 'DIVIDEND_CYCLE_NOT_FOUND', 'message', 'Dividend cycle was not found.');
    end if;

    if v_cycle.status <> 'approved' then
        return jsonb_build_object('success', false, 'code', 'INVALID_DIVIDEND_STATE', 'message', 'Dividend cycle must be approved before payment.');
    end if;

    for v_component in
        select
            dc.*,
            coalesce(sum(da.payout_amount), 0)::numeric(18,2) as total_payout
          from public.dividend_components dc
          join public.dividend_allocations da
            on da.component_id = dc.id
           and da.status = 'pending'
         where dc.cycle_id = p_cycle_id
         group by dc.id
    loop
        if v_component.total_payout <= 0 then
            continue;
        end if;

        v_total_amount := v_total_amount + v_component.total_payout;

        v_lines := v_lines || jsonb_build_array(
            jsonb_build_object(
                'account_id', v_component.dividends_payable_account_id,
                'debit', v_component.total_payout,
                'credit', 0,
                'branch_id', v_cycle.branch_id
            )
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
                select *
                  into v_share_account
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
                jsonb_build_object(
                    'account_id', v_component.payout_account_id,
                    'debit', 0,
                    'credit', v_component.total_payout,
                    'branch_id', v_cycle.branch_id
                )
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

    insert into public.dividend_payments (
        id,
        cycle_id,
        tenant_id,
        payment_method,
        total_amount,
        processed_by,
        journal_entry_id,
        reference,
        notes
    )
    values (
        v_payment_id,
        p_cycle_id,
        v_cycle.tenant_id,
        p_payment_method,
        v_total_amount,
        p_user_id,
        v_journal_id,
        p_reference,
        p_description
    );

    if p_payment_method = 'reinvest_to_shares' then
        for v_allocation in
            select da.*, m.branch_id, ma.id as share_account_id
              from public.dividend_allocations da
              join public.members m on m.id = da.member_id
              join public.member_accounts ma
                on ma.member_id = da.member_id
               and ma.tenant_id = da.tenant_id
               and ma.product_type = 'shares'
               and ma.deleted_at is null
             where da.cycle_id = p_cycle_id
               and da.status = 'pending'
        loop
            update public.member_accounts
               set available_balance = available_balance + v_allocation.payout_amount
             where id = v_allocation.share_account_id
             returning available_balance into v_running_balance;

            insert into public.member_account_transactions (
                tenant_id,
                member_account_id,
                branch_id,
                journal_id,
                transaction_type,
                direction,
                amount,
                running_balance,
                reference,
                created_by
            )
            values (
                v_cycle.tenant_id,
                v_allocation.share_account_id,
                v_allocation.branch_id,
                v_journal_id,
                'dividend_allocation',
                'in',
                v_allocation.payout_amount,
                v_running_balance,
                p_reference,
                p_user_id
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

    return jsonb_build_object(
        'success', true,
        'message', 'Dividend payment batch posted successfully.',
        'payment_id', v_payment_id,
        'journal_id', v_journal_id,
        'total_amount', v_total_amount
    );
end;
$$;

grant execute on function public.seed_tenant_defaults(uuid) to service_role;
grant execute on function public.post_journal_entry(uuid, text, text, date, uuid, public.journal_source, jsonb) to service_role;
grant execute on function public.deposit(uuid, uuid, numeric, uuid, text, text) to service_role;
grant execute on function public.withdraw(uuid, uuid, numeric, uuid, text, text) to service_role;
grant execute on function public.transfer(uuid, uuid, uuid, numeric, uuid, text, text) to service_role;
grant execute on function public.share_contribution(uuid, uuid, numeric, uuid, text, text) to service_role;
grant execute on function public.dividend_allocation(uuid, uuid, numeric, uuid, text, text) to service_role;
grant execute on function public.approve_dividend_cycle(uuid, uuid, text, text) to service_role;
grant execute on function public.pay_dividend_cycle(uuid, public.dividend_payment_method, uuid, text, text) to service_role;
grant execute on function public.loan_disburse(uuid, uuid, uuid, numeric, numeric, integer, public.repayment_frequency, uuid, text, text) to service_role;
grant execute on function public.loan_repayment(uuid, uuid, numeric, uuid, text, text) to service_role;
grant execute on function public.interest_accrual(uuid, date, uuid) to service_role;
grant execute on function public.closing_procedure(uuid, date, uuid) to service_role;
