-- Kyle (kmiller@pwiworks.com) is made admin automatically on first sign-in; everyone else starts with no access.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  insert into profiles(user_id, full_name, title, role)
  values (new.id, case when lower(new.email) = 'kmiller@pwiworks.com' then 'Kyle Miller' else coalesce(new.raw_user_meta_data->>'full_name', '') end,
          case when lower(new.email) = 'kmiller@pwiworks.com' then 'President' else '' end,
          case when lower(new.email) = 'kmiller@pwiworks.com' then 'admin'::app_role else 'none'::app_role end)
  on conflict do nothing;
  return new;
end $$;
