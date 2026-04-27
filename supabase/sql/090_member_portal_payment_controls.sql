alter table public.tenant_settings
    add column if not exists member_portal_share_contribution_enabled boolean not null default true,
    add column if not exists member_portal_savings_deposit_enabled boolean not null default true,
    add column if not exists member_portal_loan_repayment_enabled boolean not null default true;
