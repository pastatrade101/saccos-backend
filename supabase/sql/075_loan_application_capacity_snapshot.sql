alter table public.loan_applications
    add column if not exists contribution_limit numeric(18,2),
    add column if not exists product_limit numeric(18,2),
    add column if not exists liquidity_limit numeric(18,2),
    add column if not exists borrow_limit numeric(18,2),
    add column if not exists borrow_utilization_percent numeric(7,2),
    add column if not exists liquidity_status text check (liquidity_status in ('healthy', 'warning', 'risk', 'frozen', 'unknown')),
    add column if not exists capacity_captured_at timestamptz;
