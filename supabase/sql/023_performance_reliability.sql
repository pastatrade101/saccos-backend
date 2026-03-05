-- Phase: performance + reliability hardening
-- Scope:
-- 1) strengthen hot-path indexes by tenant/branch/time
-- 2) keep query plans stable for high-volume list/report workloads

create index if not exists members_tenant_branch_status_created_idx
    on public.members (tenant_id, branch_id, status, created_at desc)
    where deleted_at is null;

create index if not exists member_accounts_tenant_branch_status_created_idx
    on public.member_accounts (tenant_id, branch_id, status, created_at desc)
    where deleted_at is null;

create index if not exists member_applications_tenant_status_created_idx
    on public.member_applications (tenant_id, status, created_at desc)
    where deleted_at is null;

create index if not exists member_applications_tenant_branch_status_created_idx
    on public.member_applications (tenant_id, branch_id, status, created_at desc)
    where deleted_at is null;

create index if not exists member_applications_tenant_created_by_created_idx
    on public.member_applications (tenant_id, created_by, created_at desc)
    where deleted_at is null;

create index if not exists member_application_attachments_tenant_application_created_idx
    on public.member_application_attachments (tenant_id, application_id, created_at desc);

create index if not exists membership_status_history_tenant_member_changed_idx
    on public.membership_status_history (tenant_id, member_id, changed_at desc);

create index if not exists membership_status_history_tenant_application_changed_idx
    on public.membership_status_history (tenant_id, application_id, changed_at desc);

create index if not exists loan_applications_tenant_branch_status_created_idx
    on public.loan_applications (tenant_id, branch_id, status, created_at desc);

create index if not exists loan_approvals_tenant_application_created_idx
    on public.loan_approvals (tenant_id, application_id, created_at desc);

create index if not exists loan_guarantors_tenant_application_created_idx
    on public.loan_guarantors (tenant_id, application_id, created_at desc);

create index if not exists collateral_items_tenant_application_created_idx
    on public.collateral_items (tenant_id, application_id, created_at desc);

create index if not exists teller_sessions_tenant_status_opened_idx
    on public.teller_sessions (tenant_id, status, opened_at desc);

create index if not exists teller_sessions_tenant_branch_status_opened_idx
    on public.teller_sessions (tenant_id, branch_id, status, opened_at desc);

create index if not exists teller_session_transactions_tenant_branch_created_idx
    on public.teller_session_transactions (tenant_id, branch_id, created_at desc);

create index if not exists teller_session_transactions_tenant_type_created_idx
    on public.teller_session_transactions (tenant_id, transaction_type, created_at desc);

create index if not exists transaction_receipts_tenant_branch_created_idx
    on public.transaction_receipts (tenant_id, branch_id, created_at desc);

create index if not exists transaction_receipts_tenant_type_created_idx
    on public.transaction_receipts (tenant_id, transaction_type, created_at desc);

create index if not exists audit_logs_tenant_actor_created_idx
    on public.audit_logs (tenant_id, actor_user_id, created_at desc);

create index if not exists api_idempotency_requests_scope_created_idx
    on public.api_idempotency_requests (scope_key, created_at desc);

create index if not exists api_idempotency_requests_completed_idx
    on public.api_idempotency_requests (completed_at);
