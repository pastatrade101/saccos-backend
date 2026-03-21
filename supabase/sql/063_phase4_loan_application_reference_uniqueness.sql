update public.loan_applications applications
   set external_reference = generated.reference
  from (
    select
        id,
        'LAPP-' || to_char(created_at, 'YYYYMMDD') || '-' || lpad(
            row_number() over (
                partition by tenant_id
                order by created_at, id
            )::text,
            6,
            '0'
        ) as reference
    from public.loan_applications
    where external_reference is null
       or btrim(external_reference) = ''
       or upper(btrim(external_reference)) = 'NIL'
  ) as generated
 where applications.id = generated.id;

update public.loan_applications applications
   set external_reference = deduplicated.reference
  from (
    select
        id,
        external_reference || '-' || lpad(seq::text, 3, '0') as reference
    from (
        select
            id,
            tenant_id,
            external_reference,
            row_number() over (
                partition by tenant_id, external_reference
                order by created_at, id
            ) as seq
        from public.loan_applications
        where external_reference is not null
    ) ranked
    where ranked.seq > 1
  ) as deduplicated
 where applications.id = deduplicated.id;

create unique index if not exists loan_applications_tenant_external_reference_key
    on public.loan_applications (tenant_id, external_reference)
    where external_reference is not null;
