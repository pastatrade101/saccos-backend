alter type public.member_application_status add value if not exists 'approved_pending_payment';

alter type public.member_status add value if not exists 'approved_pending_payment';

alter type public.membership_status_code add value if not exists 'approved_pending_payment';

alter table public.member_applications
    add column if not exists auth_user_id uuid references auth.users (id);

create index if not exists member_applications_auth_user_idx
    on public.member_applications (auth_user_id)
    where auth_user_id is not null;
