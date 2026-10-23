// =====================================================================
// Agenda Lad-ICI · Función del servidor "reservas" (Supabase Edge Function)
//
// Acciones (POST JSON con campo "accion"):
//   crear           → valida y guarda una reserva; correo al alumno y al investigador
//   ver             → datos de una reserva a partir de su enlace de cancelación
//   cancelar        → cancela con el token del enlace (quien reservó)
//   cancelar_admin  → cancela cualquier reserva (requiere sesión de administrador)
//   detalle_admin   → correo del alumno de una reserva (solo administradores)
//
// Secretos (Edge Functions → Secrets):
// Todos son OPCIONALES: sin ellos la agenda funciona igual, solo no envía correos.
//   BREVO_API_KEY     clave de API de Brevo para enviar correos
//   REMITENTE_CORREO  correo remitente verificado en Brevo
//   REMITENTE_NOMBRE  nombre del remitente (opcional)
//   SITIO_URL         dirección de la página en GitHub Pages, p. ej.
//                     https://usuario.github.io/agenda-ladici/
// SUPABASE_URL y la clave de servidor los pone Supabase automáticamente.
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const LAB = "Lad-ICI";
const RECURSOS: Record<string, string> = {
  lab1: "Lab 1",
  lab2: "Lab 2",
  lab3: "Lab 3",
  flujo: "Campana de flujo laminar",
  extraccion: "Campana de extracción",
};
const ABRE = 8 * 60, CIERRA = 22 * 60, PASO = 30;
const CUPO_LAB = 3; // debe coincidir con revisar_cupo_lab() en schema.sql
const SERIE_MESES = 2;   // duración máxima de una reserva repetida
const SERIE_MAX = 62;    // tope de fechas por serie
const ZONA = "America/Mexico_City";
const OFFSET = "-06:00"; // Centro de México: sin horario de verano desde 2022

const SITIO = Deno.env.get("SITIO_URL") ?? "";
const BREVO = Deno.env.get("BREVO_API_KEY") ?? "";
const REM_CORREO = Deno.env.get("REMITENTE_CORREO") ?? "";
const REM_NOMBRE = Deno.env.get("REMITENTE_NOMBRE") ?? `Agenda ${LAB}`;

// Clave de servidor: formato nuevo (SUPABASE_SECRET_KEYS) o antiguo (service_role).
function claveServidor(): string {
  try {
    const d = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const k = d.default ?? Object.values(d)[0];
    if (typeof k === "string" && k) return k;
  } catch { /* sin claves nuevas */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  throw new Error("No hay clave de servidor disponible en la función.");
}

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  claveServidor(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fallo = (error: string, status = 400) => json({ error }, status);

// deno-lint-ignore no-explicit-any
type Reserva = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fallo("Método no permitido.", 405);
  // deno-lint-ignore no-explicit-any
  let b: any;
  try { b = await req.json(); } catch { return fallo("Solicitud inválida."); }
  try {
    switch (b?.accion) {
      case "crear": return await crear(b);
      case "crear_serie": return await crearSerie(b);
      case "cancelar_serie": return await cancelarSerie(b);
      case "cancelar_serie_admin": return await cancelarSerieAdmin(req, b);
      case "ver": return await ver(b);
      case "cancelar": return await cancelar(b);
      case "cancelar_admin": return await cancelarAdmin(req, b);
      case "detalle_admin": return await detalleAdmin(req, b);
      default: return fallo("Acción desconocida.");
    }
  } catch (e) {
    console.error(e);
    return fallo("Error interno del servidor. Intenta de nuevo en un momento.", 500);
  }
});

/* ---------------- utilidades ---------------- */
const pad = (n: number) => String(n).padStart(2, "0");
const marca = (fecha: string, min: number) => `${fecha}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00${OFFSET}`;
const correoOk = (v: string) => v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const esUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const fFecha = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fHora = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, hour: "numeric", minute: "2-digit", hourCycle: "h23" });
const cuando = (r: Reserva) =>
  `${fFecha.format(new Date(r.inicio))}, de ${fHora.format(new Date(r.inicio))} a ${fHora.format(new Date(r.fin))}`;

function enlaceCancelar(r: Reserva) {
  if (!SITIO) return "";
  const u = new URL(SITIO);
  u.searchParams.set("cancelar", r.id);
  u.searchParams.set("t", r.token_cancelacion);
  return u.toString();
}

const publica = (r: Reserva) => ({
  id: r.id, recurso: r.recurso, inicio: r.inicio, fin: r.fin, nombre: r.nombre,
  actividad: r.actividad, correo_investigador: r.correo_investigador,
  serie_id: r.serie_id ?? null,
  cancelada: !!r.cancelada_en, terminada: new Date(r.fin).getTime() <= Date.now(),
});

/* ---------------- acciones ---------------- */
// deno-lint-ignore no-explicit-any
type Datos = { recurso: string; ini: number; fin: number; nombre: string; correo_alumno: string; correo_investigador: string; actividad: string | null };
// deno-lint-ignore no-explicit-any
function validar(b: any): Datos | Response {
  const recurso = String(b.recurso ?? "");
  if (!RECURSOS[recurso]) return fallo("Espacio no válido.");
  const ini = Number(b.inicio), fin = Number(b.fin);
  if (!Number.isInteger(ini) || !Number.isInteger(fin) || ini % PASO || fin % PASO || ini < ABRE || fin > CIERRA || fin <= ini) {
    return fallo("Horario no válido. Se reserva de 8:00 a 22:00 en bloques de 30 minutos.");
  }
  const nombre = String(b.nombre ?? "").trim();
  if (nombre.length < 2 || nombre.length > 120) return fallo("Escribe tu nombre completo.");
  const correo_alumno = String(b.correo_alumno ?? "").trim().toLowerCase();
  if (!correoOk(correo_alumno)) return fallo("Revisa tu correo.");
  const correo_investigador = String(b.correo_investigador ?? "").trim().toLowerCase();
  if (!correoOk(correo_investigador)) return fallo("Revisa el correo de la persona académica responsable.");
  const actividad = String(b.actividad ?? "").trim().slice(0, 200) || null;
  return { recurso, ini, fin, nombre, correo_alumno, correo_investigador, actividad };
}

const esFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));

// deno-lint-ignore no-explicit-any
async function crear(b: any) {
  const v = validar(b); if (v instanceof Response) return v;
  const { recurso, ini, fin, nombre, correo_alumno, correo_investigador, actividad } = v;
  const fecha = String(b.fecha ?? "");
  if (!esFecha(fecha)) return fallo("Fecha no válida.");

  const inicio = marca(fecha, ini), termino = marca(fecha, fin);
  const t0 = new Date(inicio).getTime();
  if (Number.isNaN(t0)) return fallo("Fecha no válida.");
  if (t0 + PASO * 60000 <= Date.now()) return fallo("Ese horario ya pasó. Elige uno a partir de ahora.");

  const { data, error } = await db.from("reservas")
    .insert({ recurso, inicio, fin: termino, nombre, correo_alumno, correo_investigador, actividad })
    .select("*").single();
  if (error) {
    if (error.code === "23P01") return fallo("Ese horario acaba de ser apartado por alguien más. La agenda se actualizó; elige otro.", 409);
    if (error.code === "P0001" && /cupo_lleno/.test(error.message ?? "")) {
      return fallo(`${RECURSOS[recurso]} ya tiene ${CUPO_LAB} reservas en parte de ese horario. La agenda se actualizó; elige otro horario u otro laboratorio.`, 409);
    }
    if (error.code === "22008" || error.code === "22007") return fallo("Fecha no válida.");
    throw error;
  }
  const correo_enviado = await correoConfirmacion(data);
  return json({ id: data.id, token: data.token_cancelacion, correo_enviado });
}

// Reserva repetida: una reserva por fecha, ligadas por serie_id y con el mismo
// token de cancelación. Las fechas ocupadas o sin cupo se omiten y se informan.
// deno-lint-ignore no-explicit-any
async function crearSerie(b: any) {
  const v = validar(b); if (v instanceof Response) return v;
  const { recurso, ini, fin, nombre, correo_alumno, correo_investigador, actividad } = v;
  const desde = String(b.fecha_inicio ?? ""), hasta = String(b.fecha_fin ?? "");
  if (!esFecha(desde) || !esFecha(hasta)) return fallo("Fechas no válidas.");
  const dias = Array.isArray(b.dias) ? [...new Set(b.dias.map(Number))] : [];
  if (!dias.length || dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return fallo("Elige al menos un día de la semana.");
  const t0 = Date.parse(desde + "T00:00:00Z"), t1 = Date.parse(hasta + "T00:00:00Z");
  if (t1 < t0) return fallo("La fecha final debe ser posterior a la inicial.");
  const lim = new Date(t0); lim.setUTCMonth(lim.getUTCMonth() + SERIE_MESES);
  if (t1 > lim.getTime()) return fallo(`Una reserva repetida puede durar como máximo ${SERIE_MESES} meses.`);

  const fechas: string[] = [];
  for (let t = t0; t <= t1 && fechas.length < SERIE_MAX; t += 864e5) {
    const d = new Date(t);
    if (dias.includes(d.getUTCDay())) fechas.push(d.toISOString().slice(0, 10));
  }
  if (!fechas.length) return fallo("Ningún día elegido cae dentro de esas fechas.");

  const serie_id = crypto.randomUUID(), token = crypto.randomUUID();
  const creadas: { id: string; fecha: string }[] = [];
  const omitidas: { fecha: string; motivo: string }[] = [];
  for (const fecha of fechas) {
    const inicio = marca(fecha, ini), termino = marca(fecha, fin);
    if (new Date(inicio).getTime() + PASO * 60000 <= Date.now()) { omitidas.push({ fecha, motivo: "ya pasó" }); continue; }
    const { data, error } = await db.from("reservas")
      .insert({ recurso, inicio, fin: termino, nombre, correo_alumno, correo_investigador, actividad, serie_id, token_cancelacion: token })
      .select("id").single();
    if (error) {
      if (error.code === "23P01") { omitidas.push({ fecha, motivo: "ocupado" }); continue; }
      if (error.code === "P0001" && /cupo_lleno/.test(error.message ?? "")) { omitidas.push({ fecha, motivo: "sin cupo" }); continue; }
      throw error;
    }
    creadas.push({ id: data.id, fecha });
  }
  if (!creadas.length) return json({ error: "Ninguna de esas fechas estaba disponible.", omitidas }, 409);
  const correo_enviado = await correoSerie({ recurso, nombre, correo_alumno, correo_investigador, actividad, ini, fin }, creadas, omitidas, creadas[0].id, token);
  return json({ serie_id, token, creadas, omitidas, correo_enviado });
}

// deno-lint-ignore no-explicit-any
async function porToken(b: any): Promise<Reserva | null> {
  const id = String(b.id ?? ""), t = String(b.token ?? "");
  if (!esUuid(id) || !esUuid(t)) return null;
  const { data, error } = await db.from("reservas").select("*").eq("id", id).eq("token_cancelacion", t).maybeSingle();
  if (error) throw error;
  return data;
}

// deno-lint-ignore no-explicit-any
async function ver(b: any) {
  const r = await porToken(b);
  if (!r) return fallo("No encontramos esa reserva. Revisa que el enlace esté completo.", 404);
  return json({ reserva: { ...publica(r), correo_alumno: r.correo_alumno } });
}

async function marcarCancelada(r: Reserva, por: string) {
  const { data, error } = await db.from("reservas")
    .update({ cancelada_en: new Date().toISOString(), cancelada_por: por })
    .eq("id", r.id).is("cancelada_en", null).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

function revisarCancelable(r: Reserva) {
  if (r.cancelada_en) return fallo("Esta reserva ya estaba cancelada.", 409);
  if (new Date(r.fin).getTime() <= Date.now()) return fallo("Esta reserva ya terminó y no se puede cancelar.", 409);
  return null;
}

// deno-lint-ignore no-explicit-any
async function cancelar(b: any) {
  const r = await porToken(b);
  if (!r) return fallo("No encontramos esa reserva. Revisa que el enlace esté completo.", 404);
  const no = revisarCancelable(r); if (no) return no;
  if (!(await marcarCancelada(r, "propietario"))) return fallo("Esta reserva ya estaba cancelada.", 409);
  await correoCancelacion(r, null);
  return json({ ok: true });
}

async function cancelarFuturasDeSerie(serie_id: string, por: string, token?: string) {
  let q = db.from("reservas")
    .update({ cancelada_en: new Date().toISOString(), cancelada_por: por })
    .eq("serie_id", serie_id).is("cancelada_en", null).gt("fin", new Date().toISOString());
  if (token) q = q.eq("token_cancelacion", token);
  const { data, error } = await q.select("*");
  if (error) throw error;
  return (data ?? []) as Reserva[];
}

// deno-lint-ignore no-explicit-any
async function cancelarSerie(b: any) {
  const r = await porToken(b);
  if (!r) return fallo("No encontramos esa reserva. Revisa que el enlace esté completo.", 404);
  if (!r.serie_id) return fallo("Esta reserva no forma parte de una serie.");
  const hechas = await cancelarFuturasDeSerie(r.serie_id, "propietario", r.token_cancelacion);
  if (!hechas.length) return fallo("No quedan fechas pendientes en esta serie.", 409);
  await correoCancelacionSerie(hechas, null);
  return json({ ok: true, canceladas: hechas.length });
}

// deno-lint-ignore no-explicit-any
async function cancelarSerieAdmin(req: Request, b: any) {
  const admin = await correoAdmin(req);
  if (!admin) return fallo("Tu sesión no tiene permisos de administración. Vuelve a iniciar sesión.", 403);
  const r = await cargarPorId(b);
  if (!r) return fallo("No encontramos esa reserva.", 404);
  if (!r.serie_id) return fallo("Esta reserva no forma parte de una serie.");
  const hechas = await cancelarFuturasDeSerie(r.serie_id, `admin:${admin}`);
  if (!hechas.length) return fallo("No quedan fechas pendientes en esta serie.", 409);
  await correoCancelacionSerie(hechas, admin);
  return json({ ok: true, canceladas: hechas.length });
}

async function correoAdmin(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return null;
  const { data: lista, error: e2 } = await db.from("administradores").select("correo");
  if (e2) throw e2;
  return (lista ?? []).some((a) => String(a.correo).toLowerCase() === email) ? email : null;
}

// deno-lint-ignore no-explicit-any
async function cargarPorId(b: any): Promise<Reserva | null> {
  const id = String(b.id ?? "");
  if (!esUuid(id)) return null;
  const { data, error } = await db.from("reservas").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// deno-lint-ignore no-explicit-any
async function cancelarAdmin(req: Request, b: any) {
  const admin = await correoAdmin(req);
  if (!admin) return fallo("Tu sesión no tiene permisos de administración. Vuelve a iniciar sesión.", 403);
  const r = await cargarPorId(b);
  if (!r) return fallo("No encontramos esa reserva.", 404);
  const no = revisarCancelable(r); if (no) return no;
  if (!(await marcarCancelada(r, `admin:${admin}`))) return fallo("Esta reserva ya estaba cancelada.", 409);
  await correoCancelacion(r, admin);
  return json({ ok: true });
}

// deno-lint-ignore no-explicit-any
async function detalleAdmin(req: Request, b: any) {
  if (!(await correoAdmin(req))) return fallo("Tu sesión no tiene permisos de administración.", 403);
  const r = await cargarPorId(b);
  if (!r) return fallo("No encontramos esa reserva.", 404);
  return json({ correo_alumno: r.correo_alumno });
}

/* ---------------- correos ---------------- */
async function enviar(para: string[], asunto: string, html: string): Promise<boolean> {
  if (!BREVO || !REM_CORREO) {
    return false; // envío de correos desactivado
  }
  const dest = [...new Set(para.map((p) => p.toLowerCase()))];
  // deno-lint-ignore no-explicit-any
  const cuerpo: any = {
    sender: { name: REM_NOMBRE, email: REM_CORREO },
    to: [{ email: dest[0] }],
    subject: asunto,
    htmlContent: html,
  };
  if (dest.length > 1) cuerpo.cc = dest.slice(1).map((email) => ({ email }));
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (!res.ok) { console.error("Brevo", res.status, await res.text()); return false; }
    return true;
  } catch (e) {
    console.error("Brevo", e);
    return false;
  }
}

function plantilla(titulo: string, filas: [string, string][], pie: string) {
  const tabla = filas.map(([k, v]) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#5a6964;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;color:#14201c">${v}</td></tr>`
  ).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#14201c;max-width:560px">
<p style="margin:0 0 4px;color:#0e6a54;font-weight:bold">Agenda ${LAB}</p>
<h2 style="margin:0 0 16px;font-size:20px">${esc(titulo)}</h2>
<table style="border-collapse:collapse;margin-bottom:16px">${tabla}</table>
${pie}
<p style="margin:24px 0 0;font-size:12px;color:#5a6964">Laboratorio de Investigación Científica Interdisciplinaria (${LAB}). Este correo se generó automáticamente.</p>
</div>`;
}

const filasReserva = (r: Reserva): [string, string][] => [
  ["Espacio", esc(RECURSOS[r.recurso] ?? r.recurso)],
  ["Fecha y hora", esc(cuando(r))],
  ["Reservó", esc(r.nombre)],
  ["Correo de quien reservó", esc(r.correo_alumno)],
  ["Persona académica responsable", esc(r.correo_investigador)],
  ...(r.actividad ? [["Actividad", esc(r.actividad)] as [string, string]] : []),
];

function correoConfirmacion(r: Reserva) {
  const link = enlaceCancelar(r);
  const pie = link
    ? `<p style="margin:0 0 8px">Si ya no vas a usar el espacio, libéralo para que alguien más pueda apartarlo:</p>
<p style="margin:0"><a href="${esc(link)}" style="display:inline-block;background:#0e6a54;color:#ffffff;text-decoration:none;padding:9px 16px;border-radius:6px">Cancelar esta reserva</a></p>
<p style="margin:8px 0 0;font-size:12px;color:#5a6964">Este enlace es personal; no lo reenvíes.</p>`
    : "";
  return enviar(
    [r.correo_alumno, r.correo_investigador],
    `Reserva confirmada · ${RECURSOS[r.recurso]} · ${cuando(r)}`,
    plantilla("Reserva confirmada", filasReserva(r), pie),
  );
}

function correoCancelacion(r: Reserva, admin: string | null) {
  const pie = admin
    ? `<p style="margin:0">La reserva fue cancelada por la administración del laboratorio (${esc(admin)}). Si tienes dudas, responde a ese correo.</p>`
    : `<p style="margin:0">La reserva fue cancelada desde el enlace de cancelación. El horario quedó libre.</p>`;
  return enviar(
    [r.correo_alumno, r.correo_investigador],
    `Reserva cancelada · ${RECURSOS[r.recurso]} · ${cuando(r)}`,
    plantilla("Reserva cancelada", filasReserva(r), pie),
  );
}

const fCorta = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const hm = (m: number) => `${Math.floor(m / 60)}:${pad(m % 60)}`;

// deno-lint-ignore no-explicit-any
function correoSerie(d: any, creadas: { fecha: string }[], omitidas: { fecha: string; motivo: string }[], id: string, token: string) {
  const lista = creadas.map((c) => fCorta.format(new Date(c.fecha + "T12:00:00Z"))).join(", ");
  const filas: [string, string][] = [
    ["Espacio", esc(RECURSOS[d.recurso])],
    ["Horario", `${hm(d.ini)} a ${hm(d.fin)}`],
    [`Fechas (${creadas.length})`, esc(lista)],
    ["Reservó", esc(d.nombre)],
    ["Correo", esc(d.correo_alumno)],
    ["Persona académica responsable", esc(d.correo_investigador)],
  ];
  if (omitidas.length) filas.push(["No reservadas", esc(omitidas.map((o) => `${fCorta.format(new Date(o.fecha + "T12:00:00Z"))} (${o.motivo})`).join(", "))]);
  const link = enlaceCancelar({ id, token_cancelacion: token });
  const pie = link ? `<p style="margin:0"><a href="${esc(link)}">Cancelar una fecha o la serie completa</a></p>` : "";
  return enviar([d.correo_alumno, d.correo_investigador], `Reserva repetida confirmada · ${RECURSOS[d.recurso]}`, plantilla("Reserva repetida confirmada", filas, pie));
}

function correoCancelacionSerie(rs: Reserva[], admin: string | null) {
  const r = rs[0];
  const pie = admin
    ? `<p style="margin:0">La serie fue cancelada por la administración del laboratorio (${esc(admin)}).</p>`
    : `<p style="margin:0">La serie fue cancelada desde el enlace de cancelación. Los horarios quedaron libres.</p>`;
  return enviar([r.correo_alumno, r.correo_investigador], `Reserva repetida cancelada · ${RECURSOS[r.recurso]}`,
    plantilla("Reserva repetida cancelada", [["Espacio", esc(RECURSOS[r.recurso])], ["Fechas canceladas", String(rs.length)], ["Reservó", esc(r.nombre)]], pie));
}
