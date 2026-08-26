-- PokéPack backend: execute uma única vez no SQL Editor do Supabase.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default 'Treinador',
  role text not null default 'player' check (role in ('player', 'admin')),
  moons integer not null default 20 check (moons >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.card_sets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  code text not null unique,
  booster_price integer not null default 2 check (booster_price > 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cards (
  id bigint generated always as identity primary key,
  set_id uuid not null references public.card_sets(id) on delete cascade,
  external_id integer,
  name text not null,
  number text not null,
  rarity text not null,
  image_url text not null,
  weight numeric not null check (weight > 0),
  sell_value integer not null check (sell_value > 0),
  active boolean not null default true,
  unique(set_id, number)
);

create table if not exists public.inventory (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id bigint not null references public.cards(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  primary key(user_id, card_id)
);

create table if not exists public.openings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id bigint not null references public.cards(id),
  set_id uuid not null references public.card_sets(id),
  cost integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.moon_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  reason text not null,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from profiles where id=auth.uid() and role='admin') $$;

alter table public.profiles enable row level security;
alter table public.card_sets enable row level security;
alter table public.cards enable row level security;
alter table public.inventory enable row level security;
alter table public.openings enable row level security;
alter table public.moon_transactions enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (id=auth.uid() or public.is_admin());
drop policy if exists sets_read on public.card_sets;
create policy sets_read on public.card_sets for select to anon, authenticated using (active or public.is_admin());
drop policy if exists cards_read on public.cards;
create policy cards_read on public.cards for select to anon, authenticated using (active or public.is_admin());
drop policy if exists inventory_read on public.inventory;
create policy inventory_read on public.inventory for select to authenticated
using (user_id=auth.uid() or public.is_admin());
drop policy if exists openings_read on public.openings;
create policy openings_read on public.openings for select to authenticated
using (user_id=auth.uid() or public.is_admin());
drop policy if exists transactions_read on public.moon_transactions;
create policy transactions_read on public.moon_transactions for select to authenticated
using (user_id=auth.uid() or public.is_admin());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into profiles(id,email,display_name,role)
  values(new.id,new.email,coalesce(nullif(new.raw_user_meta_data->>'display_name',''),split_part(new.email,'@',1)),
    case when exists(select 1 from profiles where role='admin') then 'player' else 'admin' end);
  insert into moon_transactions(user_id,amount,reason) values(new.id,20,'Saldo inicial');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.open_booster(p_set_slug text)
returns table(card_id bigint,name text,number text,rarity text,image_url text,sell_value integer,moons integer)
language plpgsql security definer set search_path=public
as $$
declare v_set card_sets%rowtype; v_card cards%rowtype; v_moons integer;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  select * into v_set from card_sets where slug=p_set_slug and active for share;
  if not found then raise exception 'SET_NOT_FOUND'; end if;
  update profiles set moons=profiles.moons-v_set.booster_price
  where id=auth.uid() and profiles.moons>=v_set.booster_price returning profiles.moons into v_moons;
  if v_moons is null then raise exception 'INSUFFICIENT_MOONS'; end if;
  select * into v_card from cards where set_id=v_set.id and active
  order by -ln(greatest(random(),0.0000001))/weight limit 1;
  if not found then raise exception 'EMPTY_SET'; end if;
  insert into inventory(user_id,card_id,quantity) values(auth.uid(),v_card.id,1)
  on conflict on constraint inventory_pkey do update set quantity=inventory.quantity+1;
  insert into openings(user_id,card_id,set_id,cost) values(auth.uid(),v_card.id,v_set.id,v_set.booster_price);
  insert into moon_transactions(user_id,amount,reason) values(auth.uid(),-v_set.booster_price,'Abertura: '||v_set.name);
  return query select v_card.id,v_card.name,v_card.number,v_card.rarity,v_card.image_url,v_card.sell_value,v_moons;
end $$;

create or replace function public.sell_card(p_card_id bigint)
returns table(moons integer,sold_value integer)
language plpgsql security definer set search_path=public
as $$
declare v_qty integer; v_value integer; v_moons integer; v_name text;
begin
  select i.quantity,c.sell_value,c.name into v_qty,v_value,v_name from inventory i join cards c on c.id=i.card_id
  where i.user_id=auth.uid() and i.card_id=p_card_id for update of i;
  if not found then raise exception 'CARD_NOT_OWNED'; end if;
  if v_qty=1 then delete from inventory where user_id=auth.uid() and card_id=p_card_id;
  else update inventory set quantity=quantity-1 where user_id=auth.uid() and card_id=p_card_id; end if;
  update profiles set moons=profiles.moons+v_value where id=auth.uid() returning profiles.moons into v_moons;
  insert into moon_transactions(user_id,amount,reason) values(auth.uid(),v_value,'Venda: '||v_name);
  return query select v_moons,v_value;
end $$;

create or replace function public.admin_adjust_moons(p_user_id uuid,p_amount integer,p_reason text default 'Ajuste administrativo')
returns integer language plpgsql security definer set search_path=public
as $$ declare v_balance integer; begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  update profiles set moons=greatest(0,moons+p_amount) where id=p_user_id returning moons into v_balance;
  if v_balance is null then raise exception 'USER_NOT_FOUND'; end if;
  insert into moon_transactions(user_id,amount,reason,actor_id) values(p_user_id,p_amount,p_reason,auth.uid());
  return v_balance;
end $$;

create or replace function public.admin_grant_card(p_user_id uuid,p_card_id bigint,p_quantity integer default 1)
returns void language plpgsql security definer set search_path=public
as $$ begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_quantity<=0 then raise exception 'INVALID_QUANTITY'; end if;
  insert into inventory(user_id,card_id,quantity) values(p_user_id,p_card_id,p_quantity)
  on conflict on constraint inventory_pkey do update set quantity=inventory.quantity+p_quantity;
end $$;

create or replace function public.admin_upsert_card(
  p_set_id uuid,p_name text,p_number text,p_rarity text,p_image_url text,p_weight numeric,p_sell_value integer
) returns bigint language plpgsql security definer set search_path=public
as $$ declare v_id bigint; begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_weight<=0 or p_sell_value<=0 then raise exception 'INVALID_CARD_VALUES'; end if;
  insert into cards(set_id,name,number,rarity,image_url,weight,sell_value,active)
  values(p_set_id,trim(p_name),trim(p_number),p_rarity,p_image_url,p_weight,p_sell_value,true)
  on conflict(set_id,number) do update set name=excluded.name,rarity=excluded.rarity,
    image_url=excluded.image_url,weight=excluded.weight,sell_value=excluded.sell_value,active=true
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.open_booster(text) to authenticated;
grant execute on function public.sell_card(bigint) to authenticated;
grant execute on function public.admin_adjust_moons(uuid,integer,text) to authenticated;
grant execute on function public.admin_grant_card(uuid,bigint,integer) to authenticated;
grant execute on function public.admin_upsert_card(uuid,text,text,text,text,numeric,integer) to authenticated;
grant select on public.card_sets, public.cards to anon, authenticated;

insert into card_sets(slug,name,code,booster_price,image_url) values
('caos-ascendente','Caos Ascendente','ME04',2,'assets/images/booster.svg'),
('escuridao-absoluta','Escuridão Absoluta','PBL',2,'assets/images/booster-dark.svg')
on conflict(slug) do update set name=excluded.name,code=excluded.code,booster_price=excluded.booster_price;

-- Depois do seu primeiro cadastro, promova somente o seu email:
-- update public.profiles set role='admin' where email='SEU_EMAIL_AQUI';
