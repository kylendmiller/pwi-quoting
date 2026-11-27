-- Jobs from the Claude quote skill that are waiting to be built.
-- Saved when a rep opens (taps or pastes) the skill's link on any device, so the job shows on every
-- device they sign in on. Seen by the rep who made it, managers and admins.
create table if not exists quoting.waiting_quotes (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  spec jsonb not null,
  spec_hash text not null,
  summary text,
  created_at timestamptz not null default now(),
  built_quote_id uuid references quoting.quotes(id) on delete set null,
  built_at timestamptz,
  built_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null,
  unique (created_by, spec_hash)
);
create index if not exists waiting_quotes_open on quoting.waiting_quotes (created_at desc) where built_quote_id is null and dismissed_at is null;

alter table quoting.waiting_quotes enable row level security;
drop policy if exists waiting_read on quoting.waiting_quotes;
create policy waiting_read on quoting.waiting_quotes for select to authenticated
  using (quoting.is_staff() and (created_by = auth.uid() or quoting.my_role() in ('manager', 'admin')));
drop policy if exists waiting_add on quoting.waiting_quotes;
create policy waiting_add on quoting.waiting_quotes for insert to authenticated
  with check (quoting.is_staff() and created_by = auth.uid());
drop policy if exists waiting_change on quoting.waiting_quotes;
create policy waiting_change on quoting.waiting_quotes for update to authenticated
  using (quoting.is_staff() and (created_by = auth.uid() or quoting.my_role() in ('manager', 'admin')))
  with check (quoting.is_staff() and (created_by = auth.uid() or quoting.my_role() in ('manager', 'admin')));

revoke all on quoting.waiting_quotes from anon;
grant select, insert on quoting.waiting_quotes to authenticated;
grant update (built_quote_id, built_at, built_by, dismissed_at, dismissed_by) on quoting.waiting_quotes to authenticated;
