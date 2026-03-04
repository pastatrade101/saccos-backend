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
