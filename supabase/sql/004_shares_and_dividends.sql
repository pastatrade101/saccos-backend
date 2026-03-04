alter type public.journal_source add value if not exists 'share_contribution';
alter type public.journal_source add value if not exists 'dividend_allocation';

insert into public.chart_of_accounts (tenant_id, account_code, account_name, account_type, system_tag, is_system_control)
select
    t.id,
    '3030',
    'Member Share Capital',
    'equity',
    'member_share_capital_control',
    true
from public.tenants t
where t.deleted_at is null
and not exists (
    select 1
    from public.chart_of_accounts coa
    where coa.tenant_id = t.id
      and coa.system_tag = 'member_share_capital_control'
      and coa.deleted_at is null
);

insert into public.member_accounts (
    tenant_id,
    member_id,
    branch_id,
    account_number,
    account_name,
    product_type,
    status,
    gl_account_id
)
select
    m.tenant_id,
    m.id,
    m.branch_id,
    'SH-' || upper(substr(replace(m.id::text, '-', ''), 1, 10)),
    m.full_name || ' Share Capital',
    'shares',
    'active',
    coa.id
from public.members m
join public.chart_of_accounts coa
  on coa.tenant_id = m.tenant_id
 and coa.system_tag = 'member_share_capital_control'
 and coa.deleted_at is null
where m.deleted_at is null
and not exists (
    select 1
    from public.member_accounts ma
    where ma.member_id = m.id
      and ma.product_type = 'shares'
      and ma.deleted_at is null
);

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

grant execute on function public.share_contribution(uuid, uuid, numeric, uuid, text, text) to service_role;
grant execute on function public.dividend_allocation(uuid, uuid, numeric, uuid, text, text) to service_role;
