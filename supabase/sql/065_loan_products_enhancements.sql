DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'loan_term_unit'
    ) THEN
        CREATE TYPE public.loan_term_unit AS ENUM ('months', 'weeks');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'loan_processing_fee_type'
    ) THEN
        CREATE TYPE public.loan_processing_fee_type AS ENUM ('flat', 'percentage');
    END IF;
END
$$;

ALTER TYPE public.repayment_frequency ADD VALUE IF NOT EXISTS 'bi_weekly';
ALTER TYPE public.repayment_frequency ADD VALUE IF NOT EXISTS 'quarterly';

ALTER TABLE public.loan_products
    ADD COLUMN IF NOT EXISTS repayment_frequency public.repayment_frequency NOT NULL DEFAULT 'monthly',
    ADD COLUMN IF NOT EXISTS term_unit public.loan_term_unit NOT NULL DEFAULT 'months',
    ADD COLUMN IF NOT EXISTS processing_fee_type public.loan_processing_fee_type NOT NULL DEFAULT 'flat',
    ADD COLUMN IF NOT EXISTS processing_fee_amount numeric(18,2) CHECK (processing_fee_amount IS NULL OR processing_fee_amount >= 0),
    ADD COLUMN IF NOT EXISTS processing_fee_percent numeric(9,4) CHECK (processing_fee_percent IS NULL OR (processing_fee_percent >= 0 AND processing_fee_percent <= 100)),
    ADD COLUMN IF NOT EXISTS maximum_loan_multiple numeric(9,4) NOT NULL DEFAULT 3 CHECK (maximum_loan_multiple >= 0),
    ADD COLUMN IF NOT EXISTS minimum_membership_duration_months integer NOT NULL DEFAULT 0 CHECK (minimum_membership_duration_months >= 0),
    ADD COLUMN IF NOT EXISTS allow_early_repayment boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS early_settlement_fee_percent numeric(9,4) CHECK (early_settlement_fee_percent IS NULL OR (early_settlement_fee_percent >= 0 AND early_settlement_fee_percent <= 100));
