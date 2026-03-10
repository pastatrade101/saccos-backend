-- Phase 1 CR-005: Tenant policy controls for guarantor exposure enforcement.

alter table public.loan_policy_settings
    add column if not exists guarantor_exposure_enforced boolean not null default true,
    add column if not exists guarantor_max_commitment_ratio numeric(6,4) not null default 0.8 check (guarantor_max_commitment_ratio > 0 and guarantor_max_commitment_ratio <= 1),
    add column if not exists guarantor_min_available_amount numeric(18,2) not null default 0 check (guarantor_min_available_amount >= 0);

update public.loan_policy_settings
   set guarantor_exposure_enforced = coalesce(guarantor_exposure_enforced, true),
       guarantor_max_commitment_ratio = coalesce(guarantor_max_commitment_ratio, 0.8),
       guarantor_min_available_amount = coalesce(guarantor_min_available_amount, 0);
