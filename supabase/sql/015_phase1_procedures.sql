create or replace function public.seed_phase1_defaults(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cash_account_id uuid;
    v_savings_control_account_id uuid;
    v_share_capital_account_id uuid;
    v_loan_portfolio_account_id uuid;
    v_interest_income_account_id uuid;
    v_retained_earnings_account_id uuid;
    v_dividends_payable_account_id uuid;
    v_membership_fee_income_account_id uuid;
    v_withdrawal_fee_income_account_id uuid;
    v_loan_fee_income_account_id uuid;
    v_penalty_income_account_id uuid;
begin
    select
        default_cash_account_id,
        default_member_savings_control_account_id,
        default_loan_portfolio_account_id,
        default_interest_income_account_id,
        default_retained_earnings_account_id
    into
        v_cash_account_id,
        v_savings_control_account_id,
        v_loan_portfolio_account_id,
        v_interest_income_account_id,
        v_retained_earnings_account_id
    from public.tenant_settings
    where tenant_id = p_tenant_id;

    select id
      into v_share_capital_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'member_share_capital_control'
       and deleted_at is null
     limit 1;

    select id
      into v_dividends_payable_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'dividends_payable'
       and deleted_at is null
     limit 1;

    insert into public.chart_of_accounts (
        tenant_id,
        account_code,
        account_name,
        account_type,
        system_tag,
        is_system_control
    )
    values
        (p_tenant_id, '4020', 'Membership Fee Income', 'income', 'membership_fee_income', true),
        (p_tenant_id, '4030', 'Withdrawal Fee Income', 'income', 'withdrawal_fee_income', true),
        (p_tenant_id, '4040', 'Loan Fee Income', 'income', 'loan_fee_income', true),
        (p_tenant_id, '4050', 'Penalty Income', 'income', 'penalty_income', true)
    on conflict (tenant_id, account_code)
    where deleted_at is null
    do update
        set account_name = excluded.account_name,
            account_type = excluded.account_type,
            system_tag = excluded.system_tag,
            is_system_control = excluded.is_system_control,
            updated_at = now();

    select id into v_membership_fee_income_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'membership_fee_income'
       and deleted_at is null
     limit 1;

    select id into v_withdrawal_fee_income_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'withdrawal_fee_income'
       and deleted_at is null
     limit 1;

    select id into v_loan_fee_income_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'loan_fee_income'
       and deleted_at is null
     limit 1;

    select id into v_penalty_income_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'penalty_income'
       and deleted_at is null
     limit 1;

    insert into public.savings_products (
        tenant_id,
        code,
        name,
        is_compulsory,
        is_default,
        min_opening_balance,
        min_balance,
        withdrawal_notice_days,
        allow_withdrawals,
        liability_account_id,
        fee_income_account_id
    )
    values (
        p_tenant_id,
        'SAV-CORE',
        'Core Savings',
        true,
        true,
        0,
        0,
        0,
        true,
        v_savings_control_account_id,
        v_withdrawal_fee_income_account_id
    )
    on conflict (tenant_id, code)
    where deleted_at is null
    do update
        set is_compulsory = excluded.is_compulsory,
            is_default = excluded.is_default,
            min_opening_balance = excluded.min_opening_balance,
            min_balance = excluded.min_balance,
            withdrawal_notice_days = excluded.withdrawal_notice_days,
            allow_withdrawals = excluded.allow_withdrawals,
            liability_account_id = excluded.liability_account_id,
            fee_income_account_id = excluded.fee_income_account_id,
            updated_at = now();

    insert into public.share_products (
        tenant_id,
        code,
        name,
        is_compulsory,
        is_default,
        minimum_shares,
        allow_refund,
        equity_account_id
    )
    values (
        p_tenant_id,
        'SHR-CORE',
        'Core Share Capital',
        true,
        true,
        0,
        false,
        v_share_capital_account_id
    )
    on conflict (tenant_id, code)
    where deleted_at is null
    do update
        set is_compulsory = excluded.is_compulsory,
            is_default = excluded.is_default,
            minimum_shares = excluded.minimum_shares,
            allow_refund = excluded.allow_refund,
            equity_account_id = excluded.equity_account_id,
            updated_at = now();

    insert into public.fee_rules (
        tenant_id,
        code,
        name,
        fee_type,
        calculation_method,
        flat_amount,
        income_account_id
    )
    values
        (p_tenant_id, 'MEMBERSHIP_FEE', 'Membership Fee', 'membership_fee', 'flat', 10000, v_membership_fee_income_account_id),
        (p_tenant_id, 'WITHDRAWAL_FEE', 'Withdrawal Fee', 'withdrawal_fee', 'flat', 0, v_withdrawal_fee_income_account_id),
        (p_tenant_id, 'LOAN_PROCESSING_FEE', 'Loan Processing Fee', 'loan_processing_fee', 'flat', 0, v_loan_fee_income_account_id)
    on conflict (tenant_id, code)
    where deleted_at is null
    do update
        set name = excluded.name,
            fee_type = excluded.fee_type,
            calculation_method = excluded.calculation_method,
            flat_amount = excluded.flat_amount,
            income_account_id = excluded.income_account_id,
            updated_at = now();

    insert into public.penalty_rules (
        tenant_id,
        code,
        name,
        penalty_type,
        calculation_method,
        flat_amount,
        percentage_value,
        income_account_id
    )
    values (
        p_tenant_id,
        'LATE_REPAYMENT',
        'Late Repayment Penalty',
        'late_repayment',
        'percentage_per_period',
        0,
        2,
        v_penalty_income_account_id
    )
    on conflict (tenant_id, code)
    where deleted_at is null
    do update
        set name = excluded.name,
            penalty_type = excluded.penalty_type,
            calculation_method = excluded.calculation_method,
            flat_amount = excluded.flat_amount,
            percentage_value = excluded.percentage_value,
            income_account_id = excluded.income_account_id,
            updated_at = now();

    insert into public.posting_rules (
        tenant_id,
        operation_code,
        scope,
        description,
        debit_account_id,
        credit_account_id,
        is_active
    )
    values
        (p_tenant_id, 'deposit', 'savings', 'Savings deposit posting', v_cash_account_id, v_savings_control_account_id, true),
        (p_tenant_id, 'withdrawal', 'savings', 'Savings withdrawal posting', v_savings_control_account_id, v_cash_account_id, true),
        (p_tenant_id, 'membership_fee', 'membership', 'Membership fee collection', v_cash_account_id, v_membership_fee_income_account_id, true),
        (p_tenant_id, 'share_purchase', 'shares', 'Share purchase posting', v_cash_account_id, v_share_capital_account_id, true),
        (p_tenant_id, 'share_refund', 'shares', 'Share refund posting', v_share_capital_account_id, v_cash_account_id, true),
        (p_tenant_id, 'loan_disburse', 'loans', 'Loan disbursement posting', v_loan_portfolio_account_id, v_cash_account_id, true),
        (p_tenant_id, 'loan_repay_principal', 'loans', 'Loan principal repayment posting', v_cash_account_id, v_loan_portfolio_account_id, true),
        (p_tenant_id, 'loan_repay_interest', 'loans', 'Loan interest repayment posting', v_cash_account_id, v_interest_income_account_id, true),
        (p_tenant_id, 'loan_fee', 'loans', 'Loan fee posting', v_cash_account_id, v_loan_fee_income_account_id, true),
        (p_tenant_id, 'penalty', 'loans', 'Penalty posting', v_cash_account_id, v_penalty_income_account_id, true),
        (p_tenant_id, 'dividend_declare', 'dividends', 'Dividend declaration posting', v_retained_earnings_account_id, v_dividends_payable_account_id, true),
        (p_tenant_id, 'dividend_pay_cash', 'dividends', 'Dividend cash payment posting', v_dividends_payable_account_id, v_cash_account_id, true),
        (p_tenant_id, 'dividend_reinvest_shares', 'dividends', 'Dividend reinvestment posting', v_dividends_payable_account_id, v_share_capital_account_id, true)
    on conflict (tenant_id, operation_code)
    where deleted_at is null
    do update
        set scope = excluded.scope,
            description = excluded.description,
            debit_account_id = excluded.debit_account_id,
            credit_account_id = excluded.credit_account_id,
            is_active = excluded.is_active,
            updated_at = now();
end;
$$;

create or replace function public.post_membership_fee(
    p_tenant_id uuid,
    p_member_id uuid,
    p_branch_id uuid,
    p_amount numeric,
    p_user_id uuid,
    p_reference text default null,
    p_description text default null,
    p_entry_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rule record;
    v_journal_id uuid;
begin
    if coalesce(p_amount, 0) <= 0 then
        raise exception 'Membership fee amount must be greater than zero';
    end if;

    select *
      into v_rule
      from public.posting_rules
     where tenant_id = p_tenant_id
       and operation_code = 'membership_fee'
       and is_active = true
       and deleted_at is null
     limit 1;

    if not found then
        raise exception 'Posting rule membership_fee is not configured for tenant %', p_tenant_id;
    end if;

    v_journal_id := public.post_journal_entry(
        p_tenant_id,
        coalesce(p_reference, 'MEMBERSHIP_FEE'),
        coalesce(p_description, 'Membership fee payment'),
        p_entry_date,
        p_user_id,
        'membership_fee',
        jsonb_build_array(
            jsonb_build_object(
                'account_id', v_rule.debit_account_id,
                'debit', p_amount,
                'branch_id', p_branch_id
            ),
            jsonb_build_object(
                'account_id', v_rule.credit_account_id,
                'credit', p_amount,
                'branch_id', p_branch_id
            )
        )
    );

    return v_journal_id;
end;
$$;
