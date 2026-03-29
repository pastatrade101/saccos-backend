alter table public.member_applications
    add column if not exists gender text,
    add column if not exists marital_status text,
    add column if not exists occupation text,
    add column if not exists region text,
    add column if not exists district text,
    add column if not exists ward text,
    add column if not exists street_or_village text,
    add column if not exists residential_address text,
    add column if not exists next_of_kin_address text,
    add column if not exists membership_type text,
    add column if not exists initial_share_amount numeric(18,2) not null default 0,
    add column if not exists monthly_savings_commitment numeric(18,2) not null default 0,
    add column if not exists terms_accepted boolean not null default false,
    add column if not exists data_processing_consent boolean not null default false;

alter table public.members
    add column if not exists marital_status text,
    add column if not exists occupation text,
    add column if not exists region text,
    add column if not exists district text,
    add column if not exists ward text,
    add column if not exists street_or_village text,
    add column if not exists residential_address text,
    add column if not exists next_of_kin_address text,
    add column if not exists membership_type text,
    add column if not exists initial_share_amount numeric(18,2) not null default 0,
    add column if not exists monthly_savings_commitment numeric(18,2) not null default 0;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'member_applications_gender_check'
    ) then
        alter table public.member_applications
            add constraint member_applications_gender_check
            check (gender is null or gender in ('male', 'female', 'other'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'member_applications_marital_status_check'
    ) then
        alter table public.member_applications
            add constraint member_applications_marital_status_check
            check (marital_status is null or marital_status in ('single', 'married', 'divorced', 'widowed'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'member_applications_membership_type_check'
    ) then
        alter table public.member_applications
            add constraint member_applications_membership_type_check
            check (membership_type is null or membership_type in ('individual', 'group', 'company'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'member_applications_initial_share_amount_non_negative'
    ) then
        alter table public.member_applications
            add constraint member_applications_initial_share_amount_non_negative
            check (initial_share_amount >= 0);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'member_applications_monthly_savings_commitment_non_negative'
    ) then
        alter table public.member_applications
            add constraint member_applications_monthly_savings_commitment_non_negative
            check (monthly_savings_commitment >= 0);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'members_marital_status_check'
    ) then
        alter table public.members
            add constraint members_marital_status_check
            check (marital_status is null or marital_status in ('single', 'married', 'divorced', 'widowed'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'members_membership_type_check'
    ) then
        alter table public.members
            add constraint members_membership_type_check
            check (membership_type is null or membership_type in ('individual', 'group', 'company'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'members_initial_share_amount_non_negative'
    ) then
        alter table public.members
            add constraint members_initial_share_amount_non_negative
            check (initial_share_amount >= 0);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'members_monthly_savings_commitment_non_negative'
    ) then
        alter table public.members
            add constraint members_monthly_savings_commitment_non_negative
            check (monthly_savings_commitment >= 0);
    end if;
end $$;

alter table public.member_application_attachments
    add column if not exists document_type text not null default 'supporting_document';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'member_application_attachments_document_type_check'
    ) then
        alter table public.member_application_attachments
            add constraint member_application_attachments_document_type_check
            check (document_type in ('national_id', 'passport_photo', 'supporting_document'));
    end if;
end $$;

insert into storage.buckets (id, name, public)
values ('member-applications', 'member-applications', false)
on conflict (id) do nothing;
