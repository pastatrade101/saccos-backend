alter type public.member_application_status add value if not exists 'active';

create unique index if not exists member_applications_tenant_phone_key
    on public.member_applications (tenant_id, phone)
    where phone is not null and deleted_at is null;

create unique index if not exists member_applications_tenant_national_id_key
    on public.member_applications (tenant_id, national_id)
    where national_id is not null and deleted_at is null;
