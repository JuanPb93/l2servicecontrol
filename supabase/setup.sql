-- Dethrone Control v1.4 — rode no SQL Editor do seu projeto Supabase.
-- Os PINs NÃO devem ser colocados neste SQL ou no GitHub.
-- Eles ficam no secret ACCESS_PINS da Edge Function.

create table if not exists public.dethrone_workspace (
  id text primary key,
  data jsonb not null,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint dethrone_workspace_max_size check (pg_column_size(data) <= 5000000)
);

alter table public.dethrone_workspace enable row level security;
revoke all on public.dethrone_workspace from public, anon, authenticated;
grant select, insert, update on public.dethrone_workspace to service_role;
-- Não criar políticas públicas. Somente a Edge Function usa a chave secreta do servidor.

create table if not exists public.dethrone_pin_limits (
  rate_key text primary key,
  attempts int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  last_seen timestamptz not null default now()
);

alter table public.dethrone_pin_limits enable row level security;
revoke all on public.dethrone_pin_limits from public, anon, authenticated;
grant select, insert, update on public.dethrone_pin_limits to service_role;

-- Verifica o bloqueio e contabiliza falhas com trava de linha, evitando tentativas simultâneas.
-- p_success NULL = apenas consultar; TRUE = PIN correto; FALSE = tentativa errada.
create or replace function public.dethrone_pin_guard(p_key text, p_success boolean default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  r public.dethrone_pin_limits%rowtype;
  now_t timestamptz := now();
  limit_count int := case when p_key = 'global' then 100 else 6 end;
  lock_duration interval := case when p_key = 'global' then interval '15 minutes' else interval '20 minutes' end;
begin
  if p_key is null or length(p_key) > 100 or length(p_key) < 4 then
    return false;
  end if;
  insert into public.dethrone_pin_limits(rate_key)
  values (p_key)
  on conflict (rate_key) do nothing;
  select * into r from public.dethrone_pin_limits where rate_key = p_key for update;

  if r.locked_until is not null and r.locked_until > now_t then
    return false;
  end if;

  if r.window_start + interval '20 minutes' < now_t then
    update public.dethrone_pin_limits
    set attempts=0, window_start=now_t, locked_until=null, last_seen=now_t
    where rate_key=p_key;
    r.attempts := 0;
  end if;

  if p_success is null then return true; end if;
  if p_success is true then
    if p_key <> 'global' then
      update public.dethrone_pin_limits
      set attempts=0, locked_until=null, window_start=now_t, last_seen=now_t
      where rate_key=p_key;
    end if;
    return true;
  end if;

  update public.dethrone_pin_limits
  set attempts=attempts+1,
      locked_until=case when attempts+1 >= limit_count then now_t + lock_duration else null end,
      last_seen=now_t
  where rate_key=p_key;
  return false;
end;
$$;

revoke execute on function public.dethrone_pin_guard(text,boolean) from public, anon, authenticated;
grant execute on function public.dethrone_pin_guard(text,boolean) to service_role;

-- Verificação (as duas tabelas devem ter RLS ativo):
-- select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'dethrone_%';
