// =====================================================================
// Agenda Lad-ICI · lógica de la página
// =====================================================================
(() => {
'use strict';

// Debe coincidir con supabase/schema.sql y con la función "reservas".
// cap = reservas simultáneas permitidas (labs: 3 personas; campanas: uso exclusivo)
const RES = [
  {id:'lab1', name:'Lab 1', kind:'Laboratorio', c:'--r1', cap:3},
  {id:'lab2', name:'Lab 2', kind:'Laboratorio', c:'--r2', cap:3},
  {id:'lab3', name:'Lab 3', kind:'Laboratorio', c:'--r3', cap:3},
  {id:'flujo', name:'Campana de flujo laminar', short:'Flujo laminar', kind:'Campana', c:'--r4', cap:1},
  {id:'extraccion', name:'Campana de extracción', short:'Extracción', kind:'Campana', c:'--r5', cap:1}
];
const capTxt = r => r.cap > 1 ? `hasta ${r.cap} a la vez` : 'uso exclusivo';
const ZONA = 'America/Mexico_City', OFFSET = '-06:00';
const OPEN = 8*60, CLOSE = 22*60, STEP = 30, NSLOT = (CLOSE-OPEN)/STEP;
const MINE = 'agenda-ladici-mias', PREF = 'agenda-ladici-pref', DRAFT = 'agenda-ladici-datos';

/* ---------- utilidades de fecha (todo en hora del centro de México) ---------- */
const pad = n => String(n).padStart(2,'0');
const mkDay = (y,m,d) => new Date(Date.UTC(y, m-1, d));
const dkey = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
const fromKey = k => { const [y,m,d] = k.split('-').map(Number); return mkDay(y,m,d); };
const addDays = (d,n) => new Date(d.getTime() + n*864e5);
const hm = m => `${Math.floor(m/60)}:${pad(m%60)}`;
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DIAS_C = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const fmtParts = new Intl.DateTimeFormat('en-CA', {timeZone: ZONA, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
function mx(date){
  const p = {}; fmtParts.formatToParts(date).forEach(x => p[x.type] = x.value);
  return {key: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour)*60 + Number(p.minute)};
}
const todayKey = () => mx(new Date()).key;
const nowMin = () => mx(new Date()).min;
const longDate = k => { const d = fromKey(k); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; };
function isPastSlot(date, start){
  const t = todayKey();
  if (date < t) return true;
  if (date > t) return false;
  return start + STEP <= nowMin();
}

/* ---------- utilidades generales ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const resById = id => RES.find(r => r.id === id);
const lsGet = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch(e){ return fb; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} };
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const $ = id => document.getElementById(id);

/* ---------- conexión ---------- */
const CFG = window.AGENDA_CONFIG || {};
const configurado = CFG.supabaseUrl && CFG.supabaseKey && !/TU-PROYECTO|TU-CLAVE/.test(CFG.supabaseUrl + CFG.supabaseKey);
const sb = configurado && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;
const CORREOS = CFG.correos === true;   // true solo si la función tiene configurado el envío (Brevo)
const cancelLink = (id, t) => `${location.origin}${location.pathname}?cancelar=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`;

// Bloque con el enlace personal de cancelación y botón para copiarlo.
function linkBox(id, t){
  return `<div class="field"><label for="cLink">Tu enlace de cancelación</label>
    <div class="copyrow"><input id="cLink" readonly value="${esc(cancelLink(id, t))}"><button type="button" class="btn" id="cCopy">Copiar</button></div>
    <small>Guárdalo: con él puedes cancelar desde cualquier dispositivo. Funciona como una llave; no lo compartas.</small></div>`;
}
function wireCopy(){
  const btn = $('cCopy'), inp = $('cLink');
  if (!btn || !inp) return;
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(inp.value); btn.textContent = 'Copiado'; }
    catch(e){ inp.focus(); inp.select(); btn.textContent = 'Selecciónalo y copia'; }
    setTimeout(() => { btn.textContent = 'Copiar'; }, 2500);
  });
}

async function api(body){
  const { data, error } = await sb.functions.invoke('reservas', { body });
  if (error){
    let msg = 'No se pudo completar la operación. Revisa tu conexión e intenta de nuevo.';
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch(e){}
    const err = new Error(msg);
    err.status = error.context && error.context.status;
    throw err;
  }
  return data;
}

/* ---------- estado ---------- */
let mine = lsGet(MINE, {});            // id → {t: token, a: correo alumno}
const saveMine = () => lsSet(MINE, mine);
const pref = lsGet(PREF, {});
const state = {
  view: pref.view === 'semana' ? 'semana' : 'dia',
  cur: fromKey(todayKey()),
  selRes: resById(pref.res) ? pref.res : 'lab1',
  rows: [], loading: false, error: '', admin: null
};
const savePref = () => lsSet(PREF, {view: state.view, res: state.selRes});

function weekDays(d){ const off = (d.getUTCDay() + 6) % 7; const mon = addDays(d, -off); return [...Array(7)].map((_, i) => addDays(mon, i)); }
const columnDates = () => state.view === 'dia' ? [state.cur] : weekDays(state.cur);
const list = (date, res) => state.rows.filter(b => b.date === date && b.res === res).sort((a,b) => a.start - b.start || a.end - b.end);
const occAt = (date, res, t) => list(date, res).filter(b => b.start <= t && b.end > t).length;
// Reparte reservas encimadas en carriles (máximo = cupo del espacio).
function withLanes(items){
  const ends = [];
  return items.map(b => {
    let i = ends.findIndex(e => e <= b.start);
    if (i < 0){ i = ends.length; ends.push(0); }
    ends[i] = b.end;
    return {b, lane: i};
  });
}

function toRow(r){
  const a = mx(new Date(r.inicio)), b = mx(new Date(r.fin));
  return {id: r.id, res: r.recurso, date: a.key, start: a.min, end: b.key === a.key ? b.min : CLOSE,
          nombre: r.nombre, motivo: r.actividad || '', investigador: r.correo_investigador};
}

let seq = 0;
async function load(){
  if (!sb) return render();
  const days = columnDates();
  const from = dkey(days[0]), to = dkey(addDays(days[days.length-1], 1));
  const my = ++seq;
  state.loading = true; renderStatus();
  const { data, error } = await sb.from('reservas')
    .select('id,recurso,inicio,fin,nombre,actividad,correo_investigador')
    .gte('inicio', `${from}T00:00:00${OFFSET}`)
    .lt('inicio', `${to}T00:00:00${OFFSET}`)
    .order('inicio');
  if (my !== seq) return;
  state.loading = false;
  if (error){ state.error = 'No se pudo cargar la agenda. Revisa tu conexión; se reintentará en un minuto.'; console.error(error); }
  else { state.error = ''; state.rows = (data || []).map(toRow); }
  render();
}

/* ---------- dibujo ---------- */
function renderStatus(){
  const st = $('status');
  let msg = '';
  if (!configurado) msg = 'Falta configurar la conexión: edita config.js con la URL y la clave pública de tu proyecto de Supabase.';
  else if (!window.supabase) msg = 'No se pudo cargar la biblioteca de Supabase. Revisa tu conexión y recarga la página.';
  else msg = state.error;
  st.textContent = msg; st.hidden = !msg;
  $('gridWrap').classList.toggle('loading', state.loading);
}

function render(){
  renderStatus();
  $('vDia').setAttribute('aria-pressed', state.view === 'dia');
  $('vSem').setAttribute('aria-pressed', state.view === 'semana');
  $('chips').hidden = state.view !== 'semana';
  const tk = todayKey();
  let cols;
  if (state.view === 'dia'){
    const k = dkey(state.cur), d = state.cur;
    cols = RES.map(r => ({res: r, date: k, title: r.short || r.name, sub: `${r.kind} · ${capTxt(r)}`}));
    $('dateLabel').textContent = `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
  } else {
    const days = weekDays(state.cur), r = resById(state.selRes);
    cols = days.map(d => ({res: r, date: dkey(d), title: `${DIAS_C[d.getUTCDay()]} ${d.getUTCDate()}`, sub: `${r.short || r.name} · ${capTxt(r)}`}));
    const a = days[0], b = days[6];
    $('dateLabel').textContent = a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()}–${b.getUTCDate()} de ${MESES[a.getUTCMonth()]} de ${b.getUTCFullYear()}`
      : `${a.getUTCDate()} de ${MESES[a.getUTCMonth()]} – ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]} de ${b.getUTCFullYear()}`;
    $('chips').innerHTML = RES.map(x => `<button type="button" class="chip" style="--rc:var(${x.c})" data-res="${x.id}" aria-pressed="${x.id === state.selRes}">${esc(x.name)}</button>`).join('');
  }

  const tracks = cols.map(c => c.res.cap > 1 ? 'minmax(180px, 1.6fr)' : 'minmax(118px, 1fr)').join(' ');
  let h = `<div class="grid" style="grid-template-columns:54px ${tracks}"><div class="gh corner"></div>`;
  cols.forEach(c => {
    h += `<div class="gh${state.view === 'semana' && c.date === tk ? ' is-today' : ''}" style="--rc:var(${c.res.c})"><span class="gh-t">${esc(c.title)}</span><span class="gh-s">${esc(c.sub)}</span></div>`;
  });
  h += `<div class="times">`;
  for (let i = 0; i < NSLOT/2; i++) h += `<span style="top:calc(var(--row) * ${i*2})">${pad(8+i)}:00</span>`;
  h += `</div>`;
  cols.forEach(c => {
    const cap = c.res.cap;
    h += `<div class="col" style="--rc:var(${c.res.c});--cap:${cap}">`;
    for (let s = 0; s < NSLOT; s++){
      const st = OPEN + s*STEP, past = isPastSlot(c.date, st) || !sb;
      const occ = occAt(c.date, c.res.id, st), full = occ >= cap;
      const lbl = cap > 1 && occ ? `${hm(st)} · ${cap - occ} libre${cap - occ > 1 ? 's' : ''}` : hm(st);
      h += `<button type="button" class="cell${s % 2 ? ' half' : ''}${full ? ' full' : ''}" data-res="${c.res.id}" data-date="${c.date}" data-start="${st}" data-label="${lbl}" ${past || full ? 'disabled' : ''} aria-label="${full ? 'Sin cupo' : 'Reservar'} ${esc(c.res.name)}, ${longDate(c.date)}, ${hm(st)}${cap > 1 ? `, ${occ} de ${cap} ocupados` : ''}"></button>`;
    }
    withLanes(list(c.date, c.res.id)).forEach(({b, lane}) => {
      const s0 = Math.max(b.start, OPEN), s1 = Math.min(b.end, CLOSE);
      if (s1 <= s0) return;
      const top = (s0 - OPEN)/STEP, n = (s1 - s0)/STEP;
      h += `<button type="button" class="bk${mine[b.id] ? ' mine' : ''}${n < 2 ? ' short' : ''}" data-id="${b.id}" title="${esc(b.nombre)} · ${hm(b.start)}–${hm(b.end)}" style="--lane:${Math.min(lane, cap - 1)};top:calc(var(--row) * ${top} + 1px);height:calc(var(--row) * ${n} - 2px)" aria-label="${esc(b.nombre)}, ${hm(b.start)} a ${hm(b.end)}"><span class="bk-n">${esc(b.nombre)}</span><span class="bk-t">${hm(b.start)}–${hm(b.end)}</span></button>`;
    });
    if (c.date === tk){ const nm = nowMin(); if (nm >= OPEN && nm <= CLOSE) h += `<div class="now" style="top:calc(var(--row) * ${(nm - OPEN)/STEP})"></div>`; }
    h += `</div>`;
  });
  $('grid').innerHTML = h + `</div>`;
}

function renderAdmin(){
  $('adminTag').hidden = !state.admin;
  $('adminInfo').textContent = state.admin ? `Sesión de administrador: ${state.admin}` : '';
  $('adminBtn').textContent = state.admin ? 'Cerrar sesión' : 'Acceso de administradores';
}

/* ---------- ventanas ---------- */
const overlay = $('overlay'), modal = $('modal');
let lastFocus = null;
function openModal(html){
  if (overlay.hidden) lastFocus = document.activeElement;
  modal.innerHTML = html; overlay.hidden = false;
  const f = modal.querySelector('input, select, button'); if (f) f.focus();
}
function closeModal(){ overlay.hidden = true; modal.innerHTML = ''; if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); }
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) closeModal(); });

const metaLine = (r, date, start, end) =>
  `<div class="meta" style="--rc:var(${r.c})"><i class="dot"></i><strong>${esc(r.name)}</strong><span>${longDate(date)}</span>${start != null ? `<span>${hm(start)}–${hm(end)}</span>` : ''}</div>`;

let tt;
function toast(t){ const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => el.hidden = true, 3200); }

/* ---------- reservar ---------- */
function openForm(resId, date, start){
  const r = resById(resId);
  // Se puede extender hasta el primer bloque sin cupo.
  let limit = start + STEP;
  for (let t = start; t < CLOSE; t += STEP){ if (occAt(date, resId, t) >= r.cap) break; limit = t + STEP; }
  const def = Math.min(start + 60, limit);
  const occ = occAt(date, resId, start);
  let hint = '';
  if (r.cap > 1){
    if (occ) hint = `Ya hay ${occ} de ${r.cap} personas en este laboratorio a las ${hm(start)}.`;
    if (limit < CLOSE) hint += `${hint ? ' ' : ''}Se llena a las ${hm(limit)}.`;
  } else if (limit < CLOSE) hint = `Siguiente reserva en este espacio a las ${hm(limit)}.`;
  let opts = '';
  for (let e = start + STEP; e <= limit; e += STEP){
    const dur = e - start, durTxt = dur < 60 ? `${dur} min` : `${Math.floor(dur/60)} h${dur % 60 ? ' 30 min' : ''}`;
    opts += `<option value="${e}"${e === def ? ' selected' : ''}>${hm(e)} (${durTxt})</option>`;
  }
  const dr = lsGet(DRAFT, {});
  openModal(`
    <h2 id="mTitle">Nueva reserva</h2>
    ${metaLine(r, date)}
    <form id="fRes" novalidate class="stack">
      <div class="row2">
        <div class="field"><label for="fIni">Inicio</label><input id="fIni" value="${hm(start)}" disabled></div>
        <div class="field"><label for="fFin">Término</label><select id="fFin">${opts}</select></div>
      </div>
      ${hint ? `<span class="hint">${hint}</span>` : ''}
      <div class="field"><label for="fNom">Nombre completo</label><input id="fNom" required maxlength="120" autocomplete="name" value="${esc(dr.nombre)}"></div>
      <div class="field"><label for="fAlu">Correo del alumno</label><input id="fAlu" type="email" required maxlength="200" autocomplete="email" value="${esc(dr.alumno)}"></div>
      <div class="field"><label for="fInv">Correo del investigador responsable</label><input id="fInv" type="email" required maxlength="200" value="${esc(dr.investigador)}">${CORREOS ? '<small>Recibe copia de la confirmación.</small>' : ''}</div>
      <div class="field"><label for="fMot">Actividad <span style="font-weight:400;color:var(--muted)">(opcional)</span></label><input id="fMot" maxlength="200" placeholder="p. ej. extracción de ADN, digestión ácida"></div>
      <p class="err" id="fErr" hidden></p>
      <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary" id="fGo">Reservar</button></div>
    </form>`);
  setTimeout(() => (dr.nombre ? $('fFin') : $('fNom')).focus(), 0);

  $('fRes').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = $('fErr'), go = $('fGo'); err.hidden = true;
    const nombre = $('fNom').value.trim(), alumno = $('fAlu').value.trim(), investigador = $('fInv').value.trim();
    const fin = Number($('fFin').value), actividad = $('fMot').value.trim();
    let msg = '';
    if (nombre.length < 2) msg = 'Escribe tu nombre completo.';
    else if (!emailOk(alumno)) msg = 'Revisa el correo del alumno; debe tener la forma nombre@dominio.mx.';
    else if (!emailOk(investigador)) msg = 'Revisa el correo del investigador responsable.';
    if (msg){ err.textContent = msg; err.hidden = false; return; }
    go.disabled = true; go.textContent = 'Reservando…';
    try {
      const res = await api({accion:'crear', recurso: resId, fecha: date, inicio: start, fin, nombre, correo_alumno: alumno, correo_investigador: investigador, actividad});
      mine[res.id] = {t: res.token, a: alumno.toLowerCase()}; saveMine();
      lsSet(DRAFT, {nombre, alumno, investigador});
      showConfirm({id: res.id, token: res.token, res: resId, date, start, end: fin, nombre, motivo: actividad, alumno, investigador}, res.correo_enviado);
      load();
    } catch(e){
      err.textContent = e.message; err.hidden = false;
      go.disabled = false; go.textContent = 'Reservar';
      if (e.status === 409) load();
    }
  });
}

function showConfirm(b, enviado){
  const r = resById(b.res);
  openModal(`
    <div class="ok"><span class="ok-mark" aria-hidden="true">✓</span><h2 id="mTitle">Reserva confirmada</h2></div>
    ${metaLine(r, b.date, b.start, b.end)}
    <dl><dt>Nombre</dt><dd>${esc(b.nombre)}</dd>${b.motivo ? `<dt>Actividad</dt><dd>${esc(b.motivo)}</dd>` : ''}</dl>
    ${!CORREOS ? ''
      : enviado ? `<p class="note">Enviamos la confirmación a <strong>${esc(b.alumno)}</strong> y a <strong>${esc(b.investigador)}</strong>.</p>`
      : `<p class="note warn">La reserva quedó registrada, pero no se pudo enviar el correo de confirmación.</p>`}
    ${linkBox(b.id, b.token)}
    <p class="note">También puedes cancelarla desde este navegador. Si es una computadora compartida, quien la use después en este mismo navegador también podría cancelarla; mejor reserva desde tu celular o tu computadora.</p>
    <div class="actions"><button type="button" class="btn primary" data-close>Listo</button></div>`);
  wireCopy();
}

/* ---------- detalle y cancelación ---------- */
function openDetail(id){
  const b = state.rows.find(x => x.id === id); if (!b) return;
  const r = resById(b.res), own = mine[id], canCancel = !!own || !!state.admin;
  const ended = isPastSlot(b.date, b.end - STEP);
  const alumno = own && own.a ? esc(own.a) : (state.admin ? '<span id="dAlu" class="hint">Cargando…</span>' : '');
  openModal(`
    <h2 id="mTitle">${esc(b.nombre)}</h2>
    ${metaLine(r, b.date, b.start, b.end)}
    <dl>
      ${b.motivo ? `<dt>Actividad</dt><dd>${esc(b.motivo)}</dd>` : ''}
      ${alumno ? `<dt>Alumno</dt><dd>${alumno}</dd>` : ''}
      <dt>Responsable</dt><dd>${esc(b.investigador)}</dd>
    </dl>
    ${!canCancel ? `<p class="note">Solo quien hizo la reserva o un administrador del laboratorio puede cancelarla. Quien reservó puede hacerlo desde su navegador o con su enlace de cancelación.</p><div class="actions"><button type="button" class="btn" data-close>Cerrar</button></div>`
      : ended ? `<p class="note">Esta reserva ya terminó.</p><div class="actions"><button type="button" class="btn" data-close>Cerrar</button></div>`
      : `${own ? linkBox(id, own.t) : ''}<p class="err" id="dErr" hidden></p><div class="actions" id="cxl"><button type="button" class="btn" data-close>Cerrar</button><button type="button" class="btn" data-ask>Cancelar reserva</button></div>`}`);
  wireCopy();

  if (state.admin && !(own && own.a)){
    api({accion:'detalle_admin', id}).then(d => { const el = $('dAlu'); if (el) el.outerHTML = esc(d.correo_alumno); })
      .catch(() => { const el = $('dAlu'); if (el) el.textContent = 'No disponible'; });
  }

  const ask = modal.querySelector('[data-ask]');
  if (!ask) return;
  ask.addEventListener('click', () => {
    const asAdmin = !own;
    $('cxl').innerHTML = `${asAdmin ? `<p class="note" style="flex-basis:100%">Cancelarás esta reserva como administrador.${CORREOS ? ' Se avisará por correo al alumno y al investigador responsable.' : ''}</p>` : ''}<span style="margin-right:auto;font-size:14px">¿Liberar este horario?</span><button type="button" class="btn" data-close>No</button><button type="button" class="btn danger" id="dYes">Sí, cancelar</button>`;
    const yes = $('dYes'); yes.focus();
    yes.addEventListener('click', async () => {
      yes.disabled = true; yes.textContent = 'Cancelando…';
      try {
        await api(asAdmin ? {accion:'cancelar_admin', id} : {accion:'cancelar', id, token: own.t});
        delete mine[id]; saveMine();
        closeModal(); toast(CORREOS ? 'Reserva cancelada. Se avisó por correo.' : 'Reserva cancelada.'); load();
      } catch(e){
        const de = $('dErr'); de.textContent = e.message; de.hidden = false;
        yes.disabled = false; yes.textContent = 'Sí, cancelar';
        if (e.status === 409 || e.status === 404){ delete mine[id]; saveMine(); load(); }
      }
    });
  });
}

/* ---------- enlace de cancelación (?cancelar=ID&t=TOKEN) ---------- */
async function handleCancelLink(){
  const p = new URLSearchParams(location.search);
  const id = p.get('cancelar'), t = p.get('t');
  if (!id || !t || !sb) return;
  history.replaceState(null, '', location.pathname + location.hash);
  openModal(`<h2 id="mTitle">Cancelar reserva</h2><p class="note">Buscando la reserva…</p>`);
  let rv;
  try { rv = (await api({accion:'ver', id, token: t})).reserva; }
  catch(e){ openModal(`<h2 id="mTitle">Cancelar reserva</h2><p class="note warn">${esc(e.message)}</p><div class="actions"><button type="button" class="btn" data-close>Cerrar</button></div>`); return; }
  const b = toRow(rv), r = resById(b.res);
  const head = `<h2 id="mTitle">Cancelar reserva</h2>${metaLine(r, b.date, b.start, b.end)}<dl><dt>Reservó</dt><dd>${esc(b.nombre)}</dd><dt>Responsable</dt><dd>${esc(b.investigador)}</dd></dl>`;
  if (rv.cancelada || rv.terminada){
    openModal(`${head}<p class="note">${rv.cancelada ? 'Esta reserva ya estaba cancelada.' : 'Esta reserva ya terminó.'}</p><div class="actions"><button type="button" class="btn" data-close>Cerrar</button></div>`);
    return;
  }
  openModal(`${head}<p class="err" id="lErr" hidden></p><div class="actions"><button type="button" class="btn" data-close>Conservar reserva</button><button type="button" class="btn danger" id="lYes">Sí, cancelar</button></div>`);
  const yes = $('lYes');
  yes.addEventListener('click', async () => {
    yes.disabled = true; yes.textContent = 'Cancelando…';
    try {
      await api({accion:'cancelar', id, token: t});
      delete mine[id]; saveMine();
      openModal(`<div class="ok"><span class="ok-mark" aria-hidden="true">✓</span><h2 id="mTitle">Reserva cancelada</h2></div>${metaLine(r, b.date, b.start, b.end)}<p class="note">El horario quedó libre.${CORREOS ? ' Se avisó por correo al alumno y al investigador responsable.' : ''}</p><div class="actions"><button type="button" class="btn primary" data-close>Listo</button></div>`);
      load();
    } catch(e){
      const le = $('lErr'); le.textContent = e.message; le.hidden = false;
      yes.disabled = false; yes.textContent = 'Sí, cancelar';
    }
  });
}

/* ---------- administradores ---------- */
function openLogin(){
  openModal(`
    <h2 id="mTitle">Acceso de administradores</h2>
    <p class="note">Te enviaremos un enlace de acceso. Solo funciona con los correos registrados como administradores del laboratorio.</p>
    <form id="fLog" class="stack" novalidate>
      <div class="field"><label for="lMail">Correo</label><input id="lMail" type="email" autocomplete="email" required></div>
      <p class="err" id="lgErr" hidden></p>
      <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary" id="lgGo">Enviar enlace</button></div>
    </form>`);
  $('fLog').addEventListener('submit', async ev => {
    ev.preventDefault();
    const email = $('lMail').value.trim(), err = $('lgErr'), go = $('lgGo');
    err.hidden = true;
    if (!emailOk(email)){ err.textContent = 'Escribe un correo válido.'; err.hidden = false; return; }
    go.disabled = true; go.textContent = 'Enviando…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } });
    if (error){
      err.textContent = /signup|not allowed|not found|user/i.test(error.message)
        ? 'Ese correo no está registrado como administrador.'
        : `No se pudo enviar el enlace: ${error.message}`;
      err.hidden = false; go.disabled = false; go.textContent = 'Enviar enlace';
      return;
    }
    openModal(`<h2 id="mTitle">Revisa tu correo</h2><p class="note">Enviamos un enlace de acceso a <strong>${esc(email)}</strong>. Ábrelo en este mismo navegador. Puede tardar un par de minutos.</p><div class="actions"><button type="button" class="btn primary" data-close>Entendido</button></div>`);
  });
}

async function checkAdmin(session){
  if (!session){ state.admin = null; renderAdmin(); return; }
  const { data, error } = await sb.rpc('es_admin');
  if (!error && data === true){
    const nuevo = !state.admin;
    state.admin = session.user.email;
    if (nuevo) toast('Sesión de administrador iniciada');
  } else {
    state.admin = null;
    await sb.auth.signOut();
    toast('Ese correo no tiene permisos de administrador.');
  }
  renderAdmin();
}

/* ---------- eventos ---------- */
$('grid').addEventListener('click', e => {
  const bk = e.target.closest('.bk'); if (bk) return openDetail(bk.dataset.id);
  const c = e.target.closest('.cell'); if (c && !c.disabled) openForm(c.dataset.res, c.dataset.date, Number(c.dataset.start));
});
$('chips').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; state.selRes = c.dataset.res; savePref(); render(); });
$('vDia').onclick = () => { state.view = 'dia'; savePref(); load(); };
$('vSem').onclick = () => { state.view = 'semana'; savePref(); load(); };
$('prev').onclick = () => { state.cur = addDays(state.cur, state.view === 'dia' ? -1 : -7); render(); load(); };
$('next').onclick = () => { state.cur = addDays(state.cur, state.view === 'dia' ? 1 : 7); render(); load(); };
$('today').onclick = () => { state.cur = fromKey(todayKey()); render(); load(); };
$('adminBtn').onclick = async () => {
  if (!sb) return;
  if (state.admin){ await sb.auth.signOut(); toast('Sesión cerrada'); }
  else openLogin();
};

/* ---------- arranque ---------- */
render();
renderAdmin();
if (sb){
  sb.auth.onAuthStateChange((_ev, session) => { setTimeout(() => checkAdmin(session), 0); });
  load();
  handleCancelLink();
  setInterval(() => { if (overlay.hidden) load(); else render(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}
})();
