-- OTP challenge storage for secure SMS verification.

begin;

create table if not exists public.auth_otp_challenges (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    phone text not null,
    purpose text not null default 'signin',
    otp_hash text not null,
    reference text not null,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    max_attempts integer not null default 5 check (max_attempts > 0),
    resend_count integer not null default 0 check (resend_count >= 0),
    last_sent_at timestamptz not null default timezone('utc', now()),
    last_attempt_at timestamptz,
    expires_at timestamptz not null,
    verified_at timestamptz,
    consumed_at timestamptz,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists auth_otp_challenges_user_purpose_created_idx
    on public.auth_otp_challenges (user_id, purpose, created_at desc);

create index if not exists auth_otp_challenges_expires_idx
    on public.auth_otp_challenges (expires_at);

create index if not exists auth_otp_challenges_active_idx
    on public.auth_otp_challenges (purpose, phone)
    where consumed_at is null;

commit;

-- Refresh PostgREST schema cache in Supabase API.
select pg_notify('pgrst', 'reload schema');
