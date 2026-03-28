do $$
begin
    alter type public.user_role add value if not exists 'treasury_officer';
exception
    when duplicate_object then null;
end $$;
