-- Supabase linter hardening:
-- remove SECURITY DEFINER behavior from externally exposed views.
-- This ensures querying role/RLS is evaluated as the caller (security invoker).

do $$
declare
    v_view text;
    v_views text[] := array[
        'v_daily_cash_summary',
        'cash_position_view',
        'trial_balance_view',
        'ledger_entries_view',
        'loan_arrears_view',
        'member_statement_view',
        'loan_aging_view'
    ];
begin
    foreach v_view in array v_views
    loop
        if exists (
            select 1
            from pg_views
            where schemaname = 'public'
              and viewname = v_view
        ) then
            execute format(
                'alter view public.%I set (security_invoker = true)',
                v_view
            );
        end if;
    end loop;
end
$$;
