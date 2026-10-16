-- =====================================================================
-- Agenda Lad-ICI · Esquema de base de datos
-- Laboratorio de Investigación Científica Interdisciplinaria
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este
-- archivo → edita los correos de administradores (sección 5) → Run.
-- Se puede volver a ejecutar sin perder datos.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. Reservas
-- ---------------------------------------------------------------------
create table if not exists public.reservas (
  id                  uuid primary key default gen_random_uuid(),
  recurso             text not null
                      check (recurso in ('lab1','lab2','lab3','flujo','extraccion')),
  inicio              timestamptz not null,
  fin                 timestamptz not null,
  nombre              text not null check (char_length(nombre) between 2 and 120),
  correo_alumno       text not null check (correo_alumno ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  correo_investigador text not null check (correo_investigador ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  actividad           text check (actividad is null or char_length(actividad) <= 200),
  token_cancelacion   uuid not null default gen_random_uuid(),
  creada_en           timestamptz not null default now(),
  cancelada_en        timestamptz,
  cancelada_por       text,
  constraint fin_despues_de_inicio check (fin > inicio),
  -- Regla central: un mismo espacio no puede tener dos reservas activas
  -- que se encimen. La base de datos la aplica aunque dos personas
  -- reserven en el mismo segundo.
  constraint sin_traslape exclude using gist (
    recurso with =,
    tstzrange(inicio, fin, '[)') with &&
  ) where (cancelada_en is null)
);

create index if not exists reservas_inicio_idx on public.reservas (inicio);

-- ---------------------------------------------------------------------
-- 2. Administradores (pueden cancelar cualquier reserva)
-- ---------------------------------------------------------------------
create table if not exists public.administradores (
  correo text primary key
);

-- ---------------------------------------------------------------------
-- 3. Permisos
--    · El público solo LEE reservas activas y solo columnas no sensibles
--      (sin correo del alumno ni token de cancelación).
--    · Nadie escribe directamente: crear y cancelar pasan por la
--      función del servidor "reservas", que valida todo.
-- ---------------------------------------------------------------------
alter table public.reservas enable row level security;
alter table public.administradores enable row level security;

revoke all on public.reservas from anon, authenticated;
revoke all on public.administradores from anon, authenticated;

-- Permisos explícitos (necesarios si el proyecto se creó sin
-- "Automatically expose new tables"). service_role es la que usa
-- la función del servidor; nunca sale del servidor.
grant usage on schema public to anon, authenticated, service_role;
grant all on public.reservas to service_role;
grant all on public.administradores to service_role;

grant select (id, recurso, inicio, fin, nombre, actividad, correo_investigador)
  on public.reservas to anon, authenticated;

drop policy if exists "lectura de reservas activas" on public.reservas;
create policy "lectura de reservas activas" on public.reservas
  for select to anon, authenticated
  using (cancelada_en is null);

-- ---------------------------------------------------------------------
-- 4. ¿La sesión actual es de un administrador?
-- ---------------------------------------------------------------------
create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.administradores
    where lower(correo) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 5. CONFIGURACIÓN · correos de los administradores
--    Cambia estos dos correos por los reales antes de ejecutar.
--    Cada uno debe darse de alta también en Authentication → Users.
-- ---------------------------------------------------------------------
insert into public.administradores (correo) values
  ('admin1@ecosur.mx'),
  ('admin2@ecosur.mx')
on conflict do nothing;

-- Para quitar un administrador más adelante:
-- delete from public.administradores where correo = 'correo@ecosur.mx';
