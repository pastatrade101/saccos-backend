create or replace function public.consume_otp_challenge_attempt(
    p_challenge_id uuid,
    p_user_id uuid,
    p_purpose text,
    p_is_valid boolean,
    p_now timestamptz default timezone('utc', now())
)
returns table (
    status text,
    attempt_count integer,
    max_attempts integer,
    expires_at timestamptz,
    consumed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row public.auth_otp_challenges%rowtype;
    v_now timestamptz := coalesce(p_now, timezone('utc', now()));
begin
    if p_challenge_id is null or p_user_id is null or btrim(coalesce(p_purpose, '')) = '' then
        raise exception 'p_challenge_id, p_user_id and p_purpose are required' using errcode = '22023';
    end if;

    select *
      into v_row
      from public.auth_otp_challenges
     where id = p_challenge_id
       and user_id = p_user_id
       and purpose = p_purpose
     for update;

    if not found then
        return query
        select 'not_found'::text, 0::integer, 0::integer, null::timestamptz, null::timestamptz;
        return;
    end if;

    if v_row.consumed_at is not null then
        return query
        select 'already_used'::text, v_row.attempt_count, v_row.max_attempts, v_row.expires_at, v_row.consumed_at;
        return;
    end if;

    if v_row.expires_at <= v_now then
        return query
        select 'expired'::text, v_row.attempt_count, v_row.max_attempts, v_row.expires_at, v_row.consumed_at;
        return;
    end if;

    if v_row.attempt_count >= v_row.max_attempts then
        return query
        select 'attempts_exceeded'::text, v_row.attempt_count, v_row.max_attempts, v_row.expires_at, v_row.consumed_at;
        return;
    end if;

    if coalesce(p_is_valid, false) is false then
        update public.auth_otp_challenges
           set attempt_count = attempt_count + 1,
               last_attempt_at = v_now
         where id = v_row.id
        returning *
             into v_row;

        return query
        select 'invalid'::text, v_row.attempt_count, v_row.max_attempts, v_row.expires_at, v_row.consumed_at;
        return;
    end if;

    update public.auth_otp_challenges
       set verified_at = v_now,
           consumed_at = v_now,
           last_attempt_at = v_now
     where id = v_row.id
    returning *
         into v_row;

    return query
    select 'verified'::text, v_row.attempt_count, v_row.max_attempts, v_row.expires_at, v_row.consumed_at;
end;
$$;

revoke all on function public.consume_otp_challenge_attempt(uuid, uuid, text, boolean, timestamptz) from public;
revoke all on function public.consume_otp_challenge_attempt(uuid, uuid, text, boolean, timestamptz) from anon;
revoke all on function public.consume_otp_challenge_attempt(uuid, uuid, text, boolean, timestamptz) from authenticated;
grant execute on function public.consume_otp_challenge_attempt(uuid, uuid, text, boolean, timestamptz) to service_role;
