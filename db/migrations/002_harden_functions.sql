-- Security advisor fixes: role lookup only for the caller; trigger functions not callable over the API.
create or replace function my_role() returns app_role
language sql stable security definer set search_path = public as
$$ select coalesce((select role from profiles where user_id = auth.uid() and active), 'none'::app_role) $$;
create or replace function is_staff() returns boolean language sql stable set search_path = public as
$$ select my_role() in ('sales', 'manager', 'admin') $$;
create or replace function is_admin() returns boolean language sql stable set search_path = public as
$$ select my_role() = 'admin' $$;
drop function app_role_of(uuid);
revoke execute on function my_role() from public, anon;
grant execute on function my_role() to authenticated;
revoke execute on function audit_row() from public, anon, authenticated;
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function next_quote_number() from public, anon, authenticated;
revoke execute on function guard_locked_revision() from public, anon, authenticated;
