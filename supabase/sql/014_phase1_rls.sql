alter table public.member_applications enable row level security;
alter table public.member_application_attachments enable row level security;
alter table public.membership_status_history enable row level security;
alter table public.savings_products enable row level security;
alter table public.share_products enable row level security;
alter table public.fee_rules enable row level security;
alter table public.penalty_rules enable row level security;
alter table public.posting_rules enable row level security;

drop policy if exists member_applications_select_policy on public.member_applications;
create policy member_applications_select_policy
    on public.member_applications
    for select
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager', 'auditor'])
            or public.is_internal_ops()
        )
        and (
            public.has_role(array['super_admin', 'auditor'])
            or public.has_branch_scope(branch_id)
            or public.is_internal_ops()
        )
    );

drop policy if exists member_applications_insert_policy on public.member_applications;
create policy member_applications_insert_policy
    on public.member_applications
    for insert
    with check (
        public.current_tenant_id() = tenant_id
        and public.has_role(array['super_admin', 'branch_manager'])
        and public.has_branch_scope(branch_id)
    );

drop policy if exists member_applications_update_policy on public.member_applications;
create policy member_applications_update_policy
    on public.member_applications
    for update
    using (
        public.current_tenant_id() = tenant_id
        and public.has_role(array['super_admin', 'branch_manager'])
        and public.has_branch_scope(branch_id)
    )
    with check (
        public.current_tenant_id() = tenant_id
        and public.has_role(array['super_admin', 'branch_manager'])
        and public.has_branch_scope(branch_id)
    );

drop policy if exists member_application_attachments_select_policy on public.member_application_attachments;
create policy member_application_attachments_select_policy
    on public.member_application_attachments
    for select
    using (
        exists (
            select 1
            from public.member_applications applications
            where applications.id = member_application_attachments.application_id
              and applications.tenant_id = public.current_tenant_id()
              and (
                  public.has_role(array['super_admin', 'branch_manager', 'auditor'])
                  or public.is_internal_ops()
              )
        )
    );

drop policy if exists member_application_attachments_insert_policy on public.member_application_attachments;
create policy member_application_attachments_insert_policy
    on public.member_application_attachments
    for insert
    with check (
        exists (
            select 1
            from public.member_applications applications
            where applications.id = member_application_attachments.application_id
              and applications.tenant_id = public.current_tenant_id()
              and public.has_role(array['super_admin', 'branch_manager'])
              and public.has_branch_scope(applications.branch_id)
        )
    );

drop policy if exists membership_status_history_select_policy on public.membership_status_history;
create policy membership_status_history_select_policy
    on public.membership_status_history
    for select
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            or public.is_internal_ops()
            or exists (
                select 1
                from public.members members
                where members.id = membership_status_history.member_id
                  and members.user_id = auth.uid()
            )
        )
    );

drop policy if exists membership_status_history_insert_policy on public.membership_status_history;
create policy membership_status_history_insert_policy
    on public.membership_status_history
    for insert
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists savings_products_select_policy on public.savings_products;
create policy savings_products_select_policy
    on public.savings_products
    for select
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists savings_products_insert_policy on public.savings_products;
create policy savings_products_insert_policy
    on public.savings_products
    for insert
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists savings_products_update_policy on public.savings_products;
create policy savings_products_update_policy
    on public.savings_products
    for update
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    )
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists share_products_select_policy on public.share_products;
create policy share_products_select_policy
    on public.share_products
    for select
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists share_products_insert_policy on public.share_products;
create policy share_products_insert_policy
    on public.share_products
    for insert
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists share_products_update_policy on public.share_products;
create policy share_products_update_policy
    on public.share_products
    for update
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    )
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists fee_rules_select_policy on public.fee_rules;
create policy fee_rules_select_policy
    on public.fee_rules
    for select
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists fee_rules_insert_policy on public.fee_rules;
create policy fee_rules_insert_policy
    on public.fee_rules
    for insert
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists fee_rules_update_policy on public.fee_rules;
create policy fee_rules_update_policy
    on public.fee_rules
    for update
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    )
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists penalty_rules_select_policy on public.penalty_rules;
create policy penalty_rules_select_policy
    on public.penalty_rules
    for select
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists penalty_rules_insert_policy on public.penalty_rules;
create policy penalty_rules_insert_policy
    on public.penalty_rules
    for insert
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists penalty_rules_update_policy on public.penalty_rules;
create policy penalty_rules_update_policy
    on public.penalty_rules
    for update
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    )
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists posting_rules_select_policy on public.posting_rules;
create policy posting_rules_select_policy
    on public.posting_rules
    for select
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists posting_rules_insert_policy on public.posting_rules;
create policy posting_rules_insert_policy
    on public.posting_rules
    for insert
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );

drop policy if exists posting_rules_update_policy on public.posting_rules;
create policy posting_rules_update_policy
    on public.posting_rules
    for update
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    )
    with check (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or public.is_internal_ops()
        )
    );
