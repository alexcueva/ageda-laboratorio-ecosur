-- =====================================================================
-- Agenda Lad-ICI · Migración 02: reservas repetidas (series)
-- Cada fecha de una reserva repetida es una reserva normal; las de una
-- misma serie comparten serie_id (y el mismo enlace de cancelación).
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO → Run.
-- Se puede volver a ejecutar sin problema y no borra reservas.
-- =====================================================================

alter table public.reservas add column if not exists serie_id uuid;
create index if not exists reservas_serie_idx on public.reservas (serie_id) where serie_id is not null;

-- La página puede ver si una reserva pertenece a una serie (no es dato sensible).
grant select (serie_id) on public.reservas to anon, authenticated;
