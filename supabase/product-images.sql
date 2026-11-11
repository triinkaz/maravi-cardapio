-- Apply after schema.sql. Public product photos only, no private uploads.
-- No overwrite/delete policies: old catalog references remain valid.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/webp'];

-- This private helper exposes only the caller's allowlist membership. Storage
-- INSERT needs it because the allowlist itself remains unreadable to clients.
create or replace function maravi_private.can_upload_product_image()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from maravi_private.admins where user_id = auth.uid()
  );
$$;
revoke all on function maravi_private.can_upload_product_image() from public, anon, authenticated;
grant usage on schema maravi_private to authenticated;
grant execute on function maravi_private.can_upload_product_image() to authenticated;

drop policy if exists maravi_product_images_insert on storage.objects;
create policy maravi_product_images_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and name ~ '^products/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
  and (select maravi_private.can_upload_product_image())
);
commit;
