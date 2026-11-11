# Product photo uploads

## Deployment

Apply `supabase/schema.sql`, then `supabase/product-images.sql`, as database owner.
The second script is idempotent. Reapply it after rerunning schema.sql, which
revokes private-schema usage as part of its defensive setup. Neither script
replaces existing catalog data. No main/live frontend deployment is implied.

Only the `product-images` bucket is configured. It is public because all uploaded
files are intended to be public product photos, even before catalog publication.
Never upload private/customer photos. Bucket limits: 5 MiB, `image/webp` only.
Inspect existing storage policies before applying: PostgreSQL permissive policies
are OR-combined, so a pre-existing broad write policy must not cover this bucket.
The included policy grants only INSERT for users present in the private admin
allowlist. It grants no overwrite, listing, update, move, or delete capability.
Existing photos are retained; garbage collection is intentionally out of scope.

Origin is explicitly pinned to `https://dkllcttqkyazbkqygixv.supabase.co` in
backend-client.js, catalog-model.js and schema.sql. For another deployment change
all three together, update tests, and migrate existing uploaded URL references.
Do not replace the literal with a wildcard or accept arbitrary external URLs.
The existing `assets/slug.webp` catalog entries remain supported.

## Frontend contract

`await MaraviBackend.uploadProductImage(accessToken, file)` returns:

- `image`: canonical public URL, to assign to the draft product's `image` field.
- `path`: object name `products/<random UUID v4>.webp`, for diagnostics only.

The input must be a File/Blob, JPG (`image/jpeg`), PNG or WEBP, nonempty and at
most 5 MiB. The helper checks the format signature, decodes it using
createImageBitmap, rejects over 40 million decoded pixels, scales to at most
1600 pixels on the longest side, and reencodes via canvas to WebP quality 0.86.
The encoded file is also capped at 5 MiB. This strips original metadata and
animation. Unsupported browser codecs fail closed with an actionable message.
No original filename is sent to storage. Upload uses random UUIDs and
`x-upsert: false`; no secrets, refresh tokens or passwords are stored.

`MaraviCatalog.validProductImage(value)` is the shared strict URL/path validator.
Use it for validation, not an editable arbitrary URL field. Error objects have a
user-safe `.message` and `.status` (401 session expired, 403 forbidden, 0 local or
network error). Keep the prior photo on failure. Only replace the draft photo
when upload succeeds. Catalog publication remains a separate save operation.

Disable submit/save/reload and concurrent uploads while preparing or uploading,
and ignore results if the editor/product/session changed during the await. An
upload may finish after a network timeout, leaving an unreferenced image. A retry
gets a new UUID and cannot overwrite an existing catalog image.

## Security boundaries and tests

Browser reencoding is defense in depth, not server-side content inspection.
Storage enforces the byte limit and MIME allowlist; a malicious allowlisted admin
can bypass client validation and falsely declare a MIME type. Only trusted
catalog administrators may upload, and catalog URLs accept only the isolated
public WebP bucket and UUID paths. The storage service is not an antivirus or a
server-side decoder. If untrusted uploaders are introduced, add a server-side
image decoding/reencoding pipeline before making objects public.

`npm run check` covers client validation/error handling, canonical image URL
validation, PostgreSQL catalog validation and simulated Storage RLS via PGlite.
The latter checks admin/non-admin/anonymous access, unsafe paths, duplicate
inserts, denied updates/deletes, revoked admin access, and bucket configuration.
PGlite does not run the Storage HTTP service or real browser codecs; remote API
limits and a real end-to-end image upload still need deployment verification.

References: https://supabase.com/docs/guides/storage/security/access-control and
https://supabase.com/docs/guides/storage/uploads/standard-uploads
