DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'penalty_frequency'
    ) THEN
        CREATE TYPE public.penalty_frequency AS ENUM ('one_time', 'daily', 'weekly', 'monthly', 'per_repayment_period');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'penalty_calculation_base'
    ) THEN
        CREATE TYPE public.penalty_calculation_base AS ENUM ('overdue_instalment', 'outstanding_balance', 'total_loan_amount', 'principal_only');
    END IF;
END
$$;

alter type public.penalty_rule_type add value if not exists 'missed_instalment';
alter type public.penalty_rule_type add value if not exists 'loan_default';

alter table public.penalty_rules
    add column if not exists grace_period_days integer not null default 0,
    add column if not exists penalty_frequency public.penalty_frequency not null default 'per_repayment_period',
    add column if not exists calculation_base public.penalty_calculation_base not null default 'overdue_instalment',
    add column if not exists max_penalty_amount numeric(18,2),
    add column if not exists max_penalty_percent numeric(5,2),
    add column if not exists compound_penalty boolean not null default false,
    add column if not exists penalty_receivable_account_id uuid references public.chart_of_accounts (id),
    add column if not exists effective_from date,
    add column if not exists effective_to date,
    add column if not exists penalty_waivable boolean not null default true;
