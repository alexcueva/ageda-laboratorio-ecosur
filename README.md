# Agenda Lad-ICI

Sistema de reservas de los espacios comunes del **Laboratorio de Investigación Científica Interdisciplinaria (Lad-ICI)**, ECOSUR.

- Espacios: Lab 1, Lab 2, Lab 3, campana de flujo laminar y campana de extracción.
- Horario: 8:00 a 22:00, bloques de 30 minutos, hora del centro de México. Primero en llegar, primero en reservar.
- Cada reserva pide nombre, correo del alumno y correo del investigador responsable; ambos reciben un correo de confirmación.
- Solo pueden cancelar **quien reservó** (desde el navegador donde reservó o con el enlace del correo) y los **administradores** (con inicio de sesión por correo). Ambos casos avisan por correo.
- La base de datos impide dos reservas encimadas en el mismo espacio.

## Cómo funciona

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| `index.html`, `styles.css`, `app.js`, `config.js` | GitHub Pages | La página que ve todo el mundo |
| `supabase/schema.sql` | Supabase (base de datos) | Tablas, regla de no traslape, permisos, lista de administradores |
| `supabase/functions/reservas/index.ts` | Supabase (Edge Function) | Crea y cancela reservas, verifica administradores, envía correos |
| Brevo | Servicio externo | Envía los correos (gratis hasta 300 al día) |

La página solo puede **leer** reservas (sin el correo del alumno). Crear y cancelar pasa siempre por la función del servidor, así que nadie puede borrar reservas ajenas aunque modifique la página.

---

## Instalación (una sola vez, ~30 min)

### 1. Supabase: crear el proyecto
1. Entra a <https://supabase.com>, crea una cuenta y un proyecto nuevo (plan gratuito).
2. En **Project Settings → API** (o **API Keys**) copia:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **Clave pública**: la `anon` o `publishable`. **No** uses la `service_role` / `secret`.

### 2. Base de datos
1. En **SQL Editor → New query** pega todo `supabase/schema.sql`.
2. En la sección 5 del archivo cambia `admin1@ecosur.mx` y `admin2@ecosur.mx` por los correos reales.
3. Pulsa **Run**.

### 3. Administradores y acceso por correo
1. **Authentication → Users → Add user → Create new user**: crea un usuario por cada administrador con su correo (marca *Auto Confirm User*; la contraseña no se usa).
2. **Authentication → URL Configuration**:
   - **Site URL**: la dirección de la página en GitHub Pages (paso 6), p. ej. `https://tu-usuario.github.io/agenda-ladici/`
   - **Redirect URLs**: agrega esa misma dirección.

Los administradores entran con el botón *Acceso de administradores* al pie de la página: reciben un enlace en su correo y quedan con sesión iniciada en ese navegador.

### 4. Correos (Brevo)
1. Crea una cuenta gratuita en <https://www.brevo.com>.
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: registra y verifica el correo desde el que saldrán las confirmaciones.
3. **SMTP & API → API Keys → Generate a new API key**. Copia la clave.

> Si el remitente es un correo institucional (`@ecosur.mx`) sin configuración del dominio en Brevo, algunos mensajes pueden caer en spam. Si pasa, pide a TI que autorice a Brevo en el dominio, o usa como remitente una cuenta de Gmail dedicada al laboratorio.

### 5. Función del servidor
1. En Supabase: **Edge Functions → Deploy a new function → Via Editor**.
2. Nómbrala exactamente `reservas`, borra el código de ejemplo, pega `supabase/functions/reservas/index.ts` y pulsa **Deploy**.
3. En los detalles de la función desactiva **Enforce JWT verification** (la función hace sus propias verificaciones).
4. **Edge Functions → Secrets**, agrega:

| Nombre | Valor |
|---|---|
| `BREVO_API_KEY` | la clave del paso 4 |
| `REMITENTE_CORREO` | el remitente verificado en Brevo |
| `REMITENTE_NOMBRE` | `Agenda Lad-ICI` |
| `SITIO_URL` | la dirección de GitHub Pages, terminada en `/` |

Alternativa con la terminal: `supabase functions deploy reservas --no-verify-jwt` y `supabase secrets set NOMBRE=valor`.

### 6. Página en GitHub Pages
1. Edita `config.js` con la Project URL y la clave pública del paso 1.
2. Crea un repositorio (p. ej. `agenda-ladici`) y sube todos los archivos.
3. **Settings → Pages → Build and deployment**: *Deploy from a branch*, rama `main`, carpeta `/ (root)`. Guarda.
4. En uno o dos minutos la página queda en `https://tu-usuario.github.io/agenda-ladici/`.

### 7. Teams
En el canal del grupo: **+ (Agregar pestaña) → Sitio web**, pega la dirección de GitHub Pages y nómbrala *Agenda Lad-ICI*.

---

## Prueba rápida
1. Abre la página y reserva un horario con tu correo en ambos campos. Debe llegar la confirmación.
2. Desde otro navegador (o ventana privada) toca esa reserva: no debe dejar cancelarla.
3. Abre el enlace *Cancelar esta reserva* del correo: debe liberar el horario y mandar el aviso.
4. Entra como administrador y cancela una reserva ajena.

## Mantenimiento
- **Agregar o quitar administradores**: en SQL Editor, `insert into administradores values ('correo@ecosur.mx');` o `delete from administradores where correo = '...';`, y crea o borra su usuario en Authentication.
- **Historial**: las reservas canceladas no se borran; quedan con `cancelada_en` y `cancelada_por` en **Table Editor → reservas**.
- **Proyecto en pausa**: Supabase gratuito pausa proyectos sin actividad por una semana. Con uso normal de la agenda no ocurre; si pasa, se reactiva desde el panel.
- **Cambiar espacios u horario**: hay que editar la lista en `app.js`, en `index.ts` y la restricción `recurso in (...)` de `schema.sql`.
