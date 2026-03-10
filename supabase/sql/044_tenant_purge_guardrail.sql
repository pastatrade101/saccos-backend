-- Tenant purge guardrail:
-- Dynamic cleanup for all public tables with tenant_id, so future schema additions
-- do not silently break tenant hard-delete workflows.

create or replace function public.purge_tenant_scoped_rows(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pass integer := 0;
    v_max_passes integer := 12;
    v_progress boolean;
    v_table record;
    v_sql text;
    v_deleted_count bigint;
    v_total_deleted bigint := 0;
begin
    if p_tenant_id is null then
        return jsonb_build_object(
            'success', false,
            'reason', 'tenant_id_required'
        );
    end if;

    while v_pass < v_max_passes loop
        v_pass := v_pass + 1;
        v_progress := false;

        for v_table in
            select distinct c.table_name
            from information_schema.columns c
            where c.table_schema = 'public'
              and c.column_name = 'tenant_id'
              and c.table_name not in ('tenants')
            order by c.table_name
        loop
            begin
                v_sql := format(
                    'with deleted as (delete from public.%I where tenant_id = $1 returning 1) select count(*) from deleted',
                    v_table.table_name
                );
                execute v_sql using p_tenant_id into v_deleted_count;

                if coalesce(v_deleted_count, 0) > 0 then
                    v_progress := true;
                    v_total_deleted := v_total_deleted + v_deleted_count;
                end if;
            exception
                when undefined_table or undefined_column then
                    -- Table changed between introspection and delete call; ignore.
                    null;
                when foreign_key_violation then
                    -- Another pass may unlock this table once dependencies are removed.
                    null;
                when others then
                    -- Keep purge resilient; backend logs handle final failures.
                    null;
            end;
        end loop;

        exit when not v_progress;
    end loop;

    return jsonb_build_object(
        'success', true,
        'passes', v_pass,
        'rows_deleted', v_total_deleted
    );
end;
$$;

revoke all on function public.purge_tenant_scoped_rows(uuid) from public;
revoke all on function public.purge_tenant_scoped_rows(uuid) from anon;
revoke all on function public.purge_tenant_scoped_rows(uuid) from authenticated;
grant execute on function public.purge_tenant_scoped_rows(uuid) to service_role;

