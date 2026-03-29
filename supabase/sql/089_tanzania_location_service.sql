create table if not exists public.regions (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.districts (
    id uuid primary key default gen_random_uuid(),
    region_id uuid not null references public.regions(id) on delete restrict,
    name text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.wards (
    id uuid primary key default gen_random_uuid(),
    district_id uuid not null references public.districts(id) on delete restrict,
    name text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.villages (
    id uuid primary key default gen_random_uuid(),
    ward_id uuid not null references public.wards(id) on delete restrict,
    name text not null,
    code text,
    created_at timestamptz not null default now()
);

create unique index if not exists regions_name_key on public.regions (name);
create unique index if not exists districts_region_name_key on public.districts (region_id, name);
create unique index if not exists wards_district_name_key on public.wards (district_id, name);
create unique index if not exists villages_ward_name_key on public.villages (ward_id, name);
create unique index if not exists villages_code_key on public.villages (code) where code is not null;

create index if not exists districts_region_id_idx on public.districts (region_id);
create index if not exists wards_district_id_idx on public.wards (district_id);
create index if not exists villages_ward_id_idx on public.villages (ward_id);

alter table public.member_applications
    add column if not exists region_id uuid references public.regions(id) on delete set null,
    add column if not exists district_id uuid references public.districts(id) on delete set null,
    add column if not exists ward_id uuid references public.wards(id) on delete set null,
    add column if not exists village_id uuid references public.villages(id) on delete set null;

alter table public.members
    add column if not exists region_id uuid references public.regions(id) on delete set null,
    add column if not exists district_id uuid references public.districts(id) on delete set null,
    add column if not exists ward_id uuid references public.wards(id) on delete set null,
    add column if not exists village_id uuid references public.villages(id) on delete set null;

create index if not exists member_applications_region_id_idx on public.member_applications (region_id);
create index if not exists member_applications_district_id_idx on public.member_applications (district_id);
create index if not exists member_applications_ward_id_idx on public.member_applications (ward_id);
create index if not exists member_applications_village_id_idx on public.member_applications (village_id);

create index if not exists members_region_id_idx on public.members (region_id);
create index if not exists members_district_id_idx on public.members (district_id);
create index if not exists members_ward_id_idx on public.members (ward_id);
create index if not exists members_village_id_idx on public.members (village_id);
