// =====================================================================
// Agenda Lad-ICI · Configuración de la página
// Supabase → Project Settings → API (o "API Keys")
// La clave pública (anon / publishable) puede estar aquí sin problema:
// la base de datos solo deja leer reservas y todo lo demás lo valida el servidor.
// NUNCA pongas aquí la clave "service_role" / "secret".
//
// Los correos de los administradores NO van aquí: van en supabase/schema.sql
// (sección 5), porque este archivo lo puede ver y modificar cualquiera.
// =====================================================================
window.AGENDA_CONFIG = {
  supabaseUrl: 'https://ngagmlkomfxnqvabbhes.supabase.co',
  supabaseKey: 'sb_publishable_bW9wdsEsUQehZamVVcIEbQ_GuJELB2t'
};
