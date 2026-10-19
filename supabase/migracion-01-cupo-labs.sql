-- =====================================================================
-- Agenda Lad-ICI · Migración 01: cupo por espacio
--   · Lab 1, Lab 2 y Lab 3: hasta 3 reservas al mismo tiempo.
--   · Campana de flujo laminar y campana de extracción: uso exclusivo.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO → Run.
-- Solo hace falta si ya habías ejecutado schema.sql antes de este cambio.
-- Se puede volver a ejecutar sin problema y no borra reservas.
-- =====================================================================

-- 1. Campanas: la regla de no traslape aplica solo a ellas.
alter table public.reservas drop constraint if exists sin_traslape;
alter table public.reservas drop constraint if exists sin_traslape_campanas;
alter table public.reservas add constraint sin_traslape_campanas exclude using gist (
  recurso with =,
  tstzrange(inicio, fin, '[)') with &&
) where (cancelada_en is null and recurso in ('flujo', 'extraccion'));

-- 2. Laboratorios: máximo 3 reservas activas en cualquier momento.
create or replace function public.revisar_cupo_lab()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cupo constant int := 3;
  t timestamptz;
  n int;
begin
  if new.recurso not in ('lab1', 'lab2', 'lab3') or new.cancelada_en is not null then
    return new;
  end if;

  -- Turno por laboratorio: si dos personas reservan en el mismo segundo,
  -- la segunda espera a que la primera termine y luego se revisa el cupo.
  perform pg_advisory_xact_lock(hashtext('cupo:' || new.recurso));

  -- La ocupación máxima dentro del nuevo horario se da en su inicio
  -- o en el inicio de alguna reserva que empiece dentro de él.
  for t in
    select new.inicio
    union
    select r.inicio from public.reservas r
     where r.recurso = new.recurso and r.cancelada_en is null
       and r.inicio > new.inicio and r.inicio < new.fin
  loop
    select count(*) into n from public.reservas r
     where r.recurso = new.recurso and r.cancelada_en is null
       and r.inicio <= t and r.fin > t;
    if n >= cupo then
      raise exception 'cupo_lleno: % ya tiene % reservas a las %', new.recurso, n, t
        using errcode = 'P0001';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists cupo_lab on public.reservas;
create trigger cupo_lab
  before insert on public.reservas
  for each row execute function public.revisar_cupo_lab();
