# Agenda Lad-ICI

Sistema de reservas de los espacios comunes del **Laboratorio de Investigación Científica Interdisciplinaria (Lad-ICI)**, ECOSUR.

- Espacios: Lab 1, Lab 2, Lab 3, campana de flujo laminar y campana de extracción.
- Horario: 8:00 a 22:00, bloques de 30 minutos, hora del centro de México. Primero en llegar, primero en reservar.
- Cada reserva pide nombre, correo del alumno y correo del investigador responsable.
- Al reservar, la persona recibe en pantalla un **enlace personal de cancelación** para copiar y guardar.
- **Correos de confirmación: opcionales** (desactivados por ahora). Se activan con Brevo; ver "Activar correos más adelante".
- Solo pueden cancelar **quien reservó** (desde el navegador donde reservó o con su enlace de cancelación) y los **administradores** (con inicio de sesión por correo).
- Cupo: cada laboratorio admite hasta **3 personas a la vez**; las campanas son de **uso exclusivo**. La base de datos aplica el cupo aunque dos personas reserven en el mismo segundo.

## Cómo funciona

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| `index.html`, `styles.css`, `app.js`, `config.js` | GitHub Pages | La página que ve todo el mundo |
| `supabase/schema.sql` | Supabase (base de datos) | Tablas, reglas de cupo, permisos, lista de administradores |
| `supabase/migracion-01-cupo-labs.sql` | Supabase (base de datos) | Solo si ejecutaste una versión anterior de `schema.sql`: cambia a cupo de 3 en labs |
| `supabase/functions/reservas/index.ts` | Supabase (Edge Function) | Crea y cancela reservas, verifica administradores, envía correos |
| Brevo (opcional) | Servicio externo | Envía correos de confirmación (gratis hasta 300 al día) |

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

### 4. Correos (Brevo) · OPCIONAL, sáltalo por ahora
1. Crea una cuenta gratuita en <https://www.brevo.com>.
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: registra y verifica el correo desde el que saldrán las confirmaciones.
3. **SMTP & API → API Keys → Generate a new API key**. Copia la clave.

> Si el remitente es un correo institucional (`@ecosur.mx`) sin configuración del dominio en Brevo, algunos mensajes pueden caer en spam. Si pasa, pide a TI que autorice a Brevo en el dominio, o usa como remitente una cuenta de Gmail dedicada al laboratorio.

### 5. Función del servidor
1. En Supabase: **Edge Functions → Deploy a new function → Via Editor**.
2. Nómbrala exactamente `reservas`, borra el código de ejemplo, pega `supabase/functions/reservas/index.ts` y pulsa **Deploy**.
3. En los detalles de la función desactiva **Enforce JWT verification** (la función hace sus propias verificaciones).
4. **Edge Functions → Secrets**: solo si activas los correos (paso 4). Sin secretos la agenda funciona sin correos. Agrega:

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

## Activar correos más adelante
1. Haz el paso 4 (Brevo) y agrega los secretos del paso 5.
2. En `config.js` cambia `correos: false` por `correos: true` y sube el cambio.
No hay que tocar la base de datos ni volver a desplegar la función.

## Prueba rápida
1. Abre la página y reserva un horario. Copia el enlace de cancelación que aparece.
2. Desde otro navegador (o ventana privada) toca esa reserva: no debe dejar cancelarla.
3. Abre el enlace de cancelación en esa ventana privada: debe dejar cancelar y liberar el horario.
4. Entra como administrador y cancela una reserva ajena.

## Mantenimiento
- **Agregar o quitar administradores**: en SQL Editor, `insert into administradores values ('correo@ecosur.mx');` o `delete from administradores where correo = '...';`, y crea o borra su usuario en Authentication.
- **Historial**: las reservas canceladas no se borran; quedan con `cancelada_en` y `cancelada_por` en **Table Editor → reservas**.
- **Proyecto en pausa**: Supabase gratuito pausa proyectos sin actividad por una semana. Con uso normal de la agenda no ocurre; si pasa, se reactiva desde el panel.
- **Cambiar espacios u horario**: hay que editar la lista en `app.js`, en `index.ts` y la restricción `recurso in (...)` de `schema.sql`.
- **Cambiar el cupo de los labs**: `cupo constant int := 3` en `schema.sql` (función `revisar_cupo_lab`), `CUPO_LAB` en `index.ts` y `cap` en `app.js`.
