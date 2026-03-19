create or replace function public.appraise_loan_application(
    p_tenant_id uuid,
    p_application_id uuid,
    p_actor_user_id uuid,
    p_appraisal_notes text,
    p_risk_rating text,
    p_recommended_amount numeric,
    p_recommended_term_count integer,
    p_recommended_interest_rate numeric,
    p_recommended_repayment_frequency public.repayment_frequency,
    p_appraised_at timestamptz default timezone('utc', now())
)
returns table (
    ok boolean,
    error_code text,
    error_message text,
    application_id uuid,
    status public.loan_application_status,
    appraised_by uuid,
    appraised_at timestamptz,
    appraisal_notes text,
    risk_rating text,
    recommended_amount numeric,
    recommended_term_count integer,
    recommended_interest_rate numeric,
    recommended_repayment_frequency public.repayment_frequency
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_application public.loan_applications%rowtype;
begin
    if p_tenant_id is null
        or p_application_id is null
        or p_actor_user_id is null
        or nullif(btrim(coalesce(p_appraisal_notes, '')), '') is null
        or nullif(btrim(coalesce(p_risk_rating, '')), '') is null
        or p_recommended_amount is null
        or p_recommended_amount <= 0
        or p_recommended_term_count is null
        or p_recommended_term_count <= 0
        or p_recommended_interest_rate is null
        or p_recommended_interest_rate < 0
        or p_recommended_repayment_frequency is null then
        return query
        select
            false,
            'LOAN_APPLICATION_APPRAISAL_INPUT_INVALID'::text,
            'Appraisal inputs are invalid.'::text,
            null::uuid,
            null::public.loan_application_status,
            null::uuid,
            null::timestamptz,
            null::text,
            null::text,
            null::numeric,
            null::integer,
            null::numeric,
            null::public.repayment_frequency;
        return;
    end if;

    select *
      into v_application
      from public.loan_applications
     where tenant_id = p_tenant_id
       and id = p_application_id
     for update;

    if not found then
        return query
        select
            false,
            'LOAN_APPLICATION_NOT_FOUND'::text,
            'Loan application was not found.'::text,
            null::uuid,
            null::public.loan_application_status,
            null::uuid,
            null::timestamptz,
            null::text,
            null::text,
            null::numeric,
            null::integer,
            null::numeric,
            null::public.repayment_frequency;
        return;
    end if;

    if v_application.status not in ('submitted', 'appraised') then
        return query
        select
            false,
            'LOAN_APPLICATION_NOT_APPRAISABLE'::text,
            'Only submitted applications can be appraised.'::text,
            v_application.id,
            v_application.status,
            v_application.appraised_by,
            v_application.appraised_at,
            v_application.appraisal_notes,
            v_application.risk_rating,
            v_application.recommended_amount,
            v_application.recommended_term_count,
            v_application.recommended_interest_rate,
            v_application.recommended_repayment_frequency;
        return;
    end if;

    update public.loan_applications
       set status = 'appraised',
           appraised_by = p_actor_user_id,
           appraised_at = coalesce(p_appraised_at, timezone('utc', now())),
           appraisal_notes = p_appraisal_notes,
           risk_rating = p_risk_rating,
           recommended_amount = p_recommended_amount,
           recommended_term_count = p_recommended_term_count,
           recommended_interest_rate = p_recommended_interest_rate,
           recommended_repayment_frequency = p_recommended_repayment_frequency
     where tenant_id = p_tenant_id
       and id = p_application_id
     returning *
      into v_application;

    return query
    select
        true,
        null::text,
        null::text,
        v_application.id,
        v_application.status,
        v_application.appraised_by,
        v_application.appraised_at,
        v_application.appraisal_notes,
        v_application.risk_rating,
        v_application.recommended_amount,
        v_application.recommended_term_count,
        v_application.recommended_interest_rate,
        v_application.recommended_repayment_frequency;
end;
$$;

revoke all on function public.appraise_loan_application(uuid, uuid, uuid, text, text, numeric, integer, numeric, public.repayment_frequency, timestamptz) from public;
revoke all on function public.appraise_loan_application(uuid, uuid, uuid, text, text, numeric, integer, numeric, public.repayment_frequency, timestamptz) from anon;
revoke all on function public.appraise_loan_application(uuid, uuid, uuid, text, text, numeric, integer, numeric, public.repayment_frequency, timestamptz) from authenticated;
grant execute on function public.appraise_loan_application(uuid, uuid, uuid, text, text, numeric, integer, numeric, public.repayment_frequency, timestamptz) to service_role;
