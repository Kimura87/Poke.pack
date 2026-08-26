-- Corrige a ambiguidade entre a coluna inventory.card_id e o campo de retorno card_id.
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

grant execute on function public.open_booster(text) to authenticated;
