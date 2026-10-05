/* ══════════════════════════════════════════════════════════════════════
   AQUA LUAN — BODEGA  (v3.0.0 · app nueva, reemplaza por completo la anterior)
   ══════════════════════════════════════════════════════════════════════
   Flujo de 4 etapas + daños:
     1. RECEPCIÓN   (Persona 1) → entra a la bodega de INSUMOS lo que llega del proveedor
     2. PRODUCCIÓN  (Persona 2) → sale de INSUMOS hacia la línea de producción
     3. TERMINADO   (Persona 3) → entra a la bodega de PRODUCTO TERMINADO
     4. CARGA       (Persona 4) → sale de PRODUCTO TERMINADO al camión del asesor
        └ DEVOLUCIÓN (Persona 4) → producto LLENO no vendido regresa a terminado
     ⚠ DAÑOS (cualquiera)       → rotos/dañados, descuentan del stock (insumos o terminado)
     ± AJUSTE (solo admin)      → conteo físico, corrige el stock del sistema

   Los envases vacíos de CAMBIO NO entran a ningún stock (no existe ninguna
   pantalla que los registre, a propósito).

   Firestore:
     bodInsumos/{id}        catálogo de insumos (BULTOS / TAPAS / ETIQUETAS)
     bodMovimientos/{id}    libro único de movimientos; el stock se calcula sumándolos
     productos              el MISMO catálogo de la app de pedidos y el dashboard
     inventarioMovimientos  el MISMO stock del dashboard: aquí se escribe la ENTRADA
                            de producto terminado, los daños de terminado y los ajustes.
                            La carga al camión NO se escribe ahí (es un traslado interno;
                            la venta del asesor ya descuenta ese stock automáticamente).
     usuarios               perfiles con esBodega + rolesBodega
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

const firebaseConfig = {
  apiKey: "AIzaSyBOPI_zviuktXtH68F8NY4mSnbYcF1tE7s",
  authDomain: "luan-aqua.firebaseapp.com",
  projectId: "luan-aqua",
  storageBucket: "luan-aqua.firebasestorage.app",
  messagingSenderId: "1046111203141",
  appId: "1:1046111203141:web:017cd2d14f1db77c9c582c"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('Sin persistencia offline:', e.code));
/* Instancia secundaria: permite al admin crear usuarios sin cerrar su propia sesión */
const _secApp = firebase.initializeApp(firebaseConfig, 'secundariaBodega');
const _secAuth = _secApp.auth();
const TS = () => firebase.firestore.FieldValue.serverTimestamp();

const APP_VERSION = 'bodega-3.1.4';
const DOMINIO_LOGIN = '@luanaqua.app';
function emailDeUsuario(u) {
  const limpio = String(u || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (limpio === 'admin') return 'elhychristian@gmail.com';
  return limpio + DOMINIO_LOGIN;
}

/* ── Configuración del negocio ───────────────────────────────────────── */
const ETAPAS = {
  RECEPCION:  { n: '1', titulo: 'Recepción en planta',        corto: 'Recepción',    area: 'INSUMOS',   c: 'e1', desc: 'Check-in de todo lo que llega del proveedor: bultos, tapas y etiquetas.' },
  PRODUCCION: { n: '2', titulo: 'Salida a producción',        corto: 'Producción',   area: 'INSUMOS',   c: 'e2', desc: 'Lo que sale de la bodega de insumos hacia la línea de producción.' },
  TERMINADO:  { n: '3', titulo: 'Bodega de producto terminado', corto: 'P. terminado', area: 'TERMINADO', c: 'e3', desc: 'Producto listo que sale de producción y entra a la bodega de terminado.' },
  CARGA:      { n: '4', titulo: 'Carga al camión',            corto: 'Carga',        area: 'TERMINADO', c: 'e4', desc: 'Producto terminado que se carga al camión de cada asesor.' },
  DEVOLUCION: { n: '↩', titulo: 'Devolución del camión',      corto: 'Devolución',   area: 'TERMINADO', c: 'e5', desc: 'Producto LLENO que el asesor regresa sin vender.' },
  RETORNO_ENVASE: { n: '♻', titulo: 'Retorno de envases prestados', corto: 'Envases', area: 'ENVASES', c: 'ev', desc: 'Envases PRESTADOS que el asesor recuperó de los clientes y entrega vacíos en bodega.' },
  DANO:       { n: '!', titulo: 'Rotos / dañados',            corto: 'Daño',         area: null,        c: 'ed', desc: 'Registra lo que se rompió o dañó. Se descuenta del stock.' },
  AJUSTE:     { n: '±', titulo: 'Ajuste por conteo físico',   corto: 'Ajuste',       area: null,        c: 'ea', desc: 'Escribe lo que contaste físicamente; el sistema registra la diferencia.' }
};
const ROLES_BODEGA = ['RECEPCION', 'PRODUCCION', 'TERMINADO', 'CARGA'];
/* Idea de usuarios: el LOGIN es el puesto (no cambia aunque cambie la persona);
   el NOMBRE empieza como "PERSONA N" y luego se renombra con el nombre real. */
const PLANTILLAS = [
  { n: 1, usuario: 'recepcion',  rol: 'RECEPCION' },
  { n: 2, usuario: 'produccion', rol: 'PRODUCCION' },
  { n: 3, usuario: 'terminado',  rol: 'TERMINADO' },
  { n: 4, usuario: 'carga',      rol: 'CARGA' }
];
const CATEGORIAS = ['BULTOS', 'TAPAS', 'ETIQUETAS'];
const CATALOGO_INICIAL = {
  BULTOS: ['PACA 400', 'PACA 600', 'PACA 625', 'PACA 1L', 'GALON', 'PACA 5 LITROS', 'GALON PET'],
  TAPAS: ['PACA 600', 'PACA 625', 'PACA 1L', 'GALON', 'TAPON VERDE', 'TAPON AZUL', 'TAPA ROSCA AZUL PEQUEÑA',
          'TAPA ROSCA AZUL GRANDE', 'TAPA ROSCA PREMIUM', 'TAPA ROSCA VERDE DISPENSADOR', 'TAPA GALON 5 LITRO'],
  ETIQUETAS: ['PACA 400', 'PACA 600', 'PACA 625', 'PACA 1L', 'GALON', 'BOTELLON', 'SELLO LUAN', 'SELLO GENERICO',
              'SELLO PREMIUM', 'ETIQUETA PREMIUM', 'ETIQUETA GALON 5 LITRO', 'ROLLOS DE EMPAQUE']
};
const MOTIVOS_DANO = ['ROTO', 'DAÑADO', 'DERRAMADO', 'MAL SELLADO', 'CONTAMINADO', 'OTRO'];

/* ── Estado ──────────────────────────────────────────────────────────── */
const S = {
  user: null, perfil: null, nombre: '', roles: [], esAdmin: false, soloLectura: false,
  insumos: [], productos: [], movs: [], asesores: [], usuariosBod: [],
  tab: 'inicio', form: {}, modo: { CARGA: 'CARGA', PRODUCCION: 'INSUMOS', DANO: 'INSUMOS', AJUSTE: 'INSUMOS', stock: 'INSUMOS', admin: 'USUARIOS' },
  cuadre: { fecha: '', cache: {}, cargando: false, error: '' },
  hist: { desde: '', hasta: '', etapa: '', q: '', limite: 40 },
  unsubs: [], firma: '', renderPendiente: false, errorReglas: false
};

/* ── Utilidades ──────────────────────────────────────────────────────── */
const $ = s => document.querySelector(s);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hoy(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function haceDias(n) { const d = new Date(); d.setDate(d.getDate() - n); return hoy(d); }
function fmtFecha(f) { if (!f) return '-'; const [y, m, d] = f.split('-'); return `${d}/${m}/${y}`; }
function fmtHora(ms) { return ms ? new Date(ms).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : ''; }
function num(n) { return (Number(n) || 0).toLocaleString('es-EC'); }
function slug(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function upper(s, max = 120) { return String(s || '').trim().replace(/\s+/g, ' ').slice(0, max).toUpperCase(); }
function msDe(m) { return m.creadoEn?.toMillis?.() || m.creadoLocal || 0; }
function puede(rol) { return S.esAdmin || S.roles.includes(rol); }
function esPersonalBodega() { return S.esAdmin || S.roles.length > 0; }
function toast(t, ms = 2600) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = t;
  document.body.appendChild(el); setTimeout(() => el.remove(), ms);
}
function openModal(html) {
  $('#modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
  document.body.style.overflow = 'hidden';
}
function closeModal() { $('#modalRoot').innerHTML = ''; document.body.style.overflow = ''; }
function etapaBadge(et) { const e = ETAPAS[et] || {}; return `<span class="badge" style="background:var(--${e.c}bg);color:var(--${e.c})">${esc(e.n)} · ${esc(e.corto || et)}</span>`; }
function nombreRuta(r) { return String(r || '').split(':')[1]?.trim() || r || ''; }

/* ── Red ─────────────────────────────────────────────────────────────── */
function pintarRed() {
  const b = $('#netBadge'); if (!b) return;
  const on = navigator.onLine; b.textContent = on ? 'EN LÍNEA' : 'SIN INTERNET'; b.classList.toggle('off', !on);
}
window.addEventListener('online', pintarRed); window.addEventListener('offline', pintarRed);

/* ══════════════════════════ LOGIN / SESIÓN ══════════════════════════ */
function errLogin(t) { const m = $('#loginMsg'); m.textContent = t; m.classList.toggle('hidden', !t); }
async function doLogin() {
  const u = $('#loginUser').value.trim(), p = $('#loginPass').value;
  if (!u || !p) return errLogin('Completa usuario y contraseña.');
  const btn = $('#btnLogin'); btn.disabled = true; btn.textContent = 'Verificando…'; errLogin('');
  try {
    await auth.signInWithEmailAndPassword(emailDeUsuario(u), p);
  } catch (e) {
    const c = e.code || '';
    errLogin(c.includes('network') ? 'Sin conexión. Para el primer ingreso necesitas internet.'
      : c.includes('too-many') ? 'Demasiados intentos. Espera unos minutos.'
      : 'Usuario o contraseña incorrectos.');
  } finally { btn.disabled = false; btn.textContent = 'Ingresar'; }
}
$('#btnLogin').addEventListener('click', doLogin);
$('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('#btnLogout').addEventListener('click', async () => {
  if (!confirm('¿Cerrar sesión?')) return;
  detenerListeners(); await auth.signOut();
});

auth.onAuthStateChanged(async user => {
  if (!user) { detenerListeners(); S.user = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); return; }
  try {
    const snap = await db.collection('usuarios').doc(user.uid).get();
    const p = snap.exists ? snap.data() : null;
    if (!p) throw new Error('Tu cuenta no tiene perfil configurado. Contacta al administrador.');
    const esAdmin = p.esAdmin === true;
    const roles = (p.esBodega === true && p.activoBodega !== false && Array.isArray(p.rolesBodega)) ? p.rolesBodega.filter(r => ROLES_BODEGA.includes(r)) : [];
    const soloLectura = !esAdmin && roles.length === 0 && p.esSecretaria === true;
    if (!esAdmin && roles.length === 0 && !soloLectura) {
      throw new Error(p.esBodega === true && p.activoBodega === false ? 'Tu usuario de bodega está desactivado.' : 'Esta cuenta no tiene acceso a la app de Bodega.');
    }
    Object.assign(S, { user, perfil: p, esAdmin, roles, soloLectura, nombre: upper(p.nombre || p.usuario || 'USUARIO', 60) });
    entrar();
  } catch (e) {
    await auth.signOut();
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    errLogin(e.message || 'No se pudo cargar tu perfil.');
  }
});

function entrar() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const rol = S.esAdmin ? 'ADMINISTRADOR' : S.soloLectura ? 'SOLO CONSULTA' : S.roles.map(r => ETAPAS[r].n + ' ' + ETAPAS[r].corto).join(' · ');
  $('#whoami').textContent = `${S.nombre} — ${rol}`;
  pintarRed();
  let guardada = null; try { guardada = localStorage.getItem('bod_tab'); } catch (e) {}
  const tabs = tabsDisponibles().map(t => t.id);
  S.tab = tabs.includes(guardada) ? guardada : (S.roles.length === 1 ? S.roles[0] : 'inicio');
  iniciarListeners();
  render();
}

/* ══════════════════════════ LISTENERS ══════════════════════════ */
function onErr(nombre) {
  return e => {
    console.error('listener ' + nombre, e);
    if (e.code === 'permission-denied' && !S.errorReglas) { S.errorReglas = true; programarRefresco(); }
  };
}
function iniciarListeners() {
  detenerListeners();
  S.unsubs.push(db.collection('bodInsumos').onSnapshot(snap => {
    S.insumos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    programarRefresco();
  }, onErr('insumos')));
  S.unsubs.push(db.collection('productos').onSnapshot(snap => {
    S.productos = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.activo !== false && p.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    programarRefresco();
  }, onErr('productos')));
  S.unsubs.push(db.collection('bodMovimientos').onSnapshot({ includeMetadataChanges: true }, snap => {
    S.movs = snap.docs.map(d => ({ _id: d.id, _pend: d.metadata.hasPendingWrites, ...d.data() }));
    programarRefresco();
  }, onErr('movimientos')));
  if (puede('CARGA') || S.esAdmin) {
    S.unsubs.push(db.collection('usuarios').where('esAdmin', '==', false).onSnapshot(snap => {
      S.asesores = snap.docs.map(d => d.data()).filter(u => u.ruta && u.esBodega !== true && u.esSecretaria !== true)
        .map(u => u.ruta).sort();
      programarRefresco();
    }, onErr('asesores')));
  }
  if (S.esAdmin) {
    S.unsubs.push(db.collection('usuarios').where('esBodega', '==', true).onSnapshot(snap => {
      S.usuariosBod = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => String(a.usuario).localeCompare(String(b.usuario)));
      programarRefresco();
    }, onErr('usuariosBodega')));
  }
}
function detenerListeners() { S.unsubs.forEach(u => { try { u(); } catch (e) {} }); S.unsubs = []; }

let _tRefresco = null;
function programarRefresco() { clearTimeout(_tRefresco); _tRefresco = setTimeout(refrescar, 120); }
/* Las pantallas de formulario se actualizan "en sitio" (sin borrar lo que se está
   escribiendo). Las demás se redibujan, salvo que el usuario esté escribiendo. */
function refrescar() {
  if (!S.user) return;
  const scr = SCREENS[S.tab];
  if (scr && scr.form) return refrescarFormulario();
  const a = document.activeElement;
  if (a && $('#main').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { S.renderPendiente = true; return; }
  renderMain();
}
document.addEventListener('focusout', () => {
  setTimeout(() => {
    const a = document.activeElement;
    if (S.renderPendiente && !(a && $('#main')?.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { S.renderPendiente = false; renderMain(); }
  }, 50);
});

/* ══════════════════════════ CÁLCULO DE STOCK ══════════════════════════ */
function calcularStock() {
  const ins = {}, pt = {}, env = {};
  const E = n => (env[n] = env[n] || { ret: 0, prod: 0, dano: 0, aj: 0, stock: 0 });
  const I = id => (ins[id] = ins[id] || { rec: 0, prod: 0, dano: 0, aj: 0, stock: 0 });
  const P = n => (pt[n] = pt[n] || { term: 0, carga: 0, dev: 0, dano: 0, aj: 0, stock: 0 });
  for (const m of S.movs) {
    if (m.anulado) continue;
    for (const it of (m.items || [])) {
      const q = Number(it.cantidad) || 0;
      switch (m.etapa) {
        case 'RECEPCION': I(it.id).rec += q; break;
        case 'PRODUCCION': if (m.area === 'ENVASES') E(it.nombre).prod += q; else I(it.id).prod += q; break;
        case 'RETORNO_ENVASE': E(it.nombre).ret += q; break;
        case 'TERMINADO': P(it.nombre).term += q; break;
        case 'CARGA': P(it.nombre).carga += q; break;
        case 'DEVOLUCION': P(it.nombre).dev += q; break;
        case 'DANO': if (m.area === 'INSUMOS') I(it.id).dano += q; else if (m.area === 'ENVASES') E(it.nombre).dano += q; else P(it.nombre).dano += q; break;
        case 'AJUSTE': if (m.area === 'INSUMOS') I(it.id).aj += q; else if (m.area === 'ENVASES') E(it.nombre).aj += q; else P(it.nombre).aj += q; break;
      }
    }
  }
  Object.values(ins).forEach(s => s.stock = s.rec - s.prod - s.dano + s.aj);
  Object.values(pt).forEach(s => s.stock = s.term - s.carga + s.dev - s.dano + s.aj);
  Object.values(env).forEach(s => s.stock = s.ret - s.prod - s.dano + s.aj);
  return { ins, pt, env };
}
function insumosActivos() {
  return S.insumos.filter(i => i.activo !== false).sort((a, b) =>
    CATEGORIAS.indexOf(a.categoria) - CATEGORIAS.indexOf(b.categoria) || (a.orden ?? 999) - (b.orden ?? 999) || a.nombre.localeCompare(b.nombre));
}
/* [CAMBIO] Envases vacíos: misma lista fija que la app de pedidos (préstamo/retiro de envases),
   para que el cuadre del camión compare los mismos nombres. */
const ENVASES_PRESTAMO = ['ENVASE AZUL', 'ENVASE LLAVE', 'OFICINA - ENVASE'];
function itemsDeArea(area, stock) {
  if (area === 'INSUMOS') return insumosActivos().map(i => ({ id: i.id, nombre: i.nombre, categoria: i.categoria, stock: stock.ins[i.id]?.stock || 0, minimo: Number(i.minimo) || 0 }));
  if (area === 'ENVASES') return ENVASES_PRESTAMO.map(n => ({ id: n, nombre: n, stock: stock.env[n]?.stock || 0, minimo: 0 }));
  return S.productos.map(p => ({ id: p.nombre, nombre: p.nombre, stock: stock.pt[p.nombre]?.stock || 0, minimo: 0 }));
}
function nombreArea(a) { return a === 'INSUMOS' ? 'Insumos' : a === 'ENVASES' ? 'Envases vacíos' : 'Producto terminado'; }

/* ══════════════════════════ NAVEGACIÓN ══════════════════════════ */
const SCREENS = {
  inicio:     { label: 'Inicio',            render: renderInicio },
  RECEPCION:  { label: '1 · Recepción',     form: true, rol: 'RECEPCION' },
  PRODUCCION: { label: '2 · Producción',    form: true, rol: 'PRODUCCION' },
  TERMINADO:  { label: '3 · P. terminado',  form: true, rol: 'TERMINADO' },
  CARGA:      { label: '4 · Carga camión',  form: true, rol: 'CARGA' },
  DANO:       { label: '⚠ Daños',           form: true },
  stock:      { label: 'Stock',             render: renderStock },
  historial:  { label: 'Historial',         render: renderHistorial },
  cuadre:     { label: '⚖ Cuadre camión',   render: renderCuadre, staff: true },
  AJUSTE:     { label: '± Ajuste',          form: true, admin: true },
  admin:      { label: '⚙ Admin',           render: renderAdmin, admin: true }
};
function tabsDisponibles() {
  return Object.entries(SCREENS).filter(([id, s]) => {
    if (s.admin) return S.esAdmin;
    if (s.staff) return S.esAdmin || S.soloLectura;
    if (s.rol) return puede(s.rol);
    if (id === 'DANO') return esPersonalBodega();
    return true;
  }).map(([id, s]) => ({ id, label: s.label }));
}
function irA(tab) {
  S.tab = tab; try { localStorage.setItem('bod_tab', tab); } catch (e) {}
  closeModal(); render(); window.scrollTo(0, 0);
}
function render() {
  $('#tabs').innerHTML = tabsDisponibles().map(t => `<button class="${t.id === S.tab ? 'on' : ''}" onclick="irA('${t.id}')">${esc(t.label)}</button>`).join('');
  const on = $('#tabs .on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  renderMain();
}
function renderMain() {
  const scr = SCREENS[S.tab] || SCREENS.inicio;
  let html = '';
  if (S.errorReglas) html += `<div class="msg err">Firestore rechazó una lectura (permiso denegado). Falta publicar las reglas nuevas de la bodega en la consola de Firebase.</div>`;
  html += scr.form ? htmlFormulario(S.tab) : scr.render();
  $('#main').innerHTML = html;
  if (scr.form) { S.firma = firmaFormulario(S.tab); pintarResumen(); }
}

/* ══════════════════════════ INICIO ══════════════════════════ */
function renderInicio() {
  const st = calcularStock(), f = hoy();
  const deHoy = S.movs.filter(m => !m.anulado && m.fecha === f);
  const tot = et => deHoy.filter(m => m.etapa === et).reduce((a, m) => a + (Number(m.totalUnidades) || 0), 0);
  const bajos = itemsDeArea('INSUMOS', st).filter(i => i.minimo > 0 && i.stock <= i.minimo);
  const negativos = [...itemsDeArea('INSUMOS', st), ...itemsDeArea('TERMINADO', st)].filter(i => i.stock < 0);
  const quick = ['RECEPCION', 'PRODUCCION', 'TERMINADO', 'CARGA'].filter(puede).map(et => {
    const e = ETAPAS[et];
    return `<button style="background:var(--${e.c}bg);color:var(--${e.c})" onclick="irA('${et}')">${e.n} · ${esc(e.titulo)}<small>${esc(e.desc)}</small></button>`;
  }).join('');
  const ultimos = [...deHoy].sort((a, b) => msDe(b) - msDe(a)).slice(0, 6);
  const sinCatalogo = S.insumos.length === 0;
  return `
  <div class="card">
    <h2>Hola, ${esc(S.nombre)}</h2>
    <p class="hint">Hoy ${fmtFecha(f)}. Así fluye el producto en la planta:</p>
    <div class="flow">
      <span class="badge" style="background:var(--e1bg);color:var(--e1)">1 Recepción</span><span class="arrow">→</span>
      <span class="badge" style="background:var(--e2bg);color:var(--e2)">2 Producción</span><span class="arrow">→</span>
      <span class="badge" style="background:var(--e3bg);color:var(--e3)">3 P. terminado</span><span class="arrow">→</span>
      <span class="badge" style="background:var(--e4bg);color:var(--e4)">4 Camión</span>
    </div>
  </div>
  ${sinCatalogo && S.esAdmin ? `<div class="msg warn">Todavía no hay catálogo de insumos. Ve a <b>⚙ Admin → Catálogo</b> y pulsa “Cargar lista inicial”.</div>` : ''}
  ${quick ? `<div class="quick" style="margin-bottom:12px">${quick}</div>` : ''}
  <div class="kpis">
    <div class="kpi" style="border-color:var(--e1)"><span>Recibido hoy</span><b>${num(tot('RECEPCION'))}</b><small>unidades de insumos</small></div>
    <div class="kpi" style="border-color:var(--e2)"><span>A producción hoy</span><b>${num(tot('PRODUCCION'))}</b><small>unidades de insumos</small></div>
    <div class="kpi" style="border-color:var(--e3)"><span>Terminado hoy</span><b>${num(tot('TERMINADO'))}</b><small>unidades producidas</small></div>
    <div class="kpi" style="border-color:var(--e4)"><span>Cargado hoy</span><b>${num(tot('CARGA') - tot('DEVOLUCION'))}</b><small>neto (carga − devolución)</small></div>
    <div class="kpi" style="border-color:var(--ev)"><span>Envases recuperados hoy</span><b>${num(tot('RETORNO_ENVASE'))}</b><small>préstamos devueltos</small></div>
    <div class="kpi" style="border-color:var(--ed)"><span>Daños hoy</span><b>${num(tot('DANO'))}</b><small>unidades</small></div>
  </div>
  ${bajos.length ? `<div class="card"><h2 style="color:var(--red)">Insumos en o bajo el mínimo (${bajos.length})</h2>
    <div class="mov-items" style="margin-top:8px">${bajos.map(i => `<span class="chip">${esc(i.categoria)} · ${esc(i.nombre)}: <b>${num(i.stock)}</b> / mín ${num(i.minimo)}</span>`).join('')}</div></div>` : ''}
  ${negativos.length ? `<div class="msg err">Hay ${negativos.length} ítem(s) con stock negativo — revisa el historial o haz un ajuste por conteo físico.</div>` : ''}
  <div class="card"><h2>Movimientos de hoy</h2>
    ${ultimos.length ? ultimos.map(htmlMov).join('') + `<button class="btn btn-out btn-sm" onclick="irA('historial')">Ver historial completo</button>` : `<div class="empty">Todavía no hay movimientos hoy.</div>`}
  </div>`;
}

/* ══════════════════════════ FORMULARIOS DE ETAPA ══════════════════════════ */
function cfgDe(tab) {
  switch (tab) {
    case 'RECEPCION':  return { key: 'RECEPCION', etapa: 'RECEPCION', area: 'INSUMOS', limitar: false, campos: ['proveedor', 'documento', 'fecha', 'nota'] };
    case 'PRODUCCION': {
      const env = S.modo.PRODUCCION === 'ENVASES';
      return { key: env ? 'PRODUCCION_ENV' : 'PRODUCCION', etapa: 'PRODUCCION', area: env ? 'ENVASES' : 'INSUMOS', limitar: true, campos: ['fecha', 'nota'],
        seg: { modo: 'PRODUCCION', ops: [['INSUMOS', 'Insumos'], ['ENVASES', 'Envases vacíos']] } };
    }
    case 'TERMINADO':  return { key: 'TERMINADO', etapa: 'TERMINADO', area: 'TERMINADO', limitar: false, campos: ['fecha', 'nota'] };
    case 'CARGA': {
      const segC = { modo: 'CARGA', ops: [['CARGA', '4 · Cargar'], ['DEVOLUCION', '↩ Devolución'], ['RETORNO_ENVASE', '♻ Envases']] };
      if (S.modo.CARGA === 'RETORNO_ENVASE') return { key: 'RETORNO_ENVASE', etapa: 'RETORNO_ENVASE', area: 'ENVASES', limitar: false, campos: ['asesor', 'fecha', 'nota'], seg: segC };
      const dev = S.modo.CARGA === 'DEVOLUCION';
      return { key: dev ? 'DEVOLUCION' : 'CARGA', etapa: dev ? 'DEVOLUCION' : 'CARGA', area: 'TERMINADO', limitar: !dev, campos: ['asesor', 'fecha', 'nota'], seg: segC };
    }
    case 'DANO': {
      const a = S.modo.DANO;
      return { key: 'DANO_' + a, etapa: 'DANO', area: a, limitar: true, campos: ['motivo', 'fecha', 'nota'],
        seg: { modo: 'DANO', ops: [['INSUMOS', 'Insumos'], ['TERMINADO', 'P. terminado'], ['ENVASES', 'Envases vacíos']] } };
    }
    case 'AJUSTE': {
      const a = S.modo.AJUSTE;
      return { key: 'AJUSTE_' + a, etapa: 'AJUSTE', area: a, conteo: true, campos: ['fecha', 'nota'],
        seg: { modo: 'AJUSTE', ops: [['INSUMOS', 'Insumos'], ['TERMINADO', 'P. terminado'], ['ENVASES', 'Envases vacíos']] } };
    }
  }
}
function estadoForm(key) {
  if (!S.form[key]) S.form[key] = { qty: {}, campos: { fecha: hoy(), motivo: 'ROTO' }, q: '' };
  return S.form[key];
}
function firmaFormulario(tab) {
  const c = cfgDe(tab);
  const ids = c.area === 'INSUMOS' ? insumosActivos().map(i => i.id + i.nombre) : S.productos.map(p => p.nombre + c.area);
  return c.key + '|' + ids.join(',') + '|' + S.asesores.join(',') + '|' + S.errorReglas;
}
function refrescarFormulario() {
  if (firmaFormulario(S.tab) !== S.firma) { renderMain(); return; }
  /* Solo actualiza las etiquetas de stock, sin tocar los campos */
  const c = cfgDe(S.tab), st = calcularStock(), f = estadoForm(c.key);
  for (const it of itemsDeArea(c.area, st)) {
    const row = document.querySelector(`.item[data-id="${CSS.escape(it.id)}"]`); if (!row) continue;
    const sm = row.querySelector('small'); if (sm) { sm.innerHTML = etiquetaStock(c, it); sm.classList.toggle('low', it.minimo > 0 && it.stock <= it.minimo || it.stock < 0); }
    marcarInput(c, it, row.querySelector('input'), f.qty[it.id]);
  }
  pintarResumen();
}
function etiquetaStock(c, it) {
  if (c.conteo) return `Sistema: <b>${num(it.stock)}</b>`;
  if (c.limitar) return `Disponible: <b>${num(it.stock)}</b>`;
  return `En bodega: ${num(it.stock)}${it.minimo ? ` · mín ${num(it.minimo)}` : ''}`;
}
function marcarInput(c, it, inp, v) {
  if (!inp) return;
  const tiene = v !== undefined && v !== null && (c.conteo || v > 0);
  inp.classList.toggle('has', tiene);
  inp.classList.toggle('over', !!(c.limitar && v > it.stock));
}
function campoHTML(c, f, campo) {
  const v = f.campos[campo] ?? '';
  const on = `oninput="setCampo('${c.key}','${campo}',this.value)"`;
  switch (campo) {
    case 'fecha': return `<div><label class="lbl">Fecha</label><input class="in" type="date" value="${esc(v)}" max="${hoy()}" ${on}></div>`;
    case 'proveedor': {
      const provs = [...new Set(S.movs.filter(m => m.etapa === 'RECEPCION' && m.proveedor).map(m => m.proveedor))].slice(0, 40);
      return `<div><label class="lbl">Proveedor *</label><input class="in" list="dlProv" style="text-transform:uppercase" value="${esc(v)}" placeholder="¿Quién entrega?" ${on}>
        <datalist id="dlProv">${provs.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>`;
    }
    case 'documento': return `<div><label class="lbl">Guía / factura N°</label><input class="in" style="text-transform:uppercase" value="${esc(v)}" placeholder="Opcional" ${on}></div>`;
    case 'nota': return `<div style="grid-column:1/-1"><label class="lbl">Observación</label><textarea class="in" style="text-transform:uppercase" placeholder="Lote, turno, placa del camión, novedad…" ${on}>${esc(v)}</textarea></div>`;
    case 'asesor': return `<div><label class="lbl">Asesor / ruta *</label><select class="in" onchange="setCampo('${c.key}','asesor',this.value)">
        <option value="">— Selecciona el asesor —</option>${S.asesores.map(r => `<option value="${esc(r)}" ${r === v ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        ${S.asesores.length ? '' : '<div class="msg warn">No se pudo cargar la lista de asesores.</div>'}</div>`;
    case 'motivo': return `<div><label class="lbl">Motivo</label><select class="in" onchange="setCampo('${c.key}','motivo',this.value)">
        ${MOTIVOS_DANO.map(m => `<option ${m === v ? 'selected' : ''}>${m}</option>`).join('')}</select></div>`;
  }
  return '';
}
function htmlFormulario(tab) {
  const c = cfgDe(tab), e = ETAPAS[c.etapa], f = estadoForm(c.key), st = calcularStock();
  const items = itemsDeArea(c.area, st);
  let aviso = '';
  if (c.etapa === 'CARGA') aviso = `<div class="msg info">Solo producto lleno que sale de la bodega de terminado. Los envases vacíos de CAMBIO <b>no</b> se registran.</div>`;
  if (c.etapa === 'DEVOLUCION') aviso = `<div class="msg info">Solo producto <b>LLENO</b> que regresa sin vender. Los envases vacíos de CAMBIO <b>no</b> entran al stock.</div>`;
  if (c.etapa === 'RETORNO_ENVASE') aviso = `<div class="msg info">Solo envases <b>PRESTADOS</b> que el asesor recuperó de los clientes (los que marcó como “devolvió” en la app de pedidos). Entran al stock de <b>envases vacíos</b> para luego ir a producción. Los envases de CAMBIO <b>no</b> se registran.</div>`;
  if (c.etapa === 'PRODUCCION' && c.area === 'ENVASES') aviso = `<div class="msg info">Envases vacíos (devueltos de préstamos) que pasan a producción para llenarse.</div>`;
  if (c.etapa === 'TERMINADO') aviso = `<div class="msg info">Estos son los mismos productos de la app del asesor. Esta entrada también suma al Inventario del dashboard.</div>`;
  if (c.etapa === 'AJUSTE') aviso = `<div class="msg warn">Escribe solo lo que contaste. Lo que dejes vacío no se toca. ${c.area === 'TERMINADO' ? 'La diferencia también se registra en el Inventario del dashboard.' : ''}</div>`;
  const seg = c.seg ? `<div class="seg" style="margin-bottom:12px">${c.seg.ops.map(([v, l]) => `<button class="${S.modo[c.seg.modo] === v ? 'on' : ''}" onclick="setModo('${c.seg.modo}','${v}')">${esc(l)}</button>`).join('')}</div>` : '';
  const resumenCarga = (tab === 'CARGA') ? htmlResumenCargas() : '';
  let lista;
  if (!items.length) {
    lista = `<div class="empty">${c.area === 'INSUMOS' ? 'No hay insumos en el catálogo.' + (S.esAdmin ? ' Cárgalos en ⚙ Admin → Catálogo.' : ' Pide al administrador que cargue el catálogo.') : 'No hay productos activos en el catálogo de la app de pedidos.'}</div>`;
  } else {
    let grupos = c.area === 'INSUMOS' ? CATEGORIAS.map(cat => [cat, items.filter(i => i.categoria === cat)]).filter(g => g[1].length) : [['PRODUCTOS', items]];
    lista = `<input class="in picker-search" placeholder="Buscar…" value="${esc(f.q)}" oninput="filtrar('${c.key}',this.value)">` +
      grupos.map(([cat, arr]) => `<div class="cat" data-cat><div class="cat-title"><span>${esc(cat)}</span><span>${arr.length}</span></div>
        ${arr.map(it => {
          const v = f.qty[it.id];
          const visible = !f.q || it.nombre.includes(f.q.toUpperCase());
          const low = (it.minimo > 0 && it.stock <= it.minimo) || it.stock < 0;
          return `<div class="item" data-id="${esc(it.id)}" data-nm="${esc(it.nombre)}" ${visible ? '' : 'style="display:none"'}>
            <div class="nm">${esc(it.nombre)}<small class="${low ? 'low' : ''}">${etiquetaStock(c, it)}</small></div>
            <div class="qty">
              ${c.conteo ? '' : `<button type="button" onclick="paso('${c.key}',this,-1)">−</button>`}
              <input type="number" inputmode="numeric" min="0" step="1" value="${v ?? ''}" placeholder="${c.conteo ? 'conteo' : '0'}"
                class="${(v !== undefined && (c.conteo || v > 0)) ? 'has' : ''} ${c.limitar && v > it.stock ? 'over' : ''}"
                oninput="setQty('${c.key}',this)">
              ${c.conteo ? '' : `<button type="button" onclick="paso('${c.key}',this,1)">+</button>`}
            </div></div>`;
        }).join('')}</div>`).join('');
  }
  const soloLect = S.soloLectura || (c.etapa !== 'DANO' && c.etapa !== 'AJUSTE' && !puede(c.etapa === 'DEVOLUCION' || c.etapa === 'RETORNO_ENVASE' ? 'CARGA' : c.etapa));
  return `
  <div class="card">
    <div class="step-head"><div class="step-num" style="background:var(--${e.c}bg);color:var(--${e.c})">${esc(e.n)}</div>
      <div><h2>${esc(e.titulo)}</h2><p>${esc(e.desc)}</p></div></div>
    ${seg}${aviso}
    <div class="grid2">${c.campos.map(k => campoHTML(c, f, k)).join('')}</div>
  </div>
  <div class="card">${lista}
    ${items.length && !soloLect ? `<div class="sticky-save"><div class="sum" id="resumenForm"></div>
      <button class="btn btn-out btn-sm" onclick="limpiarForm('${c.key}')">Limpiar</button>
      <button class="btn btn-main" id="btnRevisar" onclick="revisar('${tab}')">Revisar y guardar</button></div>` : ''}
  </div>
  ${resumenCarga}`;
}
function htmlResumenCargas() {
  const f = hoy(), por = {};
  S.movs.filter(m => !m.anulado && m.fecha === f && (m.etapa === 'CARGA' || m.etapa === 'DEVOLUCION')).forEach(m => {
    const r = por[m.ruta] = por[m.ruta] || {};
    (m.items || []).forEach(it => { r[it.nombre] = (r[it.nombre] || 0) + (m.etapa === 'CARGA' ? 1 : -1) * (Number(it.cantidad) || 0); });
  });
  const rutas = Object.keys(por).sort();
  return `<div class="card"><h2>Cargado hoy por asesor (neto)</h2><p class="hint">Carga menos devolución, ${fmtFecha(f)}.</p>
    ${rutas.length ? rutas.map(r => `<div class="mov"><b>${esc(r)}</b><div class="mov-items" style="margin-top:6px">
      ${Object.entries(por[r]).filter(([, q]) => q !== 0).map(([n, q]) => `<span class="chip">${esc(n)}: ${num(q)}</span>`).join('') || '<span class="chip">Sin saldo</span>'}</div></div>`).join('')
      : '<div class="empty">Sin cargas hoy.</div>'}</div>`;
}
function pintarResumen() {
  const el = $('#resumenForm'); if (!el) return;
  const c = cfgDe(S.tab), f = estadoForm(c.key);
  const vals = Object.values(f.qty).filter(v => v !== undefined && (c.conteo || v > 0));
  el.innerHTML = c.conteo ? `<b>${vals.length}</b> ítem(s) contados` : `<b>${num(vals.reduce((a, b) => a + b, 0))}</b> unidades · ${vals.length} ítem(s)`;
  const b = $('#btnRevisar'); if (b) b.disabled = vals.length === 0;
}

/* Handlers del formulario (globales, usados desde el HTML) */
function setCampo(key, campo, v) { estadoForm(key).campos[campo] = v; }
function setModo(modo, v) { S.modo[modo] = v; renderMain(); }
function filtrar(key, q) {
  const f = estadoForm(key); f.q = q.trim().toUpperCase();
  document.querySelectorAll('.item').forEach(r => { r.style.display = !f.q || r.dataset.nm.includes(f.q) ? '' : 'none'; });
}
function setQty(key, inp) {
  const id = inp.closest('.item').dataset.id, raw = inp.value;
  const c = cfgDe(S.tab), f = estadoForm(key);
  if (raw === '' || raw === null) delete f.qty[id];
  else { const n = Math.max(0, Math.floor(Number(raw) || 0)); if (!c.conteo && n === 0) delete f.qty[id]; else f.qty[id] = n; }
  const it = itemsDeArea(c.area, calcularStock()).find(i => i.id === id);
  if (it) marcarInput(c, it, inp, f.qty[id]);
  pintarResumen();
}
function paso(key, btn, d) {
  const inp = btn.closest('.item').querySelector('input'), id = btn.closest('.item').dataset.id;
  const n = Math.max(0, (estadoForm(key).qty[id] || 0) + d);
  inp.value = n || '';
  setQty(key, inp);
}
function limpiarForm(key) {
  if (!confirm('¿Borrar todas las cantidades de este formulario?')) return;
  const f = estadoForm(key); f.qty = {}; f.campos.nota = ''; renderMain();
}

/* ── Revisar → confirmar → guardar ─────────────────────────────────── */
function revisar(tab) {
  const c = cfgDe(tab), f = estadoForm(c.key), st = calcularStock(), e = ETAPAS[c.etapa];
  const items = itemsDeArea(c.area, st);
  const elegidos = items.filter(it => f.qty[it.id] !== undefined && (c.conteo || f.qty[it.id] > 0));
  const errores = [];
  if (!elegidos.length) errores.push('No hay cantidades.');
  if (!f.campos.fecha) errores.push('Falta la fecha.');
  if (f.campos.fecha > hoy()) errores.push('La fecha no puede ser futura.');
  if (c.campos.includes('proveedor') && !upper(f.campos.proveedor)) errores.push('Escribe el proveedor.');
  if (c.campos.includes('asesor') && !f.campos.asesor) errores.push('Selecciona el asesor.');
  if (c.limitar) elegidos.filter(it => f.qty[it.id] > it.stock).forEach(it =>
    errores.push(`${it.categoria ? it.categoria + ' · ' : ''}${it.nombre}: pides ${num(f.qty[it.id])} pero solo hay ${num(it.stock)}.`));
  const ajustes = c.conteo ? elegidos.map(it => ({ it, delta: f.qty[it.id] - it.stock })).filter(x => x.delta !== 0) : null;
  if (c.conteo && elegidos.length && !ajustes.length) errores.push('Todo lo contado coincide con el sistema; no hay nada que ajustar.');
  if (errores.length) { openModal(`<h3>Revisa antes de guardar</h3>${errores.map(t => `<div class="msg err">${esc(t)}</div>`).join('')}<div class="actions"><button class="btn btn-main btn-block" onclick="closeModal()">Entendido</button></div>`); return; }

  let avisoDev = '';
  if (c.etapa === 'DEVOLUCION') {
    const neto = {};
    S.movs.filter(m => !m.anulado && m.fecha === f.campos.fecha && m.ruta === f.campos.asesor && (m.etapa === 'CARGA' || m.etapa === 'DEVOLUCION'))
      .forEach(m => (m.items || []).forEach(it => neto[it.nombre] = (neto[it.nombre] || 0) + (m.etapa === 'CARGA' ? 1 : -1) * it.cantidad));
    const raros = elegidos.filter(it => f.qty[it.id] > (neto[it.nombre] || 0));
    if (raros.length) avisoDev = `<div class="msg warn">Ojo: devuelve más de lo que se le cargó ese día en: ${raros.map(it => esc(it.nombre)).join(', ')}. Verifica antes de confirmar.</div>`;
  }
  const filas = c.conteo
    ? ajustes.map(({ it, delta }) => `<tr><td>${esc(it.nombre)}${it.categoria ? `<br><small style="color:var(--muted)">${esc(it.categoria)}</small>` : ''}</td><td class="n">${num(it.stock)}</td><td class="n">${num(f.qty[it.id])}</td><td class="n" style="font-weight:800;color:${delta < 0 ? 'var(--red)' : 'var(--ok)'}">${delta > 0 ? '+' : ''}${num(delta)}</td></tr>`).join('')
    : elegidos.map(it => `<tr><td>${esc(it.nombre)}${it.categoria ? `<br><small style="color:var(--muted)">${esc(it.categoria)}</small>` : ''}</td><td class="n"><b>${num(f.qty[it.id])}</b></td></tr>`).join('');
  const total = elegidos.reduce((a, it) => a + (f.qty[it.id] || 0), 0);
  openModal(`
    <h3>${esc(e.n)} · ${esc(e.titulo)}${c.etapa === 'DANO' || c.etapa === 'AJUSTE' || (c.etapa === 'PRODUCCION' && c.area === 'ENVASES') ? ' — ' + nombreArea(c.area) : ''}</h3>
    <div class="mov-meta">Fecha: <b>${fmtFecha(f.campos.fecha)}</b>
      ${f.campos.asesor ? `<br>Asesor: <b style="font-size:16px">${esc(f.campos.asesor)}</b>` : ''}
      ${c.campos.includes('proveedor') ? `<br>Proveedor: <b>${esc(upper(f.campos.proveedor))}</b>${f.campos.documento ? ' · Doc: <b>' + esc(upper(f.campos.documento)) + '</b>' : ''}` : ''}
      ${c.etapa === 'DANO' ? `<br>Motivo: <b>${esc(f.campos.motivo)}</b>` : ''}
      ${f.campos.nota ? `<br>Obs.: ${esc(upper(f.campos.nota, 300))}` : ''}</div>
    ${avisoDev}
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${c.conteo ? '<th>Ítem</th><th class="n">Sistema</th><th class="n">Conteo</th><th class="n">Ajuste</th>' : '<th>Ítem</th><th class="n">Cantidad</th>'}</tr></thead>
      <tbody>${filas}</tbody>${c.conteo ? '' : `<tfoot><tr><td><b>TOTAL</b></td><td class="n"><b>${num(total)}</b></td></tr></tfoot>`}</table></div>
    <div class="actions"><button class="btn btn-out" style="flex:1" onclick="closeModal()">Corregir</button>
      <button class="btn btn-main" style="flex:2" id="btnConfirmar" onclick="confirmarGuardar('${tab}')">Confirmar y guardar</button></div>`);
}

function confirmarGuardar(tab) {
  const btn = $('#btnConfirmar'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  const c = cfgDe(tab), f = estadoForm(c.key), st = calcularStock();
  const elegidos = itemsDeArea(c.area, st).filter(it => f.qty[it.id] !== undefined && (c.conteo || f.qty[it.id] > 0));
  let items;
  if (c.conteo) {
    items = elegidos.map(it => ({ id: it.id, nombre: it.nombre, ...(it.categoria ? { categoria: it.categoria } : {}), sistema: it.stock, conteo: f.qty[it.id], cantidad: f.qty[it.id] - it.stock }))
      .filter(x => x.cantidad !== 0);
  } else {
    items = elegidos.map(it => ({ id: it.id, nombre: it.nombre, ...(it.categoria ? { categoria: it.categoria } : {}), cantidad: f.qty[it.id] }));
  }
  const doc = {
    etapa: c.etapa, area: c.area, fecha: f.campos.fecha, items,
    totalUnidades: c.conteo ? 0 : items.reduce((a, i) => a + i.cantidad, 0),
    nota: upper(f.campos.nota, 300),
    creadoPor: S.user.uid, creadoPorNombre: S.nombre, creadoPorUsuario: S.perfil.usuario || '',
    creadoEn: TS(), creadoLocal: Date.now(), anulado: false, app: APP_VERSION
  };
  if (c.campos.includes('proveedor')) { doc.proveedor = upper(f.campos.proveedor, 80); doc.documento = upper(f.campos.documento, 40); }
  if (c.campos.includes('asesor')) doc.ruta = f.campos.asesor;
  if (c.etapa === 'DANO') doc.motivo = f.campos.motivo || 'OTRO';

  const ref = db.collection('bodMovimientos').doc();
  ref.set(doc).catch(err => {
    console.error(err);
    alert('❌ El servidor rechazó el registro ' + (ETAPAS[c.etapa].titulo) + ' del ' + fmtFecha(doc.fecha) + '.\n\n' +
      (err.code === 'permission-denied' ? 'Tu usuario no tiene permiso para esta etapa, o faltan publicar las reglas de Firestore.' : err.message));
  });
  sincronizarDashboard(ref.id, doc, false);

  /* Limpia el formulario y muestra comprobante (funciona igual sin internet) */
  S.form[c.key] = { qty: {}, campos: { fecha: f.campos.fecha, motivo: f.campos.motivo, asesor: c.etapa === 'CARGA' || c.etapa === 'DEVOLUCION' ? '' : undefined }, q: '' };
  renderMain();
  const offline = !navigator.onLine;
  openModal(`<h3>✓ Guardado</h3>
    <div class="msg ${offline ? 'warn' : 'ok'}">${offline ? 'Estás sin internet: quedó guardado en este celular y se enviará solo al volver la conexión. No cierres sesión.' : 'Registro enviado.'}</div>
    <div class="mov-meta">${esc(ETAPAS[c.etapa].titulo)} · ${items.length} ítem(s)${doc.totalUnidades ? ' · ' + num(doc.totalUnidades) + ' unidades' : ''}${doc.ruta ? '<br>Asesor: <b>' + esc(doc.ruta) + '</b>' : ''}</div>
    <div class="actions"><button class="btn btn-out" style="flex:1" onclick="elegirImpresion('${ref.id}')">🖨 Imprimir comprobante</button>
      <button class="btn btn-main" style="flex:1" onclick="closeModal()">Listo</button></div>`);
}

/* ── Sincronización con el Inventario del dashboard (inventarioMovimientos) ──
   Se envía en un lote APARTE: si fallara, el registro de bodega no se pierde. */
function sincronizarDashboard(movId, doc, reversa) {
  let tipoBase = null, origen = null, motivo = '';
  if (doc.etapa === 'TERMINADO') { tipoBase = 'entrada'; origen = 'bodega_terminado'; motivo = 'Bodega: ingreso de producto terminado'; }
  else if (doc.etapa === 'DANO' && doc.area === 'TERMINADO') { tipoBase = 'salida'; origen = 'bodega_dano'; motivo = 'Bodega: producto ' + (doc.motivo || 'dañado').toLowerCase(); }
  else if (doc.etapa === 'AJUSTE' && doc.area === 'TERMINADO') { tipoBase = 'ajuste'; origen = 'bodega_ajuste'; motivo = 'Bodega: ajuste por conteo físico'; }
  if (!tipoBase) return;
  const lote = db.batch();
  for (const it of doc.items) {
    let q = Number(it.cantidad) || 0; if (!q) continue;
    let tipo = tipoBase === 'ajuste' ? (q > 0 ? 'entrada' : 'salida') : tipoBase;
    q = Math.abs(q);
    if (reversa) tipo = tipo === 'entrada' ? 'salida' : 'entrada';
    lote.set(db.collection('inventarioMovimientos').doc(), {
      producto: it.nombre, tipo, cantidad: q,
      motivo: reversa ? 'Bodega: anulación — ' + motivo.replace('Bodega: ', '') : motivo,
      fecha: doc.fecha, usuario: S.nombre, origen: reversa ? 'bodega_anulacion' : origen, bodegaMovId: movId,
      creadoPor: S.user.uid, creadoEn: TS()
    });
  }
  lote.commit().catch(err => console.warn('No se pudo sincronizar con el Inventario del dashboard:', err));
}

/* ══════════════════════════ STOCK ══════════════════════════ */
function renderStock() {
  const st = calcularStock(), a = S.modo.stock;
  const seg = `<div class="seg" style="margin-bottom:12px">${[['INSUMOS', 'Insumos'], ['TERMINADO', 'P. terminado'], ['ENVASES', 'Envases vacíos']].map(([v, l]) => `<button class="${a === v ? 'on' : ''}" onclick="S.modo.stock='${v}';renderMain()">${l}</button>`).join('')}</div>`;
  let cuerpo;
  if (a === 'INSUMOS') {
    const items = insumosActivos();
    const bajos = items.filter(i => (Number(i.minimo) || 0) > 0 && (st.ins[i.id]?.stock || 0) <= i.minimo).length;
    cuerpo = `<div class="kpis"><div class="kpi"><span>Ítems de insumos</span><b>${items.length}</b></div>
      <div class="kpi" style="border-color:var(--red)"><span>En o bajo mínimo</span><b>${bajos}</b></div></div>` +
      (items.length ? CATEGORIAS.map(cat => {
        const arr = items.filter(i => i.categoria === cat); if (!arr.length) return '';
        return `<div class="card"><h2>${cat}</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ítem</th><th class="n">Recibido</th><th class="n">A prod.</th><th class="n">Dañado</th><th class="n">Ajuste</th><th class="n">Stock</th><th class="n">Mín.</th></tr></thead><tbody>
          ${arr.map(i => { const s = st.ins[i.id] || { rec: 0, prod: 0, dano: 0, aj: 0, stock: 0 }; const low = (i.minimo > 0 && s.stock <= i.minimo) || s.stock < 0;
            return `<tr class="${low ? 'low' : ''}"><td><b>${esc(i.nombre)}</b></td><td class="n">${num(s.rec)}</td><td class="n">${num(s.prod)}</td><td class="n">${num(s.dano)}</td><td class="n">${s.aj ? (s.aj > 0 ? '+' : '') + num(s.aj) : '0'}</td><td class="n" style="font-weight:800;color:${low ? 'var(--red)' : 'var(--text)'}">${num(s.stock)}</td><td class="n">${i.minimo ? num(i.minimo) : '-'}</td></tr>`; }).join('')}
          </tbody></table></div></div>`;
      }).join('') : '<div class="card empty">No hay catálogo de insumos todavía.</div>');
  } else if (a === 'ENVASES') {
    const nombres = [...new Set([...Object.keys(st.env)])].sort();
    const total = nombres.reduce((x, n) => x + (st.env[n]?.stock || 0), 0);
    cuerpo = `<div class="kpis"><div class="kpi" style="border-color:var(--ev)"><span>Envases vacíos en bodega</span><b>${num(total)}</b><small>de préstamos recuperados</small></div></div>
      <div class="card"><h2>Envases vacíos</h2><p class="hint">Envases prestados que los asesores recuperaron de clientes. En bodega = recuperados − a producción − dañados ± ajuste. Los envases de CAMBIO no se cuentan.</p>
      ${nombres.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Envase</th><th class="n">Recuperados</th><th class="n">A producción</th><th class="n">Dañados</th><th class="n">Ajuste</th><th class="n">En bodega</th></tr></thead><tbody>
      ${nombres.map(n => { const e = st.env[n];
        return `<tr class="${e.stock < 0 ? 'low' : ''}"><td><b>${esc(n)}</b></td><td class="n">${num(e.ret)}</td><td class="n">${num(e.prod)}</td><td class="n">${num(e.dano)}</td><td class="n">${e.aj ? (e.aj > 0 ? '+' : '') + num(e.aj) : '0'}</td><td class="n" style="font-weight:800">${num(e.stock)}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty">Todavía no hay envases recuperados.</div>'}</div>`;
  } else {
    const nombres = [...new Set([...S.productos.map(p => p.nombre), ...Object.keys(st.pt)])].sort();
    const total = nombres.reduce((a, n) => a + (st.pt[n]?.stock || 0), 0);
    cuerpo = `<div class="kpis"><div class="kpi" style="border-color:var(--e3)"><span>Unidades en bodega de terminado</span><b>${num(total)}</b></div></div>
      <div class="card"><h2>Producto terminado</h2><p class="hint">En bodega = terminado − cargado + devuelto − dañado ± ajuste. Lo que está en los camiones ya no cuenta aquí.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="n">Terminado</th><th class="n">Cargado</th><th class="n">Devuelto</th><th class="n">Dañado</th><th class="n">Ajuste</th><th class="n">En bodega</th></tr></thead><tbody>
      ${nombres.map(n => { const s = st.pt[n] || { term: 0, carga: 0, dev: 0, dano: 0, aj: 0, stock: 0 };
        return `<tr class="${s.stock < 0 ? 'low' : ''}"><td><b>${esc(n)}</b></td><td class="n">${num(s.term)}</td><td class="n">${num(s.carga)}</td><td class="n">${num(s.dev)}</td><td class="n">${num(s.dano)}</td><td class="n">${s.aj ? (s.aj > 0 ? '+' : '') + num(s.aj) : '0'}</td><td class="n" style="font-weight:800;color:${s.stock < 0 ? 'var(--red)' : 'var(--text)'}">${num(s.stock)}</td></tr>`; }).join('')}
      </tbody></table></div></div>`;
  }
  return `<div class="card"><h2>Stock actual</h2><p class="hint">Se calcula en vivo con todos los movimientos no anulados.</p>${seg}</div>${cuerpo}`;
}

/* ══════════════════════════ HISTORIAL ══════════════════════════ */
function movsFiltrados() {
  const h = S.hist, q = h.q.trim().toUpperCase();
  return S.movs.filter(m => (!h.desde || m.fecha >= h.desde) && (!h.hasta || m.fecha <= h.hasta) && (!h.etapa || m.etapa === h.etapa) &&
    (!q || [m.ruta, m.proveedor, m.creadoPorNombre, m.nota, m.documento, ...(m.items || []).map(i => i.nombre)].join(' ').toUpperCase().includes(q)))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || msDe(b) - msDe(a));
}
function htmlMov(m, sinAcciones) {
  const area = (m.etapa === 'DANO' || m.etapa === 'AJUSTE' || (m.etapa === 'PRODUCCION' && m.area === 'ENVASES')) ? ` <span class="badge" style="background:var(--soft);color:var(--muted)">${nombreArea(m.area)}</span>` : '';
  const meta = [
    m.ruta ? `Asesor: <b>${esc(m.ruta)}</b>` : '',
    m.proveedor ? `Proveedor: <b>${esc(m.proveedor)}</b>${m.documento ? ' · Doc ' + esc(m.documento) : ''}` : '',
    m.motivo ? `Motivo: <b>${esc(m.motivo)}</b>` : '',
    `Por: <b>${esc(m.creadoPorNombre || '-')}</b>`,
    m.nota ? `Obs.: ${esc(m.nota)}` : '',
    m.anulado ? `<span style="color:var(--red)">ANULADO por ${esc(m.anuladoPorNombre || '-')}: ${esc(m.motivoAnulacion || '')}</span>` : ''
  ].filter(Boolean).join(' · ');
  const chips = (m.items || []).map(i => `<span class="chip">${i.categoria ? esc(i.categoria.slice(0, 3)) + ' · ' : ''}${esc(i.nombre)}: ${m.etapa === 'AJUSTE' ? (i.cantidad > 0 ? '+' : '') : ''}${num(i.cantidad)}</span>`).join('');
  return `<div class="mov ${m.anulado ? 'anulado' : ''}">
    <div class="mov-top">${etapaBadge(m.etapa)}${area}${m._pend ? '<span class="pend">⏳ pendiente de enviar</span>' : ''}
      <span class="when">${fmtFecha(m.fecha)} ${fmtHora(msDe(m))}</span></div>
    <div class="mov-meta">${meta}</div>
    <div class="mov-items">${chips}</div>
    ${sinAcciones ? '' : `<div class="actions" style="margin-top:8px">
      <button class="btn btn-out btn-sm" onclick="elegirImpresion('${m._id}')">🖨 Imprimir</button>
      ${S.esAdmin && !m.anulado ? `<button class="btn btn-out btn-sm" style="color:var(--red)" onclick="pedirAnular('${m._id}')">Anular</button>` : ''}
    </div>`}</div>`;
}
function renderHistorial() {
  const h = S.hist; if (!h.desde) { h.desde = haceDias(7); h.hasta = hoy(); }
  const lista = movsFiltrados(), vis = lista.slice(0, h.limite);
  const etOpts = Object.entries(ETAPAS).map(([k, e]) => `<option value="${k}" ${h.etapa === k ? 'selected' : ''}>${e.n} · ${e.titulo}</option>`).join('');
  return `<div class="card"><h2>Historial de movimientos</h2>
    <div class="grid2">
      <div><label class="lbl">Desde</label><input class="in" type="date" value="${h.desde}" onchange="S.hist.desde=this.value;S.hist.limite=40;renderMain()"></div>
      <div><label class="lbl">Hasta</label><input class="in" type="date" value="${h.hasta}" onchange="S.hist.hasta=this.value;S.hist.limite=40;renderMain()"></div>
      <div><label class="lbl">Etapa</label><select class="in" onchange="S.hist.etapa=this.value;renderMain()"><option value="">Todas</option>${etOpts}</select></div>
      <div><label class="lbl">Buscar</label><input class="in" value="${esc(h.q)}" placeholder="Asesor, proveedor, producto…" onchange="S.hist.q=this.value;renderMain()"></div>
    </div>
    <div class="actions"><span class="hint" style="margin:auto 0;flex:1">${lista.length} movimiento(s)</span>
      <button class="btn btn-out btn-sm" onclick="exportarCSV()">⬇ Exportar CSV</button></div>
  </div>
  ${vis.length ? vis.map(htmlMov).join('') : '<div class="card empty">Sin movimientos con esos filtros.</div>'}
  ${lista.length > vis.length ? `<button class="btn btn-out btn-block" onclick="S.hist.limite+=40;renderMain()">Mostrar más (${lista.length - vis.length})</button>` : ''}`;
}
function exportarCSV() {
  const filas = [['Fecha', 'Hora', 'Etapa', 'Área', 'Categoría', 'Ítem', 'Cantidad', 'Asesor', 'Proveedor', 'Documento', 'Motivo', 'Registrado por', 'Observación', 'Anulado']];
  movsFiltrados().forEach(m => (m.items || []).forEach(i => filas.push([m.fecha, fmtHora(msDe(m)), ETAPAS[m.etapa]?.titulo || m.etapa, m.area, i.categoria || '', i.nombre, i.cantidad,
    m.ruta || '', m.proveedor || '', m.documento || '', m.motivo || '', m.creadoPorNombre || '', m.nota || '', m.anulado ? 'SI' : ''])));
  const csv = '﻿' + filas.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `bodega_${S.hist.desde}_${S.hist.hasta}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ── Anulación (solo admin) ─────────────────────────────────────────── */
function pedirAnular(id) {
  const m = S.movs.find(x => x._id === id); if (!m) return;
  /* Si se anula una ENTRADA, avisa qué ítems quedarían en negativo */
  let avisoNeg = '';
  const entrada = ['RECEPCION', 'TERMINADO', 'DEVOLUCION', 'RETORNO_ENVASE'].includes(m.etapa) || (m.etapa === 'AJUSTE');
  if (entrada) {
    const st = calcularStock();
    const neg = (m.items || []).filter(i => {
      const q = Number(i.cantidad) || 0; if (q <= 0) return false;
      const s = m.area === 'INSUMOS' ? (st.ins[i.id]?.stock || 0) : m.area === 'ENVASES' ? (st.env[i.nombre]?.stock || 0) : (st.pt[i.nombre]?.stock || 0);
      return s - q < 0;
    });
    if (neg.length) avisoNeg = `<div class="msg err">Al anular, quedarían en negativo: ${neg.map(i => esc(i.nombre)).join(', ')} (esa mercadería ya salió). Revisa antes de continuar.</div>`;
  }
  openModal(`<h3>Anular movimiento</h3>${htmlMov(m, true)}${avisoNeg}
    <div class="msg warn">El registro no se borra: queda marcado como ANULADO y deja de contar en el stock.${['TERMINADO', 'DANO', 'AJUSTE'].includes(m.etapa) && m.area === 'TERMINADO' ? ' También se revierte en el Inventario del dashboard.' : ''}</div>
    <label class="lbl">Motivo de la anulación *</label><input class="in" id="motAnular" style="text-transform:uppercase" placeholder="Ej. cantidad digitada mal">
    <div class="actions"><button class="btn btn-out" style="flex:1" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-red" style="flex:1" onclick="anular('${id}')">Anular</button></div>`);
}
function anular(id) {
  const mot = upper($('#motAnular')?.value, 200); if (!mot) { alert('Escribe el motivo.'); return; }
  const m = S.movs.find(x => x._id === id); if (!m || m.anulado) return closeModal();
  db.collection('bodMovimientos').doc(id).update({ anulado: true, anuladoPor: S.user.uid, anuladoPorNombre: S.nombre, anuladoEn: TS(), motivoAnulacion: mot })
    .catch(e => alert('❌ No se pudo anular: ' + e.message));
  sincronizarDashboard(id, m, true);
  closeModal(); toast('Movimiento anulado');
}

/* ── Comprobante térmico 58 mm ──────────────────────────────────────── */
function imprimirMov(id) {
  const m = S.movs.find(x => x._id === id); if (!m) { toast('Espera un momento y vuelve a intentar.'); return; }
  const e = ETAPAS[m.etapa] || {};
  const filas = (m.items || []).map(i => `<tr><td>${esc(i.nombre)}${i.categoria ? ' <i>(' + esc(i.categoria) + ')</i>' : ''}</td><td class="r">${m.etapa === 'AJUSTE' && i.cantidad > 0 ? '+' : ''}${num(i.cantidad)}</td></tr>`).join('');
  const quien = m.creadoPorNombre || '', ase = nombreRuta(m.ruta);
  const firmas = m.etapa === 'CARGA' ? [['ENTREGA BODEGA', quien], ['RECIBE ASESOR', ase]]
    : (m.etapa === 'DEVOLUCION' || m.etapa === 'RETORNO_ENVASE') ? [['ENTREGA ASESOR', ase], ['RECIBE BODEGA', quien]]
    : m.etapa === 'RECEPCION' ? [['ENTREGA PROVEEDOR', m.proveedor || ''], ['RECIBE BODEGA', quien]]
    : [['RESPONSABLE', quien]];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Comprobante</title><style>
    @page{size:58mm auto;margin:2mm}*{margin:0;padding:0}body{width:48mm;font:12px/1.35 Arial,sans-serif;color:#000}
    h1{font-size:15px;text-align:center}h2{font-size:12px;text-align:center;margin:2px 0 4px}.c{text-align:center}
    hr{border:0;border-top:1px dashed #000;margin:4px 0}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top;font-size:12px}
    .r{text-align:right;font-weight:bold;white-space:nowrap;padding-left:4px}.f{margin-top:26px;border-top:1px solid #000;text-align:center;font-size:10px;padding-top:2px}.f b{display:block;font-size:12px}
    .logo{display:block;width:40mm;max-width:100%;height:auto;margin:0 auto 3px}
    </style></head><body>
    <img class="logo" src="${new URL('logo-luanaqua.png', location.href).href}" alt="AQUA LUAN" onerror="this.outerHTML='<h1>AQUA LUAN</h1>'"><h2>BODEGA · ${esc((e.titulo || m.etapa).toUpperCase())}</h2>
    <div>Fecha: <b>${fmtFecha(m.fecha)}</b> ${fmtHora(msDe(m))}</div><div>N°: ${esc(m._id.slice(0, 8).toUpperCase())}</div>
    ${m.ruta ? `<div>Asesor: <b>${esc(m.ruta)}</b></div>` : ''}${m.proveedor ? `<div>Proveedor: <b>${esc(m.proveedor)}</b></div>` : ''}${m.documento ? `<div>Doc: ${esc(m.documento)}</div>` : ''}
    ${m.motivo ? `<div>Motivo: ${esc(m.motivo)}</div>` : ''}${m.area && (m.etapa === 'DANO' || m.etapa === 'AJUSTE' || m.area === 'ENVASES') ? `<div>Área: ${nombreArea(m.area).toUpperCase()}</div>` : ''}
    <div>Registró: ${esc(m.creadoPorNombre || '')}</div>${m.anulado ? '<div><b>*** ANULADO ***</b></div>' : ''}
    <hr><table>${filas}</table><hr>${m.totalUnidades ? `<table><tr><td><b>TOTAL</b></td><td class="r">${num(m.totalUnidades)}</td></tr></table>` : ''}
    ${m.nota ? `<div>Obs.: ${esc(m.nota)}</div>` : ''}
    ${firmas.map(([t, n]) => `<div class="f"><b>${esc(n || ' ')}</b>${t}</div>`).join('')}<br><div class="c">.</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para esta app.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

/* ── Selector de impresión: ticket térmico 58 mm o PDF / impresión normal A4 ── */
function elegirImpresion(id) {
  openModal(`<h3>🖨 Imprimir comprobante</h3>
    <div class="actions" style="flex-direction:column;gap:8px">
      <button class="btn btn-main btn-block" onclick="closeModal();imprimirMov('${id}')">🧾 Ticket térmico (58 mm)</button>
      <button class="btn btn-out btn-block" onclick="closeModal();imprimirMovPDF('${id}')">📄 PDF / Impresión normal (A4)</button>
      <button class="btn btn-out btn-block" onclick="closeModal()">Cancelar</button></div>`);
}

/* ── Comprobante PDF / impresión normal A4 ──────────────────────────── */
function imprimirMovPDF(id) {
  const m = S.movs.find(x => x._id === id); if (!m) { toast('Espera un momento y vuelve a intentar.'); return; }
  const e = ETAPAS[m.etapa] || {};
  const filas = (m.items || []).map((i, k) => `<tr><td class="c">${k + 1}</td><td>${esc(i.nombre)}</td><td>${esc(i.categoria || '')}</td><td class="r">${m.etapa === 'AJUSTE' && i.cantidad > 0 ? '+' : ''}${num(i.cantidad)}</td></tr>`).join('');
  const quien = m.creadoPorNombre || '', ase = nombreRuta(m.ruta);
  const firmas = m.etapa === 'CARGA' ? [['ENTREGA BODEGA', quien], ['RECIBE ASESOR', ase]]
    : (m.etapa === 'DEVOLUCION' || m.etapa === 'RETORNO_ENVASE') ? [['ENTREGA ASESOR', ase], ['RECIBE BODEGA', quien]]
    : m.etapa === 'RECEPCION' ? [['ENTREGA PROVEEDOR', m.proveedor || ''], ['RECIBE BODEGA', quien]]
    : [['RESPONSABLE', quien]];
  const dato = (l, v) => v ? `<div class="d"><span>${l}</span><b>${v}</b></div>` : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Comprobante ${esc(m._id.slice(0, 8).toUpperCase())}</title><style>
    @page{size:A4;margin:15mm}*{margin:0;padding:0;box-sizing:border-box}body{font:13px/1.45 Arial,sans-serif;color:#000}
    .head{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #0b4f4a;padding-bottom:10px;margin-bottom:14px}
    .logo{height:60px;width:auto}.tt{text-align:right}.tt h1{font-size:18px;color:#0b4f4a}.tt h2{font-size:14px;font-weight:normal;margin-top:2px}
    .datos{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:16px}.d span{display:block;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.04em}.d b{font-size:13px}
    table{width:100%;border-collapse:collapse}th{background:#0b4f4a;color:#fff;font-size:11px;text-transform:uppercase;text-align:left;padding:6px 8px}
    td{border-bottom:1px solid #ccc;padding:6px 8px;vertical-align:top}.c{text-align:center;width:36px}.r{text-align:right;font-weight:bold;white-space:nowrap;width:110px}th.r{text-align:right}
    .tot td{border-top:2px solid #000;border-bottom:0;font-weight:bold;font-size:14px}.obs{margin-top:12px}.anul{margin:10px 0;padding:6px;border:2px solid #b00;color:#b00;text-align:center;font-weight:bold}
    .firmas{display:flex;gap:40px;margin-top:70px}.f{flex:1;border-top:1px solid #000;text-align:center;font-size:11px;padding-top:4px}.f b{display:block;font-size:13px}
    .pie{margin-top:30px;font-size:10px;color:#777;text-align:center}
    </style></head><body>
    <div class="head"><img class="logo" src="${new URL('logo-luanaqua.png', location.href).href}" alt="AQUA LUAN" onerror="this.outerHTML='<h1>AQUA LUAN</h1>'">
      <div class="tt"><h1>BODEGA · ${esc((e.titulo || m.etapa).toUpperCase())}</h1><h2>Comprobante N° ${esc(m._id.slice(0, 8).toUpperCase())}</h2></div></div>
    ${m.anulado ? '<div class="anul">*** ANULADO ***</div>' : ''}
    <div class="datos">${dato('Fecha', fmtFecha(m.fecha) + ' ' + fmtHora(msDe(m)))}${dato('Registró', esc(m.creadoPorNombre || ''))}
      ${dato('Asesor', m.ruta ? esc(m.ruta) : '')}${dato('Proveedor', m.proveedor ? esc(m.proveedor) : '')}${dato('Documento', m.documento ? esc(m.documento) : '')}
      ${dato('Motivo', m.motivo ? esc(m.motivo) : '')}${dato('Área', m.area && (m.etapa === 'DANO' || m.etapa === 'AJUSTE' || m.area === 'ENVASES') ? nombreArea(m.area).toUpperCase() : '')}</div>
    <table><thead><tr><th class="c">#</th><th>Ítem</th><th>Categoría</th><th class="r">Cantidad</th></tr></thead><tbody>${filas}</tbody>
    ${m.totalUnidades ? `<tfoot><tr class="tot"><td></td><td colspan="2">TOTAL</td><td class="r">${num(m.totalUnidades)}</td></tr></tfoot>` : ''}</table>
    ${m.nota ? `<div class="obs"><b>Obs.:</b> ${esc(m.nota)}</div>` : ''}
    <div class="firmas">${firmas.map(([t, n]) => `<div class="f"><b>${esc(n || ' ')}</b>${t}</div>`).join('')}</div>
    <div class="pie">Aqua Luan · Bodega</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para esta app.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

/* ══════════════════════════ CUADRE DEL CAMIÓN (admin / secretaria) ══════════════════════════
   Por asesor y día. Solo LEE: pedidos y envasesPrestamos (app del asesor) + bodMovimientos.
   Producto:  cargado − vendido (incluye regalías) = debe regresar; diferencia = devuelto − debe regresar.
   Envases:   recuperados de clientes (app pedidos) vs. entregados en bodega (♻ retorno). */
async function cargarCuadre(fecha, forzar) {
  const C = S.cuadre;
  if (!forzar && C.cache[fecha]) return;
  C.cargando = true; C.error = ''; renderMain();
  try {
    const [ped, env] = await Promise.all([
      db.collection('pedidos').where('fecha', '==', fecha).get(),
      db.collection('envasesPrestamos').where('fecha', '==', fecha).get().catch(e => { console.warn('envasesPrestamos', e); return { docs: [] }; })
    ]);
    C.cache[fecha] = { pedidos: ped.docs.map(d => d.data()), envases: env.docs.map(d => d.data()), hora: Date.now() };
  } catch (e) {
    console.error(e); C.error = e.code === 'permission-denied' ? 'Sin permiso para leer pedidos (solo administrador o secretaria).' : (e.message || 'Error al cargar');
  }
  C.cargando = false; renderMain();
}
function datosCuadre(fecha) {
  const d = S.cuadre.cache[fecha]; if (!d) return null;
  const R = {};
  const A = r => (R[r] = R[r] || { prod: {}, env: {}, pedidos: 0 });
  const P = (r, n) => (A(r).prod[n] = A(r).prod[n] || { carga: 0, vend: 0, dev: 0 });
  const V = (r, n) => (A(r).env[n] = A(r).env[n] || { prest: 0, recup: 0, entreg: 0 });
  S.movs.filter(m => !m.anulado && m.fecha === fecha && m.ruta).forEach(m => (m.items || []).forEach(it => {
    const q = Number(it.cantidad) || 0;
    if (m.etapa === 'CARGA') P(m.ruta, it.nombre).carga += q;
    if (m.etapa === 'DEVOLUCION') P(m.ruta, it.nombre).dev += q;
    if (m.etapa === 'RETORNO_ENVASE') V(m.ruta, it.nombre).entreg += q;
  }));
  d.pedidos.forEach(p => {
    if (!p.empleado) return; A(p.empleado).pedidos++;
    (p.productos || []).forEach(x => {
      P(p.empleado, x.nombre).vend += Number(x.cantidad) || 0;
      (x.regalias || []).forEach(g => { P(p.empleado, g.nombre).vend += Number(g.cantidad) || 0; });
    });
  });
  d.envases.filter(e => !e.anulado && e.empleado).forEach(e => {
    if (e.tipo === 'PRESTAMO') V(e.empleado, e.envase).prest += Number(e.cantidad) || 0;
    if (e.tipo === 'DEVOLUCION') V(e.empleado, e.envase).recup += Number(e.cantidad) || 0;
  });
  return R;
}
function renderCuadre() {
  const C = S.cuadre; if (!C.fecha) C.fecha = hoy();
  if (!C.cache[C.fecha] && !C.cargando && !C.error) setTimeout(() => cargarCuadre(C.fecha), 0);
  const R = datosCuadre(C.fecha);
  const dif = n => n === 0 ? `<span class="badge" style="background:var(--okbg);color:var(--ok)">✓ cuadra</span>`
    : n < 0 ? `<span class="badge" style="background:var(--redbg);color:var(--red)">faltan ${num(-n)}</span>`
    : `<span class="badge" style="background:var(--amberbg);color:var(--amber)">sobran ${num(n)}</span>`;
  let cuerpo = '';
  if (C.cargando) cuerpo = '<div class="card empty">Cargando pedidos del día…</div>';
  else if (C.error) cuerpo = `<div class="msg err">${esc(C.error)}</div>`;
  else if (R) {
    const rutas = Object.keys(R).sort();
    let faltantes = 0;
    cuerpo = rutas.length ? rutas.map(r => {
      const a = R[r];
      const prods = Object.entries(a.prod).filter(([, x]) => x.carga || x.vend || x.dev).sort(([x], [y]) => x.localeCompare(y));
      const envs = Object.entries(a.env).filter(([, x]) => x.prest || x.recup || x.entreg).sort(([x], [y]) => x.localeCompare(y));
      prods.forEach(([, x]) => { if ((x.dev - (x.carga - x.vend)) !== 0) faltantes++; });
      envs.forEach(([, x]) => { if (x.entreg - x.recup !== 0) faltantes++; });
      return `<div class="card"><h2>${esc(r)}</h2><p class="hint">${a.pedidos} pedido(s) registrados en la app ese día.</p>
        ${prods.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="n">Cargado</th><th class="n">Vendido*</th><th class="n">Debe regresar</th><th class="n">Devolvió</th><th>Resultado</th></tr></thead><tbody>
          ${prods.map(([n, x]) => { const debe = x.carga - x.vend; return `<tr><td><b>${esc(n)}</b></td><td class="n">${num(x.carga)}</td><td class="n">${num(x.vend)}</td><td class="n">${num(debe)}</td><td class="n">${num(x.dev)}</td><td>${dif(x.dev - debe)}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<div class="empty">Sin carga ni ventas de producto.</div>'}
        ${envs.length ? `<h2 style="margin-top:14px">♻ Envases prestados</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Envase</th><th class="n">Prestó hoy</th><th class="n">Recuperó de clientes</th><th class="n">Entregó en bodega</th><th>Resultado</th></tr></thead><tbody>
          ${envs.map(([n, x]) => `<tr><td><b>${esc(n)}</b></td><td class="n">${num(x.prest)}</td><td class="n">${num(x.recup)}</td><td class="n">${num(x.entreg)}</td><td>${dif(x.entreg - x.recup)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      </div>`;
    }).join('') + '' : '<div class="card empty">No hay cargas, ventas ni envases ese día.</div>';
    if (rutas.length) cuerpo = `<div class="msg ${faltantes ? 'warn' : 'ok'}">${faltantes ? `Hay ${faltantes} línea(s) que no cuadran. Revisa con el asesor antes de cerrar el día.` : 'Todo cuadra para este día.'}</div>` + cuerpo;
  }
  return `<div class="card"><h2>Cuadre del camión</h2>
    <p class="hint">Compara lo que se cargó al camión con lo que el asesor vendió en la app de pedidos y lo que devolvió a bodega. *Vendido incluye las regalías. “Faltan” = no regresó a bodega; “sobran” = regresó más de lo esperado (posible venta sin registrar).</p>
    <div class="grid2"><div><label class="lbl">Día</label><input class="in" type="date" value="${C.fecha}" max="${hoy()}" onchange="S.cuadre.fecha=this.value;S.cuadre.error='';cargarCuadre(this.value)"></div>
      <div style="display:flex;align-items:flex-end"><button class="btn btn-out" onclick="cargarCuadre(S.cuadre.fecha,true)">↻ Actualizar ventas</button></div></div>
  </div>${cuerpo}`;
}

/* ══════════════════════════ ADMIN ══════════════════════════ */
function renderAdmin() {
  const a = S.modo.admin;
  const seg = `<div class="seg">${[['USUARIOS', 'Usuarios de bodega'], ['CATALOGO', 'Catálogo de insumos']].map(([v, l]) => `<button class="${a === v ? 'on' : ''}" onclick="S.modo.admin='${v}';renderMain()">${l}</button>`).join('')}</div>`;
  return `<div class="card"><h2>Administración</h2>${seg}</div>` + (a === 'USUARIOS' ? htmlUsuarios() : htmlCatalogo());
}

/* Usuarios */
function htmlUsuarios() {
  const existentes = new Set(S.usuariosBod.map(u => u.usuario));
  const plant = PLANTILLAS.map(p => `<button class="btn btn-out btn-sm" ${existentes.has(p.usuario) ? 'disabled title="Ya existe"' : ''} onclick="usarPlantilla(${p.n})">Persona ${p.n} · ${ETAPAS[p.rol].corto}</button>`).join('');
  const rolesChk = (pref, sel) => ROLES_BODEGA.map(r => `<label><input type="checkbox" data-rol="${r}" class="${pref}" ${sel.includes(r) ? 'checked' : ''}> ${ETAPAS[r].n} ${ETAPAS[r].corto}</label>`).join('');
  return `
  <div class="card"><h2>Crear usuario de bodega</h2>
    <p class="hint">El <b>usuario</b> de ingreso es el puesto (recepcion, produccion, terminado, carga) y no cambia. El <b>nombre</b> empieza como “PERSONA N” y lo cambias por el nombre real cuando quieras; si alguien deja el puesto, solo cambias el nombre y la contraseña. El historial guarda el nombre de quien registró cada movimiento.</p>
    <div class="actions" style="margin:0 0 6px">${plant}</div>
    <div class="grid2">
      <div><label class="lbl">Usuario (para ingresar)</label><input class="in" id="nuUsuario" autocapitalize="none" placeholder="ej. recepcion"></div>
      <div><label class="lbl">Nombre visible</label><input class="in" id="nuNombre" style="text-transform:uppercase" placeholder="PERSONA 1"></div>
      <div><label class="lbl">Contraseña (mín. 6)</label><input class="in" id="nuPass" type="text" autocomplete="off"></div>
    </div>
    <label class="lbl">Etapas que puede registrar</label><div class="roles">${rolesChk('nuRol', [])}</div>
    <div class="actions"><button class="btn btn-main" id="btnCrearU" onclick="crearUsuario()">Crear usuario</button></div>
    <div id="nuMsg"></div>
  </div>
  <div class="card"><h2>Usuarios de bodega (${S.usuariosBod.length})</h2>
    ${S.usuariosBod.length ? S.usuariosBod.map(u => `<div class="user-row" id="u_${u.uid}">
      <div class="grid2">
        <div><label class="lbl">Nombre visible</label><input class="in" data-f="nombre" style="text-transform:uppercase" value="${esc(u.nombre || '')}"></div>
        <div><label class="lbl">Usuario de ingreso</label><input class="in" value="${esc(u.usuario || '')}" disabled></div>
      </div>
      <label class="lbl">Etapas</label><div class="roles">${rolesChk('uRol', u.rolesBodega || [])}
        <label style="background:${u.activoBodega === false ? 'var(--redbg)' : 'var(--okbg)'}"><input type="checkbox" data-f="activo" ${u.activoBodega === false ? '' : 'checked'}> Activo</label></div>
      <div class="actions"><button class="btn btn-navy btn-sm" onclick="guardarUsuario('${u.uid}')">Guardar cambios</button>
        <button class="btn btn-out btn-sm" onclick="cambiarPass('${u.uid}')">Cambiar contraseña</button></div>
    </div>`).join('') : '<div class="empty">Aún no hay usuarios de bodega.</div>'}
  </div>`;
}
function usarPlantilla(n) {
  const p = PLANTILLAS.find(x => x.n === n);
  $('#nuUsuario').value = p.usuario; $('#nuNombre').value = 'PERSONA ' + n;
  document.querySelectorAll('.nuRol').forEach(ch => ch.checked = ch.dataset.rol === p.rol);
  $('#nuPass').focus();
}
async function crearUsuario() {
  const usuario = $('#nuUsuario').value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const nombre = upper($('#nuNombre').value, 60), pass = $('#nuPass').value;
  const roles = [...document.querySelectorAll('.nuRol:checked')].map(c => c.dataset.rol);
  const msg = t => $('#nuMsg').innerHTML = t;
  if (!usuario || usuario === 'admin') return msg('<div class="msg err">Usuario no válido.</div>');
  if (!nombre) return msg('<div class="msg err">Escribe el nombre visible.</div>');
  if (pass.length < 6) return msg('<div class="msg err">La contraseña debe tener al menos 6 caracteres.</div>');
  if (!roles.length) return msg('<div class="msg err">Marca al menos una etapa.</div>');
  if (!navigator.onLine) return msg('<div class="msg err">Necesitas internet para crear usuarios.</div>');
  const btn = $('#btnCrearU'); btn.disabled = true; btn.textContent = 'Creando…';
  try {
    const cred = await _secAuth.createUserWithEmailAndPassword(emailDeUsuario(usuario), pass);
    const uid = cred.user.uid; await _secAuth.signOut();
    await db.collection('usuarios').doc(uid).set({
      usuario, nombre, nombreCompleto: nombre, rol: 'BODEGA', esAdmin: false,
      esBodega: true, activoBodega: true, rolesBodega: roles,
      creadoPor: S.user.uid, creadoEn: TS()
    });
    S.modo.admin = 'USUARIOS'; renderMain();
    toast(`Usuario "${usuario}" creado`, 3500);
  } catch (e) {
    console.error(e);
    msg(`<div class="msg err">${e.code === 'auth/email-already-in-use' ? 'Ese usuario ya existe en el sistema (puede ser de otra app). Usa otro nombre de usuario.' : esc(e.message)}</div>`);
    btn.disabled = false; btn.textContent = 'Crear usuario';
  }
}
async function guardarUsuario(uid) {
  const box = $('#u_' + uid); if (!box) return;
  const nombre = upper(box.querySelector('[data-f=nombre]').value, 60);
  const roles = [...box.querySelectorAll('.uRol:checked')].map(c => c.dataset.rol);
  const activo = box.querySelector('[data-f=activo]').checked;
  if (!nombre) return alert('El nombre no puede quedar vacío.');
  if (activo && !roles.length) return alert('Marca al menos una etapa o desactiva el usuario.');
  try {
    await db.collection('usuarios').doc(uid).update({ nombre, nombreCompleto: nombre, rolesBodega: roles, activoBodega: activo });
    toast('Usuario actualizado. Los cambios aplican la próxima vez que inicie sesión.', 3500);
  } catch (e) { alert('❌ ' + e.message); }
}
async function cambiarPass(uid) {
  const u = S.usuariosBod.find(x => x.uid === uid) || {}, nombre = u.nombre || u.usuario || '';
  const p = prompt(`Nueva contraseña para ${nombre} (mín. 6 caracteres):`); if (p === null) return;
  if (p.length < 6) return alert('Mínimo 6 caracteres.');
  try {
    const token = await auth.currentUser.getIdToken(true);
    const r = await fetch('https://us-central1-luan-aqua.cloudfunctions.net/resetAsesorPassword', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ data: { uid, nuevaPassword: p } })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Error ' + r.status);
    toast('Contraseña actualizada', 3000);
  } catch (e) { alert('❌ ' + e.message); }
}

/* Catálogo de insumos */
function htmlCatalogo() {
  const faltan = CATEGORIAS.reduce((a, cat) => a + CATALOGO_INICIAL[cat].filter(n => !S.insumos.some(i => i.id === cat + '__' + slug(n))).length, 0);
  const lista = [...S.insumos].sort((a, b) => CATEGORIAS.indexOf(a.categoria) - CATEGORIAS.indexOf(b.categoria) || (a.orden ?? 999) - (b.orden ?? 999) || a.nombre.localeCompare(b.nombre));
  return `
  <div class="card"><h2>Lista inicial (hoja de control)</h2>
    <p class="hint">Bultos, tapas y etiquetas tal como están en la hoja física. ${faltan ? `Faltan <b>${faltan}</b> ítem(s) por cargar.` : 'Todos los ítems de la lista inicial ya están cargados.'}</p>
    ${faltan ? `<button class="btn btn-main" onclick="cargarCatalogoInicial()">Cargar lista inicial (${faltan})</button>` : ''}
  </div>
  <div class="card"><h2>Agregar insumo</h2>
    <div class="grid2">
      <div><label class="lbl">Categoría</label><select class="in" id="niCat">${CATEGORIAS.map(c => `<option>${c}</option>`).join('')}</select></div>
      <div><label class="lbl">Nombre</label><input class="in" id="niNombre" style="text-transform:uppercase"></div>
      <div><label class="lbl">Stock mínimo (alerta)</label><input class="in" id="niMin" type="number" min="0" inputmode="numeric" placeholder="0 = sin alerta"></div>
    </div>
    <div class="actions"><button class="btn btn-main" onclick="agregarInsumo()">Agregar</button></div>
  </div>
  <div class="card"><h2>Insumos (${lista.length})</h2>
    <p class="hint">Cambiar el nombre no afecta el stock ni el historial. Desactivar lo oculta de los formularios.</p>
    ${lista.length ? CATEGORIAS.map(cat => { const arr = lista.filter(i => i.categoria === cat); if (!arr.length) return '';
      return `<div class="cat"><div class="cat-title"><span>${cat}</span><span>${arr.length}</span></div>${arr.map(i => `
        <div class="item" id="ins_${esc(i.id)}" style="flex-wrap:wrap">
          <input class="in" data-f="nombre" style="flex:2;min-width:150px;text-transform:uppercase;padding:8px" value="${esc(i.nombre)}">
          <input class="in" data-f="minimo" type="number" min="0" style="width:90px;padding:8px" value="${Number(i.minimo) || ''}" placeholder="mín.">
          <label style="font-size:12px;font-weight:700;display:flex;gap:4px;align-items:center"><input type="checkbox" data-f="activo" ${i.activo !== false ? 'checked' : ''}> Activo</label>
          <button class="btn btn-navy btn-sm" onclick="guardarInsumo('${esc(i.id)}')">Guardar</button>
        </div>`).join('')}</div>`; }).join('') : '<div class="empty">Sin insumos.</div>'}
  </div>`;
}
async function cargarCatalogoInicial() {
  const lote = db.batch(); let n = 0;
  CATEGORIAS.forEach(cat => CATALOGO_INICIAL[cat].forEach((nombre, idx) => {
    const id = cat + '__' + slug(nombre);
    if (S.insumos.some(i => i.id === id)) return;
    lote.set(db.collection('bodInsumos').doc(id), { nombre, categoria: cat, orden: idx, minimo: 0, activo: true, creadoPor: S.user.uid, creadoEn: TS() });
    n++;
  }));
  if (!n) return toast('No falta nada por cargar.');
  try { await lote.commit(); toast(`${n} insumos cargados`); } catch (e) { alert('❌ ' + e.message); }
}
async function agregarInsumo() {
  const cat = $('#niCat').value, nombre = upper($('#niNombre').value, 60), minimo = Math.max(0, parseInt($('#niMin').value) || 0);
  if (!nombre) return alert('Escribe el nombre.');
  const id = cat + '__' + slug(nombre);
  if (S.insumos.some(i => i.id === id || (i.categoria === cat && i.nombre === nombre))) return alert('Ese insumo ya existe en ' + cat + '.');
  const orden = S.insumos.filter(i => i.categoria === cat).reduce((m, i) => Math.max(m, i.orden ?? 0), 0) + 1;
  try {
    await db.collection('bodInsumos').doc(id).set({ nombre, categoria: cat, orden, minimo, activo: true, creadoPor: S.user.uid, creadoEn: TS() });
    toast('Insumo agregado'); $('#niNombre').value = ''; $('#niMin').value = '';
  } catch (e) { alert('❌ ' + e.message); }
}
async function guardarInsumo(id) {
  const box = document.getElementById('ins_' + id); if (!box) return;
  const nombre = upper(box.querySelector('[data-f=nombre]').value, 60);
  if (!nombre) return alert('El nombre no puede quedar vacío.');
  try {
    await db.collection('bodInsumos').doc(id).update({
      nombre, minimo: Math.max(0, parseInt(box.querySelector('[data-f=minimo]').value) || 0),
      activo: box.querySelector('[data-f=activo]').checked
    });
    toast('Insumo actualizado');
  } catch (e) { alert('❌ ' + e.message); }
}

/* ── Service worker (PWA / offline) ── */
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
