alter table public.user_profiles
    add column if not exists two_factor_enabled boolean not null default false,
    add column if not exists two_factor_secret text,
    add column if not exists two_factor_verified boolean not null default false,
    add column if not exists two_factor_backup_codes jsonb,
    add column if not exists two_factor_enabled_at timestamptz,
    add column if not exists two_factor_last_verified_at timestamptz,
    add column if not exists two_factor_failed_attempts integer not null default 0,
    add column if not exists two_factor_locked_until timestamptz;

create index if not exists user_profiles_two_factor_enabled_idx
    on public.user_profiles (tenant_id, two_factor_enabled)
    where deleted_at is null;
