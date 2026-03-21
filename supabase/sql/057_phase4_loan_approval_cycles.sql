alter table public.loan_applications
    add column if not exists approval_cycle integer;

update public.loan_applications
   set approval_cycle = case
       when approval_cycle is not null then approval_cycle
       when submitted_at is null and status = 'draft' then 0
       else 1
   end;

alter table public.loan_applications
    alter column approval_cycle set default 0;

alter table public.loan_applications
    alter column approval_cycle set not null;

alter table public.loan_applications
    drop constraint if exists loan_applications_approval_cycle_check;

alter table public.loan_applications
    add constraint loan_applications_approval_cycle_check
    check (approval_cycle >= 0);

alter table public.loan_approvals
    add column if not exists approval_cycle integer;

update public.loan_approvals la
   set approval_cycle = coalesce(la.approval_cycle, nullif(app.approval_cycle, 0), 1)
  from public.loan_applications app
 where app.id = la.application_id;

update public.loan_approvals
   set approval_cycle = 1
 where approval_cycle is null;

alter table public.loan_approvals
    alter column approval_cycle set default 1;

alter table public.loan_approvals
    alter column approval_cycle set not null;

alter table public.loan_approvals
    drop constraint if exists loan_approvals_approval_cycle_check;

alter table public.loan_approvals
    add constraint loan_approvals_approval_cycle_check
    check (approval_cycle > 0);

alter table public.loan_approvals
    drop constraint if exists loan_approvals_application_id_approver_id_key;

alter table public.loan_approvals
    drop constraint if exists loan_approvals_application_id_approval_cycle_approver_id_key;

alter table public.loan_approvals
    add constraint loan_approvals_application_id_approval_cycle_approver_id_key
    unique (application_id, approval_cycle, approver_id);

drop index if exists public.loan_approvals_application_idx;
create index if not exists loan_approvals_application_cycle_idx
    on public.loan_approvals (application_id, approval_cycle, created_at desc);

drop index if exists public.loan_approvals_tenant_application_created_idx;
create index if not exists loan_approvals_tenant_application_cycle_created_idx
    on public.loan_approvals (tenant_id, application_id, approval_cycle, created_at desc);

drop function if exists public.submit_loan_application(uuid, uuid, uuid, timestamptz);
drop function if exists public.appraise_loan_application(uuid, uuid, uuid, text, text, numeric, integer, numeric, public.repayment_frequency, timestamptz);
drop function if exists public.approve_loan_application(uuid, uuid, uuid, text, timestamptz);
drop function if exists public.reject_loan_application(uuid, uuid, uuid, text, text, timestamptz);

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
    approval_cycle integer,
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
#variable_conflict use_column
declare
    v_application public.loan_applications%rowtype;
    v_next_cycle integer := 1;
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
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.approved_by,
            v_application.approved_at,
            v_application.rejected_by,
            v_application.rejected_at,
            v_application.rejection_reason,
            v_application.disbursement_ready_at;
        return;
    end if;

    v_next_cycle := case
        when coalesce(v_application.approval_cycle, 0) > 0 then v_application.approval_cycle + 1
        else 1
    end;

    update public.loan_applications
       set status = 'submitted',
           submitted_at = coalesce(p_submitted_at, timezone('utc', now())),
           approval_count = 0,
           approval_cycle = v_next_cycle,
           approval_notes = null,
           approved_by = null,
           approved_at = null,
           rejected_by = null,
           rejected_at = null,
           rejection_reason = null,
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
        v_application.approval_cycle,
        v_application.required_approval_count,
        v_application.approved_by,
        v_application.approved_at,
        v_application.rejected_by,
        v_application.rejected_at,
        v_application.rejection_reason,
        v_application.disbursement_ready_at;
end;
$$;

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
    approval_cycle integer,
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
#variable_conflict use_column
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
            null::integer,
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
            null::integer,
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
            v_application.approval_cycle,
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
        v_application.approval_cycle,
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

create or replace function public.approve_loan_application(
    p_tenant_id uuid,
    p_application_id uuid,
    p_actor_user_id uuid,
    p_notes text default null,
    p_decided_at timestamptz default timezone('utc', now())
)
returns table (
    ok boolean,
    error_code text,
    error_message text,
    application_id uuid,
    status public.loan_application_status,
    approval_count integer,
    approval_cycle integer,
    required_approval_count integer,
    approved_by uuid,
    approved_at timestamptz,
    disbursement_ready_at timestamptz,
    awaiting_additional_approvals boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
    v_application public.loan_applications%rowtype;
    v_actor_decision public.loan_approval_decision;
    v_current_cycle integer := 1;
    v_current_cycle_approved_count integer := 0;
    v_next_approval_count integer := 0;
    v_enough_approvals boolean := false;
    v_rows_inserted integer := 0;
begin
    if p_tenant_id is null or p_application_id is null or p_actor_user_id is null then
        return query
        select
            false,
            'LOAN_APPLICATION_APPROVAL_INPUT_INVALID'::text,
            'Tenant, application, and actor are required.'::text,
            null::uuid,
            null::public.loan_application_status,
            null::integer,
            null::integer,
            null::integer,
            null::uuid,
            null::timestamptz,
            null::timestamptz,
            null::boolean;
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
            null::integer,
            null::integer,
            null::integer,
            null::uuid,
            null::timestamptz,
            null::timestamptz,
            null::boolean;
        return;
    end if;

    if v_application.status not in ('appraised', 'approved') then
        return query
        select
            false,
            'LOAN_APPLICATION_NOT_APPROVABLE'::text,
            'Only appraised applications can be approved.'::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.approved_by,
            v_application.approved_at,
            v_application.disbursement_ready_at,
            null::boolean;
        return;
    end if;

    if v_application.requested_by = p_actor_user_id then
        return query
        select
            false,
            'MAKER_CHECKER_VIOLATION'::text,
            'The application maker cannot approve the same application.'::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.approved_by,
            v_application.approved_at,
            v_application.disbursement_ready_at,
            null::boolean;
        return;
    end if;

    v_current_cycle := greatest(coalesce(v_application.approval_cycle, 0), 1);

    select la.decision
      into v_actor_decision
      from public.loan_approvals la
     where la.application_id = p_application_id
       and la.approval_cycle = v_current_cycle
       and la.approver_id = p_actor_user_id
     order by la.created_at desc
     limit 1;

    if v_actor_decision = 'approved' then
        return query
        select
            false,
            'LOAN_APPLICATION_ALREADY_APPROVED'::text,
            'You already recorded an approval for this application.'::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.approved_by,
            v_application.approved_at,
            v_application.disbursement_ready_at,
            null::boolean;
        return;
    end if;

    if v_actor_decision = 'rejected' then
        return query
        select
            false,
            'LOAN_APPLICATION_ALREADY_REJECTED'::text,
            'You already recorded a rejection for this application.'::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.approved_by,
            v_application.approved_at,
            v_application.disbursement_ready_at,
            null::boolean;
        return;
    end if;

    select count(*)::integer
      into v_current_cycle_approved_count
      from public.loan_approvals la
     where la.application_id = p_application_id
       and la.approval_cycle = v_current_cycle
       and la.decision = 'approved';

    insert into public.loan_approvals (
        application_id,
        tenant_id,
        approval_cycle,
        approver_id,
        approval_level,
        decision,
        notes,
        created_at
    )
    values (
        p_application_id,
        p_tenant_id,
        v_current_cycle,
        p_actor_user_id,
        v_current_cycle_approved_count + 1,
        'approved',
        p_notes,
        coalesce(p_decided_at, timezone('utc', now()))
    )
    on conflict (application_id, approval_cycle, approver_id) do nothing;

    get diagnostics v_rows_inserted = row_count;

    if v_rows_inserted = 0 then
        select la.decision
          into v_actor_decision
          from public.loan_approvals la
         where la.application_id = p_application_id
           and la.approval_cycle = v_current_cycle
           and la.approver_id = p_actor_user_id
         order by la.created_at desc
         limit 1;

        return query
        select
            false,
            case
                when v_actor_decision = 'approved' then 'LOAN_APPLICATION_ALREADY_APPROVED'
                when v_actor_decision = 'rejected' then 'LOAN_APPLICATION_ALREADY_REJECTED'
                else 'LOAN_APPLICATION_APPROVAL_LOG_FAILED'
            end::text,
            case
                when v_actor_decision = 'approved' then 'You already recorded an approval for this application.'
                when v_actor_decision = 'rejected' then 'You already recorded a rejection for this application.'
                else 'Unable to record the loan approval.'
            end::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.approved_by,
            v_application.approved_at,
            v_application.disbursement_ready_at,
            null::boolean;
        return;
    end if;

    v_next_approval_count := v_current_cycle_approved_count + 1;
    v_enough_approvals := v_next_approval_count >= coalesce(v_application.required_approval_count, 1);

    update public.loan_applications
       set approval_count = v_next_approval_count,
           approval_cycle = v_current_cycle,
           approval_notes = coalesce(p_notes, approval_notes),
           status = (case when v_enough_approvals then 'approved' else 'appraised' end)::public.loan_application_status,
           approved_by = case when v_enough_approvals then p_actor_user_id else approved_by end,
           approved_at = case when v_enough_approvals then coalesce(p_decided_at, timezone('utc', now())) else approved_at end,
           disbursement_ready_at = case when v_enough_approvals then coalesce(p_decided_at, timezone('utc', now())) else disbursement_ready_at end
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
        v_application.approval_count,
        v_application.approval_cycle,
        v_application.required_approval_count,
        v_application.approved_by,
        v_application.approved_at,
        v_application.disbursement_ready_at,
        not v_enough_approvals;
end;
$$;

create or replace function public.reject_loan_application(
    p_tenant_id uuid,
    p_application_id uuid,
    p_actor_user_id uuid,
    p_reason text,
    p_notes text default null,
    p_decided_at timestamptz default timezone('utc', now())
)
returns table (
    ok boolean,
    error_code text,
    error_message text,
    application_id uuid,
    status public.loan_application_status,
    approval_count integer,
    approval_cycle integer,
    required_approval_count integer,
    rejected_by uuid,
    rejected_at timestamptz,
    rejection_reason text,
    approval_notes text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
    v_application public.loan_applications%rowtype;
    v_actor_decision public.loan_approval_decision;
    v_current_cycle integer := 1;
    v_current_cycle_approved_count integer := 0;
    v_rows_inserted integer := 0;
begin
    if p_tenant_id is null or p_application_id is null or p_actor_user_id is null or nullif(btrim(coalesce(p_reason, '')), '') is null then
        return query
        select
            false,
            'LOAN_APPLICATION_REJECTION_INPUT_INVALID'::text,
            'Tenant, application, actor, and rejection reason are required.'::text,
            null::uuid,
            null::public.loan_application_status,
            null::integer,
            null::integer,
            null::integer,
            null::uuid,
            null::timestamptz,
            null::text,
            null::text;
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
            null::integer,
            null::integer,
            null::integer,
            null::uuid,
            null::timestamptz,
            null::text,
            null::text;
        return;
    end if;

    if v_application.status not in ('submitted', 'appraised', 'approved') then
        return query
        select
            false,
            'LOAN_APPLICATION_NOT_REJECTABLE'::text,
            'Only submitted, appraised, or approved applications can be rejected.'::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.rejected_by,
            v_application.rejected_at,
            v_application.rejection_reason,
            v_application.approval_notes;
        return;
    end if;

    if v_application.requested_by = p_actor_user_id then
        return query
        select
            false,
            'MAKER_CHECKER_VIOLATION'::text,
            'The application maker cannot reject the same application.'::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.rejected_by,
            v_application.rejected_at,
            v_application.rejection_reason,
            v_application.approval_notes;
        return;
    end if;

    v_current_cycle := greatest(coalesce(v_application.approval_cycle, 0), 1);

    select la.decision
      into v_actor_decision
      from public.loan_approvals la
     where la.application_id = p_application_id
       and la.approval_cycle = v_current_cycle
       and la.approver_id = p_actor_user_id
     order by la.created_at desc
     limit 1;

    if v_actor_decision = 'rejected' then
        return query
        select
            false,
            'LOAN_APPLICATION_ALREADY_REJECTED'::text,
            'You already recorded a rejection for this application.'::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.rejected_by,
            v_application.rejected_at,
            v_application.rejection_reason,
            v_application.approval_notes;
        return;
    end if;

    if v_actor_decision = 'approved' then
        return query
        select
            false,
            'LOAN_APPLICATION_ALREADY_APPROVED'::text,
            'You already recorded an approval for this application.'::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.rejected_by,
            v_application.rejected_at,
            v_application.rejection_reason,
            v_application.approval_notes;
        return;
    end if;

    select count(*)::integer
      into v_current_cycle_approved_count
      from public.loan_approvals la
     where la.application_id = p_application_id
       and la.approval_cycle = v_current_cycle
       and la.decision = 'approved';

    insert into public.loan_approvals (
        application_id,
        tenant_id,
        approval_cycle,
        approver_id,
        approval_level,
        decision,
        notes,
        created_at
    )
    values (
        p_application_id,
        p_tenant_id,
        v_current_cycle,
        p_actor_user_id,
        v_current_cycle_approved_count + 1,
        'rejected',
        coalesce(p_notes, p_reason),
        coalesce(p_decided_at, timezone('utc', now()))
    )
    on conflict (application_id, approval_cycle, approver_id) do nothing;

    get diagnostics v_rows_inserted = row_count;

    if v_rows_inserted = 0 then
        select la.decision
          into v_actor_decision
          from public.loan_approvals la
         where la.application_id = p_application_id
           and la.approval_cycle = v_current_cycle
           and la.approver_id = p_actor_user_id
         order by la.created_at desc
         limit 1;

        return query
        select
            false,
            case
                when v_actor_decision = 'rejected' then 'LOAN_APPLICATION_ALREADY_REJECTED'
                when v_actor_decision = 'approved' then 'LOAN_APPLICATION_ALREADY_APPROVED'
                else 'LOAN_APPLICATION_REJECTION_LOG_FAILED'
            end::text,
            case
                when v_actor_decision = 'rejected' then 'You already recorded a rejection for this application.'
                when v_actor_decision = 'approved' then 'You already recorded an approval for this application.'
                else 'Unable to record the loan rejection.'
            end::text,
            v_application.id,
            v_application.status,
            v_application.approval_count,
            v_application.approval_cycle,
            v_application.required_approval_count,
            v_application.rejected_by,
            v_application.rejected_at,
            v_application.rejection_reason,
            v_application.approval_notes;
        return;
    end if;

    update public.loan_applications
       set status = 'rejected',
           approval_cycle = v_current_cycle,
           rejection_reason = p_reason,
           rejected_at = coalesce(p_decided_at, timezone('utc', now())),
           rejected_by = p_actor_user_id,
           approval_notes = coalesce(p_notes, approval_notes),
           disbursement_ready_at = null,
           approved_by = null,
           approved_at = null
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
        v_application.approval_count,
        v_application.approval_cycle,
        v_application.required_approval_count,
        v_application.rejected_by,
        v_application.rejected_at,
        v_application.rejection_reason,
        v_application.approval_notes;
end;
$$;
