-- Run in the Supabase SQL Editor as the project database owner.
-- Idempotent setup: existing catalog data and administrator grants are preserved.
begin;

create schema if not exists maravi_private;
revoke all on schema maravi_private from public, anon, authenticated;

create table if not exists maravi_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists maravi_private.catalog (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 1 check (revision > 0),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table maravi_private.admins enable row level security;
alter table maravi_private.catalog enable row level security;
-- No table policies: all browser table access is denied. Only the explicitly
-- granted SECURITY DEFINER RPCs below can access data under the owner's role.
revoke all on all tables in schema maravi_private from public, anon, authenticated;

create or replace function maravi_private.validate_catalog(payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  product jsonb;
  flavor jsonb;
  field_name text;
  product_ids text[] := '{}';
  flavor_names text[];
  amount numeric;
begin
  if payload is null or jsonb_typeof(payload) is distinct from 'object'
     or octet_length(payload::text) > 262144 then
    raise exception using errcode = '22023', message = 'CATALOG_INVALID: expected an object up to 256 KiB';
  end if;
  if not (payload ? 'products') or payload - 'products' <> '{}'::jsonb
     or jsonb_typeof(payload->'products') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'CATALOG_INVALID: products array required';
  end if;
  if jsonb_array_length(payload->'products') > 200 then
    raise exception using errcode = '22023', message = 'CATALOG_INVALID: maximum 200 products';
  end if;
  for product in select value from jsonb_array_elements(payload->'products') loop
    if jsonb_typeof(product) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: product must be an object';
    end if;
    if not (product ?& array['id','name','category','description','weight','price_cents','image','active','stock','custom','flavors'])
       or product - array['id','name','category','description','weight','price_cents','image','active','stock','custom','flavors'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: missing or unknown product fields';
    end if;
    if jsonb_typeof(product->'id') is distinct from 'string'
       or (product->>'id') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       or length(product->>'id') > 80 or product->>'id' = any(product_ids) then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: product IDs must be unique slugs up to 80 characters';
    end if;
    product_ids := array_append(product_ids, product->>'id');
    foreach field_name in array array['name','category','description','weight'] loop
      if jsonb_typeof(product->field_name) is distinct from 'string' then
        raise exception using errcode = '22023', message = 'CATALOG_INVALID: product text fields must be strings';
      end if;
    end loop;
    if length(btrim(product->>'name')) not between 1 and 100
       or length(product->>'name') > 100
       or length(btrim(product->>'category')) not between 1 and 80
       or length(product->>'category') > 80
       or length(product->>'description') > 1000
       or length(product->>'weight') > 100 then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: invalid product text length';
    end if;
    if jsonb_typeof(product->'price_cents') is distinct from 'number' then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: price must be integer cents';
    end if;
    amount := (product->>'price_cents')::numeric;
    if amount <> trunc(amount) or amount < 1 or amount > 1000000 then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: price must be 1 to 1000000 cents';
    end if;
    if jsonb_typeof(product->'image') is distinct from 'string'
       or (product->>'image') !~ '^assets/[a-z0-9][a-z0-9-]*\.webp$'
       or length(product->>'image') > 100 then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: image must be a local assets/slug.webp path';
    end if;
    if jsonb_typeof(product->'active') is distinct from 'boolean' then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: active must be boolean';
    end if;
    if product->'stock' <> 'null'::jsonb then
      if jsonb_typeof(product->'stock') is distinct from 'number' then
        raise exception using errcode = '22023', message = 'CATALOG_INVALID: stock must be null or integer';
      end if;
      amount := (product->>'stock')::numeric;
      if amount <> trunc(amount) or amount < 0 or amount > 99999 then
        raise exception using errcode = '22023', message = 'CATALOG_INVALID: stock must be 0 to 99999';
      end if;
    end if;
    if product->'custom' <> 'null'::jsonb then
      if jsonb_typeof(product->'custom') is distinct from 'string'
         or product->>'custom' not in ('aconchego','quarteto') then
        raise exception using errcode = '22023', message = 'CATALOG_INVALID: unsupported box type';
      end if;
    end if;
    if jsonb_typeof(product->'flavors') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: flavors array required';
    end if;
    if (product->'custom' = 'null'::jsonb and jsonb_array_length(product->'flavors') <> 0)
       or (product->'custom' <> 'null'::jsonb and jsonb_array_length(product->'flavors') not between 1 and 20) then
      raise exception using errcode = '22023', message = 'CATALOG_INVALID: boxes need 1 to 20 flavors; simple products need none';
    end if;
    flavor_names := '{}';
    for flavor in select value from jsonb_array_elements(product->'flavors') loop
      if jsonb_typeof(flavor) is distinct from 'object' then
        raise exception using errcode = '22023', message = 'CATALOG_INVALID: flavor must be an object';
      end if;
      if not (flavor ?& array['name','active']) or flavor - array['name','active'] <> '{}'::jsonb
         or jsonb_typeof(flavor->'name') is distinct from 'string'
         or jsonb_typeof(flavor->'active') is distinct from 'boolean' then
        raise exception using errcode = '22023', message = 'CATALOG_INVALID: flavor requires name and active only';
      end if;
      if length(flavor->>'name') not between 1 and 100
         or flavor->>'name' <> btrim(flavor->>'name')
         or lower(flavor->>'name') in ('__proto__','constructor','prototype')
         or lower(flavor->>'name') = any(flavor_names) then
        raise exception using errcode = '22023', message = 'CATALOG_INVALID: flavor names must be nonempty and unique';
      end if;
      flavor_names := array_append(flavor_names, lower(flavor->>'name'));
    end loop;
  end loop;
end;
$$;
revoke all on function maravi_private.validate_catalog(jsonb) from public, anon, authenticated;

create or replace function public.get_public_catalog()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('revision', c.revision, 'catalog', jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(
        p.item || jsonb_build_object('flavors', coalesce((
          select jsonb_agg(f.item order by f.position)
          from jsonb_array_elements(p.item->'flavors') with ordinality as f(item, position)
          where f.item->'active' = 'true'::jsonb
        ), '[]'::jsonb)) order by p.position)
      from jsonb_array_elements(c.data->'products') with ordinality as p(item, position)
      where p.item->'active' = 'true'::jsonb
    ), '[]'::jsonb)))
  from maravi_private.catalog c where c.singleton = true;
$$;
revoke all on function public.get_public_catalog() from public, anon, authenticated;
grant execute on function public.get_public_catalog() to anon, authenticated;

create or replace function public.admin_get_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from maravi_private.admins where user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  select jsonb_build_object('revision', revision, 'catalog', data) into result
  from maravi_private.catalog where singleton = true;
  return result;
end;
$$;
revoke all on function public.admin_get_catalog() from public, anon, authenticated;
grant execute on function public.admin_get_catalog() to authenticated;

create or replace function public.admin_save_catalog(expected_revision bigint, catalog_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_revision bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from maravi_private.admins where user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  perform maravi_private.validate_catalog(catalog_data);
  select revision into current_revision from maravi_private.catalog
  where singleton = true for update;
  if current_revision is null then
    raise exception using errcode = '55000', message = 'CATALOG_NOT_INITIALIZED';
  end if;
  if expected_revision is null or current_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'CATALOG_CONFLICT',
      hint = 'Reload the catalog before saving. Another administrator has changed it.';
  end if;
  update maravi_private.catalog set data = catalog_data,
    revision = current_revision + 1, updated_at = now() where singleton = true;
  return jsonb_build_object('revision', current_revision + 1, 'catalog', catalog_data);
end;
$$;
revoke all on function public.admin_save_catalog(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_catalog(bigint, jsonb) to authenticated;

-- Original menu seed. ON CONFLICT intentionally never replaces live edits.
do $seed$
declare initial_catalog jsonb := $catalog$
{
  "products": [
    {
      "id": "classic-nutella",
      "name": "Classic Nutella",
      "category": "Cookies clássicos",
      "weight": "Aprox. 110g",
      "description": "Massa clássica de baunilha, chocolate 40% e recheio de Nutella.",
      "price_cents": 1500,
      "image": "assets/classic-nutella.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "double-chocolate",
      "name": "Double Chocolate",
      "category": "Cookies clássicos",
      "weight": "Aprox. 110g",
      "description": "Cacau Black 100%, chocolates 40% e branco, com brigadeiro de chocolate branco.",
      "price_cents": 1400,
      "image": "assets/double-chocolate.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "red-ninho",
      "name": "Red Ninho",
      "category": "Cookies clássicos",
      "weight": "Aprox. 110g",
      "description": "Red velvet com cacau, chocolate branco e brigadeiro de leite em pó Ninho.",
      "price_cents": 1300,
      "image": "assets/red-ninho.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "dark-cacau",
      "name": "Dark Cacau",
      "category": "Cookies clássicos",
      "weight": "Aprox. 110g",
      "description": "Cacau Black e cacau 100% com muito chocolate 40%. Sem recheio.",
      "price_cents": 1600,
      "image": "assets/dark-cacau.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "kinder-classic",
      "name": "Kinder Classic",
      "category": "Cookies especiais",
      "weight": "Aprox. 128g",
      "description": "Baunilha, chocolates 40% e branco, creme de Kinder Bueno White e finalização especial.",
      "price_cents": 2400,
      "image": "assets/kinder-classic.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "rabanada",
      "name": "Rabanada",
      "category": "Cookie natalino",
      "weight": "Aprox. 120g",
      "description": "Baunilha, manteiga noisette, especiarias, chocolate 40% e doce de leite caseiro.",
      "price_cents": 1300,
      "image": "assets/rabanada.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "selecao-maravi",
      "name": "Seleção Maravi",
      "category": "Cookies tradicionais",
      "weight": "Aprox. 75g · 3 unidades",
      "description": "Uma unidade de cada cookie tradicional. Composição fixa, sem alterações.",
      "price_cents": 1150,
      "image": "assets/selecao-maravi.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "aconchego",
      "name": "Aconchego",
      "category": "Cookies tradicionais",
      "weight": "Aprox. 100g · 4 unidades",
      "description": "Quatro cookies tradicionais à sua escolha. Monte sua combinação.",
      "custom": "aconchego",
      "price_cents": 1550,
      "image": "assets/aconchego.webp",
      "active": true,
      "stock": null,
      "flavors": [
        {
          "name": "Baunilha com chocolate 40%",
          "active": true
        },
        {
          "name": "Cacau Black com chocolates 40% e branco",
          "active": true
        },
        {
          "name": "Red Velvet com chocolate branco",
          "active": true
        }
      ]
    },
    {
      "id": "cenourito",
      "name": "Cenourito",
      "category": "Caseirinhos",
      "weight": "Aprox. 170g",
      "description": "Massa de cenoura e brigadeiro de chocolate 50%, finalizado com granulado Melken.",
      "price_cents": 1600,
      "image": "assets/cenourito.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "ninho-frutas",
      "name": "Ninho com Frutas Vermelhas",
      "category": "Cremosos",
      "weight": "Aprox. 125g",
      "description": "Brigadeiro de Ninho e compota artesanal de frutas vermelhas.",
      "price_cents": 1400,
      "image": "assets/ninho-frutas.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "maracuja-chocolate",
      "name": "Maracujá com Chocolate",
      "category": "Cremosos",
      "weight": "Aprox. 115g",
      "description": "Mousse de maracujá e ganache de chocolate 40%.",
      "price_cents": 1400,
      "image": "assets/maracuja-chocolate.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "quarteto-maravi",
      "name": "Quarteto Maravi",
      "category": "Brigadeiros",
      "weight": "4 unidades · aprox. 84g",
      "description": "Escolha quatro brigadeiros. Duas caixinhas elegíveis saem por R$ 22.",
      "custom": "quarteto",
      "price_cents": 1200,
      "image": "assets/quarteto-maravi.webp",
      "active": true,
      "stock": null,
      "flavors": [
        {
          "name": "Ninho",
          "active": true
        },
        {
          "name": "Moranguinho",
          "active": true
        },
        {
          "name": "Coco tradicional",
          "active": true
        },
        {
          "name": "Chocolate 50%",
          "active": true
        }
      ]
    },
    {
      "id": "com-carinho",
      "name": "Bilhete Com Carinho",
      "category": "Para presentear",
      "weight": "Bilhete com envelope",
      "description": "Um toque de carinho para acompanhar seu presente.",
      "price_cents": 80,
      "image": "assets/com-carinho.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    },
    {
      "id": "feliz-aniversario",
      "name": "Bilhete Feliz Aniversário",
      "category": "Para presentear",
      "weight": "Bilhete com envelope e vela",
      "description": "Para deixar a comemoração completa.",
      "price_cents": 105,
      "image": "assets/feliz-aniversario.webp",
      "active": true,
      "stock": null,
      "custom": null,
      "flavors": []
    }
  ]
}
$catalog$::jsonb;
begin
  perform maravi_private.validate_catalog(initial_catalog);
  insert into maravi_private.catalog(singleton, data) values (true, initial_catalog)
  on conflict (singleton) do nothing;
end;
$seed$;

commit;
