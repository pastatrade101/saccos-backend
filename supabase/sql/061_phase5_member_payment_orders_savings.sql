alter table public.payment_orders
    drop constraint if exists payment_orders_purpose_check;

alter table public.payment_orders
    add constraint payment_orders_purpose_check
    check (purpose in ('share_contribution', 'savings_deposit'));
