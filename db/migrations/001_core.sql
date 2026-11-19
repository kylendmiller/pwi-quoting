-- PWI quoting v1 core schema.
-- Rule: browsers READ through RLS; every write to quotes, prices, flags and approvals
-- goes through server functions (service role) that run the pricing engine.

create extension if not exists pgcrypto;

-- ---------- people ----------
create type app_role as enum ('none', 'sales', 'manager', 'admin');

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  title text not null default '',
  phone text,
  role app_role not null default 'none',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function app_role_of(uid uuid) returns app_role
language sql stable security definer set search_path = public as
$$ select coalesce((select role from profiles where user_id = uid and active), 'none'::app_role) $$;

create or replace function is_staff() returns boolean language sql stable set search_path = public as
$$ select app_role_of(auth.uid()) in ('sales', 'manager', 'admin') $$;
create or replace function is_admin() returns boolean language sql stable set search_path = public as
$$ select app_role_of(auth.uid()) = 'admin' $$;

-- new auth users get a profile with no access until an admin assigns a role
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as
$$ begin insert into profiles(user_id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', '')) on conflict do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------- customers ----------
create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  server_folder text,                       -- exact folder name under Y:\Customers
  address text, city text, state text, zip text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index customers_name_uq on customers (lower(name));

create table contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null, email text, phone text, title text,
  created_at timestamptz not null default now()
);
create index on contacts(customer_id);

-- ---------- quotes ----------
create sequence quote_number_seq;
create or replace function next_quote_number() returns text language sql volatile set search_path = public as
$$ select 'Q-' || to_char(now() at time zone 'America/Indiana/Indianapolis', 'YY') || '-' || lpad(nextval('quote_number_seq')::text, 4, '0') $$;

create type quote_status as enum ('draft', 'approval_needed', 'approved', 'sent', 'won', 'lost', 'void');
create type doc_type as enum ('QUOTATION', 'CONFIRMATION', 'CHANGE ORDER');

create table quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique default next_quote_number(),
  job_id text unique,                        -- 5-digit job #, set at win; replaces the quote number on documents
  customer_id uuid not null references customers(id),
  contact_id uuid references contacts(id),
  project_name text not null,
  job_location text,
  brand text not null default 'PWI',
  salesperson_id uuid references auth.users(id),
  status quote_status not null default 'draft',
  current_revision int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_id_format check (job_id is null or job_id ~ '^\d{5}$')
);
create index on quotes(customer_id);
create index on quotes(salesperson_id);

create table quote_revisions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  rev int not null,                          -- R0, R1, ...
  doc_type doc_type not null default 'QUOTATION',
  doc jsonb not null default '{}'::jsonb,    -- inputs: items, lines, overrides, wording, options
  priced jsonb,                              -- server pricing result (lines, rollup, flags)
  base_price numeric(14,2), installation numeric(14,2), freight numeric(14,2),
  pre_use numeric(14,2), sales_tax numeric(14,2), total numeric(14,2),
  gross_margin_pct numeric(6,4), shop_hours numeric(10,2), install_hours numeric(10,2), cad_hours numeric(10,2),
  flags jsonb not null default '[]'::jsonb,  -- e.g. INSTALL_BELOW_SUGGESTED (written by the server only)
  price_book_id uuid,
  engine_version text,
  doc_version int not null default 0,        -- optimistic lock for saves
  locked boolean not null default false,     -- true once sent; never unlocked
  sent_at timestamptz, sent_by uuid references auth.users(id),
  pdf_path text, pdf_sha256 text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_id, rev)
);

-- sent revisions can never change again
create or replace function guard_locked_revision() returns trigger language plpgsql set search_path = public as
$$ begin
  if old.locked then raise exception 'Revision % is locked (sent) and cannot be changed', old.id; end if;
  return coalesce(new, old);
end $$;
create trigger revisions_locked before update or delete on quote_revisions for each row execute function guard_locked_revision();

-- flattened lines for reporting, rewritten by the server on every save
create table quote_line_facts (
  revision_id uuid not null references quote_revisions(id) on delete cascade,
  line_key text not null,
  item_label text, family text, category text, income_category text,
  description text, vendor text, part text,
  qty numeric, unit text, cost numeric(14,2), sell numeric(14,2), hours numeric(10,2),
  primary key (revision_id, line_key)
);

create type approval_rule as enum ('INSTALL_BELOW_SUGGESTED', 'INSTALL_MANUAL_NO_SUGGESTION', 'PV_BELOW_FLOOR', 'CLASS_D');
create table approvals (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references quote_revisions(id) on delete cascade,
  rule approval_rule not null,
  detail jsonb not null default '{}'::jsonb,  -- e.g. suggested vs quoted hours
  covered_hash text not null,                 -- hash of the numbers approved; a change voids it
  requested_by uuid references auth.users(id), requested_at timestamptz not null default now(),
  decision text check (decision in ('approved', 'rejected')),
  decided_by uuid references auth.users(id), decided_at timestamptz, note text
);
create index on approvals(revision_id);

create table quote_events (
  id bigint generated always as identity primary key,
  quote_id uuid not null references quotes(id) on delete cascade,
  revision_id uuid references quote_revisions(id) on delete set null,
  actor uuid references auth.users(id),
  event text not null,                        -- created, saved, approval_requested, approved, sent, won, ...
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index on quote_events(quote_id);

-- ---------- settings + price book ----------
create table settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table price_books (
  id uuid primary key default gen_random_uuid(),
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id),
  note text not null,
  data jsonb not null,                         -- frozen copy of settings + reference tables
  sha256 text not null
);

-- ---------- reference tables (editable by admins, history kept) ----------
create table steel_price_groups (
  code text primary key, price_per_lb numeric(8,4) not null, updated date, note text
);
create table steel_shapes (
  shape text primary key, price_group text not null references steel_price_groups(code), lb_per_ft numeric(10,3) not null
);
create table std_parts (
  id uuid primary key default gen_random_uuid(),
  section text, description text not null, vendor text, part text,
  sell numeric(12,2) not null, shop_hours_each numeric(8,2), gm_pct numeric(6,4),
  price_updated date, active boolean not null default true
);
create table vendor_parts (
  vendor text not null, part text not null, description text, list numeric(12,2) not null,
  primary key (vendor, part)
);
create table vendor_discounts (
  vendor text primary key, pwi_discount_pct numeric(6,2) not null, customer_discount_pct numeric(6,2) not null
);
create table labor_ops (
  code text primary key,
  side text not null check (side in ('shop', 'site')),
  name text not null, unit text not null, hours_per_unit numeric(8,3),
  family text, active boolean not null default true, note text
);
create table rate_items (               -- painting, equipment, travel, pre-use, decals
  id uuid primary key default gen_random_uuid(),
  kind text not null, item text not null, price numeric(12,2), price_weekly numeric(12,2), price_monthly numeric(12,2),
  updated date, active boolean not null default true
);

create table audit_log (
  id bigint generated always as identity primary key,
  table_name text not null, row_key text, action text not null,
  old_row jsonb, new_row jsonb, actor uuid, at timestamptz not null default now()
);
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  insert into audit_log(table_name, row_key, action, old_row, new_row, actor)
  values (tg_table_name, coalesce(to_jsonb(new)->>'key', to_jsonb(new)->>'code', to_jsonb(old)->>'key', to_jsonb(old)->>'code'),
          tg_op, case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end, auth.uid());
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['settings','steel_price_groups','steel_shapes','std_parts','vendor_parts','vendor_discounts','labor_ops','rate_items'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row()', t);
  end loop;
end $$;

-- ---------- row level security ----------
do $$ declare t text; begin
  foreach t in array array['profiles','customers','contacts','quotes','quote_revisions','quote_line_facts','approvals','quote_events',
                           'settings','price_books','steel_price_groups','steel_shapes','std_parts','vendor_parts','vendor_discounts',
                           'labor_ops','rate_items','audit_log'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- staff can read everything they need; quote writes go through server functions only
create policy profiles_read on profiles for select to authenticated using (is_staff() or user_id = auth.uid());
do $$ declare t text; begin
  foreach t in array array['customers','contacts','quotes','quote_revisions','quote_line_facts','approvals','quote_events',
                           'settings','price_books','steel_price_groups','steel_shapes','std_parts','vendor_parts','vendor_discounts',
                           'labor_ops','rate_items'] loop
    execute format('create policy %1$s_read on %1$I for select to authenticated using (is_staff())', t);
  end loop;
  -- admins edit reference data directly (audited); everything else is server-only
  foreach t in array array['settings','steel_price_groups','steel_shapes','std_parts','vendor_parts','vendor_discounts','labor_ops','rate_items'] loop
    execute format('create policy %1$s_admin_write on %1$I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;
create policy audit_admin_read on audit_log for select to authenticated using (is_admin());

-- staff may add customers and contacts directly (no pricing involved)
create policy customers_insert on customers for insert to authenticated with check (is_staff());
create policy contacts_insert on contacts for insert to authenticated with check (is_staff());
create policy contacts_update on contacts for update to authenticated using (is_staff()) with check (is_staff());
