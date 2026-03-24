do $$
declare
    tenant_row record;
    v_interest_income_account_id uuid;
    v_loan_fee_income_account_id uuid;
    v_penalty_income_account_id uuid;
begin
    for tenant_row in
        select id
        from public.tenants
        where deleted_at is null
    loop
        update public.chart_of_accounts
           set account_name = 'Loan Fee Income',
               account_type = 'income',
               system_tag = 'loan_fee_income',
               is_system_control = true
         where tenant_id = tenant_row.id
           and account_code = '4040'
           and deleted_at is null
           and not exists (
                select 1
                from public.chart_of_accounts existing
                where existing.tenant_id = tenant_row.id
                  and existing.system_tag = 'loan_fee_income'
                  and existing.deleted_at is null
           );

        insert into public.chart_of_accounts (
            tenant_id,
            account_code,
            account_name,
            account_type,
            system_tag,
            is_system_control
        )
        select
            tenant_row.id,
            '4040',
            'Loan Fee Income',
            'income',
            'loan_fee_income',
            true
        where not exists (
            select 1
            from public.chart_of_accounts coa
            where coa.tenant_id = tenant_row.id
              and coa.system_tag = 'loan_fee_income'
              and coa.deleted_at is null
        )
          and not exists (
            select 1
            from public.chart_of_accounts coa
            where coa.tenant_id = tenant_row.id
              and coa.account_code = '4040'
              and coa.deleted_at is null
        );

        update public.chart_of_accounts
           set account_name = 'Penalty Income',
               account_type = 'income',
               system_tag = 'penalty_income',
               is_system_control = true
         where tenant_id = tenant_row.id
           and account_code = '4050'
           and deleted_at is null
           and not exists (
                select 1
                from public.chart_of_accounts existing
                where existing.tenant_id = tenant_row.id
                  and existing.system_tag = 'penalty_income'
                  and existing.deleted_at is null
           );

        insert into public.chart_of_accounts (
            tenant_id,
            account_code,
            account_name,
            account_type,
            system_tag,
            is_system_control
        )
        select
            tenant_row.id,
            '4050',
            'Penalty Income',
            'income',
            'penalty_income',
            true
        where not exists (
            select 1
            from public.chart_of_accounts coa
            where coa.tenant_id = tenant_row.id
              and coa.system_tag = 'penalty_income'
              and coa.deleted_at is null
        )
          and not exists (
            select 1
            from public.chart_of_accounts coa
            where coa.tenant_id = tenant_row.id
              and coa.account_code = '4050'
              and coa.deleted_at is null
        );

        select id
          into v_interest_income_account_id
          from public.chart_of_accounts
         where tenant_id = tenant_row.id
           and system_tag = 'interest_income'
           and deleted_at is null
         limit 1;

        select id
          into v_loan_fee_income_account_id
          from public.chart_of_accounts
         where tenant_id = tenant_row.id
           and system_tag = 'loan_fee_income'
           and deleted_at is null
         limit 1;

        select id
          into v_penalty_income_account_id
          from public.chart_of_accounts
         where tenant_id = tenant_row.id
           and system_tag = 'penalty_income'
           and deleted_at is null
         limit 1;

        if v_loan_fee_income_account_id is not null then
            update public.loan_products
               set fee_income_account_id = v_loan_fee_income_account_id
             where tenant_id = tenant_row.id
               and deleted_at is null
               and (
                    fee_income_account_id is null
                    or fee_income_account_id = interest_income_account_id
                    or fee_income_account_id = v_interest_income_account_id
                    or fee_income_account_id = v_penalty_income_account_id
               );

            update public.fee_rules
               set income_account_id = v_loan_fee_income_account_id
             where tenant_id = tenant_row.id
               and deleted_at is null
               and fee_type = 'loan_processing_fee'
               and (
                    income_account_id is null
                    or income_account_id = v_interest_income_account_id
                    or income_account_id = v_penalty_income_account_id
               );

            update public.posting_rules
               set credit_account_id = v_loan_fee_income_account_id
             where tenant_id = tenant_row.id
               and deleted_at is null
               and operation_code = 'loan_fee'
               and (
                    credit_account_id is null
                    or credit_account_id = v_interest_income_account_id
                    or credit_account_id = v_penalty_income_account_id
               );
        end if;

        if v_penalty_income_account_id is not null then
            update public.loan_products
               set penalty_income_account_id = v_penalty_income_account_id
             where tenant_id = tenant_row.id
               and deleted_at is null
               and (
                    penalty_income_account_id is null
                    or penalty_income_account_id = interest_income_account_id
                    or penalty_income_account_id = v_interest_income_account_id
                    or penalty_income_account_id = fee_income_account_id
                    or penalty_income_account_id = v_loan_fee_income_account_id
               );

            update public.penalty_rules
               set income_account_id = v_penalty_income_account_id
             where tenant_id = tenant_row.id
               and deleted_at is null
               and (
                    income_account_id is null
                    or income_account_id = v_interest_income_account_id
                    or income_account_id = v_loan_fee_income_account_id
               );

            update public.posting_rules
               set credit_account_id = v_penalty_income_account_id
             where tenant_id = tenant_row.id
               and deleted_at is null
               and operation_code = 'penalty'
               and (
                    credit_account_id is null
                    or credit_account_id = v_interest_income_account_id
                    or credit_account_id = v_loan_fee_income_account_id
               );
        end if;
    end loop;
end $$;

create or replace function public.seed_phase3_defaults(p_tenant_id uuid)
returns void
language plpgsql
as $$
declare
    v_loan_portfolio_account_id uuid;
    v_interest_income_account_id uuid;
    v_loan_fee_income_account_id uuid;
    v_penalty_income_account_id uuid;
begin
    insert into public.chart_of_accounts (
        tenant_id,
        account_code,
        account_name,
        account_type,
        system_tag,
        is_system_control
    )
    values
        (p_tenant_id, '4040', 'Loan Fee Income', 'income', 'loan_fee_income', true),
        (p_tenant_id, '4050', 'Penalty Income', 'income', 'penalty_income', true)
    on conflict do nothing;

    select default_loan_portfolio_account_id, default_interest_income_account_id
      into v_loan_portfolio_account_id, v_interest_income_account_id
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    select id
      into v_loan_fee_income_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'loan_fee_income'
       and deleted_at is null
     limit 1;

    select id
      into v_penalty_income_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'penalty_income'
       and deleted_at is null
     limit 1;

    insert into public.loan_policy_settings (
        tenant_id,
        default_repayment_order,
        require_open_teller_session_for_disbursement,
        multi_approval_required,
        committee_approval_count,
        out_of_policy_requires_notes
    )
    values (
        p_tenant_id,
        '["penalty","fees","interest","principal"]'::jsonb,
        true,
        false,
        1,
        true
    )
    on conflict (tenant_id) do nothing;

    if v_loan_portfolio_account_id is not null
       and v_interest_income_account_id is not null
       and v_loan_fee_income_account_id is not null
       and v_penalty_income_account_id is not null then
        insert into public.loan_products (
            tenant_id,
            code,
            name,
            description,
            interest_method,
            annual_interest_rate,
            min_amount,
            max_amount,
            min_term_count,
            max_term_count,
            insurance_rate,
            required_guarantors_count,
            eligibility_rules_json,
            receivable_account_id,
            interest_income_account_id,
            fee_income_account_id,
            penalty_income_account_id,
            is_default,
            status
        )
        values (
            p_tenant_id,
            'STANDARD',
            'Standard Loan',
            'Default tenant loan product seeded for workflow operations.',
            'reducing_balance',
            18,
            100000,
            10000000,
            1,
            36,
            0,
            1,
            '{"min_membership_months": 3, "requires_active_member": true}'::jsonb,
            v_loan_portfolio_account_id,
            v_interest_income_account_id,
            v_loan_fee_income_account_id,
            v_penalty_income_account_id,
            true,
            'active'
        )
        on conflict (tenant_id, code) where deleted_at is null do nothing;
    end if;
end;
$$;
