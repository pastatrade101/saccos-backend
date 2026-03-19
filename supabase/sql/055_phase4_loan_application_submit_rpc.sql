create or replace function public.submit_loan_application(
    p_tenant_id uuid,
    p_application_id uuid,
    p_actor_user_id uuid,
    p_submitted_at timestamptz default timezone('utc', now())
)
returns table (
    ok boolean,
    error_code text,
    error_message text,
    application_id uuid,
    status public.loan_application_status,
    submitted_at timestamptz,
    approval_count integer,
    required_approval_count integer,
    approved_by uuid,
    approved_at timestamptz,
    rejected_by uuid,
    rejected_at timestamptz,
    rejection_reason text,
    disbursement_ready_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_application public.loan_applications%rowtype;
begin
    if p_tenant_id is null or p_application_id is null or p_actor_user_id is null then
        return query
        select
            false,
            'LOAN_APPLICATION_SUBMISSION_INPUT_INVALID'::text,
            'Tenant, application, and actor are required.'::text,
            null::uuid,
            null::public.loan_application_status,
            null::timestamptz,
            null::integer,
            null::integer,
            null::uuid,
            null::timestamptz,
            null::uuid,
            null::timestamptz,
            null::text,
            null::timestamptz;
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
            null::timestamptz,
            null::integer,
            null::integer,
            null::uuid,
            null::timestamptz,
            null::uuid,
            null::timestamptz,
            null::text,
            null::timestamptz;
        return;
    end if;

    if v_application.status not in ('draft', 'rejected') then
        return query
        select
            false,
            'LOAN_APPLICATION_NOT_SUBMITTABLE'::text,
            'Only draft or rejected applications can be submitted.'::text,
            v_application.id,
            v_application.status,
            v_application.submitted_at,
            v_application.approval_count,
            v_application.required_approval_count,
            v_application.approved_by,
            v_application.approved_at,
            v_application.rejected_by,
            v_application.rejected_at,
            v_application.rejection_reason,
            v_application.disbursement_ready_at;
        return;
    end if;

    update public.loan_applications
       set status = 'submitted',
           submitted_at = coalesce(p_submitted_at, timezone('utc', now())),
           rejection_reason = null,
           rejected_at = null,
           rejected_by = null,
           approval_count = 0,
           approval_notes = null,
           approved_by = null,
           approved_at = null,
           disbursement_ready_at = null
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
        v_application.submitted_at,
        v_application.approval_count,
        v_application.required_approval_count,
        v_application.approved_by,
        v_application.approved_at,
        v_application.rejected_by,
        v_application.rejected_at,
        v_application.rejection_reason,
        v_application.disbursement_ready_at;
end;
$$;

revoke all on function public.submit_loan_application(uuid, uuid, uuid, timestamptz) from public;
revoke all on function public.submit_loan_application(uuid, uuid, uuid, timestamptz) from anon;
revoke all on function public.submit_loan_application(uuid, uuid, uuid, timestamptz) from authenticated;
grant execute on function public.submit_loan_application(uuid, uuid, uuid, timestamptz) to service_role;
