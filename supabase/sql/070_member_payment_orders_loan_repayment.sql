alter table public.payment_orders
    add column if not exists loan_id uuid references public.loans(id) on delete restrict;

alter table public.payment_orders
    alter column account_id drop not null;

alter table public.payment_orders
    drop constraint if exists payment_orders_purpose_check;

alter table public.payment_orders
    add constraint payment_orders_purpose_check
    check (purpose in ('share_contribution', 'savings_deposit', 'membership_fee', 'loan_repayment'));

alter table public.payment_orders
    drop constraint if exists payment_orders_target_check;

alter table public.payment_orders
    add constraint payment_orders_target_check
    check (
        (
            purpose in ('share_contribution', 'savings_deposit', 'membership_fee')
            and account_id is not null
        )
        or (
            purpose = 'loan_repayment'
            and loan_id is not null
        )
    );

create index if not exists payment_orders_tenant_loan_created_idx
    on public.payment_orders (tenant_id, loan_id, created_at desc)
    where loan_id is not null;
