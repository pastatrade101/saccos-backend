DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'savings_interest_method'
    ) THEN
        CREATE TYPE public.savings_interest_method AS ENUM ('daily_balance', 'average_balance', 'monthly_balance');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'withdrawal_fee_type'
    ) THEN
        CREATE TYPE public.withdrawal_fee_type AS ENUM ('flat', 'percentage');
    END IF;
END
$$;

ALTER TABLE public.savings_products
    ADD COLUMN IF NOT EXISTS annual_interest_rate numeric(9,4) not null default 0 check (annual_interest_rate >= 0 AND annual_interest_rate <= 100),
    ADD COLUMN IF NOT EXISTS interest_calculation_method public.savings_interest_method not null default 'daily_balance',
    ADD COLUMN IF NOT EXISTS interest_expense_account_id uuid references public.chart_of_accounts (id),
    ADD COLUMN IF NOT EXISTS withdrawal_fee_type public.withdrawal_fee_type not null default 'flat',
    ADD COLUMN IF NOT EXISTS withdrawal_fee_amount numeric(18,2) check (withdrawal_fee_amount is null or withdrawal_fee_amount >= 0),
    ADD COLUMN IF NOT EXISTS withdrawal_fee_percent numeric(9,4) check (withdrawal_fee_percent is null or (withdrawal_fee_percent >= 0 AND withdrawal_fee_percent <= 100)),
    ADD COLUMN IF NOT EXISTS maximum_account_balance numeric(18,2) check (maximum_account_balance is null or maximum_account_balance >= 0),
    ADD COLUMN IF NOT EXISTS minimum_withdrawal_amount numeric(18,2) check (minimum_withdrawal_amount is null or minimum_withdrawal_amount >= 0),
    ADD COLUMN IF NOT EXISTS maximum_withdrawal_amount numeric(18,2) check (maximum_withdrawal_amount is null or maximum_withdrawal_amount >= 0),
    ADD COLUMN IF NOT EXISTS dormant_after_days integer check (dormant_after_days is null or dormant_after_days >= 0),
    ADD COLUMN IF NOT EXISTS account_opening_fee numeric(18,2) check (account_opening_fee is null or account_opening_fee >= 0);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_min_opening_balance_non_negative'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_min_opening_balance_non_negative CHECK (min_opening_balance >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_min_balance_non_negative'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_min_balance_non_negative CHECK (min_balance >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_min_balance_le_min_opening'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_min_balance_le_min_opening CHECK (min_balance <= min_opening_balance);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_withdrawal_notice_days_non_negative'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_withdrawal_notice_days_non_negative CHECK (withdrawal_notice_days >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_withdrawal_fee_amount_non_negative'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_withdrawal_fee_amount_non_negative CHECK (withdrawal_fee_amount IS NULL OR withdrawal_fee_amount >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_maximum_account_balance_non_negative'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_maximum_account_balance_non_negative CHECK (maximum_account_balance IS NULL OR maximum_account_balance >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_withdrawal_minimum_amount_non_negative'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_withdrawal_minimum_amount_non_negative CHECK (minimum_withdrawal_amount IS NULL OR minimum_withdrawal_amount >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_withdrawal_maximum_amount_non_negative'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_withdrawal_maximum_amount_non_negative CHECK (maximum_withdrawal_amount IS NULL OR maximum_withdrawal_amount >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_dormant_after_days_non_negative'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_dormant_after_days_non_negative CHECK (dormant_after_days IS NULL OR dormant_after_days >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'savings_products'
          AND c.conname = 'savings_account_opening_fee_non_negative'
    ) THEN
        ALTER TABLE public.savings_products
            ADD CONSTRAINT savings_account_opening_fee_non_negative CHECK (account_opening_fee IS NULL OR account_opening_fee >= 0);
    END IF;
END
$$;
