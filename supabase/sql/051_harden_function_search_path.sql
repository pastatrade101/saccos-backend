-- Supabase linter hardening (0011_function_search_path_mutable):
-- enforce explicit search_path on sensitive/public helper functions.

do $$
declare
    fn record;
begin
    for fn in
        select
            n.nspname as schema_name,
            p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any (array[
              'seed_phase3_defaults',
              'set_updated_at',
              'validate_balanced_journal_entry',
              'current_tenant_id',
              'current_user_role',
              'is_internal_ops',
              'has_role',
              'has_branch_scope',
              'is_platform_admin',
              'seed_phase2_defaults'
          ]::text[])
    loop
        execute format(
            'alter function %I.%I(%s) set search_path = public, pg_temp',
            fn.schema_name,
            fn.function_name,
            fn.identity_args
        );
    end loop;
end
$$;
