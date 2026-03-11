-- Supabase linter hardening (0014_extension_in_public):
-- ensure pg_trgm is installed in non-public schema.

create schema if not exists extensions;

do $$
declare
    ext_schema text;
begin
    select n.nspname
    into ext_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm';

    if ext_schema is null then
        execute 'create extension if not exists pg_trgm with schema extensions';
    elsif ext_schema = 'public' then
        execute 'alter extension pg_trgm set schema extensions';
    end if;
end
$$;
