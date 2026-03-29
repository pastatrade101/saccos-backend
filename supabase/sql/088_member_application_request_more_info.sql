alter table public.member_applications
    add column if not exists request_more_info_reason text,
    add column if not exists requested_more_info_by uuid,
    add column if not exists requested_more_info_at timestamptz;
