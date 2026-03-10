-- Phase 1 CR-004: Tenant policy controls for automated default detection.

alter table public.loan_policy_settings
    add column if not exists default_case_detection_enabled boolean not null default true,
    add column if not exists default_case_dpd_threshold integer not null default 30 check (default_case_dpd_threshold > 0),
    add column if not exists default_case_reason_code text not null default 'arrears_threshold_breached';

update public.loan_policy_settings
   set default_case_detection_enabled = coalesce(default_case_detection_enabled, true),
       default_case_dpd_threshold = coalesce(default_case_dpd_threshold, 30),
       default_case_reason_code = coalesce(nullif(trim(default_case_reason_code), ''), 'arrears_threshold_breached');
