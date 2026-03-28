alter table public.payment_orders
    drop constraint if exists payment_orders_gateway_check;

alter table public.payment_orders
    add constraint payment_orders_gateway_check
    check (gateway in ('azampay', 'snippe'));

alter table public.payment_order_callbacks
    drop constraint if exists payment_order_callbacks_gateway_check;

alter table public.payment_order_callbacks
    add constraint payment_order_callbacks_gateway_check
    check (gateway in ('azampay', 'snippe'));
