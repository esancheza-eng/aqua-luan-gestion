/* ════════════════════════════════════════
   CONFIG
════════════════════════════════════════ */
/* [NEW] SCRIPT_URL eliminado — los datos ahora vienen de Firestore, no de Google Sheets */

/* ══ FIREBASE — Fase 1: Authentication (login del admin) ══ */
const firebaseConfig = {
  apiKey: "AIzaSyBOPI_zviuktXtH68F8NY4mSnbYcF1tE7s",
  authDomain: "luan-aqua.firebaseapp.com",
  projectId: "luan-aqua",
  storageBucket: "luan-aqua.firebasestorage.app",
  messagingSenderId: "1046111203141",
  appId: "1:1046111203141:web:017cd2d14f1db77c9c582c",
  measurementId: "G-L0YP0548Y6"
};
firebase.initializeApp(firebaseConfig);
/* [SECURITY FIX] Firebase App Check — ver nota igual en index.html. Modo "Monitor" en
   Firebase Console: no bloquea nada todavía, solo registra. */
firebase.appCheck().activate(
  '6Leu0nAtAAAAACV2-G97q5BNW2RZ_lHzEUuIxLfn',
  true
);
const auth = firebase.auth();
// [FIX] LA PANTALLA SE SEGUÍA CONGELANDO en algunos navegadores (Edge/Chrome
// con "Tracking Prevention" o bloqueo de cookies de terceros activado): el
// authDomain de Firebase ("luan-aqua.firebaseapp.com") es un dominio DISTINTO
// al del dashboard ("aqualuanpedidos.elhyai.com"), así que por defecto
// Firebase Auth intenta sincronizar la sesión mediante un iframe oculto hacia
// ese dominio — eso es justo lo que bloquea "Tracking Prevention" (mensajes
// en consola: "requestStorageAccess: Permission denied" / "Tracking
// Prevention blocked access to storage"). Cuando ese acceso falla, Firebase
// reintenta la operación varias veces, y esos reintentos silenciosos podían
// sentirse como que la pantalla se traba. Forzar persistencia LOCAL hace que
// Firebase guarde la sesión directamente en el IndexedDB del propio dominio
// del dashboard, sin depender de ese iframe entre dominios.
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err => console.warn('No se pudo fijar persistencia SESSION de Auth:', err));
const db   = firebase.firestore();
const DOMINIO_LOGIN = '@luanaqua.app';
function _emailDeUsuario(usuario){
  const limpio = usuario.trim().toLowerCase().replace(/[^a-z0-9._-]/g,'');
  // [NEW] Caso especial: la cuenta admin usa un correo REAL
  // (elhychristian@gmail.com) en vez del dominio interno, para que
  // "¿Olvidaste tu contraseña?" funcione de verdad si algún día hace falta.
  if(limpio === 'admin') return 'elhychristian@gmail.com';
  return limpio + DOMINIO_LOGIN;
}
/* [SECURITY FIX] Escapa cualquier dato que venga de un usuario (cliente, notas, dirección,
   producto, etc.) antes de insertarlo en innerHTML. Sin esto, un nombre de cliente como
   <img src=x onerror=...> se ejecuta como código en la sesión del admin que lo ve — se debe
   usar SIEMPRE que se interpole un campo de Firestore dentro de una plantilla HTML. */
function escHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
/* [NEW] Instancia secundaria de Firebase — permite crear la cuenta de Secretaria sin
   cerrar la sesión del admin (crear un usuario normalmente inicia sesión con él). */
const FORMAS_PAGO_FIJAS = ['Contado', 'Crédito', 'Transferencia', 'Cheque'];
function _normFormaPago(s){
  const t = String(s||'').trim().toLowerCase();
  if (!t || t === 'mixto' || t === 'sin especificar') return '';
  if (t.includes('contad') || t === 'efectivo') return 'Contado';
  if (t.includes('crédit') || t.includes('credit')) return 'Crédito';
  if (t.includes('transfer')) return 'Transferencia';
  if (t.includes('cheque')) return 'Cheque';
  return '';
}
function _formasDelPedido(r){
  const set = new Set();
  const des = r['PAGOS_DESGLOSE'];
  if (des && des.length) {
    des.forEach(pg => {
      const f = _normFormaPago(pg.forma);
      if (f && (parseFloat(pg.monto)||0) > 0.004) set.add(f);
    });
  }
  const fCampo = _normFormaPago(r['FORMA DE PAGO']);
  if (fCampo) set.add(fCampo);
  if (parseFloat(r['CREDITO_PENDIENTE']||0) > 0.004) set.add('Crédito');
  return set;
}
function _filtrosPagoActivos(){
  return FORMAS_PAGO_FIJAS.filter(f => !_pagoFiltroExcluidos.has(f));
}
function _desgloseRealPago(r){
  const cred=parseFloat(r['CREDITO_PENDIENTE']||0);
  if (r['PAGOS_DESGLOSE'] && r['PAGOS_DESGLOSE'].length) {
    const partes=r['PAGOS_DESGLOSE'].map(pg => `${pg.forma} $${(parseFloat(pg.monto)||0).toFixed(2)}`).join(' + ');
    return cred>0.004 ? partes + ' + Crédito $' + cred.toFixed(2) : partes;
  }
  const f = r['FORMA DE PAGO'] || '';
  if (String(f).toLowerCase() === 'mixto') {
    const formas = [..._formasDelPedido(r)];
    if (formas.length) {
      return cred>0.004 && !formas.includes('Crédito')
        ? formas.join(' + ') + ' + Crédito $' + cred.toFixed(2)
        : formas.join(' + ');
    }
  }
  return f || '-';
}
function _etiquetaPagoDetalle(r){
  const activos = _filtrosPagoActivos();
  if (activos.length === 1) return activos[0];
  return _desgloseRealPago(r);
}
function _textoDesgloseFila(r){
  return _desgloseRealPago(r);
}
function _montoPedidoSegunFiltroPago(r){
  const raw=r['TOTAL PEDIDO ($)'];
  if(raw==='' || raw===null || raw===undefined) return 0;
  const tot=parseFloat(raw)||0;
  const activos=_filtrosPagoActivos();
  if(!activos.length) return 0;
  if(activos.length===FORMAS_PAGO_FIJAS.length) return tot;
  const des=Array.isArray(r['PAGOS_DESGLOSE'])?r['PAGOS_DESGLOSE']:[];
  const cred=parseFloat(r['CREDITO_PENDIENTE']||0)||0;
  let s=0;
  if(des.length){
    des.forEach(pg=>{
      const f=_normFormaPago(pg.forma);
      if(f && activos.includes(f)) s+=parseFloat(pg.monto)||0;
    });
    if(activos.includes('Crédito')) s+=cred;
    return s;
  }
  const f=_normFormaPago(r['FORMA DE PAGO']);
  if(activos.includes('Crédito') && (f==='Crédito' || cred>0.004)){
    s+= cred>0.004 ? cred : (f==='Crédito' ? tot : 0);
  }
  if(f && f!=='Crédito' && f!=='Mixto' && activos.includes(f)){
    s+= Math.max(tot-cred,0);
  }
  if(f==='Mixto' && !des.length && activos.includes('Crédito')) s+=cred;
  return s;
}
function _totalYEtiquetaDetalleFiltrado(datos){
  const activos=_filtrosPagoActivos();
  const porProducto=!!_productoFiltroSeleccionado;
  const total= porProducto
    ? (datos||[]).reduce((s,r)=>s+(parseFloat(r['SUBTOTAL'])||0),0)
    : (datos||[]).reduce((s,r)=>s+(_montoPedidoSegunFiltroPago(r)||0),0);
  let label='TOTAL GENERAL';
  if(activos.length===1) label='TOTAL '+activos[0].toUpperCase();
  if(porProducto) label=label+' · '+_productoFiltroSeleccionado;
  return {total,label,activos,producto:_productoFiltroSeleccionado||'Todos'};
}
const _secondaryAppDash = firebase.initializeApp(firebaseConfig, 'secondaryDash');
const _secondaryAuthDash = _secondaryAppDash.auth();

const RUTA_COLORS = {
  'RUTA 1: Jefferson': '#1565c0',
  'RUTA 2: Luis':      '#0a7c6e',
  'RUTA 3: Vicente':   '#e67e22',
  'RUTA 4: Wilson':    '#c0392b',
  'RUTA 5: Lister':    '#7b1fa2',
  'RUTA 6: Asesora':   '#0891b2',
};
const RUTA_INITIALS = {
  'RUTA 1: Jefferson': 'J',
  'RUTA 2: Luis':      'L',
  'RUTA 3: Vicente':   'V',
  'RUTA 4: Wilson':    'W',
  'RUTA 5: Lister':    'Li',
  'RUTA 6: Asesora':   'A',
};
/* [FIX] RUTA_COLORS de arriba usa nombres en "Título" (ej. "Jefferson"), pero el
   nombre real guardado en cada pedido es el que el admin escribió al crear el
   asesor (ver crearAsesorReal en index.html) — normalmente todo en MAYÚSCULAS
   (ej. "RUTA 1: JEFFERSON"). La comparación exacta RUTA_COLORS[asesorKey] nunca
   coincidía por esa diferencia de mayúsculas, así que TODOS los marcadores del
   mapa de "Rutas del Día" caían al mismo color por defecto. Esta función busca
   sin distinguir mayúsculas/minúsculas y, si de verdad no encuentra el asesor,
   genera un color de respaldo determinístico según su nombre (siempre el mismo
   color para ese asesor, y distinto al de los demás) en vez de un gris/naranja
   compartido por todos. */
const RUTA_COLORS_LC = {};
Object.entries(RUTA_COLORS).forEach(([k,v]) => { RUTA_COLORS_LC[k.trim().toLowerCase()] = v; });
const _FALLBACK_COLOR_PALETTE = ['#1565c0','#0a7c6e','#e67e22','#c0392b','#7b1fa2','#0891b2','#c2185b','#558b2f','#ef6c00','#5d4037'];
function colorDeAsesor(asesorKey){
  const k = (asesorKey||'').trim().toLowerCase();
  if (RUTA_COLORS_LC[k]) return RUTA_COLORS_LC[k];
  let hash = 0;
  for (let i=0; i<k.length; i++) hash = (hash*31 + k.charCodeAt(i)) >>> 0;
  return _FALLBACK_COLOR_PALETTE[hash % _FALLBACK_COLOR_PALETTE.length];
}

let todosLosDatos = [];
let charts = {};
// [FIX] Caché de los datos que ya usa renderCharts() — permite redibujar los 3
// gráficos al instante al volver a "Resumen General", sin recalcular filtros.
let _kpiPedidosCache = [], _kpiPedidosConTotalCache = [];
// [FIX] Caché para diferir renderResumenPorCliente() y poblarClienteSelect() — ver
// comentario en renderDashboard().
let _resumenClientesPedidosCache = [], _clienteSelectPedidosCache = [];
let autoRefreshInterval = null;
let leafletMap = null;
let leafletLoaded = false;
let mapMarkers = [];
let mapPolylines = [];
let pedidosDetalleActuales = [];
let _pedidosTablaFiltrados = []; // [NEW] subconjunto de pedidosDetalleActuales tras aplicar el filtro de Pago, solo para la tabla de Detalle de Pedidos y su export a PDF

/* [NEW] Editar Pedido — identidad del admin actual (para el historial de cambios) */
let ADMIN_ACTUAL = { uid: null, nombre: 'Admin', usuario: '' };
let ROL_ACTUAL = null; // [NEW] 'admin' | 'secretaria' — controla qué secciones y botones se muestran

function etiquetaUsuarioSesion(){
  if (ROL_ACTUAL === 'admin') return 'Administración';
  const usuario = (ADMIN_ACTUAL && ADMIN_ACTUAL.usuario) || '';
  const nombre = (ADMIN_ACTUAL && ADMIN_ACTUAL.nombre) || usuario || 'Secretaria';
  if (usuario && nombre && nombre.toLowerCase() !== String(usuario).toLowerCase()) {
    return `Secretaria · ${nombre} (${usuario})`.trim();
  }
  return `Secretaria · ${nombre}`.trim();
}
function lineaImpresoPor(){
  return 'Impreso por: ' + etiquetaUsuarioSesion();
}
function _quitarEmoji(str){
  return String(str||'').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,'');
}

function _dispararImpresion(win){
  if(!win) return;
  try{
    if(win.document && win.document.body){
      win.document.body.innerHTML = _quitarEmoji(win.document.body.innerHTML);
    }
  }catch(e){}
  var hecho=false;
  function go(){
    if(hecho) return;
    hecho=true;
    try{ win.focus(); win.print(); }catch(e){}
  }
  setTimeout(go, 180);
  setTimeout(go, 600);
}

function actorAuditoria(){
  return etiquetaUsuarioSesion() || (ADMIN_ACTUAL && (ADMIN_ACTUAL.nombre || ADMIN_ACTUAL.usuario)) || 'sistema';
}

function pintarUsuarioHeader(){
  const el = document.getElementById('usuarioSesionBadge');
  if (el) el.textContent = etiquetaUsuarioSesion() || '—';
}
/* [NEW] Editar Pedido — catálogo de productos en caché para que el modal abra al instante */
let _productosCache = [];
let _unsubProductosDash = null;
/* [NEW] Editar Pedido — lista de rutas/asesores reales en caché (además del <select> de filtro) */
let _asesoresCache = [];
/* [NEW] Editar Pedido — pedido que se está editando actualmente en el modal */
let editandoPedidoActual = null;

/* ════════════════════════════════════════
   TABS
════════════════════════════════════════ */
/* [NEW] Menú lateral del panel administrativo — cambia entre secciones sin mezclarlas */
let _yaCargado = { eliminados:false, inventario:false, roles:false, pedidosweb:false, auditoria:false }; // [NEW] carga perezosa
const SECCIONES_SECRETARIA = ['pedidos','caja','liquidacionDash','cierreDelDia','notasAdicionalesDash','movimientosBancarios','cobranzasClientes'];

function switchSeccionDash(sec){
  if (ROL_ACTUAL === 'secretaria' && !SECCIONES_SECRETARIA.includes(sec)) {
    sec = 'pedidos';
  }
  document.querySelectorAll('.dash-section').forEach(el => el.classList.toggle('active', el.id === 'seccion-'+sec));
  document.querySelectorAll('.dash-nav-item').forEach(el => el.classList.toggle('active', el.dataset.section === sec));
  // [NEW] Carga perezosa: estas 4 pestañas no tienen filtro de fecha (leen la
  // colección completa), así que solo se conectan la PRIMERA vez que el admin
  // realmente entra a verlas — no automáticamente al iniciar sesión. Una vez
  // cargadas quedan en tiempo real mientras dure la sesión, sin recargar.
  if (ROL_ACTUAL === 'admin' && !_yaCargado[sec]) {
    if (sec === 'eliminados') { _iniciarListenerEliminados(); _yaCargado.eliminados = true; }
    if (sec === 'roles') { _iniciarListenerRolesHistorial(); _yaCargado.roles = true; }
    if (sec === 'pedidosweb') { _iniciarListenerPedidosWeb(); _yaCargado.pedidosweb = true; }
    if (sec === 'auditoria') { _iniciarListenerAuditoria(); _yaCargado.auditoria = true; }
  }
  // Inventario: el stock se calcula con TODO el historial, así que el listener
  // no puede llevar limit. Para que no quede abierto todo el día, solo vive
  // mientras el admin está dentro de esta pestaña.
  if (ROL_ACTUAL === 'admin' && sec === 'inventario') {
    _iniciarListenerInventario();
  } else if (typeof detenerListenerInventario === 'function') {
    detenerListenerInventario();
  }
  if (sec === 'liquidacionDash' && typeof renderLiquidacionDash === 'function') renderLiquidacionDash(); // [NEW] siempre refresca al entrar, ya usa datos que el Dashboard ya tiene cargados
  if (sec === 'cierreDelDia' && typeof renderCierreDelDia === 'function') renderCierreDelDia(); // [NEW] Cierre del Día — vista matriz, se refresca al entrar
  if (sec === 'eliminados' && typeof renderTablaEliminados === 'function') renderTablaEliminados();
  if (sec === 'auditoria' && typeof renderTablaAuditoria === 'function') renderTablaAuditoria();
  if (sec === 'notasAdicionalesDash' && typeof renderNotasAdicionalesDash === 'function') renderNotasAdicionalesDash(); // [NEW] sección independiente de Notas Adicionales
  if (sec === 'movimientosBancarios' && typeof renderMovimientosBancarios === 'function') renderMovimientosBancarios();
  if (sec === 'reporteAsesor' && typeof renderReporteAsesores === 'function') renderReporteAsesores();
  if (sec === 'cobranzasClientes' && typeof renderCobranzasClientes === 'function') renderCobranzasClientes();
  // [FIX] Los gráficos de "Resumen General" ya no se redibujan en cada cambio de
  // Firestore si esta pestaña no está activa (ver comentario en renderDashboard) —
  // así que al entrar aquí se redibujan al instante con los últimos datos en caché.
  if (sec === 'resumen' && typeof renderCharts === 'function') renderCharts(_kpiPedidosCache, _kpiPedidosConTotalCache);
  // [FIX] Mismo patrón para el resumen por cliente (pestaña "Resumen General") y la
  // tabla de "Consultar por Cliente" — se recalculan al instante solo al entrar,
  // usando los datos que ya se tenían en caché desde el último cambio de Firestore.
  if (sec === 'resumen' && typeof renderResumenPorCliente === 'function') renderResumenPorCliente(_resumenClientesPedidosCache);
  if (sec === 'cliente' && typeof poblarClienteSelect === 'function') poblarClienteSelect(_clienteSelectPedidosCache);
}
function _fechaRutasDesdeDashboard(){
  const desde=(document.getElementById('filtroFecha')?.value||'').trim();
  const hasta=(document.getElementById('filtroFechaHasta')?.value||'').trim();
  return hasta || desde || ((typeof fechaHoy==='function')?fechaHoy():'');
}
function _sincronizarFechaRutasConDashboard(){
  const el=document.getElementById('rutasFecha');
  if(!el) return;
  const f=_fechaRutasDesdeDashboard();
  if(f) el.value=f;
  const ra=document.getElementById('rutasAsesor');
  const fa=document.getElementById('filtroAsesor');
  if(ra && fa){
    const v=fa.value||'';
    if(!v){ ra.value=''; }
    else {
      const opts=[...ra.options].map(o=>o.value);
      if(opts.includes(v)) ra.value=v;
      else {
        const hit=opts.find(o=>o && (o.toLowerCase()===v.toLowerCase() || o.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes((o.split(':')[1]||o).trim().toLowerCase())));
        ra.value=hit||'';
      }
    }
  }
}
function switchTab(tab) {
  if (ROL_ACTUAL === 'secretaria' && tab === 'rutas') tab = 'dashboard';
  document.getElementById('viewDashboard').classList.toggle('active', tab === 'dashboard');
  document.getElementById('viewRutas').classList.toggle('active', tab === 'rutas');
  document.getElementById('tabDashboard').classList.toggle('active', tab === 'dashboard');
  document.getElementById('tabRutas').classList.toggle('active', tab === 'rutas');
  if (tab === 'rutas') {
    cargarLeaflet(() => {
      if (!leafletMap) initLeafletMap();
      // [FIX] No forzar "hoy": copiar la fecha/asesor del dashboard (ej. 16/09).
      _sincronizarFechaRutasConDashboard();
      aplicarRutas();
    });
  }
}

/* ════════════════════════════════════════
   LOGIN — [FIX] .toLowerCase() para aceptar Admin/ADMIN/admin
════════════════════════════════════════ */
async function doLogin() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  if (!user || !pass) { document.getElementById('loginError').classList.add('show'); return; }
  try{
    const email = _emailDeUsuario(user);
    const cred = await auth.signInWithEmailAndPassword(email, pass);
    const perfilDoc = await db.collection('usuarios').doc(cred.user.uid).get();
    document.getElementById('loginPass').value = '';
    const perfil = perfilDoc.exists ? perfilDoc.data() : null;
    /* [NEW] Ahora entran dos roles: Admin (acceso total) y Secretaria (solo lectura,
       sin Editar/Eliminar Pedido, sin Inventario/Roles de Pago/Importar Datos/Eliminados) */
    if(!perfil || !(perfil.esAdmin === true || perfil.esSecretaria === true)){
      await auth.signOut();
      document.getElementById('loginError').classList.add('show');
      document.getElementById('loginPass').focus();
      return;
    }
    ROL_ACTUAL = perfil.esAdmin === true ? 'admin' : 'secretaria'; // [NEW]
    ADMIN_ACTUAL = { uid: cred.user.uid, nombre: perfil.nombre || user, usuario: perfil.usuario || user };
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('loginError').classList.remove('show');
    pintarUsuarioHeader();
    iniciar();
  }catch(err){
    console.error(err);
    document.getElementById('loginError').classList.add('show');
    document.getElementById('loginPass').focus();
  }
}

/* [NEW] Cambiar la propia contraseña — no requiere Cloud Function ni
   permisos de admin, cualquier usuario autenticado puede cambiar SU
   PROPIA contraseña con el SDK de Firebase Auth, siempre que confirme
   la contraseña actual (reautenticación). No usa correos reales porque
   el login usa un dominio interno (@luanaqua.app) que nadie recibe. */
async function cambiarMiPassword(){
  if (ROL_ACTUAL === 'secretaria') { alert('La secretaria no cambia la contraseña desde aquí. Solicítelo a Administración.'); return; }
  const user = firebase.auth().currentUser;
  if(!user){ alert('No hay sesión activa.'); return; }

  const passActual = prompt('Por seguridad, ingresa tu contraseña ACTUAL:');
  if(!passActual) return;

  const passNueva = prompt('Ingresa tu NUEVA contraseña (mínimo 6 caracteres):');
  if(!passNueva || passNueva.length < 6){ alert('La nueva contraseña debe tener al menos 6 caracteres.'); return; }

  const passNuevaConfirmar = prompt('Confirma tu NUEVA contraseña:');
  if(passNueva !== passNuevaConfirmar){ alert('Las contraseñas no coinciden. Inténtalo de nuevo.'); return; }

  try{
    const credencial = firebase.auth.EmailAuthProvider.credential(user.email, passActual);
    await user.reauthenticateWithCredential(credencial);
    await user.updatePassword(passNueva);
    alert('✅ Contraseña actualizada correctamente. La próxima vez que inicies sesión, usa la nueva contraseña.');
  }catch(err){
    console.error(err);
    let msg = 'No se pudo cambiar la contraseña.';
    if(err.code === 'auth/wrong-password') msg = 'La contraseña actual que ingresaste es incorrecta.';
    else if(err.code === 'auth/weak-password') msg = 'La nueva contraseña es muy débil.';
    else if(err.code === 'auth/requires-recent-login') msg = 'Por seguridad, vuelve a iniciar sesión e inténtalo de nuevo.';
    alert('❌ ' + msg);
  }
}

/* [NEW] Recuperar contraseña del admin por correo real. Solo funciona
   para "admin" (el único usuario con correo real configurado) — para
   cualquier otro usuario, el dominio interno @luanaqua.app no existe
   como bandeja real, así que este flujo no aplicaría para asesores. */
async function olvidoPasswordAdmin(){
  const userRaw = (document.getElementById('loginUser').value || '').trim();
  if(!userRaw){
    alert('Escribe tu usuario ("admin") en el campo de Usuario antes de pedir la recuperación.');
    return;
  }
  const limpio = userRaw.toLowerCase().replace(/[^a-z0-9._-]/g,'');
  if(limpio !== 'admin'){
    alert('La recuperación por correo solo está disponible para la cuenta admin por ahora.');
    return;
  }
  try{
    await firebase.auth().sendPasswordResetEmail('elhychristian@gmail.com');
    alert('✅ Se envió un correo de recuperación a elhychristian@gmail.com. Revisa tu bandeja (y spam) y sigue el enlace para crear una nueva contraseña.');
  }catch(err){
    console.error(err);
    alert('❌ No se pudo enviar el correo de recuperación: ' + err.message);
  }
}

function cerrarSesion() {
  clearInterval(autoRefreshInterval);
  detenerListenersDashboard(); // [NEW]
  detenerListenerAsesoresDash(); // [NEW]
  detenerListenerProductosDash(); // [NEW]
  detenerListenerEliminados(); // [NEW]
  detenerListenerInventario(); // [NEW]
  detenerListenerRolesHistorial(); // [NEW]
  detenerListenerPedidosWeb(); // [NEW]
  detenerListenerAuditoria(); // [NEW]
  auth.signOut(); // la limpieza del overlay ocurre en onAuthStateChanged, más abajo
}

/* [NEW] Firebase Auth mantiene la sesión sola — si el admin o secretaria ya había entrado
   antes (en este navegador), no le vuelve a pedir clave. */
auth.onAuthStateChanged(async (user)=>{
  if(user){
    try{
      const perfilDoc = await db.collection('usuarios').doc(user.uid).get();
      const perfil = perfilDoc.exists ? perfilDoc.data() : null;
      if(perfil && (perfil.esAdmin===true || perfil.esSecretaria===true)){
        ROL_ACTUAL = perfil.esAdmin===true ? 'admin' : 'secretaria'; // [NEW]
        ADMIN_ACTUAL = { uid: user.uid, nombre: perfil.nombre || (ROL_ACTUAL==='admin'?'Admin':'Secretaria'), usuario: perfil.usuario || '' };
        document.getElementById('loginOverlay').classList.add('hidden');
        pintarUsuarioHeader();
        iniciar();
      } else {
        await auth.signOut();
      }
    }catch(e){ console.error(e); }
  } else {
    clearInterval(autoRefreshInterval);
    detenerListenersDashboard(); // [NEW]
    detenerListenerAsesoresDash(); // [NEW]
    detenerListenerProductosDash(); // [NEW]
    detenerListenerEliminados(); // [NEW]
    detenerListenerInventario(); // [NEW]
    detenerListenerRolesHistorial(); // [NEW]
    detenerListenerPedidosWeb(); // [NEW]
    detenerListenerAuditoria(); // [NEW]
    _yaCargado = { eliminados:false, inventario:false, roles:false, pedidosweb:false, auditoria:false }; // [NEW] resetea la carga perezosa al salir
    ROL_ACTUAL = null;
    ADMIN_ACTUAL = { uid: null, nombre: '', usuario: '' };
    const badge = document.getElementById('usuarioSesionBadge');
    if (badge) badge.textContent = '—';
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
  }
});

async function _resyncSesionDashboard(){
  const user = auth.currentUser;
  if(!user){
    ROL_ACTUAL = null;
    ADMIN_ACTUAL = { uid: null, nombre: '', usuario: '' };
    pintarUsuarioHeader();
    return;
  }
  try{
    const perfilDoc = await db.collection('usuarios').doc(user.uid).get();
    const perfil = perfilDoc.exists ? perfilDoc.data() : null;
    if(!perfil) return;
    ROL_ACTUAL = perfil.esAdmin===true ? 'admin' : (perfil.esSecretaria===true ? 'secretaria' : ROL_ACTUAL);
    ADMIN_ACTUAL = { uid: user.uid, nombre: perfil.nombre || '', usuario: perfil.usuario || '' };
    pintarUsuarioHeader();
    if (typeof aplicarRestriccionesRol === 'function') aplicarRestriccionesRol();
  }catch(e){ console.warn('resync sesión', e); }
}
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState==='visible') _resyncSesionDashboard();
});
window.addEventListener('pageshow', function(){ _resyncSesionDashboard(); });

/* ════════════════════════════════════════
   INICIAR
════════════════════════════════════════ */
let _unsubAsesoresDash = null;
function _iniciarListenerAsesoresDash(){
  if(_unsubAsesoresDash){_unsubAsesoresDash();_unsubAsesoresDash=null;}
  _unsubAsesoresDash = db.collection('usuarios').where('esAdmin','==',false).onSnapshot(snap => {
    const rutas = snap.docs.map(d => d.data().ruta).filter(Boolean).sort();
    _asesoresCache = rutas; // [NEW] disponible para el <select> de Asesor dentro del modal Editar Pedido
    if (typeof renderReporteAsesores === 'function') renderReporteAsesores(); /* [FIX] antes solo se refrescaba cuando cambiaban los pedidos, no cuando llegaba la lista de asesores — se quedaba en "No hay asesores registrados" si este listener tardaba más en cargar */
    if (typeof poblarClienteSelect === 'function') poblarClienteSelect(todosLosDatos); // [FIX] mismo problema en "Consultar por Cliente": el filtro de asesores se quedaba vacío (solo "Todos los asesores") si esta lista llegaba después que los pedidos
    const sel = document.getElementById('filtroAsesor');
    if (!sel) return;
    const valorActual = sel.value;
    sel.innerHTML = '<option value="">Todos</option>' + rutas.map(r => {
      const nombre = r.split(':')[1]?.trim() || r;
      return `<option value="${r}">${nombre}</option>`;
    }).join('');
    if (rutas.includes(valorActual)) sel.value = valorActual;
  }, err => console.error('listener asesores dash:', err));
}
function detenerListenerAsesoresDash(){ if(_unsubAsesoresDash){_unsubAsesoresDash();_unsubAsesoresDash=null;} }

/* [NEW] Editar Pedido — catálogo de productos en vivo, listo antes de abrir el modal
   (misma colección `productos` que ya usa el panel "Gestionar Productos" en index.html) */
function _iniciarListenerProductosDash(){
  if(_unsubProductosDash){_unsubProductosDash();_unsubProductosDash=null;}
  _unsubProductosDash = db.collection('productos').where('activo','==',true).onSnapshot(snap => {
    _productosCache = snap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || '' })).sort((a,b) => a.nombre.localeCompare(b.nombre));
    if(typeof renderInventario==='function') renderInventario(); /* [FIX] antes el <select> de Inventario solo se llenaba cuando cambiaba un movimiento, no cuando llegaba el catálogo de productos — se quedaba vacío si el catálogo cargaba después */
  }, err => console.error('listener productos dash:', err));
}
function detenerListenerProductosDash(){ if(_unsubProductosDash){_unsubProductosDash();_unsubProductosDash=null;} }

/* [NEW] Pedidos Eliminados — respaldo en vivo desde la colección `pedidosEliminados`
   (se llena automáticamente cada vez que el admin usa el botón 🗑 Eliminar). */
let _unsubEliminados=null, _eliminadosRaw=[];
function _iniciarListenerEliminados(){
  if(_unsubEliminados){_unsubEliminados();_unsubEliminados=null;}
  // [NEW] Antes leía TODA la colección; la tabla solo muestra los recientes
  // igual, así que ahora se limita también la lectura a Firestore (más rápido).
  _unsubEliminados = db.collection('pedidosEliminados').orderBy('eliminadoEn','desc').limit(200).onSnapshot(snap => {
    _eliminadosRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a,b) => (b.eliminadoEn?.toMillis?.()||0) - (a.eliminadoEn?.toMillis?.()||0));
    renderTablaEliminados();
  }, err => console.error('listener eliminados:', err));
}
function detenerListenerEliminados(){ if(_unsubEliminados){_unsubEliminados();_unsubEliminados=null;} }

/* [NEW] Auditoría — quién modificó/eliminó qué, cuándo, y el detalle antes/después.
   Limitado a los 300 registros más recientes por la misma razón que Eliminados/Roles:
   es una lista pura de lectura, sin ningún total acumulado que dependa del historial completo. */
let _unsubAuditoria=null, _auditoriaRaw=[];
function _iniciarListenerAuditoria(){
  if(_unsubAuditoria){_unsubAuditoria();_unsubAuditoria=null;}
  _unsubAuditoria = db.collection('historialCambios').orderBy('creadoEn','desc').limit(300).onSnapshot(snap => {
    _auditoriaRaw = snap.docs.map(d => d.data());
    renderTablaAuditoria();
  }, err => console.error('listener auditoría:', err));
}
function renderTablaAuditoria(){
  const tbody = document.getElementById('auditoriaTbody');
  const count = document.getElementById('auditoriaCount');
  if (!tbody) return;
  const registros = (_auditoriaRaw||[]).filter(r => _estaEnRangoFiltroDash(r.fecha, r.creadoEn));
  if (count) count.textContent = `${registros.length} registro${registros.length!==1?'s':''}`;
  const badgeAccion = (a) => {
    const color = a==='eliminación' ? '#b71c1c' : (a==='edición' ? '#8a6d00' : '#0a7c6e');
    const fondo = a==='eliminación' ? '#fee2e2' : (a==='edición' ? '#fff3cd' : '#e6f4f2');
    return `<span style="display:inline-block;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700;background:${fondo};color:${color}">${a||'-'}</span>`;
  };
  const detalleDe = (r) => {
    if (r.campo) return `<b>${r.campo}:</b> "${(r.valorAnterior||'').toString().slice(0,40)}" → "${(r.valorNuevo||'').toString().slice(0,40)}"`;
    return r.detalle || '-';
  };
  tbody.innerHTML = registros.length ? registros.map(r => `<tr>
      <td style="font-size:12px;white-space:nowrap">${r.fecha||'-'}</td>
      <td style="font-size:12px;white-space:nowrap">${r.hora||'-'}</td>
      <td style="font-size:12px;font-weight:600">${r.usuarioAdmin||'-'}</td>
      <td style="font-size:12px;text-transform:capitalize">${r.tipo||'-'}</td>
      <td>${badgeAccion(r.accion)}</td>
      <td style="font-size:12px;color:var(--muted)">${detalleDe(r)}</td>
      <td style="font-size:12px;color:var(--muted);font-style:italic">${escHTML(r.motivo||'-')}</td>
    </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state"><div class="icon">🕵️</div>Sin registros de auditoría en el período filtrado</div></td></tr>';
}
function detenerListenerAuditoria(){ if(_unsubAuditoria){_unsubAuditoria();_unsubAuditoria=null;} }

/* [NEW] Liquidación de Efectivo por Asesor — versión Dashboard de la misma pantalla
   que ya existe en la app de ventas (index.html), pero usando los datos que el
   Dashboard ya tiene cargados (_pedidosRaw/_pagosRaw/_gastosRaw), respetando el
   filtro de fecha/asesor activo arriba, en vez de depender de la sesión del día
   de un asesor en particular. Misma fórmula exacta, para que el número coincida
   siempre con lo que ve el asesor en su propia app. */

function _totalVentasRuta(d){
  return (Number(d.ventasContado)||0)+(Number(d.ventasCredito)||0)+(Number(d.ventasTransferencia)||0)+(Number(d.ventasCheque)||0)+(Number(d.ventasOtras)||0);
}
function _totalPagosRuta(d){
  return (Number(d.pagosEfectivo)||0)+(Number(d.pagosTransferencia)||0)+(Number(d.pagosCheque)||0)+(Number(d.pagosOtros)||0);
}
function _totalIngresosRuta(d){
  return _totalVentasRuta(d)+_totalPagosRuta(d);
}
function _valorAEntregarRuta(d){
  /* Misma fórmula del recuadro "TOTAL A ENTREGAR — PASO A PASO" de Liquidación:
     Valor/Liquidación (todas las ventas)
     + Pagos
     − Créditos − Gastos − Transferencias − Cheques
     = Valor total del día */
  const liq=_totalVentasRuta(d);
  const pagos=_totalPagosRuta(d);
  const creditos=Number(d.ventasCredito)||0;
  const gastos=Number(d.gastos)||0;
  const transf=(Number(d.ventasTransferencia)||0)+(Number(d.pagosTransferencia)||0);
  const cheques=(Number(d.ventasCheque)||0)+(Number(d.pagosCheque)||0);
  return liq + pagos - creditos - gastos - transf - cheques;
}
function _calcularLiquidacionDash(){
  const porAsesor = {};
  const getAsesor = nombre => { if(!porAsesor[nombre]) porAsesor[nombre] = {
    ventasContado:0, ventasCredito:0, ventasTransferencia:0, ventasCheque:0, ventasOtras:0,
    pagosEfectivo:0, pagosTransferencia:0, pagosCheque:0, pagosOtros:0,
    gastos:0, productos:{} /* [NEW] desglose por producto vendido, para ver qué vendió cada asesor */
  }; return porAsesor[nombre]; };
  // [FIX] Antes esta función ignoraba por completo el selector "Asesor" del filtro
  // general del Dashboard — siempre calculaba y mostraba TODAS las rutas, aunque
  // el usuario hubiera elegido una en el dropdown. Ahora, si hay un asesor
  // seleccionado, solo se procesan sus pedidos/pagos/gastos.
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const pedidosF = asesorSel ? _pedidosRaw.filter(p => (p.empleado||'') === asesorSel) : _pedidosRaw;
  const pagosF   = asesorSel ? _pagosRaw.filter(p => (p.empleado||'') === asesorSel) : _pagosRaw;
  const gastosF  = asesorSel ? _gastosRaw.filter(g => (g.empleado||'') === asesorSel) : _gastosRaw;
  pedidosF.forEach(p=>{
    const d = getAsesor(p.empleado || 'Sin asignar'); const tot = parseFloat(p.total||0);
    // [FIX] NUEVO FORMATO DE PAGO MÚLTIPLE (index.html) — el asesor ahora puede marcar
    // varias formas de pago a la vez (ej. $20 Contado + $30 Transferencia), y lo que no
    // cubre ninguna forma marcada queda como 'creditoPendiente' automático. Ya NO se
    // registra un "Pago" aparte en la colección 'pagos' para ese saldo (a diferencia del
    // abono viejo) — todo el desglose vive dentro del propio pedido, en el array
    // 'pagos' + 'creditoPendiente'. formapago pasa a valer 'Mixto' en estos casos, así
    // que la comparación exacta de abajo (Contado/Crédito/Transferencia/Cheque) dejaría
    // TODO el total de un pedido Mixto sin clasificar si no se maneja aparte primero.
    if (p.pagos !== null && p.pagos !== undefined) {
      (p.pagos || []).forEach(pg => {
        const monto = parseFloat(pg.monto || 0);
        if (pg.forma === 'Contado') d.ventasContado += monto;
        else if (pg.forma === 'Transferencia') d.ventasTransferencia += monto;
        else if (pg.forma === 'Cheque') d.ventasCheque += monto;
        else d.ventasOtras += monto;
      });
      d.ventasCredito += parseFloat(p.creditoPendiente || 0);
    } else {
    // --- Compatibilidad con pedidos creados ANTES del pago múltiple (campo 'abono') ---
    const abono = parseFloat(p.abono||0); // [FIX] venta con abono parcial (Contado o Crédito)
    if(abono>0 && abono<tot){
      // [FIX] El abono ya se registra por separado como un "Pago" en efectivo
      // (ver confirmarEnvio en index.html), así que aquí solo se cuenta el
      // SALDO PENDIENTE como crédito — sumar también el total completo aquí
      // duplicaba el abono (efectivo real entregado) y siempre sobrestimaba
      // lo que el asesor debía entregar. Con esto la Liquidación del
      // Dashboard vuelve a coincidir con la de Detalle de Pedidos.
      d.ventasCredito+=(tot-abono);
    } else if(abono>=tot && tot>0){
      // El abono cubrió el 100% de la venta al momento de hacerla — no se
      // generó un Pago aparte, así que ese efectivo se cuenta aquí
      // directamente, sin importar la forma de pago elegida.
      d.ventasContado+=tot;
    }
    else if(p.formapago==='Contado') d.ventasContado+=tot;
    else if(p.formapago==='Crédito') d.ventasCredito+=tot;
    else if(p.formapago==='Transferencia') d.ventasTransferencia+=tot;
    else if(p.formapago==='Cheque') d.ventasCheque+=tot;
    else d.ventasOtras+=tot;
    }
    // [FIX] Acumular por producto vendido, y también las regalías entregadas
    // (a $0, ya que no representan ingreso, pero sí deben verse reflejadas
    // como unidades entregadas en el desglose de la Liquidación)
    (p.productos||[]).forEach(prod=>{
      const nom = prod.nombre || 'Sin nombre';
      if(!d.productos[nom]) d.productos[nom] = { cantidad:0, dolares:0 };
      d.productos[nom].cantidad += parseFloat(prod.cantidad||0);
      d.productos[nom].dolares  += parseFloat(prod.subtotal||0);
      (prod.regalias||[]).forEach(reg=>{
        const nomReg = '🎁 REGALO: ' + (reg.nombre || 'Sin nombre');
        if(!d.productos[nomReg]) d.productos[nomReg] = { cantidad:0, dolares:0 };
        d.productos[nomReg].cantidad += parseFloat(reg.cantidad||0);
        // dolares se mantiene en 0 para regalías, no afecta el total en $
      });
    });
  });
  pagosF.forEach(p=>{
    const d = getAsesor(p.empleado || 'Sin asignar');
    if(p.forma==='Efectivo') d.pagosEfectivo+=(parseFloat(p.monto)||0);
    else if(p.forma==='Transferencia') d.pagosTransferencia+=(parseFloat(p.monto)||0);
    else if(p.forma==='Cheque') d.pagosCheque+=(parseFloat(p.monto)||0);
    else d.pagosOtros+=(parseFloat(p.monto)||0);
  });
  gastosF.forEach(g=>{ getAsesor(g.empleado || 'Sin asignar').gastos += (parseFloat(g.monto)||0); });
  return porAsesor;
}
async function _leerAjusteSaldosAsesor(nombre){
  try{
    if(typeof db==='undefined') return 0;
    const snap=await db.collection('cierresLiquidacion').doc(_idEntregaLiquidacion(nombre)).get();
    return snap.exists ? (Number(snap.data().ajusteSaldos)||0) : 0;
  }catch(e){ return 0; }
}
async function _guardarAjusteSaldosAsesor(nombre, valor){
  if(typeof db==='undefined') return;
  await db.collection('cierresLiquidacion').doc(_idEntregaLiquidacion(nombre)).set({
    asesor:nombre,
    ajusteSaldos:Number(valor)||0,
    actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
    actualizadoPor: (typeof actorAuditoria==='function')?actorAuditoria():'sistema'
  }, {merge:true});
}
function _onAjusteSaldosInput(el){
  const card=el.closest('.liq-card-asesor');
  if(!card) return;
  const ajuste=parseFloat(String(el.value||'0').replace(',','.'))||0;
  const base=parseFloat(card.dataset.contadoBase||0)||0;
  const pagos=parseFloat(card.dataset.pagos||0)||0;
  const gastos=parseFloat(card.dataset.gastos||0)||0;
  const credito=parseFloat(card.dataset.credito||0)||0;
  const transf=parseFloat(card.dataset.transf||0)||0;
  const cheques=parseFloat(card.dataset.cheques||0)||0;
  const otras=parseFloat(card.dataset.otras||0)||0;
  const pagosTot=parseFloat(card.dataset.pagosTot||0)||0;
  const contado=base+ajuste;
  const d={ventasContado:contado, pagosEfectivo:pagos, gastos, ventasCredito:credito, ventasTransferencia:0, pagosTransferencia:0, ventasCheque:0, pagosCheque:0, ventasOtras:otras, pagosOtros:0};
  // transferencias/cheques ya vienen sumados en data-transf / data-cheques
  const totalRuta=contado+credito+transf+cheques+otras;
  const totalIngresos=totalRuta+pagosTot;
  const totalEntregar=(typeof _valorAEntregarRuta==='function')
    ? (contado + pagos + otras - gastos)
    : (contado+pagos-gastos);
  const verde=card.querySelector('.liq-total-verde');
  if(verde){ verde.textContent='$'+totalEntregar.toFixed(2); verde.style.color=totalEntregar>=0?'#0f7c38':'#a93226'; }
  const contadoEl=card.querySelector('.liq-val-contado');
  if(contadoEl) contadoEl.textContent='$'+contado.toFixed(2);
  const setTxt=(sel,txt)=>{ const n=card.querySelector(sel); if(n) n.textContent=txt; };
  setTxt('.liq-paso-ruta','$'+totalRuta.toFixed(2));
  setTxt('.liq-paso-ingresos','$'+totalIngresos.toFixed(2));
  setTxt('.liq-paso-entregar','$'+totalEntregar.toFixed(2));
  const ref=card.querySelector('.liq-ref-total');
  if(ref) ref.textContent='$'+totalEntregar.toFixed(2);
  const box=card.querySelector('.liq-entrega-asesor');
  if(box) box.dataset.total=String(totalEntregar);
}
function _guardarAjusteSaldosDesdeInput(el){
  const card=el.closest('.liq-card-asesor');
  if(!card) return;
  const inp=card.querySelector('.liq-ajuste-saldos');
  const nombre=card.dataset.asesor||'';
  const valor=parseFloat(String((inp&&inp.value)||'0').replace(',','.'))||0;
  if(!confirm('¿Está seguro de guardar el ajuste de saldos de '+nombre+'?')) return;
  _guardarAjusteSaldosAsesor(nombre, valor).then(()=>{
    alert('Ajuste de saldos guardado.');
    if(typeof renderCierreDelDia==='function') renderCierreDelDia();
  }).catch(err=>{
    console.warn('ajusteSaldos', err);
    alert('No se pudo guardar el ajuste de saldos.');
  });
}
async function renderLiquidacionDash(){
  const cont = document.getElementById('liquidacionDashLista');
  const emptyMsg = document.getElementById('liquidacionDashEmptyMsg');
  if(!cont) return;
  const porAsesor = _calcularLiquidacionDash();
  const asesores = Object.keys(porAsesor).sort((a,b)=>a.localeCompare(b,'es'));
  if(!asesores.length){
    cont.innerHTML='';
    if(emptyMsg) emptyMsg.style.display='block';
    document.getElementById('liquidacionDashTotalValor').textContent='$0.00';
    const ref0=document.getElementById('liqEntregaTotalRef');
    if(ref0) ref0.textContent='$0.00';
    _liqTotalEntregarCache=0;
    const boxGlobal0=document.getElementById('liqEntregaBox');
    if(boxGlobal0) boxGlobal0.style.display='none';
    return;
  }
  if(emptyMsg) emptyMsg.style.display='none';
  const ajustes={};
  await Promise.all(asesores.map(async n=>{ ajustes[n]=await _leerAjusteSaldosAsesor(n); }));
  let totalGeneral = 0;
  cont.innerHTML = asesores.map(nombre=>{
    const d0 = porAsesor[nombre];
    const ajuste = Number(ajustes[nombre])||0;
    const d = Object.assign({}, d0, { ventasContado: (Number(d0.ventasContado)||0) + ajuste });
    const totalEntregar = _valorAEntregarRuta(d);
    totalGeneral += totalEntregar;
    const totalRuta = d.ventasContado+d.ventasCredito+d.ventasTransferencia+d.ventasCheque+d.ventasOtras;
    const totalPagosAsesor = d.pagosEfectivo+d.pagosTransferencia+d.pagosCheque+d.pagosOtros;
    const totalIngresos = totalRuta+totalPagosAsesor;
    const creditos = d.ventasCredito;
    const transferencias = d.ventasTransferencia+d.pagosTransferencia;
    const cheques = d.ventasCheque+d.pagosCheque;
    const sinClasificar = d.ventasOtras+d.pagosOtros;
    // [NEW] Desglose por producto vendido por este asesor, ordenado de mayor a menor venta
    const prodsOrdenados = Object.entries(d.productos).sort(([,a],[,b]) => b.dolares - a.dolares);
    const totalCantidadProd = prodsOrdenados.reduce((s,[,p]) => s + p.cantidad, 0);
    const totalDolaresProd  = prodsOrdenados.reduce((s,[,p]) => s + p.dolares, 0);
    const filasProductosLiq = prodsOrdenados.map(([nom,p]) => `
      <tr>
        <td>${escHTML(nom)}</td>
        <td>${p.cantidad % 1 === 0 ? parseInt(p.cantidad) : p.cantidad.toFixed(1)}</td>
        <td>$${p.dolares.toFixed(2)}</td>
      </tr>`).join('');
    const safeNom=escHTML(nombre).replace(/"/g,'&quot;');
    const ajusteVal=ajuste?ajuste.toFixed(2):'';
    return `<div class="table-card liq-card-asesor" data-asesor="${safeNom}" data-contado-base="${Number(d0.ventasContado)||0}" data-pagos="${Number(d0.pagosEfectivo)||0}" data-gastos="${Number(d0.gastos)||0}" data-credito="${Number(d0.ventasCredito)||0}" data-transf="${(Number(d0.ventasTransferencia)||0)+(Number(d0.pagosTransferencia)||0)}" data-cheques="${(Number(d0.ventasCheque)||0)+(Number(d0.pagosCheque)||0)}" data-otras="${Number(d0.ventasOtras)||0}" data-pagos-tot="${totalPagosAsesor}" style="margin-bottom:12px">
      <div style="padding:12px 16px;display:flex;align-items:flex-start;justify-content:space-between;background:var(--surface2);gap:12px">
        <div>
          <div style="font-weight:800;color:var(--navy)">${escHTML(nombre)}</div>
          <div style="font-size:10px;font-weight:800;letter-spacing:0.06em;color:var(--muted);margin-top:6px">AJUSTE DE SALDOS</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <span class="liq-total-verde" style="font-weight:800;font-size:16px;color:${totalEntregar>=0?'#0f7c38':'#a93226'}">$${totalEntregar.toFixed(2)}</span>
          <input type="text" class="liq-ajuste-saldos" inputmode="decimal" placeholder="0.00" value="${ajusteVal}" disabled
            style="width:88px;height:34px;border:1.5px solid var(--border);border-radius:8px;padding:0 8px;text-align:right;font-weight:700;background:#fff"
            oninput="_filtrarInputMontoLiq(this);_onAjusteSaldosInput(this)">
          <button type="button" class="liq-btn-guardar-ajuste" onclick="_guardarAjusteSaldosDesdeInput(this)"
            style="display:none;padding:6px 12px;border:none;border-radius:8px;background:#0f7c38;color:#fff;font-weight:700;cursor:pointer;font-size:12px">Guardar</button>
        </div>
      </div>
      <div style="padding:10px 16px;font-size:13px">
        <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Ventas al contado</span><b class="liq-val-contado">$${d.ventasContado.toFixed(2)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Pagos cobrados en efectivo</span><b>$${d.pagosEfectivo.toFixed(2)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Gastos de la ruta</span><b>-$${d.gastos.toFixed(2)}</b></div>
      </div>
      <div style="margin:0 16px 14px;padding:10px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;font-size:12.5px">
        <div style="font-weight:800;color:#0f7c38;margin-bottom:6px;text-transform:uppercase;font-size:10px;letter-spacing:0.05em">Total a entregar — paso a paso</div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>${escHTML(nombre)}</span><span class="liq-paso-ruta">$${totalRuta.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>+ Pagos</span><span>$${totalPagosAsesor.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;font-weight:700"><span>= Total de Ingresos</span><span class="liq-paso-ingresos">$${totalIngresos.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Créditos</span><span>$${creditos.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Gastos</span><span>$${d.gastos.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Transferencias</span><span>$${transferencias.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Cheques</span><span>$${cheques.toFixed(2)}</span></div>
        ${sinClasificar>0?`<div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Sin clasificar</span><span>$${sinClasificar.toFixed(2)}</span></div>`:''}
        <div style="display:flex;justify-content:space-between;padding-top:6px;margin-top:4px;border-top:1px solid var(--border);font-weight:800"><span>Total a Entregar</span><span class="liq-paso-entregar" style="color:${totalEntregar>=0?'#0f7c38':'#a93226'}">$${totalEntregar.toFixed(2)}</span></div>
      </div>
      ${_htmlEntregaAsesorBox(nombre, totalEntregar)}
      ${prodsOrdenados.length ? `
      <div style="margin:0 16px 14px">
        <div class="cierre-section-label" style="margin-bottom:6px">📦 Productos vendidos por ${escHTML(nombre)}</div>
        <table class="cierre-prod-table">
          <thead><tr><th>Producto</th><th>Cantidad</th><th>Total ($)</th></tr></thead>
          <tbody>
            ${filasProductosLiq}
            <tr class="cierre-prod-subtotal">
              <td style="font-weight:800">SUBTOTAL PRODUCTOS</td>
              <td style="font-weight:800;text-align:right;color:var(--blue)">${totalCantidadProd % 1 === 0 ? parseInt(totalCantidadProd) : totalCantidadProd.toFixed(1)}</td>
              <td style="font-weight:800;text-align:right;color:var(--teal)">$${totalDolaresProd.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>` : ''}
    </div>`;
  }).join('');
  document.getElementById('liquidacionDashTotalValor').textContent = '$'+totalGeneral.toFixed(2);
  const ref=document.getElementById('liqEntregaTotalRef');
  if(ref) ref.textContent='$'+totalGeneral.toFixed(2);
  _liqTotalEntregarCache=totalGeneral;
  const boxGlobal=document.getElementById('liqEntregaBox');
  if(boxGlobal) boxGlobal.style.display='none';
  await Promise.all(asesores.map(nombre=>_cargarEntregaAsesor(nombre)));
}
/* [NEW] Cierre del Día — vista consolidada en formato matriz (una columna por
   asesor + columna Total), igual a la hoja de papel "Cierre del Día" que se
   usaba antes. Tabla 1 arranca con los mismos números que _calcularLiquidacionDash()
   (mismos que la pestaña Liquidación), pero es EDITABLE a mano: el admin/secretaria
   puede ajustar cualquier celda antes de guardar el cierre oficial del día.
   Tabla 2 arranca con lo que cada asesor registró en "Forma de entrega"
   (colección cierresLiquidacion), también editable. Todo se guarda junto en
   la colección 'cierresDelDia', un documento por período de fecha filtrado. */
let _cierreDelDiaAsesoresCache = [];
function _idCierreDelDia(){
  const desde=document.getElementById('filtroFecha')?.value||fechaHoy();
  const hasta=document.getElementById('filtroFechaHasta')?.value||desde;
  return desde+'_'+hasta;
}
function _htmlTablaCierreDelDia(tablaNum, asesoresId, nombresDisplay, datos, filas, guardado){
  // Layout: 1 sola columna de nombres (filas = asesores). Las métricas van en columnas.
  // Guardado/lectura siguen siendo guardado[etiqueta][asesorId] — no cambia el dato.
  const thead = '<tr><th>Asesor</th>' + filas.map(f=>`<th${f.destacado?' class="cierre-matriz-destacado-col"':''}>${escHTML(f.etiqueta)}</th>`).join('') + '</tr>';
  const colTotales = filas.map(()=>0);
  const tbody = asesoresId.map((id, rowIdx)=>{
    const celdas = filas.map((f, fi)=>{
      const guardadoVal = guardado?.[f.etiqueta]?.[id];
      const v = (guardadoVal !== undefined && guardadoVal !== null && guardadoVal !== '') ? (Number(guardadoVal)||0) : (f.valor(datos[rowIdx]) || 0);
      colTotales[fi] += v;
      return `<td class="${f.destacado?'cierre-matriz-destacado':''}"><input type="text" class="cdd-input" inputmode="decimal" data-etiqueta="${escHTML(f.etiqueta)}" data-asesor="${escHTML(id)}" value="${v.toFixed(2)}" disabled oninput="_filtrarInputMontoLiq(this);_recalcularFilaCierreDelDia(this)"></td>`;
    }).join('');
    return `<tr><td class="cdd-nombre">${escHTML(nombresDisplay[rowIdx]||id)}</td>${celdas}</tr>`;
  }).join('');
  const tfoot = '<tr class="cierre-matriz-total-row"><td>TOTAL</td>' + colTotales.map((t,i)=>`<td class="${filas[i].destacado?'cierre-matriz-destacado':''}">$${t.toFixed(2)}</td>`).join('') + '</tr>';
  return `<table class="cierre-matriz-table cierre-matriz-asesores-col" id="cierreDelDiaTabla${tablaNum}"><thead>${thead}</thead><tbody>${tbody}</tbody><tfoot>${tfoot}</tfoot></table>`;
}
function _recalcularFilaCierreDelDia(input){
  const tabla = input.closest('table');
  if(!tabla) return;
  const ths = tabla.querySelectorAll('thead th');
  const colCount = ths.length;
  const sums = Array(colCount).fill(0);
  tabla.querySelectorAll('tbody tr').forEach(tr=>{
    const tds = tr.querySelectorAll('td');
    tds.forEach((td, i)=>{
      if(i===0) return;
      const inp = td.querySelector('.cdd-input');
      const v = inp ? (_parseMontoLiq(inp.value).ok ? _parseMontoLiq(inp.value).valor : 0) : 0;
      sums[i] += v;
    });
  });
  const footTds = tabla.querySelectorAll('tfoot tr td');
  footTds.forEach((td, i)=>{
    if(i===0) return;
    td.textContent = '$'+sums[i].toFixed(2);
  });
}
function _cierreDelDiaEsSoloHoy(){
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const desde=document.getElementById('filtroFecha')?.value||hoy;
  const hasta=document.getElementById('filtroFechaHasta')?.value||desde;
  return !!hoy && desde===hoy && hasta===hoy;
}
function _cierreDelDiaPuedeEditar(){
  if(ROL_ACTUAL!=='admin' && ROL_ACTUAL!=='secretaria') return false;
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const desde=document.getElementById('filtroFecha')?.value||hoy;
  const hasta=document.getElementById('filtroFechaHasta')?.value||desde;
  if(!hoy) return false;
  if(desde && desde>hoy) return false;
  if(hasta && hasta>hoy) return false;
  return true;
}
function _actualizarBotonesCierreDelDia(editando){
  const puede=_cierreDelDiaPuedeEditar();
  const btnEd=document.getElementById('cddBtnEditar');
  const btnGu=document.getElementById('cddBtnGuardar');
  if(btnEd){
    btnEd.style.display=(puede && !editando)?'inline-flex':'none';
    btnEd.disabled=!puede;
  }
  if(btnGu){
    btnGu.style.display=(puede && editando)?'inline-flex':'none';
    btnGu.disabled=!puede || !editando;
  }
}
function _setCierreDelDiaEditable(on){
  const puede=_cierreDelDiaPuedeEditar();
  const activo=!!on && puede;
  document.querySelectorAll('#cierreDelDiaTabla1 .cdd-input, #cierreDelDiaTabla2 .cdd-input').forEach(el => {
    el.disabled = !activo;
  });
  _actualizarBotonesCierreDelDia(activo);
}
function habilitarEdicionCierreDelDia(){
  if(!_cierreDelDiaPuedeEditar()){
    alert('No se puede editar el Cierre del Día en fechas futuras. Usa el filtro Desde / Hasta.');
    return;
  }
  _setCierreDelDiaEditable(true);
  const st=document.getElementById('cierreDelDiaStatus');
  if(st) st.textContent='Modo edición — puedes ajustar los montos del rango Desde / Hasta. Luego pulsa Guardar.';
}
function _confirmarGuardarCierreDelDia(){
  if(!_cierreDelDiaPuedeEditar()){
    alert('No se puede guardar el Cierre del Día en fechas futuras. Usa el filtro Desde / Hasta.');
    return;
  }
  if(!confirm('¿Está seguro que desea guardar el Cierre del Día de este rango de fechas?')) return;
  _guardarCierreDelDia();
}
async function _guardarCierreDelDia(){
  if(!_cierreDelDiaPuedeEditar()){
    alert('No se puede guardar el Cierre del Día en fechas futuras. Usa el filtro Desde / Hasta.');
    return;
  }
  if(typeof db==='undefined') return;
  const leerTabla=(num)=>{
    const tabla={};
    document.querySelectorAll(`#cierreDelDiaTabla${num} .cdd-input`).forEach(el=>{
      const etiqueta=el.dataset.etiqueta, asesor=el.dataset.asesor;
      const p=_parseMontoLiq(el.value);
      if(!tabla[etiqueta]) tabla[etiqueta]={};
      tabla[etiqueta][asesor]=p.ok?p.valor:0;
    });
    return tabla;
  };
  const tabla1=leerTabla(1), tabla2=leerTabla(2);
  const st=document.getElementById('cierreDelDiaStatus');
  try{
    await db.collection('cierresDelDia').doc(_idCierreDelDia()).set({
      tabla1, tabla2, asesores:_cierreDelDiaAsesoresCache,
      desde:document.getElementById('filtroFecha')?.value||'',
      hasta:document.getElementById('filtroFechaHasta')?.value||'',
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: (typeof actorAuditoria==='function') ? actorAuditoria() : ''
    }, {merge:true});
    const asesoresSync=_cierreDelDiaAsesoresCache||[];
    await Promise.all(asesoresSync.map(async nombre=>{
      const get=etiq=>Number(tabla2[etiq]&&tabla2[etiq][nombre])||0;
      const ef=get('Efectivo'), dep=get('Depósito'), tr=get('Transferencia');
      const f1=get('Faltante 1'), f2=get('Faltante 2'), f3=get('Faltante 3');
      const sob=Math.abs(get('Sobrante'));
      await db.collection('cierresLiquidacion').doc(_idEntregaLiquidacion(nombre)).set({
        efectivo:{marcado:ef>0, monto:ef},
        deposito:{marcado:dep>0, monto:dep},
        depositos:dep>0?[{marcado:true,monto:dep}]:[],
        transferencia:{marcado:tr>0, monto:tr},
        faltantes:[{monto:f1,motivo:''},{monto:f2,motivo:''},{monto:f3,motivo:''}],
        sobrante:{monto:sob, motivo:''},
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
        actualizadoPor: (typeof actorAuditoria==='function') ? actorAuditoria() : ''
      }, {merge:true});
    }));
    if (typeof _registrarAuditoria === 'function') {
      _registrarAuditoria('cierreDelDia', 'edición', _idCierreDelDia(), 'Cierre del Día guardado por '+actorAuditoria());
    }
    if(st) st.textContent='Guardado correctamente — última actualización por '+(typeof actorAuditoria==='function'?actorAuditoria():'');
    _setCierreDelDiaEditable(false);
    if(typeof renderLiquidacionDash==='function') renderLiquidacionDash();
    if(typeof renderMovimientosBancarios==='function') renderMovimientosBancarios();
  }catch(err){
    console.warn('cierresDelDia escritura:', err);
    if(st) st.textContent='No se pudo guardar el Cierre del Día.';
    alert('No se pudo guardar el Cierre del Día. Intenta de nuevo.');
  }
}
function _firmaUsuarioActualCierreDia(){
  const rolLabel = ROL_ACTUAL === 'admin' ? 'Administrador' : 'Secretaria';
  const nombre = (ADMIN_ACTUAL && (ADMIN_ACTUAL.nombre || ADMIN_ACTUAL.usuario)) || '';
  return rolLabel + (nombre ? ': ' + nombre : '');
}
async function imprimirCierreDelDia(){
  const yaHay=!!document.querySelector('#cierreDelDiaTabla1 tbody tr, #cierreDelDiaTabla1Wrap table tbody tr');
  if(!yaHay && typeof renderCierreDelDia==='function') await renderCierreDelDia();
  const asesores=_cierreDelDiaAsesoresCache||[];
  if(!asesores.length){ alert('No hay datos para imprimir en este período.'); return; }
  const fecha = _textoRangoFecha();
  const filaAHtml = tr => {
    const celdas=[...tr.querySelectorAll('td')].map((td,i)=>{
      if(i===0) return `<td style="text-align:center;font-weight:800">${escHTML(td.textContent)}</td>`;
      const inp=td.querySelector('input');
      const val = inp ? (parseFloat(inp.value)||0) : (parseFloat((td.textContent||'').replace('$',''))||0);
      return `<td style="text-align:center">$${val.toFixed(2)}</td>`;
    }).join('');
    return `<tr>${celdas}</tr>`;
  };
  const armarTabla = (tablaId, titulo) => {
    const tabla=document.getElementById(tablaId);
    if(!tabla) return '';
    const thead=tabla.querySelector('thead').innerHTML;
    const filas=[...tabla.querySelectorAll('tbody tr')].map(filaAHtml).join('');
    const pie=[...tabla.querySelectorAll('tfoot tr')].map(filaAHtml).join('');
    return `<div class="cdd-print-title">${titulo}</div><table class="cdd-print-table"><thead>${thead}</thead><tbody>${filas}${pie}</tbody></table>`;
  };
  const bloque1 = armarTabla('cierreDelDiaTabla1', 'CIERRE DEL DÍA');
  const bloque2 = armarTabla('cierreDelDiaTabla2', 'FORMA DE ENTREGA DE DINERO');
  const v = window.open('', '_blank', 'width=900,height=900');
  const logoUrl = location.origin + '/logo-luanaqua.png';
  v.document.write(`<html><head><title>Cierre del Día</title><style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#1a3a5c;}
    .print-header p{font-size:11px;color:#888;margin-top:3px;}
    .cdd-print-title{font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#1a3a5c;margin:18px 0 8px;}
    .cdd-print-table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px;}
    .cdd-print-table th{text-align:center;font-size:9px;font-weight:800;letter-spacing:0.04em;color:#888;padding:5px 6px;border-bottom:1px solid #d2dae2;}
    .cdd-print-table td{padding:5px 6px;border-bottom:1px solid #e6ebf0;text-align:center;}
    .cdd-print-table td:first-child{font-weight:800;}
    .cdd-print-table tr:last-child td{border-bottom:none;}
    .firmas-box{display:flex;justify-content:center;margin-top:48px;}
    .firma-linea{width:280px;text-align:center;font-size:12px;color:#1a3a5c;font-weight:700;}
    .firma-linea .raya{border-top:1px solid #1a3a5c;margin-bottom:6px;}
    @media print{body{padding:12px;}}
  </style></head><body>
  <div class="print-header">
    <img src="${logoUrl}" alt="Aqua Luan" onerror="this.style.display='none'">
    <div>
      <h1>CIERRE DEL DÍA</h1>
      <p>Fecha: ${fecha} · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
    </div>
  </div>
  ${bloque1}
  ${bloque2}
  <div class="firmas-box" style="display:flex;justify-content:space-between;gap:30px;width:100%">
    <div class="firma-linea" style="flex:1"><div class="raya">&nbsp;</div>Firma Liquidadora</div>
    <div class="firma-linea" style="flex:1"><div class="raya">&nbsp;</div>Firma Asesor</div>
    <div class="firma-linea" style="flex:1"><div class="raya">&nbsp;</div>Firma Ayudante</div>
  </div>
  <script>
    var _impresoCierreDia=false;
    function _intentarImprimirCierreDia(){ if(_impresoCierreDia)return; _impresoCierreDia=true; window.print(); }
    window.onload=_intentarImprimirCierreDia;
    setTimeout(_intentarImprimirCierreDia,180);
  <\/script>
  </body></html>`);
  v.document.close();
  _dispararImpresion(v);
}
async function renderCierreDelDia(){
  const cont1 = document.getElementById('cierreDelDiaTabla1Wrap');
  const cont2 = document.getElementById('cierreDelDiaTabla2Wrap');
  const emptyMsg = document.getElementById('cierreDelDiaEmptyMsg');
  const st = document.getElementById('cierreDelDiaStatus');
  if(!cont1 || !cont2) return;
  // Lista MAESTRA de todos los asesores activos (_asesoresCache, la misma que llena el
  // dropdown "ASESOR" de arriba) — así siempre aparecen todas las rutas como columna,
  // aunque alguna no haya tenido movimiento ese día (se muestra en $0.00).
  const porAsesor = _calcularLiquidacionDash();
  // [FIX] Lista maestra de todos los asesores activos (_asesoresCache, la misma que
  // llena el dropdown "ASESOR" de arriba), FUSIONADA con cualquier asesor que sí tenga
  // actividad registrada ese período (porAsesor). Esto es una red de seguridad: si el
  // perfil de un asesor en Firestore tiene el campo 'esAdmin' mal configurado o
  // ausente, la consulta .where('esAdmin','==',false) lo excluye silenciosamente de
  // _asesoresCache — pero si igual tiene pedidos/pagos/gastos ese día, con esta fusión
  // de todas formas aparece en la tabla, en vez de desaparecer sin explicación.
  const rutasSet = new Set([
    ...(Array.isArray(_asesoresCache) ? _asesoresCache : []),
    ...Object.keys(porAsesor)
  ]);
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  let rutasFull = [...rutasSet].sort((a,b)=>a.localeCompare(b,'es'));
  if(asesorSel){
    const selNom=(asesorSel.split(':')[1]||asesorSel).trim().toLowerCase();
    rutasFull = rutasFull.filter(r => r===asesorSel || (r.split(':')[1]||r).trim().toLowerCase()===selNom);
  }
  if(!rutasFull.length){
    cont1.innerHTML=''; cont2.innerHTML='';
    if(emptyMsg) emptyMsg.style.display='block';
    if(st) st.textContent='';
    _cierreDelDiaAsesoresCache=[];
    return;
  }
  if(emptyMsg) emptyMsg.style.display='none';
  _cierreDelDiaAsesoresCache = rutasFull;
  const nombresDisplay = rutasFull.map(r => r.split(':')[1]?.trim() || r); // "RUTA 1: JEFFERSON" -> "JEFFERSON"

  // Objeto "vacío" para cualquier asesor sin ventas/pagos/gastos ese período —
  // así no rompe los cálculos, simplemente da $0.00 en todo.
  const _asesorVacio = { ventasContado:0, ventasCredito:0, ventasTransferencia:0, ventasCheque:0, ventasOtras:0, pagosEfectivo:0, pagosTransferencia:0, pagosCheque:0, pagosOtros:0, gastos:0, productos:{} };

  // Tabla 1 — Cierre del Día (mismos campos que ya calcula la Liquidación,
  // incluyendo el ajuste de saldos de cada ruta).
  const ajustes={};
  await Promise.all(rutasFull.map(async n=>{
    const card=[...document.querySelectorAll('.liq-card-asesor')].find(c=>(c.dataset.asesor||'')===n);
    if(card){
      const inp=card.querySelector('.liq-ajuste-saldos');
      ajustes[n]=parseFloat(String((inp&&inp.value)||'0').replace(',','.'))||0;
    }else{
      ajustes[n]=await _leerAjusteSaldosAsesor(n);
    }
  }));
  const datosAsesores = rutasFull.map(r => {
    const d0 = porAsesor[r] || _asesorVacio;
    const ajuste = Number(ajustes[r])||0;
    return Object.assign({}, d0, { ventasContado: (Number(d0.ventasContado)||0) + ajuste });
  });
  const filas1 = [
    { etiqueta:'Valor/Liquidación', valor: n => _totalVentasRuta(n) },
    { etiqueta:'Pagos', valor: n => _totalPagosRuta(n) },
    { etiqueta:'Créditos', valor: n => n.ventasCredito },
    { etiqueta:'Gastos', valor: n => n.gastos },
    { etiqueta:'Transferencias', valor: n => n.ventasTransferencia + n.pagosTransferencia },
    { etiqueta:'Cheques', valor: n => n.ventasCheque + n.pagosCheque },
    { etiqueta:'Valor total del día', valor: n => _valorAEntregarRuta(n), destacado:true }
  ];

  // Tabla 2 — Forma de Entrega de Dinero (lee lo guardado por cada asesor en Liquidación)
  const entregas = await Promise.all(rutasFull.map(async nombre=>{
    try{
      return await _cargarEntregaCierreAsesor(nombre);
    }catch(err){ console.warn('cierreDelDia lectura entrega:', err); return {}; }
  }));
  const _montoEfectivo = e => (e.efectivo?.marcado ? (Number(e.efectivo.monto)||0) : 0);
  const _montoDeposito = e => {
    if(Array.isArray(e.depositos) && e.depositos.length){
      return e.depositos.reduce((s,d)=>s+((d.marcado)?(Number(d.monto)||0):0),0);
    }
    return (e.deposito?.marcado ? (Number(e.deposito.monto)||0) : 0);
  };
  const _montoTransferencia = e => (e.transferencia?.marcado ? (Number(e.transferencia.monto)||0) : 0);
  const _montoFaltante1 = e => Number(e.faltantes?.[0]?.monto)||0;
  const _montoFaltante2 = e => Number(e.faltantes?.[1]?.monto)||0;
  const _montoFaltante3 = e => Number(e.faltantes?.[2]?.monto)||0;
  const _montoSobrante = e => Number(e.sobrante?.monto)||0;
  const filas2 = [
    { etiqueta:'Efectivo', valor: _montoEfectivo },
    { etiqueta:'Depósito', valor: _montoDeposito },
    { etiqueta:'Transferencia', valor: _montoTransferencia },
    { etiqueta:'Faltante 1', valor: _montoFaltante1 },
    { etiqueta:'Faltante 2', valor: _montoFaltante2 },
    { etiqueta:'Faltante 3', valor: _montoFaltante3 },
    { etiqueta:'Sobrante', valor: e => -_montoSobrante(e) },
    { etiqueta:'TOTAL GENERAL', destacado:true, valor: e =>
        _montoEfectivo(e) + _montoDeposito(e) + _montoTransferencia(e) +
        _montoFaltante1(e) + _montoFaltante2(e) + _montoFaltante3(e) - _montoSobrante(e)
    }
  ];

  // Si ya se guardó un Cierre del Día para este período, esos valores mandan sobre
  // los calculados (así se respeta cualquier ajuste manual que se haya hecho antes).
  let guardado = {};
  try{
    if(typeof db!=='undefined'){
      const snap = await db.collection('cierresDelDia').doc(_idCierreDelDia()).get();
      if(snap.exists) guardado = snap.data() || {};
    }
  }catch(err){ console.warn('cierresDelDia lectura:', err); }

  const tabla2Liq={};
  filas2.forEach(f=>{
    tabla2Liq[f.etiqueta]={};
    rutasFull.forEach((id,i)=>{
      const e=entregas[i]||{};
      tabla2Liq[f.etiqueta][id]= f.valor(e);
    });
  });
  const t2Final=(guardado.tabla2 && Object.keys(guardado.tabla2).length)?guardado.tabla2:tabla2Liq;
  cont1.innerHTML = _htmlTablaCierreDelDia(1, rutasFull, nombresDisplay, datosAsesores, filas1, guardado.tabla1||{});
  cont2.innerHTML = _htmlTablaCierreDelDia(2, rutasFull, nombresDisplay, entregas, filas2, t2Final);
  if(st) st.textContent = guardado && guardado.actualizadoPor ? ('Última vez guardado por '+guardado.actualizadoPor) : 'Aún no se ha guardado este Cierre del Día — mostrando valores calculados automáticamente.';
  _setCierreDelDiaEditable(false);
}
/* [NEW] Notas Adicionales — sección independiente en el menú lateral. Muestra
   los pedidos del período filtrado (fecha del Dashboard) que traen alguna
   nota registrada (ej. regalías pendientes de entregas anteriores,
   condiciones especiales, etc.), para que no se pierdan dentro del detalle
   de cada pedido. */
function renderNotasAdicionalesDash(){
  const tbody = document.getElementById('notasAdicionalesTbody');
  const tabla = document.getElementById('notasAdicionalesTabla');
  const emptyMsg = document.getElementById('notasAdicionalesEmptyMsg');
  if(!tbody) return;
  // [FIX] Antes esta sección ignoraba el selector "Asesor" del filtro general del
  // Dashboard — siempre mostraba las notas de TODAS las rutas, aunque el usuario
  // hubiera elegido una en el dropdown. La fecha sí se respetaba (_pedidosRaw ya
  // viene filtrado por fecha desde la consulta a Firestore), pero el asesor no.
  // Mismo patrón que _calcularLiquidacionDash().
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const pedidosConNota = _pedidosRaw
    .filter(p => (p.notas||'').trim() !== '')
    .filter(p => !asesorSel || (p.empleado||'') === asesorSel)
    .sort((a,b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
  if(!pedidosConNota.length){
    tbody.innerHTML = '';
    if(tabla) tabla.style.display = 'none';
    if(emptyMsg) emptyMsg.style.display = 'block';
    return;
  }
  if(tabla) tabla.style.display = '';
  if(emptyMsg) emptyMsg.style.display = 'none';
  const puede=(p)=>{
    if(ROL_ACTUAL!=='admin' && ROL_ACTUAL!=='secretaria') return false;
    const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
    const f=p.fecha||'';
    return !hoy || !f || f<=hoy;
  };
  tbody.innerHTML = pedidosConNota.map(p => {
    const id=escHTML(p._id||'').replace(/'/g,"\\'");
    const acc=puede(p)?`<button type="button" class="btn-editar-fila" onclick="editarNotaAdicional('${id}')">✏ Editar</button>
      <button type="button" class="btn-eliminar-fila" onclick="eliminarNotaAdicional('${id}')">🗑 Eliminar</button>`:'';
    return `<tr>
      <td style="white-space:nowrap;font-weight:700;color:var(--navy)">${escHTML(p.fecha||'-')}</td>
      <td style="font-weight:700;color:var(--navy)">${escHTML(p.empleado||'-')}</td>
      <td style="font-weight:700;color:var(--navy)">${escHTML(p.cliente||'-')}</td>
      <td style="font-weight:700;color:var(--navy)">📝 ${escHTML(p.notas)}</td>
      <td style="white-space:nowrap">${acc}</td>
    </tr>`;
  }).join('');
}
async function editarNotaAdicional(pedidoId){
  const p=(_pedidosRaw||[]).find(x=>x._id===pedidoId);
  if(!p){ alert('No se encontró el pedido de esta nota.'); return; }
  if(ROL_ACTUAL!=='admin' && ROL_ACTUAL!=='secretaria'){
    alert('No puedes editar esta nota.'); return;
  }
  const actual=p.notas||'';
  const nuevo=prompt('Editar nota de '+(p.cliente||'este cliente')+':', actual);
  if(nuevo===null) return;
  const texto=String(nuevo).trim();
  if(!texto){ alert('La nota no puede quedar vacía. Usa Eliminar si quieres quitarla.'); return; }
  try{
    await db.collection('pedidos').doc(pedidoId).update({ notas:texto });
    if(typeof _registrarAuditoria==='function'){
      await _registrarAuditoria('nota','edición',pedidoId,'Nota de "'+(p.cliente||'')+'" editada');
    }
    p.notas=texto;
    renderNotasAdicionalesDash();
    if(typeof renderDashboard==='function') renderDashboard();
  }catch(err){
    alert('No se pudo guardar la nota.');
  }
}
function eliminarNotaAdicional(pedidoId){
  const p=(_pedidosRaw||[]).find(x=>x._id===pedidoId);
  if(!p){ alert('No se encontró el pedido de esta nota.'); return; }
  if(ROL_ACTUAL!=='admin' && ROL_ACTUAL!=='secretaria'){
    alert('No puedes eliminar esta nota.'); return;
  }
  _pedirMotivoEliminar('Vas a quitar la nota del pedido de "'+(p.cliente||'este cliente')+'". El pedido no se borra, solo la observación.', async (motivo)=>{
    try{
      await db.collection('pedidos').doc(pedidoId).update({ notas:'' });
      if(typeof _registrarAuditoria==='function'){
        await _registrarAuditoria('nota','eliminación',pedidoId,'Nota de "'+(p.cliente||'')+'" eliminada', motivo);
      }
      p.notas='';
      renderNotasAdicionalesDash();
      if(typeof renderDashboard==='function') renderDashboard();
    }catch(err){
      alert('No se pudo eliminar la nota.');
    }
  });
}
/* [NEW] Imprimir Notas Adicionales — mismo patrón (logo + firmas) que
   imprimirLiquidacionDash(), respetando los mismos filtros de fecha y asesor
   que ya aplica renderNotasAdicionalesDash(). */
function imprimirNotasAdicionalesDash(){
  const fecha = _textoRangoFecha();
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const asesorLabel = asesorSel.split(':')[1]?.trim() || 'Todos';
  const pedidosConNota = _pedidosRaw
    .filter(p => (p.notas||'').trim() !== '')
    .filter(p => !asesorSel || (p.empleado||'') === asesorSel)
    .sort((a,b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
  const filas = pedidosConNota.map(p => `<tr>
    <td style="font-weight:700;color:#1a3a5c">${escHTML(p.fecha||'-')}</td>
    <td style="font-weight:700;color:#1a3a5c">${escHTML(p.empleado||'-')}</td>
    <td style="font-weight:700;color:#1a3a5c">${escHTML(p.cliente||'-')}</td>
    <td style="font-weight:700;color:#1a3a5c">${escHTML(p.notas||'-')}</td>
  </tr>`).join('');
  const v = window.open('', '_blank', 'width=900,height=900');
  // [NEW] URL absoluta del logo — esta ventana se abre en blanco, sin el
  // dashboard como base, así que una ruta relativa no cargaría.
  const logoUrl = location.origin + '/logo-luanaqua.png';
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Notas Adicionales — ${asesorLabel} — Aqua Luan — ${fecha}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#1a3a5c;}
    .print-header p{font-size:11px;color:#888;margin-top:3px;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    thead th{padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#fff;background:#1a3a5c;}
    tbody td{padding:9px 12px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
    .firmas{display:flex;justify-content:space-between;gap:30px;margin-top:70px;page-break-inside:avoid;}
    .firmas .firma{flex:1;text-align:center;}
    .firmas .firma-linea{border-top:1.5px solid #1a3a5c;margin-bottom:6px;}
    .firmas .firma-label{font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#1a3a5c;}
    @media print{body{padding:12px;} thead{display:table-header-group;} .firmas{margin-top:60px;}}
  </style></head><body>
  <div class="print-header">
    <img src="${logoUrl}" alt="Aqua Luan" onerror="this.style.display='none'">
    <div>
      <h1>NOTAS ADICIONALES — ${escHTML(asesorLabel)}</h1>
      <p>Fecha: ${fecha} · Asesor: ${escHTML(asesorLabel)} · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
    </div>
  </div>
  <table>
    <thead><tr><th>Fecha</th><th>Asesor</th><th>Cliente</th><th>Nota</th></tr></thead>
    <tbody>
      ${filas || '<tr><td colspan="4" style="text-align:center;color:#888">No hay notas adicionales registradas en este período.</td></tr>'}
    </tbody>
  </table>
  <div class="firmas">
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Liquidadora</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Asesor</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Ayudante</div></div>
  </div>
  <script>
    var _impresoNotas=false;
    function _intentarImprimirNotas(){ if(_impresoNotas)return; _impresoNotas=true; window.print(); }
    window.onload=_intentarImprimirNotas;
    setTimeout(_intentarImprimirNotas,180);
  <\/script>
  </body></html>`);
  v.document.close();
  _dispararImpresion(v);
}


function _mbPeriodoEsHoy(){
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const hasta=document.getElementById('filtroFechaHasta')?.value||hoy;
  const desde=document.getElementById('filtroFecha')?.value||hasta;
  return !!hoy && desde===hoy && hasta===hoy;
}
/* Guardar / editar habilitado desde el 15-sep-2026 inclusive hasta hoy.
   Fechas anteriores al 15 siguen bloqueadas. Imprimir no se bloquea. */
const MB_FECHA_EDITABLE_DESDE='2026-09-15';
const MB_FECHA_EDITABLE_EXTRA=MB_FECHA_EDITABLE_DESDE;
function _mbDiaFiltroUnico(){
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const hasta=document.getElementById('filtroFechaHasta')?.value||hoy;
  const desde=document.getElementById('filtroFecha')?.value||hasta;
  if(!desde || !hasta || desde!==hasta) return '';
  return desde;
}
function _periodoEditableDesde15(){
  const dia=_mbDiaFiltroUnico();
  if(!dia) return false;
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  if(!hoy) return false;
  return dia>=MB_FECHA_EDITABLE_DESDE && dia<=hoy;
}
function _mbPeriodoEditable(){
  if(ROL_ACTUAL !== 'admin' && ROL_ACTUAL !== 'secretaria') return false;
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const hasta=document.getElementById('filtroFechaHasta')?.value||hoy;
  const desde=document.getElementById('filtroFecha')?.value||hasta;
  if(!hoy) return false;
  if(!desde && !hasta) return true;
  return (!hasta || hasta<=hoy) && (!desde || desde<=hoy);
}
function _esAdminMovBanc(){
  return ROL_ACTUAL === 'admin' || ROL_ACTUAL === 'secretaria';
}
function _idMovimientosBancarios(){
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const hasta=document.getElementById('filtroFechaHasta')?.value||hoy;
  const desde=document.getElementById('filtroFecha')?.value||hasta;
  return desde+'_'+hasta;
}
function _nombreCortoAsesor(nombre){
  return String(nombre||'').split(':')[1]?.trim() || String(nombre||'Sin asignar');
}
function _esMetodoBancario(forma){
  const f=String(forma||'').trim().toLowerCase();
  if(f==='transferencia') return 'Transferencia';
  if(f==='cheque') return 'Cheque';
  if(f==='depósito' || f==='deposito') return 'Depósito';
  return '';
}
function _normMetodoMB(forma){
  const f=String(forma||'').trim().toLowerCase();
  if(!f || f==='mixto') return '';
  if(f.includes('contad') || f==='efectivo') return 'Contado';
  if(f.includes('crédit') || f.includes('credit')) return 'Crédito';
  if(f.includes('transfer')) return 'Transferencia';
  if(f.includes('cheque')) return 'Cheque';
  if(f.includes('dep')) return 'Depósito';
  return '';
}
const MB_FILTRO_FORMAS = ['Contado','Crédito','Transferencia','Cheque','Depósito'];
let _mbFiltroExcluidos = new Set();
function _mbFormasActivas(){
  return MB_FILTRO_FORMAS.filter(f => !_mbFiltroExcluidos.has(f));
}
function _asesorMatchMB(nombre, sel){
  if(!sel) return true;
  const n=_nombreCortoAsesor(nombre).toLowerCase();
  const s=_nombreCortoAsesor(sel).toLowerCase();
  const full=String(nombre||'').trim().toLowerCase();
  const selv=String(sel||'').trim().toLowerCase();
  return full===selv || n===s || full.includes(s) || selv.includes(n);
}
function _diasDelRangoFiltroMB(){
  const hoy = (typeof fechaHoy==='function') ? fechaHoy() : new Date().toISOString().slice(0,10);
  let desde = document.getElementById('filtroFecha')?.value || '';
  let hasta = document.getElementById('filtroFechaHasta')?.value || hoy;
  if(!hasta || hasta>hoy) hasta=hoy;
  if(!desde){
    const d=new Date(hasta+'T00:00:00');
    d.setDate(d.getDate()-40);
    desde=d.toISOString().slice(0,10);
  }
  const out=[];
  const cur=new Date(desde+'T00:00:00');
  const end=new Date(hasta+'T00:00:00');
  let guard=0;
  while(cur<=end && guard<62){
    out.push(cur.toISOString().slice(0,10));
    cur.setDate(cur.getDate()+1);
    guard++;
  }
  return out;
}
function renderFiltroPagoMovBanc(){
  const bar=document.getElementById('mbFiltroPagoBar');
  if(!bar) return;
  const activos=_mbFormasActivas();
  bar.innerHTML = '<span style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-right:4px">Forma de pago</span>' +
    MB_FILTRO_FORMAS.map(f=>{
      const on=activos.includes(f);
      return `<label style="display:inline-flex;align-items:center;gap:6px;background:${on?'#e8f6f3':'#f3f4f6'};border:1.5px solid ${on?'#0a7c6e':'#d5dbe3'};border-radius:999px;padding:4px 10px;cursor:pointer;font-weight:700;color:#1a3a5c">
        <input type="checkbox" ${on?'checked':''} onchange="toggleFiltroPagoMB('${f}', this.checked)" style="accent-color:#0a7c6e"> ${f}
      </label>`;
    }).join('');
}
function toggleFiltroPagoMB(valor, marcado){
  if(marcado) _mbFiltroExcluidos.delete(valor); else _mbFiltroExcluidos.add(valor);
  renderMovimientosBancarios();
}
const MB_CUENTAS = ['Angel Fonseca','Ana Luisa','Grupo Fonseca'];
const MB_BANCOS = ['Pichincha','Guayaquil'];
function _htmlSelectCuentaMB(valor, dis){
  const v=String(valor||'');
  const opts=['<option value="">Seleccionar cuenta</option>'].concat(
    MB_CUENTAS.map(n=>`<option value="${escHTML(n)}"${v===n?' selected':''}>${escHTML(n)}</option>`)
  );
  if(v && !MB_CUENTAS.includes(v)){
    opts.push(`<option value="${escHTML(v)}" selected>${escHTML(v)}</option>`);
  }
  return `<select class="cdd-input mb-cuenta" ${dis} style="width:100%;min-width:160px">${opts.join('')}</select>`;
}
function _htmlInputBancoMB(valor, dis){
  const v=String(valor||'');
  const esLista = !v || MB_BANCOS.includes(v);
  const sel = esLista ? v : '__otro__';
  const extra = (!esLista && v) ? v : '';
  const show = sel==='__otro__' ? '' : 'display:none;';
  return `<div style="display:flex;flex-direction:column;gap:6px;min-width:170px">
    <select class="cdd-input mb-banco-sel" ${dis} onchange="_toggleBancoOtroMB(this)" style="width:100%">
      <option value="">Seleccionar banco</option>
      <option value="Pichincha"${sel==='Pichincha'?' selected':''}>Pichincha</option>
      <option value="Guayaquil"${sel==='Guayaquil'?' selected':''}>Guayaquil</option>
      <option value="__otro__"${sel==='__otro__'?' selected':''}>Otro banco…</option>
    </select>
    <input type="text" class="cdd-input mb-banco-otro" ${dis} value="${escHTML(extra)}" placeholder="Escribe el banco" style="width:100%;${show}">
    <input type="hidden" class="mb-banco" value="${escHTML(v)}">
  </div>`;
}
function _toggleBancoOtroMB(sel){
  const wrap=sel.closest('div');
  if(!wrap) return;
  const otro=wrap.querySelector('.mb-banco-otro');
  const hid=wrap.querySelector('.mb-banco');
  if(!otro||!hid) return;
  if(sel.value==='__otro__'){
    otro.style.display='block';
    otro.focus();
    hid.value=(otro.value||'').trim();
  } else {
    otro.style.display='none';
    otro.value='';
    hid.value=sel.value||'';
  }
}
function _valorBancoFilaMB(tr){
  const sel=tr.querySelector('.mb-banco-sel');
  const otro=tr.querySelector('.mb-banco-otro');
  if(sel && sel.value==='__otro__') return (otro?.value||'').trim();
  if(sel && sel.value) return sel.value.trim();
  return (tr.querySelector('.mb-banco')?.value||'').trim();
}
function _diaLocalDesdeFecha(fecha){
  const raw=String(fecha||'').trim();
  const iso=raw.match(/(\d{4}-\d{2}-\d{2})/);
  if(iso) return iso[1];
  const dmy=raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(dmy) return dmy[3]+'-'+dmy[2]+'-'+dmy[1];
  return '';
}
function _horaLocalDesdeTs(ts){
  let d=null;
  try{
    if(ts && typeof ts.toDate==='function') d=ts.toDate();
    else if(ts && typeof ts.toMillis==='function') d=new Date(ts.toMillis());
    else if(ts instanceof Date) d=ts;
    else if(typeof ts==='number' && ts>0) d=new Date(ts);
  }catch(e){}
  if(!d || isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function _fmtFechaHoraMB(fecha, ts){
  /* La columna FECHA debe respetar p.fecha (día del pedido), no creadoEn en UTC.
     Si no, un pedido del 04 guardado a las 08:45 del 05 aparece como 05. */
  let dia=_diaLocalDesdeFecha(fecha);
  if(!dia){
    let d=null;
    try{
      if(ts && typeof ts.toDate==='function') d=ts.toDate();
      else if(ts && typeof ts.toMillis==='function') d=new Date(ts.toMillis());
    }catch(e){}
    if(d && !isNaN(d.getTime())){
      dia=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    }
  }
  if(!dia) return '—';
  const p=dia.split('-');
  const base=p[2]+'/'+p[1]+'/'+p[0];
  const hh=_horaLocalDesdeTs(ts);
  return hh ? (base+' '+hh) : base;
}
function _msMovBanc(l){
  const ts=l && l.ts;
  try{
    if(ts && typeof ts.toMillis==='function') return ts.toMillis();
    if(ts && typeof ts.toDate==='function') return ts.toDate().getTime();
    if(ts instanceof Date) return ts.getTime();
    if(typeof ts==='number' && ts>0) return ts;
  }catch(e){}
  const f=String((l&&l.fecha)||'');
  const m=f.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return Date.parse(m[1]+'-'+m[2]+'-'+m[3]+'T00:00:00');
  return 0;
}
function _lineasMovimientosDesdeDatos(){
  const lineas=[];
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const activas = new Set(_mbFormasActivas());
  function pushLinea(asesor, valor, metodo, fecha, ts, origen){
    if(!metodo || !(Number(valor)>0)) return;
    if(!_asesorMatchMB(asesor, asesorSel)) return;
    if(activas.size && !activas.has(metodo)) return;
    lineas.push({asesor, valor:Number(valor), metodo, fecha:fecha||'', ts:ts||null, origen:origen||null});
  }
  (_pedidosRaw||[]).forEach(p=>{
    const asesor=p.empleado || 'Sin asignar';
    const fecha=p.fecha||'';
    const ts=p.creadoEn||null;
    const origenPed={tipo:'pedido', id:p._id||''};
    if (p.pagos !== null && p.pagos !== undefined) {
      (p.pagos||[]).forEach(pg=>{
        const metodo=_normMetodoMB(pg.forma) || _esMetodoBancario(pg.forma);
        pushLinea(asesor, parseFloat(pg.monto||0)||0, metodo, fecha, ts, origenPed);
      });
      const cred=parseFloat(p.creditoPendiente||0)||0;
      if(cred>0.004) pushLinea(asesor, cred, 'Crédito', fecha, ts, origenPed);
    } else {
      const metodo=_normMetodoMB(p.formapago) || _esMetodoBancario(p.formapago);
      const tot=parseFloat(p.total||0)||0;
      if(metodo) pushLinea(asesor, tot, metodo, fecha, ts, origenPed);
      else if(String(p.formapago||'').toLowerCase()==='mixto' && tot>0){
        /* sin desglose: no inventar */
      }
    }
  });
  (_pagosRaw||[]).forEach(p=>{
    const metodo=_normMetodoMB(p.forma) || _esMetodoBancario(p.forma);
    pushLinea(p.empleado||'Sin asignar', parseFloat(p.monto||0)||0, metodo, p.fecha||'', p.creadoEn||null, {tipo:'pago', id:p._id||''});
  });
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const hasta=document.getElementById('filtroFechaHasta')?.value||hoy;
  const desde=document.getElementById('filtroFecha')?.value||hasta;
  if(desde || hasta){
    return lineas.filter(l=>{
      const dia=_diaLocalDesdeFecha(l.fecha) || _isoDiaMB(l.fecha, null);
      if(!dia) return false;
      if(desde && dia<desde) return false;
      if(hasta && dia>hasta) return false;
      return true;
    });
  }
  return lineas;
}
function _isoDiaMB(fecha, ts){
  const dia=_diaLocalDesdeFecha(fecha);
  if(dia) return dia;
  try{
    let d=null;
    if(ts && typeof ts.toDate==='function') d=ts.toDate();
    else if(ts && typeof ts.toMillis==='function') d=new Date(ts.toMillis());
    if(d && !isNaN(d.getTime())){
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    }
  }catch(e){}
  return '';
}
function _idFilaMovBanc(l, idx){
  const sl=String(l.asesor||'').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const dia=_isoDiaMB(l.fecha, l.ts) || String(idx||0);
  return sl+'__'+String(l.metodo||'').toLowerCase()+'__'+Number(l.valor||0).toFixed(2)+'__'+dia;
}
function _claveFlexibleMB(f){
  const sl=String(f.asesor||f.nombre||'').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const met=String(f.metodo||'').toLowerCase();
  const val=Number(f.valor||0).toFixed(2);
  return sl+'__'+met+'__'+val;
}
let _mbBloqueado=false;
let _mbOcultos=[];
async function renderMovimientosBancarios(){
  const tbody=document.getElementById('mbTbody');
  let totalEl=document.getElementById('mbTotal');
  const st=document.getElementById('mbStatus');
  const btn=document.getElementById('mbBtnGuardar');
  if(!tbody) return;
  renderFiltroPagoMovBanc();
  const theadRow=document.querySelector('#mbTabla thead tr');
  if(theadRow){
    theadRow.innerHTML='<th>Fecha</th><th>Asesor</th><th style="text-align:right">Valor</th><th>Método de pago</th><th>Nombre de cuenta</th><th>Banco</th><th>Acciones</th>';
  }
  const tfootRow=document.querySelector('#mbTabla tfoot tr');
  if(tfootRow){
    tfootRow.innerHTML='<td style="font-weight:800">TOTAL</td><td></td><td id="mbTotal" style="text-align:right;font-weight:800">$0.00</td><td colspan="4"></td>';
  }
  const totalEl2=document.getElementById('mbTotal');
  if(totalEl2) totalEl=totalEl2;
  let lineas=_lineasMovimientosDesdeDatos();
  try{
    if(typeof db!=='undefined'){
      const rutasSet=new Set([...(Array.isArray(_asesoresCache)?_asesoresCache:[]), ...(_pedidosRaw||[]).map(p=>p.empleado||''), ...(_pagosRaw||[]).map(p=>p.empleado||'')].filter(Boolean));
      const asesorSelDep = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
      const dias=_diasDelRangoFiltroMB();
      const ids=[];
      [...rutasSet].forEach(nombre=>{
        if(!_asesorMatchMB(nombre, asesorSelDep)) return;
        const sl=_slugAsesorLiq(nombre);
        dias.forEach(dia=> ids.push({nombre, id: dia+'_'+dia+'__'+sl, dia}));
        const rangoId=_idEntregaLiquidacion(nombre);
        ids.push({nombre, id: rangoId, dia: document.getElementById('filtroFecha')?.value||''});
      });
      const seenId=new Set();
      const uniq=ids.filter(x=>{ if(seenId.has(x.id)) return false; seenId.add(x.id); return true; });
      const entregas=await Promise.all(uniq.map(async item=>{
        try{
          const snap=await db.collection('cierresLiquidacion').doc(item.id).get();
          return {nombre:item.nombre, dia:item.dia, data: snap.exists ? snap.data() : {}};
        }catch(err){ return {nombre:item.nombre, dia:item.dia, data:{}}; }
      }));
      const activasDep=new Set(_mbFormasActivas());
      const seenDep=new Set();
      entregas.forEach(({nombre,dia,data})=>{
        if(!data || !Object.keys(data).length) return;
        const fechaLiq=dia||data.desde||data.fecha||'';
        const tsLiq=data.actualizadoEn||null;
        const deps=Array.isArray(data.depositos)&&data.depositos.length?data.depositos:null;
        const lista=deps || (data.deposito ? [data.deposito] : []);
        lista.forEach((dep,ix)=>{
          const monto=dep && dep.marcado ? (Number(dep.monto)||0) : 0;
          if(!(monto>0)) return;
          if(activasDep.size && !activasDep.has('Depósito')) return;
          const key='dep|'+nombre+'|'+monto.toFixed(2)+'|'+fechaLiq+'|'+ix;
          if(seenDep.has(key)) return;
          seenDep.add(key);
          lineas.push({asesor:nombre, valor:monto, metodo:'Depósito', fecha:fechaLiq, ts:tsLiq});
        });
        // [FIX] La forma de entrega de liquidación también declara Transferencia
        // (además de Depósito). Antes solo se copiaban los depósitos, por eso
        // montos como el $477 de Wilson no aparecían en Movimientos Bancarios.
        const tr=data.transferencia;
        const trMarcado = !tr ? false : (typeof tr==='object' ? !!tr.marcado : true);
        const montoTr = !tr ? 0 : (typeof tr==='object' ? (Number(tr.monto)||0) : (Number(tr)||0));
        if(trMarcado && montoTr>0 && (!activasDep.size || activasDep.has('Transferencia'))){
          const key='tr|'+nombre+'|'+montoTr.toFixed(2)+'|'+fechaLiq;
          if(!seenDep.has(key)){
            seenDep.add(key);
            lineas.push({asesor:nombre, valor:montoTr, metodo:'Transferencia', fecha:fechaLiq, ts:tsLiq});
          }
        }
      });
    }
  }catch(err){ console.warn('movimientosBancarios depositos:', err); }
  lineas.sort((a,b)=>{
    const ta=_msMovBanc(b)-_msMovBanc(a);
    if(ta!==0) return ta;
    const na=_nombreCortoAsesor(a.asesor).localeCompare(_nombreCortoAsesor(b.asesor),'es');
    if(na!==0) return na;
    return String(a.metodo).localeCompare(String(b.metodo),'es');
  });
  let guardado={ filas:[] };
  async function _leerGuardadoMB(id){
    const out={};
    try{
      const snapCierre=await db.collection('cierresDelDia').doc(id).get();
      const dataCierre=snapCierre.exists ? (snapCierre.data()||{}) : {};
      if(dataCierre.movimientosBancarios && typeof dataCierre.movimientosBancarios==='object'){
        return dataCierre.movimientosBancarios||{};
      }
    }catch(e){}
    try{
      const snap=await db.collection('movimientosBancarios').doc(id).get();
      if(snap.exists) return snap.data()||{};
    }catch(e){}
    return out;
  }
  try{
    if(typeof db!=='undefined'){
      const ids=new Set([_idMovimientosBancarios()]);
      _diasDelRangoFiltroMB().forEach(dia=>ids.add(dia+'_'+dia));
      const bloques=await Promise.all([...ids].map(_leerGuardadoMB));
      const filasMerge=[];
      const ocultosMerge=new Set();
      bloques.forEach(b=>{
        if(b && b.bloqueado) guardado.bloqueado=true;
        if(b && b.actualizadoPor) guardado.actualizadoPor=b.actualizadoPor;
        (b.filas||[]).forEach(f=>filasMerge.push(f));
        (b.ocultos||[]).forEach(id=>ocultosMerge.add(String(id)));
      });
      guardado.filas=filasMerge;
      guardado.ocultos=[...ocultosMerge];
    }
  }catch(err){ console.warn('movimientosBancarios lectura:', err); }
  _mbBloqueado=!!guardado.bloqueado;
  const porId={};
  (guardado.filas||[]).forEach(f=>{
    if(!f) return;
    if(f.id) porId[f.id]=f;
    porId[_claveFlexibleMB(f)]=f;
    if(f.asesor && f.metodo){
      const alt=_idFilaMovBanc(f,0);
      if(!porId[alt]) porId[alt]=f;
    }
  });
  const ocultos=new Set((guardado.ocultos||[]).map(String));
  _mbOcultos=[...ocultos];
  lineas=lineas.filter((l,idx)=>{
    const id=_idFilaMovBanc(l,idx);
    const flex=_claveFlexibleMB({asesor:l.asesor, metodo:l.metodo, valor:l.valor});
    return !ocultos.has(id) && !ocultos.has(flex);
  });
  const total=lineas.reduce((s,l)=>s+(Number(l.valor)||0),0);
  if(totalEl) totalEl.textContent='$'+total.toFixed(2);
  if(!lineas.length){
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:#888;font-style:italic;padding:18px">No hay transferencias, cheques ni depósitos en este período.</td></tr>';
  } else {
    tbody.innerHTML=lineas.map((l,idx)=>{
      const id=_idFilaMovBanc(l,idx);
      const flex=_claveFlexibleMB({asesor:l.asesor, metodo:l.metodo, valor:l.valor});
      const saved=porId[id] || porId[flex] || {};
      const cuenta=saved.cuenta||'';
      const banco=saved.banco||'';
      const dis=(!_esAdminMovBanc() || !_mbPeriodoEditable() || _mbBloqueado)?'disabled':'';
      const fechaTxt=_fmtFechaHoraMB(l.fecha, l.ts);
      const btnDel=_mbPeriodoEditable()?`<button type="button" class="btn-eliminar-fila" onclick="eliminarFilaMovimientoBancario('${escHTML(id).replace(/'/g,"\\'")}')">🗑 Eliminar</button>`:'';
      return `<tr data-mb-id="${escHTML(id)}" data-asesor="${escHTML(l.asesor)}" data-valor="${Number(l.valor).toFixed(2)}" data-metodo="${escHTML(l.metodo)}" data-fecha="${escHTML(fechaTxt)}" data-origen-tipo="${escHTML((l.origen&&l.origen.tipo)||'')}" data-origen-id="${escHTML((l.origen&&l.origen.id)||'')}">
        <td style="font-size:12px;white-space:nowrap;color:var(--navy)">${escHTML(fechaTxt)}</td>
        <td style="font-weight:800;color:var(--navy)">${escHTML(_nombreCortoAsesor(l.asesor))}</td>
        <td style="text-align:right;font-weight:700">$${Number(l.valor).toFixed(2)}</td>
        <td>${escHTML(l.metodo)}</td>
        <td>${_htmlSelectCuentaMB(cuenta, dis)}</td>
        <td>${_htmlInputBancoMB(banco, dis)}</td>
        <td>${btnDel||'<span style="color:var(--muted);font-size:11px">—</span>'}</td>
      </tr>`;
    }).join('');
  }
  const esAdmin=_esAdminMovBanc();
  const esEditable=esAdmin && _mbPeriodoEditable();
  if(btn){
    btn.style.display=(esEditable && !_mbBloqueado)?'inline-flex':'none';
    btn.disabled=!esEditable || _mbBloqueado;
  }
  const btnEd=document.getElementById('mbBtnEditar');
  if(btnEd){
    btnEd.style.display=esEditable?'inline-flex':'none';
    btnEd.disabled=!esEditable;
    btnEd.title=esEditable?'Editar cuenta y banco':'No se puede editar en este período';
  }
  if(st){
    if(!esAdmin){
      st.textContent='Consulta e impresión.';
    } else if(!esEditable){
      st.textContent='No se puede editar en este período.';
    } else if(_mbBloqueado){
      st.textContent=('Guardado'+(guardado.actualizadoPor?' por '+guardado.actualizadoPor:'')+' — pulsa Editar para cambiar cuenta o banco.');
    } else {
      st.textContent='Elige la cuenta y el banco. Luego pulsa Guardar información.';
    }
  }
}
function _refrescarDashboardTrasMB(){
  if(typeof renderMovimientosBancarios==='function') renderMovimientosBancarios();
  if(typeof renderLiquidacionDash==='function') renderLiquidacionDash();
  if(typeof renderCierreDelDia==='function') renderCierreDelDia();
  if(typeof renderReporteAsesores==='function') renderReporteAsesores();
  if(typeof actualizarTodo==='function') actualizarTodo();
}
async function _quitarMontoEnEntregaLiq(nombre, metodo, monto){
  if(typeof db==='undefined' || !nombre) return;
  const id=_idEntregaLiquidacion(nombre);
  try{
    const snap=await db.collection('cierresLiquidacion').doc(id).get();
    if(!snap.exists) return;
    const data=snap.data()||{};
    const m=Number(monto)||0;
    const met=String(metodo||'').toLowerCase();
    if(met.includes('dep')){
      let deps=Array.isArray(data.depositos)?data.depositos.slice():(data.deposito?[data.deposito]:[]);
      let quitado=false;
      deps=deps.filter(d=>{
        if(quitado) return true;
        const val=d && d.marcado ? (Number(d.monto)||0) : 0;
        if(Math.abs(val-m)<0.009){ quitado=true; return false; }
        return true;
      });
      const suma=deps.reduce((s,d)=>s+((d.marcado)?(Number(d.monto)||0):0),0);
      await db.collection('cierresLiquidacion').doc(id).set({
        depositos:deps,
        deposito:{marcado:suma>0, monto:suma},
        actualizadoEn:firebase.firestore.FieldValue.serverTimestamp()
      }, {merge:true});
    } else if(met.includes('transf')){
      const actual=(data.transferencia && data.transferencia.marcado)?(Number(data.transferencia.monto)||0):0;
      if(Math.abs(actual-m)<0.009 || actual>=m){
        const resto=Math.max(0, actual-m);
        await db.collection('cierresLiquidacion').doc(id).set({
          transferencia:{marcado:resto>0, monto:resto},
          actualizadoEn:firebase.firestore.FieldValue.serverTimestamp()
        }, {merge:true});
      }
    }
  }catch(err){ console.warn('sync liquidacion desde MB:', err); }
}
async function _quitarPagoOrigenMB(asesor, metodo, monto, fechaTxt){
  if(typeof db==='undefined') return;
  const m=Number(monto)||0;
  const dia=_diaLocalDesdeFecha(fechaTxt);
  const forma=String(metodo||'');
  const cand=(_pagosRaw||[]).filter(p=>{
    if(!_asesorMatchMB(p.empleado||'', asesor) && (p.empleado||'')!==asesor) return false;
    if(Math.abs((parseFloat(p.monto)||0)-m)>0.009) return false;
    const f=_normMetodoMB(p.forma)||p.forma||'';
    if(String(f).toLowerCase()!==forma.toLowerCase() && !_normMetodoMB(p.forma)) {
      if(String(p.forma||'').toLowerCase()!==forma.toLowerCase()) return false;
    }
    const pd=_diaLocalDesdeFecha(p.fecha||'');
    if(dia && pd && pd!==dia) return false;
    return true;
  });
  if(cand.length!==1 || !cand[0]._id) return;
  try{
    await db.collection('pagos').doc(cand[0]._id).delete();
  }catch(err){ console.warn('sync pago desde MB:', err); }
}
async function eliminarFilaMovimientoBancario(id){
  if(!_mbPeriodoEditable()){
    alert('Solo el administrador puede eliminar movimientos en este rango de fechas.');
    return;
  }
  if(!id) return;
  const tr0=[...document.querySelectorAll('#mbTbody tr[data-mb-id]')].find(r=>r.dataset.mbId===id);
  const valor0=tr0?.dataset.valor||'';
  const metodo0=tr0?.dataset.metodo||'';
  const asesor0=tr0?.dataset.asesor||'';
  _pedirMotivoEliminar('Vas a quitar este movimiento bancario ('+(asesor0||'')+' · '+(metodo0||'')+' · $'+(valor0||'0')+'). Escribe el motivo. Quedará en Auditoría.', async (motivo)=>{
  if(!_mbOcultos) _mbOcultos=[];
  if(!_mbOcultos.includes(id)) _mbOcultos.push(id);
  const tr=[...document.querySelectorAll('#mbTbody tr[data-mb-id]')].find(r=>r.dataset.mbId===id);
  const asesor=tr?.dataset.asesor||'';
  const metodo=tr?.dataset.metodo||'';
  const valor=tr?.dataset.valor||'';
  const fechaTxt=tr?.dataset.fecha||'';
  const origenTipo=tr?.dataset.origenTipo||'';
  const origenId=tr?.dataset.origenId||'';
  if(tr) tr.remove();
  await _quitarMontoEnEntregaLiq(asesor, metodo, valor);
  if(origenTipo==='pago' && origenId && typeof db!=='undefined'){
    try{ await db.collection('pagos').doc(origenId).delete(); }catch(e){ console.warn('MB origen pago:', e); }
  } else {
    await _quitarPagoOrigenMB(asesor, metodo, valor, fechaTxt);
  }
  if(typeof _registrarAuditoria==='function'){
    await _registrarAuditoria('movimientosBancarios','eliminación',id,
      'Movimiento '+metodo+' $'+valor+' de '+(asesor||'')+' quitado del listado', motivo);
  }
  if(typeof db==='undefined') return;
  const periodo=_idMovimientosBancarios();
  const actor=(typeof actorAuditoria==='function') ? actorAuditoria() : 'sistema';
  async function _persistirOcultosMB(docId){
    let prev={};
    try{
      const snap=await db.collection('cierresDelDia').doc(docId).get();
      prev=snap.exists ? ((snap.data()||{}).movimientosBancarios||{}) : {};
    }catch(e){}
    const payload=Object.assign({}, prev, {
      periodo: docId,
      ocultos: _mbOcultos.slice(),
      actualizadoPor: actor,
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('cierresDelDia').doc(docId).set({
      movimientosBancarios: payload,
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: actor
    }, {merge:true});
  }
  try{
    await _persistirOcultosMB(periodo);
    const dias=_diasDelRangoFiltroMB();
    await Promise.all(dias.map(dia=>_persistirOcultosMB(dia+'_'+dia)));
    _refrescarDashboardTrasMB();
  }catch(err){
    console.warn('eliminar movimiento bancario:', err);
    alert('No se pudo eliminar. Intenta de nuevo.');
  }
  });
}
function habilitarEdicionMovimientosBancarios(){
  if(!_esAdminMovBanc()){
    alert('No se puede editar Movimientos Bancarios.');
    return;
  }
  if(!_mbPeriodoEditable()){
    alert('No se puede editar Movimientos Bancarios.');
    return;
  }
  _mbBloqueado=false;
  document.querySelectorAll('#mbTbody select, #mbTbody input').forEach(el=>{ el.disabled=false; });
  const btn=document.getElementById('mbBtnGuardar');
  if(btn){ btn.style.display='inline-flex'; btn.disabled=false; }
  const btnEd=document.getElementById('mbBtnEditar');
  if(btnEd) btnEd.style.display='none';
  const st=document.getElementById('mbStatus');
  if(st) st.textContent='Modo edición. Cambia cuenta o banco y pulsa Guardar información.';
}
async function guardarMovimientosBancarios(){
  if(!_esAdminMovBanc()){
    alert('No se puede guardar Movimientos Bancarios.');
    return;
  }
  if(!_mbPeriodoEditable()){
    alert('No se puede guardar Movimientos Bancarios.');
    return;
  }
  if(_mbBloqueado){ alert('Esta hoja está bloqueada. Pulsa Editar para modificar cuenta o banco.'); return; }
  if(typeof db==='undefined'){ alert('No hay conexión para guardar.'); return; }
  const filas=[...document.querySelectorAll('#mbTbody tr[data-mb-id]')].map(tr=>({
    id: tr.dataset.mbId||'',
    asesor: tr.dataset.asesor||'',
    valor: parseFloat(tr.dataset.valor||0)||0,
    metodo: tr.dataset.metodo||'',
    cuenta: (tr.querySelector('.mb-cuenta')?.value||'').trim(),
    banco: _valorBancoFilaMB(tr),
    fecha: tr.dataset.fecha||''
  }));
  filas.forEach(f=>{
    f.dia=_diaLocalDesdeFecha(f.fecha)||'';
  });
  if(!filas.length){ alert('No hay movimientos para guardar en este período.'); return; }
  const filasCompletas=filas.filter(f=>f.cuenta && f.banco);
  if(!filasCompletas.length){
    alert('Selecciona Nombre de cuenta y Banco al menos en una fila para guardar.');
    const st0=document.getElementById('mbStatus');
    if(st0) st0.textContent='Falta cuenta o banco en las filas que quieres guardar.';
    return;
  }
  if(!confirm('Se guardarán '+filasCompletas.length+' fila(s) con cuenta y banco. Las que estén vacías se dejan para después. ¿Continuar?')) return;
  const st=document.getElementById('mbStatus');
  if(st) st.textContent='Guardando…';
  const periodo=_idMovimientosBancarios();
  const actor=(typeof actorAuditoria==='function') ? actorAuditoria() : 'sistema';
  async function _escribirBloqueMB(docId, filasDoc){
    const payload={
      periodo: docId,
      bloqueado:true,
      filas: filasDoc,
      ocultos: (_mbOcultos||[]).slice(),
      actualizadoPor: actor,
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('cierresDelDia').doc(docId).set({
      movimientosBancarios: payload,
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: actor
    }, {merge:true});
    try{
      await db.collection('movimientosBancarios').doc(docId).set(payload, {merge:true});
    }catch(errCol){
      console.warn('movimientosBancarios coleccion opcional:', errCol);
    }
  }
  async function _leerFilasMB(docId){
    try{
      const snap=await db.collection('cierresDelDia').doc(docId).get();
      const data=snap.exists ? (snap.data()||{}) : {};
      if(data.movimientosBancarios && Array.isArray(data.movimientosBancarios.filas)){
        return data.movimientosBancarios.filas.slice();
      }
    }catch(e){}
    try{
      const snap2=await db.collection('movimientosBancarios').doc(docId).get();
      if(snap2.exists && Array.isArray((snap2.data()||{}).filas)) return snap2.data().filas.slice();
    }catch(e){}
    return [];
  }
  function _mergeFilasMB(prev, next){
    const map={};
    (prev||[]).forEach(f=>{ if(!f) return; if(f.id) map[f.id]=f; });
    (next||[]).forEach(f=>{ if(!f) return; if(f.id) map[f.id]=f; });
    return Object.values(map);
  }
  try{
    const prevRango=await _leerFilasMB(periodo);
    await _escribirBloqueMB(periodo, _mergeFilasMB(prevRango, filasCompletas));
    const porDia={};
    filasCompletas.forEach(f=>{
      const d=f.dia;
      if(!d) return;
      if(!porDia[d]) porDia[d]=[];
      porDia[d].push(f);
    });
    await Promise.all(Object.keys(porDia).map(async dia=>{
      const idDia=dia+'_'+dia;
      const prevDia=await _leerFilasMB(idDia);
      await _escribirBloqueMB(idDia, _mergeFilasMB(prevDia, porDia[dia]));
    }));
    if (typeof _registrarAuditoria === 'function') {
      _registrarAuditoria('movimientosBancarios', 'edición', periodo, 'Movimientos bancarios guardados por '+actor);
    }
    _mbBloqueado=true;
    _refrescarDashboardTrasMB();
    if(st) st.textContent='Guardado correctamente — ya no se puede editar.';
  }catch(err){
    console.warn('movimientosBancarios escritura:', err);
    const detalle=(err && (err.message||err.code)) ? String(err.message||err.code) : 'error desconocido';
    alert('No se pudo guardar los movimientos bancarios.\nDetalle: '+detalle);
    if(st) st.textContent='No se pudo guardar. '+detalle;
  }
}

async function imprimirMovimientosBancarios(){
  const yaHay=!!document.querySelector('#mbTbody tr[data-mb-id]');
  if(!yaHay && typeof renderMovimientosBancarios==='function') await renderMovimientosBancarios();
  const filas=[...document.querySelectorAll('#mbTbody tr[data-mb-id]')].map(tr=>{
    const fecha=tr.dataset.fecha||tr.cells[0]?.textContent.trim()||'—';
    const asesor=_nombreCortoAsesor(tr.dataset.asesor||'')||tr.cells[1]?.textContent.trim()||'';
    const valor=parseFloat(tr.dataset.valor||0)||0;
    const metodo=tr.dataset.metodo||'';
    const cuenta=(tr.querySelector('.mb-cuenta')?.value||'').trim()||'—';
    const banco=_valorBancoFilaMB(tr)||'—';
    return {fecha, asesor, valor, metodo, cuenta, banco};
  });
  if(!filas.length){ alert('No hay movimientos bancarios para imprimir en este período.'); return; }
  const fecha=_textoRangoFecha();
  const total=filas.reduce((s,f)=>s+(Number(f.valor)||0),0);
  const filasHtml=filas.map(f=>`<tr>
    <td>${escHTML(f.fecha||'—')}</td>
    <td>${escHTML(f.asesor)}</td>
    <td style="text-align:right">$${Number(f.valor).toFixed(2)}</td>
    <td>${escHTML(f.metodo)}</td>
    <td>${escHTML(f.cuenta)}</td>
    <td>${escHTML(f.banco)}</td>
  </tr>`).join('');
  const v=window.open('','_blank','width=900,height=900');
  const logoUrl=location.origin+'/logo-luanaqua.png';
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Movimientos Bancarios — Aqua Luan — ${fecha}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#1a3a5c;}
    .print-header p{font-size:11px;color:#888;margin-top:3px;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    thead th{padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#fff;background:#1a3a5c;}
    thead th:nth-child(2){text-align:right;}
    tbody td{padding:9px 12px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
    .total-row{background:#e6f4f2;font-weight:800;color:#085f54;}
    .total-row td{padding:12px;border-top:2px solid #0a7c6e;}
    .firmas{display:flex;justify-content:space-between;gap:30px;margin-top:70px;page-break-inside:avoid;}
    .firmas .firma{flex:1;text-align:center;}
    .firmas .firma-linea{border-top:1.5px solid #1a3a5c;margin-bottom:6px;}
    .firmas .firma-label{font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#1a3a5c;}
    @media print{body{padding:12px;} thead{display:table-header-group;} .firmas{margin-top:60px;}}
  </style></head><body>
  <div class="print-header">
    <img src="${logoUrl}" alt="Aqua Luan" onerror="this.style.display='none'">
    <div>
      <h1>MOVIMIENTOS BANCARIOS</h1>
      <p>Fecha: ${fecha} · ${filas.length} movimiento(s) · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
    </div>
  </div>
  <table>
    <thead><tr><th>Fecha</th><th>Asesor</th><th>Valor</th><th>Método de pago</th><th>Nombre de cuenta</th><th>Banco</th></tr></thead>
    <tbody>
      ${filasHtml}
      <tr class="total-row"><td>TOTAL</td><td></td><td style="text-align:right">$${total.toFixed(2)}</td><td colspan="3"></td></tr>
    </tbody>
  </table>
  <div class="firmas">
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Liquidadora</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Asesor</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Ayudante</div></div>
  </div>
  </body></html>`);
  v.document.close();
  _dispararImpresion(v);
}

let _liqTotalEntregarCache=0, _liqEntregaTimer=null, _liqEntregaCargando=false;
function _slugAsesorLiq(nombre){
  return String(nombre||'general').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'general';
}
function _idEntregaLiquidacion(asesor){
  const desde=document.getElementById('filtroFecha')?.value||fechaHoy();
  const hasta=document.getElementById('filtroFechaHasta')?.value||desde;
  const sl=_slugAsesorLiq(asesor||document.getElementById('filtroAsesor')?.value||'general');
  return desde+'_'+hasta+'__'+sl;
}
function _diasISOInclusive(desde, hasta){
  const out=[];
  if(!desde || !hasta) return out;
  const a=new Date(desde+'T12:00:00');
  const b=new Date(hasta+'T12:00:00');
  if(isNaN(a.getTime()) || isNaN(b.getTime()) || a>b) return out;
  for(let d=new Date(a); d<=b; d.setDate(d.getDate()+1)){
    out.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));
  }
  return out;
}
function _fusionarEntregasLiq(docs){
  const acc={
    efectivo:{marcado:false, monto:0},
    depositos:[],
    transferencia:{marcado:false, monto:0},
    faltantes:[{monto:0},{monto:0},{monto:0}],
    sobrante:{monto:0, motivo:''}
  };
  (docs||[]).forEach(e=>{
    if(!e) return;
    const ef=(e.efectivo && e.efectivo.marcado) ? (Number(e.efectivo.monto)||0) : 0;
    if(ef>0){ acc.efectivo.marcado=true; acc.efectivo.monto+=ef; }
    let deps=[];
    if(Array.isArray(e.depositos) && e.depositos.length) deps=e.depositos;
    else if(e.deposito) deps=[e.deposito];
    deps.forEach(d=>{
      const m=d && d.marcado ? (Number(d.monto)||0) : 0;
      if(m>0) acc.depositos.push({marcado:true, monto:m});
    });
    const tr=(e.transferencia && e.transferencia.marcado) ? (Number(e.transferencia.monto)||0) : 0;
    if(tr>0){ acc.transferencia.marcado=true; acc.transferencia.monto+=tr; }
    (e.faltantes||[]).forEach((f,i)=>{
      if(i>2) return;
      acc.faltantes[i].monto += Number(f && f.monto)||0;
    });
    const sb=Number(e.sobrante && e.sobrante.monto)||0;
    if(sb>0) acc.sobrante.monto += sb;
  });
  return acc;
}
async function _cargarEntregaCierreAsesor(nombre){
  if(typeof db==='undefined') return {};
  const desde=document.getElementById('filtroFecha')?.value||fechaHoy();
  const hasta=document.getElementById('filtroFechaHasta')?.value||desde;
  const sl=_slugAsesorLiq(nombre);
  const dias=_diasISOInclusive(desde, hasta);
  const diarios=[];
  for(const dia of dias){
    try{
      const snap=await db.collection('cierresLiquidacion').doc(dia+'_'+dia+'__'+sl).get();
      if(snap.exists) diarios.push(snap.data()||{});
    }catch(err){}
  }
  if(diarios.length) return _fusionarEntregasLiq(diarios);
  try{
    const snapExact=await db.collection('cierresLiquidacion').doc(_idEntregaLiquidacion(nombre)).get();
    if(snapExact.exists) return snapExact.data()||{};
  }catch(err){}
  return {};
}
function _boxEntregaAsesor(nombre){
  const boxes=[...document.querySelectorAll('.liq-entrega-asesor')];
  return boxes.find(b=>b.dataset.asesor===nombre) || null;
}
function _htmlEntregaAsesorBox(nombre, total){
  const safe=String(nombre||'').replace(/\\/g,'\\').replace(/'/g,"\\'");
  return `<div class="liq-entrega-asesor" data-asesor="${escHTML(nombre)}" data-total="${Number(total)||0}" style="margin:0 16px 14px;padding:14px 14px;background:var(--surface2);border:1.5px solid var(--border);border-radius:var(--radius)">
    <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--navy);margin-bottom:8px">Forma de entrega — ${escHTML(nombre)}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding:8px 10px;background:#fff;border-radius:8px;border:1px solid var(--border)">
      <span style="font-weight:800">Total a entregar</span>
      <span class="liq-ref-total" style="font-weight:800;color:var(--teal)">$${(Number(total)||0).toFixed(2)}</span>
    </div>
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><input type="checkbox" class="liq-chk-ef" onchange="_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))"><span style="min-width:130px;font-weight:700">Efectivo</span><input type="text" class="liq-monto-ef" placeholder="0.00" inputmode="decimal" style="flex:1;height:36px;border:1.5px solid var(--border);border-radius:8px;padding:0 10px" oninput="_filtrarInputMontoLiq(this);_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))"></label>
    <div class="liq-depositos-lista"></div>
    <button type="button" class="liq-btn-add-dep" onclick="_agregarDepositoAsesor(this)" style="display:none;margin:0 0 8px;padding:8px 12px;border:1.5px dashed var(--border);background:#fff;border-radius:8px;font-weight:700;cursor:pointer;color:var(--navy)">+ Añadir depósito</button>
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><input type="checkbox" class="liq-chk-tr" onchange="_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))"><span style="min-width:130px;font-weight:700">Transferencia</span><input type="text" class="liq-monto-tr" placeholder="0.00" inputmode="decimal" style="flex:1;height:36px;border:1.5px solid var(--border);border-radius:8px;padding:0 10px" oninput="_filtrarInputMontoLiq(this);_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))"></label>
    <div class="liq-faltantes-lista"></div>
    <button type="button" class="liq-btn-add-falt" onclick="_agregarFaltanteAsesor(this)" style="display:none;margin:4px 0 8px;padding:8px 12px;border:1.5px dashed var(--border);background:#fff;border-radius:8px;font-weight:700;cursor:pointer;color:var(--navy)">+ Añadir faltante</button>
    <button type="button" class="liq-btn-toggle-sob" onclick="_toggleSobranteAsesor(this)" style="display:none;margin:0 0 8px;padding:8px 12px;border:1.5px dashed #0a7c6e;background:#fff;border-radius:8px;font-weight:700;cursor:pointer;color:#0a7c6e">+ Sobrante</button>
    <div class="liq-sobrante-wrap" style="display:none;margin:0 0 8px;padding:10px;background:#fff;border:1.5px solid #c5e4dc;border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="min-width:90px;font-weight:700;color:#0a7c6e">Sobrante</span>
        <input type="text" class="liq-sob-monto" placeholder="0.00" inputmode="decimal" style="width:110px;height:36px;border:1.5px solid var(--border);border-radius:8px;padding:0 10px" oninput="_filtrarInputMontoLiq(this);_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))">
        <input type="text" class="liq-sob-motivo" placeholder="Motivo del sobrante" maxlength="120" style="flex:1;height:36px;border:1.5px solid var(--border);border-radius:8px;padding:0 10px">
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Se resta del efectivo / entrega para cuadrar el total.</div>
    </div>
    <div class="liq-entrega-cuadre" style="font-size:12px;margin-top:8px;font-weight:700"></div>
    <div class="liq-entrega-status" style="font-size:11px;color:var(--muted);margin-top:6px"></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button type="button" class="liq-btn-editar" onclick="_editarEntregaAsesor('${safe}')" style="padding:8px 14px;border:none;border-radius:8px;background:var(--navy);color:#fff;font-weight:700;cursor:pointer">✏ Editar</button>
      <button type="button" class="liq-btn-guardar" onclick="_confirmarGuardarEntregaAsesor('${safe}')" style="display:none;padding:8px 14px;border:none;border-radius:8px;background:#0f7c38;color:#fff;font-weight:700;cursor:pointer">💾 Guardar</button>
      <button type="button" class="liq-btn-cancelar" onclick="_cancelarEntregaAsesor('${safe}')" style="display:none;padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;background:#fff;font-weight:700;cursor:pointer">Cancelar</button>
    </div>
  </div>`;
}

function _filtroLiquidacionEsHoy(){
  /* Administración y Secretaria pueden editar liquidación y ajuste de saldos. */
  if(ROL_ACTUAL!=='admin' && ROL_ACTUAL!=='secretaria') return false;
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const hasta=document.getElementById('filtroFechaHasta')?.value||hoy;
  const desde=document.getElementById('filtroFecha')?.value||hasta;
  if(!hoy) return false;
  return (!hasta || hasta<=hoy) && (!desde || desde<=hoy);
}
function _setEntregaEditable(box, on){
  if(!box) return;
  const permitido=_filtroLiquidacionEsHoy();
  if(on && !permitido) on=false;
  box.dataset.editando = on ? '1' : '0';
  box.querySelectorAll('input').forEach(el => { el.disabled = !on; });
  const card=box.closest('.liq-card-asesor');
  const aj=card&&card.querySelector('.liq-ajuste-saldos');
  const btnAj=card&&card.querySelector('.liq-btn-guardar-ajuste');
  if(aj) aj.disabled=!on;
  if(btnAj) btnAj.style.display=on?'':'none';
  const add=box.querySelector('.liq-btn-add-falt');
  const addSob=box.querySelector('.liq-btn-toggle-sob');
  const addDep=box.querySelector('.liq-btn-add-dep');
  const ed=box.querySelector('.liq-btn-editar');
  const gu=box.querySelector('.liq-btn-guardar');
  const ca=box.querySelector('.liq-btn-cancelar');
  if(add) add.style.display = on ? '' : 'none';
  if(addSob) addSob.style.display = on ? '' : 'none';
  if(addDep){
    const n=box.querySelectorAll('.liq-deposito-row').length;
    addDep.style.display = (on && n<3) ? '' : 'none';
  }
  if(ed){
    const esAdmin = (typeof _esAdminMovBanc==='function') ? _esAdminMovBanc() : false;
    const puede = (ROL_ACTUAL==='admin' || ROL_ACTUAL==='secretaria');
    ed.style.display = (puede && !on) ? '' : 'none';
    ed.title = puede ? 'Editar entrega y ajuste de saldos' : 'Sin permiso para editar';
  }
  if(gu) gu.style.display = on ? '' : 'none';
  if(ca) ca.style.display = on ? '' : 'none';
}
function _editarEntregaAsesor(nombre){
  if(!_filtroLiquidacionEsHoy()){
    alert('No se puede editar la liquidación en este período.');
    return;
  }
  const box=_boxEntregaAsesor(nombre);
  _setEntregaEditable(box, true);
}
function _cancelarEntregaAsesor(nombre){
  _cargarEntregaAsesor(nombre);
}
function _confirmarGuardarEntregaAsesor(nombre){
  if(!_filtroLiquidacionEsHoy()){
    alert('No se puede guardar la liquidación en este período.');
    return;
  }
  if(!confirm('¿Está seguro que desea guardar la entrega de liquidación de '+nombre+'?')) return;
  _guardarEntregaAsesor(nombre).then(()=>{
    const box=_boxEntregaAsesor(nombre);
    _setEntregaEditable(box, false);
  });
}

function _parseMontoLiq(raw){
  const s=String(raw||'').trim();
  if(!s) return {ok:true, valor:0};
  const comas=(s.match(/,/g)||[]).length;
  const puntos=(s.match(/\./g)||[]).length;
  if(comas+puntos>1) return {ok:false, valor:0};
  if(!/^\d+([.,]\d{1,2})?$/.test(s)) return {ok:false, valor:0};
  const v=parseFloat(s.replace(',','.'));
  if(!isFinite(v)||v<0) return {ok:false, valor:0};
  return {ok:true, valor:v};
}
function _filtrarInputMontoLiq(el){
  if(!el) return;
  let v=String(el.value||'').replace(/[^0-9.,]/g,'');
  const sep=v.includes(',')&&!v.includes('.')?',':'.';
  const partes=v.split(/[.,]/);
  if(partes.length>2) v=partes[0]+sep+partes.slice(1).join('');
  el.value=v;
}

function _leerEntregaDesdeBox(box){
  if(!box) return {invalido:true};
  const n=sel=>{
    const el=box.querySelector(sel);
    const p=_parseMontoLiq(el?.value);
    return p.ok?p.valor:NaN;
  };
  const faltantes=[...box.querySelectorAll('.liq-faltante-row')].map(row=>{
    const p=_parseMontoLiq(row.querySelector('.liq-falt-monto')?.value);
    return {monto:p.ok?p.valor:NaN, montoOk:p.ok, motivo:(row.querySelector('.liq-falt-motivo')?.value||'').trim()};
  });
  const depositos=[...box.querySelectorAll('.liq-deposito-row')].map(row=>{
    const p=_parseMontoLiq(row.querySelector('.liq-dep-monto')?.value);
    return {marcado:!!row.querySelector('.liq-chk-dep')?.checked, monto:p.ok?p.valor:NaN, montoOk:p.ok};
  });
  const dep1=depositos[0]||{marcado:false,monto:0};
  return {
    efectivo:{marcado:!!box.querySelector('.liq-chk-ef')?.checked, monto:n('.liq-monto-ef')},
    deposito:{marcado:!!dep1.marcado, monto:Number.isNaN(dep1.monto)?0:dep1.monto},
    depositos,
    transferencia:{marcado:!!box.querySelector('.liq-chk-tr')?.checked, monto:n('.liq-monto-tr')},
    faltantes,
    sobrante:(()=>{ const p=_parseMontoLiq(box.querySelector('.liq-sob-monto')?.value); return {monto:p.ok?p.valor:NaN, montoOk:p.ok, motivo:(box.querySelector('.liq-sob-motivo')?.value||'').trim()}; })(),
    invalido:[n('.liq-monto-ef'),n('.liq-monto-tr')].some(v=>Number.isNaN(v)) || depositos.some(d=>!d.montoOk) || faltantes.some(f=>!f.montoOk) || !_parseMontoLiq(box.querySelector('.liq-sob-monto')?.value).ok
  };
}
function _htmlFilaFaltanteAsesor(i,monto,motivo){
  const val=monto?String(monto):'';
  return `<div class="liq-faltante-row" style="margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="min-width:90px;font-weight:700">Faltante ${i+1}</span>
      <input type="text" class="liq-falt-monto" placeholder="0.00" inputmode="decimal" value="${val.replace(/"/g,'')}" style="width:110px;height:36px;border:1.5px solid var(--border);border-radius:8px;padding:0 10px" oninput="_filtrarInputMontoLiq(this);_guardarEntregaDesdeFila(this)">
      <input type="text" class="liq-falt-motivo" placeholder="Nombre / motivo" maxlength="120" value="${(motivo||'').replace(/"/g,'&quot;')}" style="flex:1;height:36px;border:1.5px solid var(--border);border-radius:8px;padding:0 10px" oninput="_guardarEntregaDesdeFila(this)">
      ${i>0?`<button type="button" onclick="_quitarFaltanteAsesor(this)" style="height:36px;padding:0 10px;border:none;background:#fdecea;color:#c0392b;border-radius:8px;font-weight:700;cursor:pointer">Quitar</button>`:''}
    </div>
  </div>`;
}
function _htmlFilaDepositoAsesor(i,marcado,monto){
  const val=monto?String(monto):'';
  return `<label class="liq-deposito-row" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
    <input type="checkbox" class="liq-chk-dep" ${marcado?'checked':''} onchange="_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))">
    <span style="min-width:130px;font-weight:700">Depósito ${i+1}</span>
    <input type="text" class="liq-dep-monto" placeholder="0.00" inputmode="decimal" value="${val.replace(/"/g,'')}" style="flex:1;height:36px;border:1.5px solid var(--border);border-radius:8px;padding:0 10px" oninput="_filtrarInputMontoLiq(this);_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))">
    ${i>0?`<button type="button" onclick="_quitarDepositoAsesor(this)" style="height:36px;padding:0 10px;border:none;background:#fdecea;color:#c0392b;border-radius:8px;font-weight:700;cursor:pointer">Quitar</button>`:''}
  </label>`;
}
function _agregarDepositoAsesor(btn){
  const box=btn.closest('.liq-entrega-asesor');
  if(!box) return;
  const list=box.querySelector('.liq-depositos-lista');
  const actual=[...box.querySelectorAll('.liq-deposito-row')].map(row=>({
    marcado:!!row.querySelector('.liq-chk-dep')?.checked,
    monto:row.querySelector('.liq-dep-monto')?.value||''
  }));
  if(actual.length>=3) return;
  actual.push({marcado:true,monto:''});
  list.innerHTML=actual.map((d,i)=>_htmlFilaDepositoAsesor(i,d.marcado,d.monto)).join('');
  const add=box.querySelector('.liq-btn-add-dep');
  if(add) add.style.display=actual.length>=3?'none':'';
  _actualizarCuadreBox(box);
}
function _quitarDepositoAsesor(btn){
  const box=btn.closest('.liq-entrega-asesor');
  const row=btn.closest('.liq-deposito-row');
  if(row) row.remove();
  if(!box) return;
  const rows=[...box.querySelectorAll('.liq-deposito-row')];
  const actual=rows.map(r=>({marcado:!!r.querySelector('.liq-chk-dep')?.checked, monto:r.querySelector('.liq-dep-monto')?.value||''}));
  const list=box.querySelector('.liq-depositos-lista');
  if(list) list.innerHTML=actual.map((d,i)=>_htmlFilaDepositoAsesor(i,d.marcado,d.monto)).join('');
  const add=box.querySelector('.liq-btn-add-dep');
  if(add && box.dataset.editando==='1') add.style.display=actual.length>=3?'none':'';
  _actualizarCuadreBox(box);
}
function _sumaDepositosEntrega(u){
  if(u && Array.isArray(u.depositos) && u.depositos.length){
    return u.depositos.reduce((s,d)=>s+((d.marcado && d.montoOk!==false)?(Number(d.monto)||0):0),0);
  }
  return (u && u.deposito && u.deposito.marcado)?(Number(u.deposito.monto)||0):0;
}

function _guardarEntregaDesdeFila(el){
  const box=el.closest('.liq-entrega-asesor');
  if(box) _actualizarCuadreBox(box);
}
function _toggleSobranteAsesor(btn){
  const box=btn.closest('.liq-entrega-asesor');
  if(!box) return;
  const wrap=box.querySelector('.liq-sobrante-wrap');
  if(!wrap) return;
  const on=wrap.style.display==='none';
  wrap.style.display=on?'block':'none';
  if(!on){
    const m=box.querySelector('.liq-sob-monto');
    const t=box.querySelector('.liq-sob-motivo');
    if(m) m.value='';
    if(t) t.value='';
    _actualizarCuadreBox(box);
  }
}
function _agregarFaltanteAsesor(btn){
  const box=btn.closest('.liq-entrega-asesor');
  if(!box) return;
  const list=box.querySelector('.liq-faltantes-lista');
  const actual=[...box.querySelectorAll('.liq-faltante-row')].map(row=>({
    monto:row.querySelector('.liq-falt-monto')?.value||'',
    motivo:row.querySelector('.liq-falt-motivo')?.value||''
  }));
  actual.push({monto:'',motivo:''});
  list.innerHTML=actual.map((f,i)=>_htmlFilaFaltanteAsesor(i,f.monto,f.motivo)).join('');
}
function _quitarFaltanteAsesor(btn){
  const box=btn.closest('.liq-entrega-asesor');
  const row=btn.closest('.liq-faltante-row');
  if(row) row.remove();
  if(box&&box.dataset.asesor) _guardarEntregaAsesorDebounced(box.dataset.asesor);
}
function _actualizarCuadreBox(box){
  const el=box.querySelector('.liq-entrega-cuadre');
  if(!el) return;
  const u=_leerEntregaDesdeBox(box);
  const tot=parseFloat(box.dataset.total||0)||0;
  if(u.invalido){
    el.style.color='#c0392b';
    el.textContent='Hay un monto inválido.';
    return;
  }
  const sob=(u.sobrante && u.sobrante.montoOk)?(Number(u.sobrante.monto)||0):0;
  const suma=(u.efectivo.marcado?u.efectivo.monto:0)+_sumaDepositosEntrega(u)+(u.transferencia.marcado?u.transferencia.monto:0)+(u.faltantes||[]).reduce((s,f)=>s+(f.montoOk?f.monto:0),0)-sob;
  const hayDep=(u.depositos||[]).some(d=>d.marcado)||u.deposito?.marcado;
  if(suma===0 && !u.efectivo.marcado && !hayDep && !u.transferencia.marcado){
    el.textContent=''; return;
  }
  const diff=tot-suma;
  if(Math.abs(diff)<0.009){
    el.style.color='#0f7c38';
    el.textContent='Cuadra con el total a entregar ($'+tot.toFixed(2)+').';
  } else if(diff>0){
    el.style.color='#c0392b';
    el.textContent='Falta registrar $'+diff.toFixed(2)+' para cuadrar el total.';
  } else {
    el.style.color='#c0392b';
    el.textContent='La suma supera el total por $'+Math.abs(diff).toFixed(2)+'.';
  }
}
async function _cargarEntregaAsesor(nombre){
  const box=_boxEntregaAsesor(nombre);
  if(!box || typeof db==='undefined') return;
  try{
    const snap=await db.collection('cierresLiquidacion').doc(_idEntregaLiquidacion(nombre)).get();
    const d=snap.exists?snap.data():{};
    const setN=(sel,v)=>{ const el=box.querySelector(sel); if(el) el.value=(v?Number(v).toFixed(2):''); };
    const chk=(sel,v)=>{ const el=box.querySelector(sel); if(el) el.checked=!!v; };
    chk('.liq-chk-ef', d.efectivo?.marcado);
    chk('.liq-chk-tr', d.transferencia?.marcado);
    setN('.liq-monto-ef', d.efectivo?.monto);
    setN('.liq-monto-tr', d.transferencia?.monto);
    let deps=Array.isArray(d.depositos)&&d.depositos.length?d.depositos.map(x=>({marcado:!!x.marcado,monto:x.monto||''})):[];
    if(!deps.length && (d.deposito?.marcado || Number(d.deposito?.monto)>0)){
      deps=[{marcado:!!d.deposito.marcado, monto:d.deposito.monto||''}];
    }
    const listDep=box.querySelector('.liq-depositos-lista');
    if(listDep) listDep.innerHTML=(deps.length?deps:[{marcado:false,monto:''}]).slice(0,3).map((x,i)=>_htmlFilaDepositoAsesor(i,x.marcado,x.monto)).join('');
    let filas=Array.isArray(d.faltantes)?d.faltantes.map(f=>({monto:f.monto||'',motivo:f.motivo||''})):[];
    const list=box.querySelector('.liq-faltantes-lista');
    if(list) list.innerHTML=(filas.length?filas:[{monto:'',motivo:''}]).map((f,i)=>_htmlFilaFaltanteAsesor(i,f.monto,f.motivo)).join('');
    const wrapSob=box.querySelector('.liq-sobrante-wrap');
    const sobMonto=Number(d.sobrante && d.sobrante.monto)||0;
    const sobMotivo=(d.sobrante && d.sobrante.motivo)||'';
    if(wrapSob){
      wrapSob.style.display=sobMonto>0?'block':'none';
      const sm=box.querySelector('.liq-sob-monto');
      const stxt=box.querySelector('.liq-sob-motivo');
      if(sm) sm.value=sobMonto>0?sobMonto.toFixed(2):'';
      if(stxt) stxt.value=sobMotivo;
    }
    const st=box.querySelector('.liq-entrega-status');
    if(st){
      if(!_filtroLiquidacionEsHoy()){
        st.textContent=(snap.exists?'Entrega guardada de este asesor. ':'Sin entrega registrada. ')+'Pulsa Editar para cambiar entrega o ajuste de saldos.';
      } else {
        st.textContent=snap.exists?'Entrega guardada de este asesor.':'Sin entrega registrada aún.';
      }
    }
    _setEntregaEditable(box, false);
    _actualizarCuadreBox(box);
  }catch(err){
    console.warn('cierresLiquidacion lectura:', err);
  }
}
const _liqTimers={};
function _guardarEntregaAsesorDebounced(nombre){
  const box=_boxEntregaAsesor(nombre);
  if(box) _actualizarCuadreBox(box);
  clearTimeout(_liqTimers[nombre]);
  _liqTimers[nombre]=setTimeout(()=>_guardarEntregaAsesor(nombre), 600);
}
async function _guardarEntregaAsesor(nombre){
  const box=_boxEntregaAsesor(nombre);
  if(!box || typeof db==='undefined') return;
  if(!_filtroLiquidacionEsHoy()){
    const st0=box.querySelector('.liq-entrega-status');
    if(st0) st0.textContent='No se guarda en este período.';
    return;
  }
  const u=_leerEntregaDesdeBox(box);
  if(u.invalido) return;
  const st=box.querySelector('.liq-entrega-status');
  try{
    const faltantes=(u.faltantes||[]).map(f=>({monto:f.montoOk?Number(f.monto)||0:0, motivo:f.motivo||''}));
    const depositos=(u.depositos||[]).map(d=>({marcado:!!d.marcado, monto:d.montoOk?Number(d.monto)||0:0}));
    const depSuma=_sumaDepositosEntrega(u);
    const tot=parseFloat(box.dataset.total||0)||0;
    const card=box.closest('.liq-card-asesor');
    const ajusteInp=card&&card.querySelector('.liq-ajuste-saldos');
    const ajusteVal=parseFloat(String((ajusteInp&&ajusteInp.value)||'0').replace(',','.'))||0;
    const payloadEntrega={
      asesor:nombre,
      ajusteSaldos:ajusteVal,
      efectivo:u.efectivo,
      deposito:{marcado:depSuma>0, monto:depSuma},
      depositos,
      transferencia:u.transferencia,
      faltantes,
      sobrante:{monto:(u.sobrante&&u.sobrante.montoOk)?(Number(u.sobrante.monto)||0):0, motivo:(u.sobrante&&u.sobrante.motivo)||''},
      totalEntregar:tot,
      desde:document.getElementById('filtroFecha')?.value||'',
      hasta:document.getElementById('filtroFechaHasta')?.value||'',
      actualizadoEn:firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: (typeof actorAuditoria==='function') ? actorAuditoria() : ''
    };
    const idRango=_idEntregaLiquidacion(nombre);
    await db.collection('cierresLiquidacion').doc(idRango).set(payloadEntrega, {merge:true});
    const desdeE=payloadEntrega.desde||fechaHoy();
    const hastaE=payloadEntrega.hasta||desdeE;
    if(desdeE===hastaE && idRango!==(desdeE+'_'+hastaE+'__'+_slugAsesorLiq(nombre))){
      await db.collection('cierresLiquidacion').doc(desdeE+'_'+hastaE+'__'+_slugAsesorLiq(nombre)).set(payloadEntrega, {merge:true});
    }
    if(st) st.textContent='Entrega guardada.';
    if (typeof _registrarAuditoria === 'function') {
      _registrarAuditoria('liquidacion', 'edición', _idEntregaLiquidacion(nombre),
        'Entrega de '+nombre+' por '+actorAuditoria());
    }
    _actualizarCuadreBox(box);
    if(typeof renderCierreDelDia==='function') renderCierreDelDia();
  }catch(err){
    console.warn('cierresLiquidacion escritura:', err);
    if(st) st.textContent='No se pudo guardar la entrega.';
  }
}
function _htmlEntregaLiquidacionPrint(){
  const boxes=[...document.querySelectorAll('.liq-entrega-asesor')];
  if(!boxes.length) return '';
  return boxes.map(box=>{
    const u=_leerEntregaDesdeBox(box);
    const nom=box.dataset.asesor||'';
    const tot=parseFloat(box.dataset.total||0)||0;
    const fila=(ok,n,monto)=>`<div class="ruta-linea"><span>${ok?'☑':'☐'} ${n}</span><b>$${(monto||0).toFixed(2)}</b></div>`;
    return `<div class="ruta-block">
      <div class="ruta-header"><span>FORMA DE ENTREGA — ${escHTML(nom)}</span><span>$${tot.toFixed(2)}</span></div>
      ${fila(u.efectivo.marcado,'Efectivo',u.efectivo.monto)}
      ${(u.depositos&&u.depositos.length?u.depositos:[{marcado:u.deposito?.marcado,monto:u.deposito?.monto}]).map((d,i)=>fila(!!d.marcado,'Depósito '+(i+1),d.monto||0)).join('')}
      ${fila(u.transferencia.marcado,'Transferencia',u.transferencia.monto)}
      ${(u.faltantes||[]).filter(f=>f.montoOk&&f.monto>0).map((f,i)=>`<div class="ruta-linea"><span>Faltante ${i+1}${f.motivo?' — '+escHTML(f.motivo):''}</span><b>$${f.monto.toFixed(2)}</b></div>`).join('')||'<div class="ruta-linea"><span>Faltantes</span><b>$0.00</b></div>'}
      ${(u.sobrante&&u.sobrante.montoOk&&u.sobrante.monto>0)?`<div class="ruta-linea"><span>Sobrante${u.sobrante.motivo?' — '+escHTML(u.sobrante.motivo):''}</span><b>-$${Number(u.sobrante.monto).toFixed(2)}</b></div>`:''}
    </div>`;
  }).join('');
}


function _ajusteSaldosDesdeUI(nombre){
  const cards=[...document.querySelectorAll('.liq-card-asesor')];
  const card=cards.find(c=>(c.dataset.asesor||'')===nombre);
  const inp=card&&card.querySelector('.liq-ajuste-saldos');
  return parseFloat(String((inp&&inp.value)||'0').replace(',','.'))||0;
}
function _htmlBloqueEntregaPrint(nombre, tot, u){
  const fila=(ok,n,monto)=>`<div class="ruta-linea"><span>${ok?'☑':'☐'} ${n}</span><b>$${(Number(monto)||0).toFixed(2)}</b></div>`;
  const deps=(u.depositos&&u.depositos.length)?u.depositos:(u.deposito?[{marcado:!!u.deposito.marcado,monto:u.deposito.monto}]:[]);
  const falt=(u.faltantes||[]).filter(f=>(Number(f.monto)||0)>0);
  const sob=Number(u.sobrante&&u.sobrante.monto)||0;
  return `<div class="pasos-box">
      <div class="pasos-title">FORMA DE ENTREGA — ${escHTML(nombre)}</div>
      <div class="ruta-linea"><span>Total a entregar</span><b>$${(Number(tot)||0).toFixed(2)}</b></div>
      ${fila(!!(u.efectivo&&u.efectivo.marcado),'Efectivo',u.efectivo&&u.efectivo.monto)}
      ${(deps.length?deps:[{marcado:false,monto:0}]).map((d,i)=>fila(!!d.marcado,'Depósito '+(i+1),d.monto||0)).join('')}
      ${fila(!!(u.transferencia&&u.transferencia.marcado),'Transferencia',u.transferencia&&u.transferencia.monto)}
      ${falt.length?falt.map((f,i)=>`<div class="ruta-linea"><span>Faltante ${i+1}${f.motivo?' — '+escHTML(f.motivo):''}</span><b>$${(Number(f.monto)||0).toFixed(2)}</b></div>`).join(''):'<div class="ruta-linea"><span>Faltantes</span><b>$0.00</b></div>'}
      ${sob>0?`<div class="ruta-linea"><span>Sobrante${u.sobrante.motivo?' — '+escHTML(u.sobrante.motivo):''}</span><b>-$${sob.toFixed(2)}</b></div>`:''}
    </div>`;
}
function _htmlEntregaPrintDeAsesor(nombre){
  const box=_boxEntregaAsesor(nombre);
  if(!box) return '';
  const u=_leerEntregaDesdeBox(box);
  const tot=parseFloat(box.dataset.total||0)||0;
  const hay=(Number(u.efectivo&&u.efectivo.monto)||0)>0 || (Number(u.transferencia&&u.transferencia.monto)||0)>0 || _sumaDepositosEntrega(u)>0 || (u.faltantes||[]).some(f=>f.monto>0) || (Number(u.sobrante&&u.sobrante.monto)||0)>0;
  if(!hay) return '';
  return _htmlBloqueEntregaPrint(nombre, tot, u);
}
async function _htmlEntregaPrintDeAsesorAsync(nombre, tot){
  const box=_boxEntregaAsesor(nombre);
  if(box){
    const html=_htmlEntregaPrintDeAsesor(nombre);
    if(html) return html;
  }
  const d=await _cargarEntregaCierreAsesor(nombre);
  if(!d || !Object.keys(d).length) return box?_htmlBloqueEntregaPrint(nombre, tot, _leerEntregaDesdeBox(box)):'';
  return _htmlBloqueEntregaPrint(nombre, tot, {
    efectivo:d.efectivo||{marcado:false,monto:0},
    deposito:d.deposito||{marcado:false,monto:0},
    depositos:d.depositos||[],
    transferencia:d.transferencia||{marcado:false,monto:0},
    faltantes:d.faltantes||[],
    sobrante:d.sobrante||{monto:0,motivo:''}
  });
}
async function imprimirLiquidacionDash(){
  if(typeof renderLiquidacionDash==='function') await renderLiquidacionDash();
  const porAsesor = _calcularLiquidacionDash();
  const asesores = Object.keys(porAsesor).sort((a,b)=>a.localeCompare(b,'es'));
  const fecha = _textoRangoFecha();
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const asesorLabel = asesorSel.split(':')[1]?.trim() || 'General';
  let totalGeneral = 0;
  const bloques = await Promise.all(asesores.map(async nombre=>{
    const d0 = porAsesor[nombre];
    const ajuste = _ajusteSaldosDesdeUI(nombre);
    const d = Object.assign({}, d0, { ventasContado: (Number(d0.ventasContado)||0) + ajuste });
    const totalEntregar = _valorAEntregarRuta(d);
    totalGeneral += totalEntregar;
    const totalRuta = d.ventasContado+d.ventasCredito+d.ventasTransferencia+d.ventasCheque+d.ventasOtras;
    const totalPagosAsesor = d.pagosEfectivo+d.pagosTransferencia+d.pagosCheque+d.pagosOtros;
    const totalIngresos = totalRuta+totalPagosAsesor;
    const creditos = d.ventasCredito;
    const transferencias = d.ventasTransferencia+d.pagosTransferencia;
    const cheques = d.ventasCheque+d.pagosCheque;
    const sinClasificar = d.ventasOtras+d.pagosOtros;
    // [NEW] Desglose por producto vendido, también en el PDF
    const prodsOrdenados = Object.entries(d.productos).sort(([,a],[,b]) => b.dolares - a.dolares);
    const totalCantidadProd = prodsOrdenados.reduce((s,[,p]) => s + p.cantidad, 0);
    const totalDolaresProd  = prodsOrdenados.reduce((s,[,p]) => s + p.dolares, 0);
    const filasProductosPdf = prodsOrdenados.map(([nom,p]) => `
      <tr><td>${escHTML(nom)}</td><td style="text-align:right">${p.cantidad % 1 === 0 ? parseInt(p.cantidad) : p.cantidad.toFixed(1)}</td><td style="text-align:right">$${p.dolares.toFixed(2)}</td></tr>`).join('');
    const bloqueProductos = prodsOrdenados.length ? `
      <div class="prod-box">
        <div class="prod-title">PRODUCTOS VENDIDOS</div>
        <table class="prod-table">
          <thead><tr><th>Producto</th><th style="text-align:right">Cant.</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>
            ${filasProductosPdf}
            <tr class="prod-subtotal"><td>SUBTOTAL</td><td style="text-align:right">${totalCantidadProd % 1 === 0 ? parseInt(totalCantidadProd) : totalCantidadProd.toFixed(1)}</td><td style="text-align:right">$${totalDolaresProd.toFixed(2)}</td></tr>
          </tbody>
        </table>
      </div>` : '';
    return `<div class="ruta-block">
      <div class="ruta-header"><span>${escHTML(nombre)}</span><span style="color:${totalEntregar>=0?'#0f7c38':'#a93226'}">$${totalEntregar.toFixed(2)}</span></div>
      <div class="ruta-linea"><span>Ventas al contado</span><b>$${d.ventasContado.toFixed(2)}</b></div>
      <div class="ruta-linea"><span>Pagos cobrados en efectivo</span><b>$${d.pagosEfectivo.toFixed(2)}</b></div>
      <div class="ruta-linea"><span>Gastos de la ruta</span><b>$${d.gastos.toFixed(2)}</b></div>
      <div class="pasos-box">
        <div class="pasos-title">TOTAL A ENTREGAR — PASO A PASO</div>
        <div class="ruta-linea"><span>(Ruta) Ventas totales</span><span>$${totalRuta.toFixed(2)}</span></div>
        <div class="ruta-linea"><span>+ Pagos</span><span>$${totalPagosAsesor.toFixed(2)}</span></div>
        <div class="ruta-linea" style="font-weight:700"><span>= Total de Ingresos</span><span>$${totalIngresos.toFixed(2)}</span></div>
        <div class="ruta-linea"><span>− Créditos</span><span>$${creditos.toFixed(2)}</span></div>
        <div class="ruta-linea"><span>− Gastos</span><span>$${d.gastos.toFixed(2)}</span></div>
        <div class="ruta-linea"><span>− Transferencias</span><span>$${transferencias.toFixed(2)}</span></div>
        <div class="ruta-linea"><span>− Cheques</span><span>$${cheques.toFixed(2)}</span></div>
        ${sinClasificar>0?`<div class="ruta-linea"><span>− Sin clasificar</span><span>$${sinClasificar.toFixed(2)}</span></div>`:''}
        <div class="ruta-linea total-entregar"><span>Total a Entregar</span><span style="color:${totalEntregar>=0?'#0f7c38':'#a93226'}">$${totalEntregar.toFixed(2)}</span></div>
      </div>
      ${await _htmlEntregaPrintDeAsesorAsync(nombre, totalEntregar)}
      ${bloqueProductos}
    </div>`;
  }));
  const bloquesHtml = bloques.join('');
  const v = window.open('', '_blank', 'width=900,height=900');
  // [NEW] URL absoluta del logo — esta ventana se abre en blanco, sin el
  // dashboard como base, así que una ruta relativa no cargaría. Mismo patrón
  // que ya se usa en Pagos y Gastos / Detalle de Pedidos.
  const logoUrl = location.origin + '/logo-luanaqua.png';
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Liquidación de Efectivo — ${asesorLabel} — Aqua Luan — ${fecha}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#1a3a5c;}
    .print-header p{font-size:11px;color:#888;margin-top:3px;}
    .ruta-block{background:#f0f5f8;border-radius:8px;margin-bottom:14px;padding:12px 14px;}
    .ruta-header{display:flex;justify-content:space-between;font-weight:800;font-size:14px;margin-bottom:8px;color:#1a3a5c;}
    .ruta-linea{display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:#1a3a5c;}
    .pasos-box{background:#f8fafc;border:1px solid #d2dae2;border-radius:6px;margin-top:8px;padding:8px 10px;font-size:11.5px;}
    .pasos-title{font-size:9px;font-weight:800;letter-spacing:0.08em;color:#0f7c38;margin-bottom:6px;}
    .total-entregar{border-top:1px solid #d2dae2;margin-top:4px;padding-top:6px;font-weight:800;font-size:13px;}
    .prod-box{background:#f8fafc;border:1px solid #d2dae2;border-radius:6px;margin-top:8px;padding:8px 10px;}
    .prod-title{font-size:9px;font-weight:800;letter-spacing:0.08em;color:#1a3a5c;margin-bottom:6px;}
    .prod-table{width:100%;border-collapse:collapse;font-size:11px;}
    .prod-table th{text-align:left;font-size:9px;font-weight:800;letter-spacing:0.04em;color:#888;padding:3px 4px;border-bottom:1px solid #d2dae2;}
    .prod-table td{padding:3px 4px;border-bottom:1px solid #e6ebf0;}
    .prod-table tr:last-child td{border-bottom:none;}
    .prod-subtotal td{font-weight:800;border-top:1px solid #d2dae2;padding-top:5px;}
    .total-general{background:#1a3a5c;border-radius:10px;padding:14px 18px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;}
    .total-general span:first-child{font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.6);}
    .total-general span:last-child{font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#4ec9a0;}
    .firmas-box{display:flex;justify-content:space-between;align-items:flex-end;gap:36px;margin-top:64px;padding:0 8px;}
    .firma-linea{flex:1;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1a3a5c;}
    .firma-linea .raya{border-top:1px solid #1a3a5c;margin:0 auto 8px;width:90%;height:36px;}
    @media print{body{padding:12px;}}
  </style></head><body>
  <div class="print-header">
    <img src="${logoUrl}" alt="Aqua Luan" onerror="this.style.display='none'">
    <div>
      <h1>LIQUIDACIÓN DE EFECTIVO — ${escHTML(asesorLabel)}</h1>
      <p>Fecha: ${fecha} · Generado: ${new Date().toLocaleString('es-EC')} · Impreso por: Liquidadora${(ADMIN_ACTUAL && (ADMIN_ACTUAL.nombre || ADMIN_ACTUAL.usuario)) ? ' · ' + escHTML(ADMIN_ACTUAL.nombre || ADMIN_ACTUAL.usuario) : ''}</p>
    </div>
  </div>
  ${bloquesHtml || '<p style="color:#888;font-style:italic">No hay ventas, pagos ni gastos registrados en este período.</p>'}
  <div class="total-general">
    <span>TOTAL EFECTIVO A ENTREGAR HOY</span>
    <span>$${totalGeneral.toFixed(2)}</span>
  </div>
  <div class="firmas-box">
    <div class="firma-linea"><div class="raya">&nbsp;</div>Firma Liquidadora</div>
    <div class="firma-linea"><div class="raya">&nbsp;</div>Firma Asesor</div>
    <div class="firma-linea"><div class="raya">&nbsp;</div>Firma Ayudante</div>
  </div>
  <script>
    /* [FIX] Antes esto dependía 100% de window.onload, que espera a que cargue
       TODO — incluida la fuente externa de Google Fonts. Con señal débil/inestable,
       esa petición externa puede quedarse esperando indefinidamente y el print()
       nunca se dispara: la pestaña se queda "cargando" para siempre, dando la
       sensación de que la app se congeló. Ahora se imprime con lo primero que
       ocurra: la carga completa, o un máximo de 1.2s de espera. */
    var _impresoLiquidacion=false;
    function _intentarImprimirLiquidacion(){ if(_impresoLiquidacion)return; _impresoLiquidacion=true; window.print(); }
    window.onload=_intentarImprimirLiquidacion;
    setTimeout(_intentarImprimirLiquidacion,180);
  <\/script>
  </body></html>`);
  v.document.close();
  _dispararImpresion(v);
}

/* [NEW] Inventario — entradas y salidas, en vivo */
let _unsubInventario=null, _movimientosInvRaw=[];
function _iniciarListenerInventario(){
  if(_unsubInventario){_unsubInventario();_unsubInventario=null;}
  // [NOTA] A diferencia de Eliminados/Roles, aquí NO se limita la lectura:
  // el "Stock Actual" se calcula sumando TODOS los movimientos históricos
  // de cada producto, así que limitar a los últimos 200 dañaría ese cálculo
  // para productos con más movimientos que eso. Se deja completo a propósito.
  _unsubInventario = db.collection('inventarioMovimientos').onSnapshot(snap => {
    _movimientosInvRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a,b) => (b.creadoEn?.toMillis?.()||0) - (a.creadoEn?.toMillis?.()||0));
    renderInventario();
  }, err => console.error('listener inventario:', err));
}
function detenerListenerInventario(){ if(_unsubInventario){_unsubInventario();_unsubInventario=null;} }

/* [NEW] Roles de Pago — historial de roles ya generados, en vivo */
let _unsubRolesHist=null, _rolesConfig={};
function _iniciarListenerRolesHistorial(){
  if(_unsubRolesHist){_unsubRolesHist();_unsubRolesHist=null;}
  // [NEW] Limitado a los 150 roles más recientes — la tabla ya solo
  // mostraba 100, y a diferencia de Inventario esta lista no calcula
  // ningún total acumulado, así que limitar aquí es seguro.
  _unsubRolesHist = db.collection('rolesPago').orderBy('creadoEn','desc').limit(150).onSnapshot(snap => {
    const roles = snap.docs.map(d => d.data()).sort((a,b) => (b.creadoEn?.toMillis?.()||0) - (a.creadoEn?.toMillis?.()||0));
    const tbody = document.getElementById('tablaRolesHistorial');
    if (!tbody) return;
    tbody.innerHTML = roles.length ? roles.slice(0,100).map(r => `<tr>
        <td style="font-size:12px">${r.periodoDesde||'-'} → ${r.periodoHasta||'-'}</td>
        <td style="font-weight:600">${r.asesorNombre||'-'}</td>
        <td style="text-align:right;font-weight:700;color:var(--teal)">$${(r.totalPagado||0).toFixed(2)}</td>
        <td style="font-size:12px">${r.generadoPor||'-'}</td>
        <td style="font-size:12px;color:var(--muted)">${r.fechaGeneracion||'-'}</td>
      </tr>`).join('') : '<tr><td colspan="5"><div class="empty-state"><div class="icon">📋</div>Sin roles generados aún</div></td></tr>';
  }, err => console.error('listener roles:', err));
}
function detenerListenerRolesHistorial(){ if(_unsubRolesHist){_unsubRolesHist();_unsubRolesHist=null;} }

function iniciar() {
  const hoy = fechaHoy();
  document.getElementById('filtroFecha').value = hoy;
  document.getElementById('filtroFechaHasta').value = hoy;
  _topeFechaHoy();
  iniciarListenersDashboard(); // [NEW] tiempo real — reemplaza el polling cada 60s
  _iniciarListenerAsesoresDash(); // [NEW] filtro de asesor real, en vivo
  _iniciarListenerProductosDash(); // [NEW] catálogo de productos para el modal Editar Pedido
  if (ROL_ACTUAL === 'admin') { // [NEW] Secretaria no tiene permiso de lectura en estas colecciones — ni falta que le hace, sus pestañas están ocultas
    poblarSelectEliminarSecretaria(); // [NEW]
    // [NEW] _iniciarListenerEliminados/Inventario/RolesHistorial/PedidosWeb ya
    // NO se llaman aquí — ahora cargan solo la primera vez que el admin entra
    // a esa pestaña (ver switchSeccionDash), para que el login sea más rápido.
  }
  document.getElementById('invFecha').value = hoy; // [NEW]
  document.getElementById('rolesDesde').value = hoy; // [NEW]
  document.getElementById('rolesHasta').value = hoy; // [NEW]
  aplicarRestriccionesRol(); // [NEW]
}
/* [NEW] Oculta las secciones y botones que son solo para Admin cuando entra Secretaria */
function aplicarRestriccionesRol(){
  const esSecretaria = ROL_ACTUAL === 'secretaria';
  document.querySelectorAll('.dash-nav-item').forEach(el => {
    const sec = el.dataset.section;
    if (!sec) return;
    el.style.display = (esSecretaria && !SECCIONES_SECRETARIA.includes(sec)) ? 'none' : '';
  });
  const tabRutas = document.getElementById('tabRutas');
  if (tabRutas) tabRutas.style.display = esSecretaria ? 'none' : '';
  document.querySelectorAll('.btn-cierre-dia').forEach(btn => {
    const t = (btn.textContent || '');
    if (t.includes('Cierre') || t.includes('Contraseña')) btn.style.display = esSecretaria ? 'none' : '';
  });
  const btnPass = document.getElementById('btnMiPassword');
  if (btnPass) btnPass.style.display = esSecretaria ? 'none' : '';
  /* Secretaria sí puede Editar/Guardar Movimientos Bancarios, igual que Administración. */
  pintarUsuarioHeader();
  if (esSecretaria) {
    switchTab('dashboard');
    const activa = document.querySelector('.dash-section.active');
    const activaId = activa && activa.id ? activa.id.replace('seccion-','') : '';
    if (!SECCIONES_SECRETARIA.includes(activaId)) switchSeccionDash('pedidos');
  }
}
function fechaHoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _isoFechaDash(valor, ts){
  const raw = String(valor||'').trim();
  if(raw){
    const iso = raw.slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if(m) return m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');
  }
  if(ts && typeof ts.toDate === 'function'){
    const d = ts.toDate();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  if(ts instanceof Date && !isNaN(ts)){
    return ts.getFullYear()+'-'+String(ts.getMonth()+1).padStart(2,'0')+'-'+String(ts.getDate()).padStart(2,'0');
  }
  return '';
}
function _estaEnRangoFiltroDash(fechaValor, ts){
  const hoy = (typeof _topeFechaHoy === 'function') ? _topeFechaHoy() : fechaHoy();
  const desde = document.getElementById('filtroFecha')?.value || '';
  let hasta = document.getElementById('filtroFechaHasta')?.value || hoy;
  if(!hasta || hasta > hoy) hasta = hoy;
  const f = _isoFechaDash(fechaValor, ts);
  if(!f) return false;
  if(desde && f < desde) return false;
  if(hasta && f > hasta) return false;
  return true;
}
function _esRegistroDeHoy(fecha){
  const raw = String(fecha||'').trim();
  if(!raw) return false;
  const iso = raw.slice(0,10);
  return iso === fechaHoy();
}
function _btnEliminarSiHoy(fecha, htmlEliminar){
  return _esRegistroDeHoy(fecha) ? htmlEliminar : '';
}
function _topeFechaHoy(){
  const hoy = fechaHoy();
  const f = document.getElementById('filtroFecha');
  const h = document.getElementById('filtroFechaHasta');
  [f,h].forEach(el => { if(el) el.max = hoy; });
  if (h && h.value && h.value > hoy) h.value = hoy;
  if (f && f.value && f.value > hoy) f.value = hoy;
  if (f && h && f.value && h.value && f.value > h.value) f.value = h.value;
  return hoy;
}

/* [FIX] Convierte "7:59:52 p. m." / "8:00 a. m." / "19:59:52" a minutos desde medianoche (0-1439).
   Devuelve NaN si el texto no tiene un formato de hora reconocible. */
function horaAMinutos(str) {
  if (!str) return NaN;
  const s = String(str).trim();
  const m12 = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*\.?\s*m\.?/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = parseInt(m12[2], 10);
    const ampm = m12[4].toLowerCase();
    if (ampm === 'p' && h !== 12) h += 12;
    if (ampm === 'a' && h === 12) h = 0;
    if (isNaN(h) || isNaN(min)) return NaN;
    return h * 60 + min;
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (!isNaN(h) && !isNaN(min)) return h * 60 + min;
  }
  return NaN;
}

/* ════════════════════════════════════════
   CARGAR DATOS
════════════════════════════════════════ */
/* ════════════════════════════════════════
   [NEW] FIRESTORE — Fase 2: datos en tiempo real
   Construye filas con el MISMO formato que antes venía de Google Sheets
   (FECHA, ASESOR / RUTA, CLIENTE, PRODUCTO, TOTAL PEDIDO ($), etc.) para
   que el resto del dashboard (tablas, gráficos, Cierre del Día, exportar
   PDF) siga funcionando sin tener que reescribirlo.
════════════════════════════════════════ */
let _pedidosRaw = [], _pagosRaw = [], _gastosRaw = [];
let _unsubPedidosAll = null, _unsubPagosAll = null, _unsubGastosAll = null;

function _horaDeTs(ts) {
  try { const ms = ts?.toMillis ? ts.toMillis() : Date.now(); return new Date(ms).toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
  catch { return ''; }
}
function _filaProducto(p, prod, esPrimera, esRegalo) {
  // [FIX] NUEVO FORMATO DE PAGO MÚLTIPLE — index.html ahora permite marcar varias
  // formas de pago a la vez (ej. Contado $20 + Transferencia $30) y ya NO guarda el
  // campo 'abono'; en su lugar guarda 'pagos' (array [{forma,monto}, ...]) y
  // 'creditoPendiente' (el saldo que no cubrió ninguna forma marcada). formapago pasa
  // a valer 'Mixto' cuando se combinan formas o queda saldo, en vez de un solo nombre.
  // Se calcula aquí un único campo CREDITO_PENDIENTE, válido para pedidos viejos
  // (con 'abono') y nuevos (con 'pagos'), para que Deuda Vigente y demás cálculos de
  // crédito no dependan de comparar el string de FORMA DE PAGO contra 'Crédito' —
  // comparación que se rompía en cuanto formapago valía 'Mixto'.
  let creditoPendienteCalc = 0;
  if (esPrimera) {
    if (p.pagos !== null && p.pagos !== undefined) {
      // Pedido nuevo (pago múltiple): el saldo a crédito ya viene calculado.
      creditoPendienteCalc = parseFloat(p.creditoPendiente || 0);
    } else {
      // Pedido viejo (formato anterior con 'abono' único o sin abono).
      const totNum = parseFloat(p.total) || 0;
      const abonoNum = parseFloat(p.abono || 0);
      if (abonoNum > 0 && abonoNum < totNum) creditoPendienteCalc = totNum - abonoNum;
      else if (abonoNum <= 0 && p.formapago === 'Crédito') creditoPendienteCalc = totNum;
    }
  }
  return {
    'FECHA': p.fecha || '', 'ASESOR / RUTA': p.empleado || '', 'CLIENTE': p.cliente || '',
    'TELÉFONO': p.telefono || '', 'DIRECCIÓN': p.direccion || '',
    'PRODUCTO': esRegalo ? `🎁 REGALO: ${prod.nombre || ''}` : (prod.nombre || ''),
    'CANTIDAD': prod.cantidad != null ? prod.cantidad : '',
    'PRECIO UNIT.': esRegalo ? 0 : (prod.precio != null ? prod.precio : ''),
    'SUBTOTAL': esRegalo ? 0 : (prod.subtotal != null ? prod.subtotal : ''),
    'TOTAL PEDIDO ($)': esPrimera ? (parseFloat(p.total) || 0) : '',
    'ABONO': esPrimera ? (parseFloat(p.abono) || 0) : '', // [LEGACY] solo tiene valor real en pedidos viejos
    'CREDITO_PENDIENTE': esPrimera ? creditoPendienteCalc : '', // [NEW] válido para pedidos viejos y nuevos
    'PAGOS_DESGLOSE': esPrimera ? (p.pagos || null) : null, // [NEW] desglose crudo del pago múltiple, para mostrarlo en el detalle
    'FORMA DE PAGO': p.formapago || '', 'LINK GPS': (p.gps && p.gps.url) ? p.gps.url : '', 'NOTAS': p.notas || '',
    'LATITUD': (p.gps && p.gps.lat != null) ? p.gps.lat : '', 'LONGITUD': (p.gps && p.gps.lng != null) ? p.gps.lng : '',
    'PRECISIÓN GPS': (p.gps && p.gps.acc != null) ? `±${p.gps.acc}m` : '',
    'HORA REGISTRO': _horaDeTs(p.creadoEn),
    '_pedidoId': p._id || '' /* [NEW] id real del documento en Firestore — necesario para poder editarlo */
  };
}
function _expandirPedido(p) {
  const filas = []; let primera = true;
  (p.productos || []).forEach(prod => {
    filas.push(_filaProducto(p, prod, primera, false));
    primera = false;
    (prod.regalias || []).forEach(reg => { filas.push(_filaProducto(p, reg, false, true)); });
  });
  return filas;
}
// [FIX] LA PANTALLA SE CONGELABA porque los 3 listeners de arriba (pedidos,
// pagos, gastos) son independientes: cuando se guarda una venta con abono
// parcial (que escribe en 'pedidos' Y 'pagos' casi al mismo tiempo), o cuando
// varios de los ~14 cobradores registran pedidos en la misma ventana de
// segundos, cada listener llamaba a _recalcularTodosLosDatos() por su cuenta
// — y esa función reconstruye TODO de forma síncrona (KPIs, 3 gráficos
// Chart.js con destroy()+new Chart(), tablas, resumen de clientes, cuadre de
// caja, reporte por asesor). Dos o tres de esos renders pesados encadenados
// en milisegundos bloqueaban el hilo principal del navegador y se sentían
// como que "se congela la pantalla". Ahora los listeners llaman a esta
// versión debounced, que agrupa ráfagas de cambios en una sola recarga.
let _recalcDebounceTimer = null;
function _recalcularTodosLosDatosDebounced() {
  if (_recalcDebounceTimer) clearTimeout(_recalcDebounceTimer);
  // [FIX] Ventana ampliada de 250ms a 800ms: con 5 asesores activos a la vez,
  // 250ms agrupaba solo ráfagas muy pegadas (ej. un mismo pedido con abono que
  // escribe en 2 colecciones); 800ms agrupa mejor también cuando 2-3 asesores
  // distintos guardan casi al mismo tiempo pero no en el mismo instante exacto,
  // sin que el retraso se note para quien mira el Dashboard.
  _recalcDebounceTimer = setTimeout(() => { _recalcDebounceTimer = null; _recalcularTodosLosDatos(); }, 800);
}
function _recalcularTodosLosDatos() {
  let filas = [];
  _pedidosRaw.forEach(p => { filas = filas.concat(_expandirPedido(p)); });
  _pagosRaw.forEach(pg => filas.push({
    'FECHA': pg.fecha || '', 'ASESOR / RUTA': pg.empleado || '', 'CLIENTE': pg.cliente || '',
    'TELÉFONO': '', 'DIRECCIÓN': '', 'PRODUCTO': '', 'CANTIDAD': '', 'PRECIO UNIT.': '', 'SUBTOTAL': '',
    'TOTAL PEDIDO ($)': parseFloat(pg.monto) || 0, 'FORMA DE PAGO': pg.forma || '', 'LINK GPS': '', 'NOTAS': pg.notas || '',
    '_pagoId': pg._id || '' /* [NEW] */
  }));
  _gastosRaw.forEach(g => filas.push({
    'FECHA': g.fecha || '', 'ASESOR / RUTA': g.empleado || '', 'CLIENTE': '',
    'TELÉFONO': '', 'DIRECCIÓN': '', 'PRODUCTO': '', 'CANTIDAD': '', 'PRECIO UNIT.': '', 'SUBTOTAL': '',
    'TOTAL PEDIDO ($)': -(parseFloat(g.monto) || 0), 'FORMA DE PAGO': '', 'LINK GPS': '', 'NOTAS': g.desc || g.categoria || '',
    '_gastoId': g._id || '' /* [NEW] */
  }));
  todosLosDatos = filas;
  renderDashboard();
  // [FIX] Antes esto llamaba a renderLiquidacionDash() SIN CONDICIÓN, en cada
  // cambio de cualquier pedido/pago/gasto de todo el sistema — con varios
  // asesores trabajando en tiempo real, eso significaba recalcular y redibujar
  // esa sección constantemente durante todo el día, aunque nadie la estuviera
  // viendo. Ahora solo se actualiza si esa pestaña está realmente abierta.
  const seccionLiquidacionVisible = document.getElementById('seccion-liquidacionDash')?.classList.contains('active');
  if (seccionLiquidacionVisible && typeof renderLiquidacionDash === 'function') renderLiquidacionDash();
  // [NEW] misma lógica de refresco perezoso para Cierre del Día — antes solo se
  // actualizaba al ENTRAR a la pestaña, no al cambiar el filtro de fecha estando ya adentro
  const seccionCierreDelDiaVisible = document.getElementById('seccion-cierreDelDia')?.classList.contains('active');
  if (seccionCierreDelDiaVisible && typeof renderCierreDelDia === 'function') renderCierreDelDia();
  // [NEW] misma lógica de refresco perezoso para la sección independiente de Notas Adicionales
  const seccionNotasAdicionalesVisible = document.getElementById('seccion-notasAdicionalesDash')?.classList.contains('active');
  if (seccionNotasAdicionalesVisible && typeof renderNotasAdicionalesDash === 'function') renderNotasAdicionalesDash();
  const seccionMovBancVisible = document.getElementById('seccion-movimientosBancarios')?.classList.contains('active');
  if (seccionMovBancVisible && typeof renderMovimientosBancarios === 'function') renderMovimientosBancarios();
  const seccionCobranzasVisible = document.getElementById('seccion-cobranzasClientes')?.classList.contains('active');
  if (seccionCobranzasVisible && typeof renderCobranzasClientes === 'function') renderCobranzasClientes();
  if (typeof renderTablaEliminados === 'function') renderTablaEliminados();
  if (typeof renderTablaAuditoria === 'function') renderTablaAuditoria();
  if (document.getElementById('viewRutas')?.classList.contains('active') && typeof aplicarRutas === 'function') {
    const fecha = document.getElementById('rutasFecha')?.value || '';
    const asesor = document.getElementById('rutasAsesor')?.value || '';
    if (typeof renderRutasDia === 'function') renderRutasDia(fecha, asesor);
  }
  document.getElementById('lastUpdate').textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit' });
}
function iniciarListenersDashboard() {
  if (_unsubPedidosAll) _unsubPedidosAll();
  if (_unsubPagosAll) _unsubPagosAll();
  if (_unsubGastosAll) _unsubGastosAll();
  document.getElementById('kpiGrid').innerHTML = '<div class="loading"><div class="spinner"></div><span>Cargando datos...</span></div>';
  /* [FIX] Antes esto traía TODA la colección completa (todos los pedidos/pagos/gastos
     de toda la historia), sin importar el filtro de fecha elegido arriba -- por eso el
     Dashboard se ponía cada vez más lento a medida que se acumulaban más registros con
     el tiempo. Ahora arma la consulta según el rango Desde/Hasta seleccionado, así solo
     se descarga y procesa lo que realmente hace falta mostrar. El botón "Todo" sigue
     funcionando igual: al dejar ambos campos vacíos, no se agrega ningún .where() de
     fecha y se trae el histórico completo, como antes (esperable que tarde más, porque
     ahí sí se está pidiendo todo a propósito). */
  const hoyTop = _topeFechaHoy();
  const desde = document.getElementById('filtroFecha').value;
  let hasta = document.getElementById('filtroFechaHasta').value || hoyTop;
  if (!hasta || hasta > hoyTop) hasta = hoyTop;
  if (document.getElementById('filtroFechaHasta') && !document.getElementById('filtroFechaHasta').disabled) {
    document.getElementById('filtroFechaHasta').value = hasta;
  }
  let qPedidos = db.collection('pedidos'), qPagos = db.collection('pagos'), qGastos = db.collection('gastos');
  if (desde) { qPedidos = qPedidos.where('fecha','>=',desde); qPagos = qPagos.where('fecha','>=',desde); qGastos = qGastos.where('fecha','>=',desde); }
  qPedidos = qPedidos.where('fecha','<=',hasta); qPagos = qPagos.where('fecha','<=',hasta); qGastos = qGastos.where('fecha','<=',hasta);
  _unsubPedidosAll = qPedidos.onSnapshot(snap => {
    /* [FIX] Se quitó el orderBy('creadoEn','desc') del lado de Firestore — ese ordenamiento
       EXCLUÍA por completo cualquier pedido que aún no tuviera confirmado su creadoEn en el
       servidor (típico de pedidos guardados offline mientras terminan de sincronizar),
       haciendo que desaparecieran de TODO el dashboard, no solo de "Detalle de Pedidos".
       Ahora el orden "más reciente primero" se hace aquí, del lado del navegador, sobre TODOS
       los documentos recibidos — nadie se excluye, solo se ordenan. */
    _pedidosRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a,b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
    _recalcularTodosLosDatosDebounced(); // [FIX] ver comentario en la función
  }, err => { console.error('listener pedidos:', err); document.getElementById('kpiGrid').innerHTML = '<div class="loading"><span>⚠️ Error al cargar datos: '+err.message+'</span></div>'; }); /* [FIX] _id agregado — antes no se guardaba el id del documento, y sin él no era posible editar un pedido puntual */
  _unsubPagosAll   = qPagos.onSnapshot(snap => { _pagosRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() })); _recalcularTodosLosDatosDebounced(); }, err => console.error('listener pagos:', err)); /* [NEW] _id agregado para poder editar/eliminar */
  _unsubGastosAll  = qGastos.onSnapshot(snap => { _gastosRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() })); _recalcularTodosLosDatosDebounced(); }, err => console.error('listener gastos:', err)); /* [NEW] _id agregado para poder editar/eliminar */
}
function detenerListenersDashboard() {
  if (_unsubPedidosAll) { _unsubPedidosAll(); _unsubPedidosAll = null; }
  if (_unsubPagosAll)   { _unsubPagosAll();   _unsubPagosAll   = null; }
  if (_unsubGastosAll)  { _unsubGastosAll();  _unsubGastosAll  = null; }
}
/* Botón "Actualizar" — con listeners en tiempo real los datos ya están al día,
   así que solo forzamos un re-render inmediato con lo último recibido. */
async function cargarDatos(mostrarSpinner = true) {
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('spin-icon');
  _recalcularTodosLosDatos();
  setTimeout(() => { if (icon) icon.classList.remove('spin-icon'); }, 500);
}

/* ════════════════════════════════════════
   FILTROS DASHBOARD
════════════════════════════════════════ */
function filtrarHoy() { const hoy = fechaHoy(); document.getElementById('filtroFecha').value = hoy; document.getElementById('filtroFechaHasta').value = hoy; if(typeof _sincronizarFechaRutasConDashboard==='function') _sincronizarFechaRutasConDashboard(); iniciarListenersDashboard(); }
function limpiarFiltro() { document.getElementById('filtroFecha').value = ''; document.getElementById('filtroFechaHasta').value = fechaHoy(); if (document.getElementById('filtroAsesor')) document.getElementById('filtroAsesor').value = ''; _productoFiltroSeleccionado = ''; iniciarListenersDashboard(); }
/* [NEW] Texto legible del rango de fecha actualmente filtrado, para usar en encabezados de PDF */
function _textoRangoFecha() {
  const desde = document.getElementById('filtroFecha').value;
  const hasta = document.getElementById('filtroFechaHasta').value;
  if (!desde && !hasta) return 'Todos los registros';
  if (desde && hasta && desde !== hasta) return `${desde} a ${hasta}`;
  return desde || hasta;
}
function getDatosFiltrados() {
  const desde = document.getElementById('filtroFecha').value;
  const hasta = document.getElementById('filtroFechaHasta').value;
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  let datos = todosLosDatos;
  if (desde) datos = datos.filter(r => String(r['FECHA'] || r['fecha'] || '') >= desde);
  if (hasta) datos = datos.filter(r => String(r['FECHA'] || r['fecha'] || '') <= hasta);
  if (asesorSel) datos = datos.filter(r => (r['ASESOR / RUTA']||'') === asesorSel);
  return datos;
}
/* [NEW] Igual que getDatosFiltrados() pero SIN el filtro de asesor — para que "Reporte
   por Asesor" siempre pueda mostrar todas las tarjetas, sin importar qué asesor esté
   seleccionado arriba en el filtro general del dashboard. */
function getDatosSoloFecha() {
  const desde = document.getElementById('filtroFecha').value;
  const hasta = document.getElementById('filtroFechaHasta').value;
  let datos = todosLosDatos;
  if (desde) datos = datos.filter(r => String(r['FECHA'] || r['fecha'] || '') >= desde);
  if (hasta) datos = datos.filter(r => String(r['FECHA'] || r['fecha'] || '') <= hasta);
  return datos;
}

/* ════════════════════════════════════════
   RENDER DASHBOARD
════════════════════════════════════════ */
function renderDashboard() {
  const datos = getDatosFiltrados();
  const pedidos = datos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== '');
  const pagos   = datos.filter(r => !r['PRODUCTO'] && r['TOTAL PEDIDO ($)'] > 0 && String(r['TOTAL PEDIDO ($)']).indexOf('-') === -1);
  const gastos  = datos.filter(r => String(r['TOTAL PEDIDO ($)']).indexOf('-') !== -1);
  const pedidosConTotal = pedidos.filter(r => r['TOTAL PEDIDO ($)'] && parseFloat(r['TOTAL PEDIDO ($)']) > 0);
  const totalReal   = pedidosConTotal.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalPagos  = pagos.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalGastos = gastos.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const clientesUnicos = new Set(pedidos.map(r => r['CLIENTE'])).size;
  const pedidosUnicos  = new Set(pedidos.map(r => r['_pedidoId'] || `${r['CLIENTE']}-${r['FECHA']}-${r['ASESOR / RUTA']}`)).size; // [FIX] usa el ID real del pedido cuando existe, para no fusionar 2 pedidos distintos del mismo cliente el mismo día
  const ventasPorAsesor = {};
  pedidosConTotal.forEach(r => { const a = r['ASESOR / RUTA'] || 'Sin asignar'; ventasPorAsesor[a] = (ventasPorAsesor[a]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const asesorTop = Object.entries(ventasPorAsesor).sort((a,b) => b[1]-a[1])[0];
  // [FIX] "Total en caja" usaba (Total cobrado − Total gastos), pero "Total cobrado"
  // solo suma la colección de Pagos (abonos/cobros aparte) — nunca incluía las
  // Ventas al Contado del día, así que si la mayoría de ventas eran a Crédito,
  // esta tarjeta daba negativo aunque sí hubiera efectivo real entrando por
  // ventas al contado. Ahora reutiliza el mismo cálculo ya correcto de
  // Liquidación (Ventas al Contado + Pagos en Efectivo − Gastos, con el ajuste
  // de abonos parciales) sumado entre todos los asesores, para que ambas
  // pantallas coincidan siempre.
  const totalCajaReal = Object.values(_calcularLiquidacionDash())
    .reduce((s,d) => s + _valorAEntregarRuta(d), 0);
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-card teal"><div class="kpi-icon">💰</div><div class="kpi-label">Total ventas</div><div class="kpi-value">$${totalReal.toFixed(2)}</div><div class="kpi-sub">${pedidosUnicos} pedido(s)</div></div>
    <div class="kpi-card blue"><div class="kpi-icon">💳</div><div class="kpi-label">Total cobrado</div><div class="kpi-value">$${totalPagos.toFixed(2)}</div><div class="kpi-sub">${pagos.length} pago(s)</div></div>
    <div class="kpi-card red"><div class="kpi-icon">📉</div><div class="kpi-label">Total gastos</div><div class="kpi-value">$${totalGastos.toFixed(2)}</div><div class="kpi-sub">${gastos.length} gasto(s)</div></div>
    <div class="kpi-card orange"><div class="kpi-icon">👥</div><div class="kpi-label">Clientes atendidos</div><div class="kpi-value">${clientesUnicos}</div><div class="kpi-sub">${pedidosUnicos} pedido(s)</div></div>
    <div class="kpi-card navy"><div class="kpi-icon">🏆</div><div class="kpi-label">Asesor top</div><div class="kpi-value" style="font-size:1rem">${asesorTop ? asesorTop[0].split(':')[1]?.trim()||asesorTop[0] : '—'}</div><div class="kpi-sub">${asesorTop ? '$'+asesorTop[1].toFixed(2) : 'Sin datos'}</div></div>
    <div class="kpi-card accent"><div class="kpi-icon">📦</div><div class="kpi-label">Líneas de producto</div><div class="kpi-value">${pedidos.length}</div><div class="kpi-sub">unidades registradas</div></div>
    <div class="kpi-card navy"><div class="kpi-icon">🧮</div><div class="kpi-label">Total en caja</div><div class="kpi-value" style="color:${totalCajaReal>=0?'#0a7c6e':'#c0392b'}">$${totalCajaReal.toFixed(2)}</div><div class="kpi-sub">Contado + Cobrado efectivo − Gastos</div></div>
  `;
  // [FIX] Los 3 gráficos (Chart.js) son la parte más pesada de esta función —
  // destruyen y vuelven a crear 3 canvas cada vez que llega cualquier cambio de
  // Firestore, aunque el admin esté viendo otra pestaña (Cuadre de Caja, Reporte
  // por Asesor, etc.) donde esos gráficos ni siquiera son visibles. Con varios
  // asesores registrando pedidos seguido, eso sumaba trabajo innecesario a cada
  // recálculo. Ahora solo se redibujan si "Resumen General" está realmente
  // activa; se guardan los datos en caché para poder redibujarlos al instante
  // (sin volver a filtrar/agrupar nada) apenas el admin entra a esa pestaña.
  _kpiPedidosCache = pedidos; _kpiPedidosConTotalCache = pedidosConTotal;
  const seccionResumenVisible = document.getElementById('seccion-resumen')?.classList.contains('active');
  if (seccionResumenVisible) renderCharts(pedidos, pedidosConTotal);
  pedidosDetalleActuales = pedidos;
  renderFiltroProductoSelect(pedidos); // [NEW] filtro por producto en Detalle de Pedidos
  _pedidosTablaFiltrados = _filtrarPorPagoChecklist(_filtrarPorProducto(pedidos));
  renderFiltroPagoDropdown(pedidos);
  renderTabla(_pedidosTablaFiltrados);
  // [FIX] LA PANTALLA SE CONGELABA con muchos clientes acumulados: renderResumenPorCliente()
  // arma una tarjeta HTML completa por cada cliente único, y poblarClienteSelect() calcula
  // sus estadísticas — ambas cosas corrían en CADA cambio de Firestore sin importar si el
  // admin estaba viendo "Resumen General" / "Consultar por Cliente" o cualquier otra
  // pestaña. Con cientos de clientes eso era trabajo pesado tirado a la basura la mayoría
  // del tiempo. Ahora, igual que con los gráficos, solo corren si esa pestaña está
  // realmente activa; los datos se guardan en caché para recalcularlos al instante apenas
  // el admin entra a la pestaña correspondiente.
  _resumenClientesPedidosCache = _pedidosTablaFiltrados;
  _clienteSelectPedidosCache = pedidos;
  if (seccionResumenVisible) renderResumenPorCliente(_pedidosTablaFiltrados);
  const seccionClienteVisible = document.getElementById('seccion-cliente')?.classList.contains('active');
  if (seccionClienteVisible) poblarClienteSelect(pedidos);
  renderPagosGastosDetalle(pagos, gastos); // [NEW]
  document.getElementById('chartsGrid').style.display = 'grid';
  document.getElementById('tableCard').style.display = 'block';
  document.getElementById('clienteCard').style.display = 'block';
  document.getElementById('pagosGastosCard').style.display = 'block'; // [NEW]
  const seccionReporteVisible = document.getElementById('seccion-reporteAsesor')?.classList.contains('active');
  if (seccionReporteVisible) renderReporteAsesores();
}

/* ════════════════════════════════════════
   [NEW] DETALLE DE PAGOS Y GASTOS
════════════════════════════════════════ */
let pagosDetalleActuales = [], gastosDetalleActuales = []; // [NEW] para exportar a PDF

function _puedeEditarCuadreCaja(fecha){
  if(ROL_ACTUAL!=='admin' && ROL_ACTUAL!=='secretaria') return false;
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const f=String(fecha||'').slice(0,10);
  if(!hoy) return ROL_ACTUAL==='admin' || ROL_ACTUAL==='secretaria';
  if(f && f>hoy) return false;
  return true;
}
function renderPagosGastosDetalle(pagos, gastos) {
  pagosDetalleActuales = pagos; gastosDetalleActuales = gastos; // [NEW]
  const puedeAlta=_puedeEditarCuadreCaja(document.getElementById('filtroFechaHasta')?.value||(typeof fechaHoy==='function'?fechaHoy():''));
  const btnNP=document.getElementById('btnNuevoPagoCaja');
  const btnNG=document.getElementById('btnNuevoGastoCaja');
  if(btnNP) btnNP.style.display=puedeAlta?'inline-flex':'none';
  if(btnNG) btnNG.style.display=puedeAlta?'inline-flex':'none';
  const totalPagos  = pagos.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalGastos = gastos.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const neto = totalPagos - totalGastos;

  // [NEW] Desglose por forma de pago (Efectivo / Transferencia / Cheque / etc.)
  const porForma = {};
  pagos.forEach(r => { const f = r['FORMA DE PAGO'] || 'Sin especificar'; porForma[f] = (porForma[f]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const iconoForma = { 'Efectivo':'💵','Transferencia':'🏦','Cheque':'📝','Contado':'💵','Crédito':'📋' };
  const tagsForma = Object.entries(porForma).sort(([,a],[,b]) => b-a).map(([f,v]) => `
    <span style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1.5px solid var(--border);border-radius:100px;padding:5px 14px;font-size:12px;font-weight:700;color:var(--navy)">${iconoForma[f]||'💳'} ${f}<span style="color:var(--blue);margin-left:2px">$${v.toFixed(2)}</span></span>`).join('');
  document.getElementById('resumenFormasPago').innerHTML = pagos.length
    ? `<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Desglose por forma de pago</div><div style="display:flex;flex-wrap:wrap;gap:8px">${tagsForma}</div>`
    : '';

  // [FIX] Se quitaron las tarjetas de Ingresos/Egresos/Total en Caja — ahora
  // Cuadre de Caja muestra directamente Pagos registrados y Gastos registrados.
  document.getElementById('resumenPgGrid').innerHTML = '';

  const tbodyPagos = document.getElementById('tablaPagosDetalle');
  if (!pagos.length) {
    tbodyPagos.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon">💳</div>No hay pagos en este período</div></td></tr>';
  } else {
    const filas = pagos.map(r => {
      const monto = parseFloat(r['TOTAL PEDIDO ($)'])||0;
      let pid = r['_pagoId'] || '';
      if(!pid && Array.isArray(_pagosRaw)){
        const hit=_pagosRaw.find(pg => String(pg.fecha||'')===String(r['FECHA']||'') && String(pg.cliente||'')===String(r['CLIENTE']||'') && Math.abs((parseFloat(pg.monto)||0)-monto)<0.009);
        if(hit) pid=hit._id||'';
      }
      const puedePago = pid && _puedeEditarCuadreCaja(r['FECHA']);
      const accionesPago = puedePago ? `<button class="btn-editar-fila" onclick="abrirEditarPago('${pid}')" title="Editar este pago">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarPagoDash('${pid}')" title="Eliminar este pago">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>';
      return `<tr>
        <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
        <td style="font-size:12px">${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
        <td><span class="badge badge-blue">${r['FORMA DE PAGO']||'-'}</span></td>
        <td style="font-size:11px;color:var(--muted);white-space:nowrap">${limpiarFecha(r['FECHA'])}</td>
        <td style="text-align:right;font-weight:700;color:var(--blue)">$${monto.toFixed(2)}</td>
        <td>${accionesPago}</td>
      </tr>`;
    }).join('');
    tbodyPagos.innerHTML = filas + `<tr style="background:#e8f0fd"><td colspan="4" style="text-align:right;font-weight:800;color:var(--blue)">SUBTOTAL PAGOS</td><td style="text-align:right;font-weight:800;color:var(--blue)">$${totalPagos.toFixed(2)}</td><td></td></tr>`;
  }

  const tbodyGastos = document.getElementById('tablaGastosDetalle');
  if (!gastos.length) {
    tbodyGastos.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="icon">📉</div>No hay gastos en este período</div></td></tr>';
  } else {
    const filas = gastos.map(r => {
      const monto = Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0);
      const desc = r['NOTAS'] || r['CLIENTE'] || r['DIRECCIÓN'] || '-'; // [NOTA] ver aviso más abajo sobre esta columna
      let gid = r['_gastoId'] || '';
      if(!gid && Array.isArray(_gastosRaw)){
        const hit=_gastosRaw.find(g => String(g.fecha||'')===String(r['FECHA']||'') && Math.abs((parseFloat(g.monto)||0)-monto)<0.009);
        if(hit) gid=hit._id||'';
      }
      const puedeGasto = gid && _puedeEditarCuadreCaja(r['FECHA']);
      const accionesGasto = puedeGasto ? `<button class="btn-editar-fila" onclick="abrirEditarGasto('${gid}')" title="Editar este gasto">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarGastoDash('${gid}')" title="Eliminar este gasto">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>';
      return `<tr>
        <td style="font-weight:600">${escHTML(desc)}</td>
        <td style="font-size:12px">${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
        <td style="font-size:11px;color:var(--muted);white-space:nowrap">${limpiarFecha(r['FECHA'])}</td>
        <td style="text-align:right;font-weight:700;color:var(--red)">$${monto.toFixed(2)}</td>
        <td>${accionesGasto}</td>
      </tr>`;
    }).join('');
    tbodyGastos.innerHTML = filas + `<tr style="background:#fdecea"><td colspan="3" style="text-align:right;font-weight:800;color:var(--red)">SUBTOTAL GASTOS</td><td style="text-align:right;font-weight:800;color:var(--red)">$${totalGastos.toFixed(2)}</td><td></td></tr>`;
  }
}

/* ════════════════════════════════════════
   CHARTS
════════════════════════════════════════ */
function renderCharts(pedidos, pedidosConTotal) {
  const ventasPorRuta = {};
  pedidosConTotal.forEach(r => { const ruta = (r['ASESOR / RUTA']||'Sin asignar').split(':')[1]?.trim() || r['ASESOR / RUTA']; ventasPorRuta[ruta] = (ventasPorRuta[ruta]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  if (charts.rutas) charts.rutas.destroy();
  charts.rutas = new Chart(document.getElementById('chartRutas').getContext('2d'), {
    type: 'bar',
    data: { labels: Object.keys(ventasPorRuta), datasets: [{ label:'Ventas ($)', data: Object.values(ventasPorRuta), backgroundColor:['#0a7c6e','#1565c0','#e67e22','#c0392b','#4ec9a0'], borderRadius:6 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true,ticks:{callback:v=>'$'+v,font:{size:11}},grid:{color:'rgba(0,0,0,0.05)'}}, x:{ticks:{font:{size:11}},grid:{display:false}} } }
  });
  // [FIX] Antes se mostraban solo los primeros 6 productos — ahora se incluyen
  // TODOS los productos vendidos en el período filtrado, sin límite.
  const cantPorProducto = {};
  pedidos.forEach(r => { const p=r['PRODUCTO']||''; if(p) cantPorProducto[p]=(cantPorProducto[p]||0)+(parseFloat(r['CANTIDAD'])||0); });
  const prodSorted = Object.entries(cantPorProducto).sort((a,b)=>b[1]-a[1]);
  if (charts.productos) charts.productos.destroy();
  charts.productos = new Chart(document.getElementById('chartProductos').getContext('2d'), {
    type:'doughnut',
    data:{ labels:prodSorted.map(([k])=>k.length>15?k.substring(0,15)+'…':k), datasets:[{ data:prodSorted.map(([,v])=>v), backgroundColor:['#0a7c6e','#1565c0','#e67e22','#c0392b','#4ec9a0','#1a3a5c','#8e44ad','#d35400','#16a085','#7f8c8d','#2c3e50','#f39c12'], borderWidth:2, borderColor:'#fff' }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:'right',labels:{font:{size:10},boxWidth:12,padding:8}} } }
  });
  const ventasPorHora = {};
  for(let h=7;h<=20;h++) ventasPorHora[h]=0;
  pedidosConTotal.forEach(r => {
    const minutos = horaAMinutos(r['HORA REGISTRO']);
    if(!isNaN(minutos)){ const h=Math.floor(minutos/60); if(h>=7&&h<=20) ventasPorHora[h]=(ventasPorHora[h]||0)+(parseFloat(r['TOTAL PEDIDO ($)'])||0); }
  });
  if (charts.horas) charts.horas.destroy();
  charts.horas = new Chart(document.getElementById('chartHoras').getContext('2d'), {
    type:'line',
    data:{ labels:Object.keys(ventasPorHora).map(h=>h+':00'), datasets:[{ label:'Ventas ($)', data:Object.values(ventasPorHora), borderColor:'#0a7c6e', backgroundColor:'rgba(10,124,110,0.08)', borderWidth:2.5, pointBackgroundColor:'#0a7c6e', pointRadius:4, tension:0.4, fill:true }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true,ticks:{callback:v=>'$'+v,font:{size:11}},grid:{color:'rgba(0,0,0,0.05)'}}, x:{ticks:{font:{size:11}},grid:{display:false}} } }
  });
}

function renderGPS(pedidos) {
  const container = document.getElementById('mapPoints');
  const conGPS = pedidos.filter(r => r['LINK GPS'] && r['LINK GPS'] !== '');
  if (!conGPS.length) { container.innerHTML = '<div class="map-empty">📍 No hay ubicaciones GPS registradas en este período.</div>'; return; }
  container.innerHTML = conGPS.map(r => `
    <a class="map-point" href="${r['LINK GPS']}" target="_blank">
      <div class="map-dot"></div>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--navy)">${escHTML(r['CLIENTE']||'-')}</div>
        <div style="font-size:10px;color:var(--muted)">${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||''} · ${r['FECHA']||''}</div>
      </div>
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="margin-left:auto;flex-shrink:0"><path d="M4 12L12 4M12 4H7M12 4v5" stroke="var(--teal)" stroke-width="1.5" stroke-linecap="round"/></svg>
    </a>
  `).join('');
}

/* [NEW] Filtro tipo checklist para "Pago" en Detalle de Pedidos.
   Opciones FIJAS: Contado, Crédito, Transferencia, Cheque.
   Se guarda como un Set de formas DESMARCADAS. Vacío = mostrar todo.
   Un pedido con varias formas aparece en cada filtro que le corresponda. */
let _pagoFiltroExcluidos = new Set();
function _opcionesPagoDisponibles(pedidos) {
  return FORMAS_PAGO_FIJAS.slice();
}
function _filtrarPorPagoChecklist(pedidos) {
  const activos = _filtrosPagoActivos();
  if (activos.length === FORMAS_PAGO_FIJAS.length) return pedidos;
  if (!activos.length) return [];
  return pedidos.filter(r => {
    const formas = _formasDelPedido(r);
    return activos.some(f => formas.has(f));
  });
}
function renderFiltroPagoDropdown(pedidosSinFiltrarPago) {
  const cont = document.getElementById('filtroPagoOpciones');
  if (!cont) return;
  const opciones = FORMAS_PAGO_FIJAS;
  cont.innerHTML = opciones.map(o => `
    <label class="filtro-pago-item">
      <input type="checkbox" ${_pagoFiltroExcluidos.has(o) ? '' : 'checked'} onchange="toggleFiltroPago('${o}', this.checked)">
      ${o}
    </label>
  `).join('');
  const contador = document.getElementById('filtroPagoContador');
  if (contador) {
    if (_pagoFiltroExcluidos.size > 0) { contador.textContent = `(${opciones.length - _pagoFiltroExcluidos.size}/${opciones.length})`; contador.style.display = 'inline'; }
    else { contador.style.display = 'none'; }
  }
}
function toggleFiltroPago(valor, marcado) {
  if (marcado) _pagoFiltroExcluidos.delete(valor); else _pagoFiltroExcluidos.add(valor);
  renderDashboard();
}
function marcarTodosFiltroPago(marcarTodo) {
  if (marcarTodo) { _pagoFiltroExcluidos.clear(); }
  else { FORMAS_PAGO_FIJAS.forEach(o => _pagoFiltroExcluidos.add(o)); }
  renderDashboard();
}
function toggleDropdownPago(ev) {
  if (ev) ev.stopPropagation();
  const dd = document.getElementById('dropdownPago');
  if (dd) dd.classList.toggle('open');
}
document.addEventListener('click', (ev) => {
  const dd = document.getElementById('dropdownPago');
  if (dd && dd.classList.contains('open') && !dd.contains(ev.target) && ev.target.closest('.filtro-pago-wrap') === null) {
    dd.classList.remove('open');
  }
});

/* [NEW] Filtro por Producto en Detalle de Pedidos.
   Se arma dinámicamente desde los productos presentes en el rango de fecha/asesor
   ya filtrado (igual alcance que "Pago": solo afecta la tabla y el PDF, no los
   KPIs ni los gráficos de Resumen General). '' = todos los productos. */
let _productoFiltroSeleccionado = '';
function _filtrarPorProducto(pedidos) {
  if (!_productoFiltroSeleccionado) return pedidos;
  return pedidos.filter(r => (r['PRODUCTO']||'') === _productoFiltroSeleccionado);
}
function renderFiltroProductoSelect(pedidos) {
  const sel = document.getElementById('filtroProducto');
  if (!sel) return;
  const valorActual = sel.value;
  const productos = Array.from(new Set(pedidos.map(r => r['PRODUCTO']).filter(Boolean))).sort((a,b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">📦 Todos los productos</option>' + productos.map(p => `<option value="${escHTML(p)}">${escHTML(p)}</option>`).join('');
  if (productos.includes(valorActual)) sel.value = valorActual; else _productoFiltroSeleccionado = ''; // [NEW] si el producto seleccionado ya no está en el rango filtrado, vuelve a "Todos"
}
function onChangeFiltroProducto() {
  const sel = document.getElementById('filtroProducto');
  _productoFiltroSeleccionado = sel ? sel.value : '';
  renderDashboard();
}

function renderTabla(pedidos) {
  const tbody = document.getElementById('tablaPedidos');
  if (!pedidos.length) {
    tbody.innerHTML = '<tr><td colspan="12"><div class="empty-state"><div class="icon">📋</div>No hay pedidos en este período</div></td></tr>';
    const foot0=document.getElementById('tablaPedidosFoot');
    if(foot0) foot0.innerHTML='';
    return;
  }
  const lista = pedidos.slice(0,100);
  tbody.innerHTML = lista.map((r, idx) => {
    const gps   = r['LINK GPS'] ? `<a href="${r['LINK GPS']}" target="_blank" style="color:var(--teal);font-weight:700;font-size:11px">📍 Ver</a>` : '<span style="color:var(--muted);font-size:11px">—</span>';
    const total = r['TOTAL PEDIDO ($)'] ? `<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>` : '';
    // [FIX] NUEVO FORMATO DE PAGO MÚLTIPLE — antes esto solo miraba el campo viejo
    // 'ABONO', así que un pedido 'Mixto' (varias formas + saldo a crédito) nunca
    // mostraba el aviso de saldo pendiente aunque sí tuviera uno. Ahora usa
    // CREDITO_PENDIENTE (calculado en _filaProducto, válido para pedidos viejos y
    // nuevos) y, si el pedido trae el desglose de pago múltiple (PAGOS_DESGLOSE),
    // lo muestra completo en vez de solo "Abono/Saldo".
    const creditoPend = parseFloat(r['CREDITO_PENDIENTE']||0);
    const totalVal = parseFloat(r['TOTAL PEDIDO ($)']||0);
    const tieneSaldo = creditoPend > 0.004 && totalVal > 0;
    const etiquetaPago = _etiquetaPagoDetalle(r);
    const unSoloFiltro = _filtrosPagoActivos().length === 1;
    let detallePago = '';
    if (!unSoloFiltro) {
      if (r['PAGOS_DESGLOSE'] && r['PAGOS_DESGLOSE'].length) {
        const partes = r['PAGOS_DESGLOSE'].map(pg => `${pg.forma} $${(parseFloat(pg.monto)||0).toFixed(2)}`).join(' + ');
        detallePago = `<div style="font-size:10px;color:var(--muted);margin-top:2px;white-space:nowrap">${partes}</div>`;
        if (tieneSaldo) detallePago += `<div style="font-size:10px;color:var(--red);white-space:nowrap">Saldo crédito $${creditoPend.toFixed(2)}</div>`;
      } else if (tieneSaldo) {
        const abonoVal = parseFloat(r['ABONO']||0);
        detallePago = `<div style="font-size:10px;color:var(--red);margin-top:2px;white-space:nowrap">Abono $${abonoVal.toFixed(2)} · Saldo $${creditoPend.toFixed(2)}</div>`;
      }
    }
    const pago  = etiquetaPago ? `<span class="badge badge-teal">${escHTML(etiquetaPago)}</span>${detallePago}` : '';
    /* [NEW] Botón Editar — solo funciona si la fila trae el id real del pedido en Firestore
       (las filas de pagos/gastos no lo traen, pero renderTabla solo recibe pedidos con producto) */
    const puedeEditar = r['_pedidoId'] && ROL_ACTUAL === 'admin';
    const puedeEliminar = r['_pedidoId'] && ROL_ACTUAL === 'admin';
    const accion = (puedeEditar || puedeEliminar)
      ? `${puedeEditar?`<button class="btn-editar-fila" onclick="abrirEditarPedido('${r['_pedidoId']}')" title="Editar este pedido">✏ Editar</button>`:''}${puedeEliminar?`<button class="btn-eliminar-fila" onclick="eliminarPedidoCompleto('${r['_pedidoId']}')" title="Eliminar este pedido">🗑 Eliminar</button>`:''}`
      : '<span style="color:var(--muted);font-size:11px">—</span>';
    const fila = `<tr>
      <td style="white-space:nowrap;font-size:12px">${limpiarFecha(r['FECHA'])}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--muted)">${escHTML(r['HORA REGISTRO']||'-')}</td>
      <td style="font-size:12px">${escHTML((r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-')}</td>
      <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
      <td style="font-size:12px;color:var(--muted)">${escHTML(r['TELÉFONO']||'-')}</td>
      <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:center;font-size:12px">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right;font-size:12px;color:var(--muted)">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
      <td style="text-align:right">${total}</td>
      <td>${pago}</td>
      <td>${gps}</td>
      <td>${accion}</td>
    </tr>`;
    const este = String(r['CLIENTE']||'').trim().toLowerCase();
    const sig = String(lista[idx+1]?.['CLIENTE']||'').trim().toLowerCase();
    return fila + ((idx < lista.length-1 && este !== sig) ? '<tr class="sep-cliente"><td colspan="12"></td></tr>' : '');
  }).join('');
  const foot=document.getElementById('tablaPedidosFoot');
  if(foot){
    const t=_totalYEtiquetaDetalleFiltrado(pedidos);
    foot.innerHTML=`<tr style="background:#e6f4f2;font-weight:800;color:#085f54"><td colspan="8" style="text-align:right;padding:10px">${escHTML(t.label)}</td><td style="text-align:right;padding:10px">$${t.total.toFixed(2)}</td><td colspan="3" style="font-size:11px;font-weight:600;color:var(--muted)">${pedidos.length} línea(s)</td></tr>`;
  }
}

/* [NEW] Resumen por Cliente — agrupa el detalle de pedidos por cliente,
   con Producto / Cant. / Subtotal / Total / Pago debajo de cada uno. */
function renderResumenPorCliente(pedidos) {
  const card = document.getElementById('resumenClientesCard');
  const cont = document.getElementById('resumenClientesContenido');
  if (!pedidos.length) { card.style.display = 'none'; cont.innerHTML=''; return; }
  const porCliente = {};
  pedidos.forEach(r => {
    const cliente = r['CLIENTE'] || 'Sin nombre';
    if (!porCliente[cliente]) porCliente[cliente] = { items: [], formaPago: '' };
    porCliente[cliente].items.push(r);
    if (r['FORMA DE PAGO']) porCliente[cliente].formaPago = r['FORMA DE PAGO'];
  });
  const clientesOrdenados = Object.entries(porCliente).sort(([a],[b]) => a.localeCompare(b));
  const html = clientesOrdenados.map(([cliente, c]) => {
    const totalesPedido = c.items.map(r => parseFloat(r['TOTAL PEDIDO ($)']||0)).filter(v => v > 0);
    const totalCliente = totalesPedido.length ? totalesPedido.reduce((s,v) => s+v, 0) : c.items.reduce((s,r) => s+(parseFloat(r['SUBTOTAL']||0)), 0);
    const cantidadTotal = c.items.reduce((s,r) => s+(parseFloat(r['CANTIDAD'])||0), 0); // [NEW]
    const porForma = {}; // [NEW] desglose de formas de pago del cliente
    c.items.forEach(r => { const f = r['FORMA DE PAGO'] || 'Sin especificar'; porForma[f] = (porForma[f]||0) + (parseFloat(r['SUBTOTAL'])||0); });
    const tagsPagoCliente = Object.entries(porForma).sort(([,a],[,b]) => b-a).map(([f,v]) => `<span class="badge badge-teal" style="margin-right:4px">${f}: $${v.toFixed(2)}</span>`).join('');
    const filas = c.items.map(r => `
      <tr>
        <td>${escHTML(r['PRODUCTO']||'-')}</td>
        <td style="text-align:center">${r['CANTIDAD']||'-'}</td>
        <td style="text-align:right">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
        <td style="text-align:right">${r['TOTAL PEDIDO ($)']?'$'+parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2):'—'}</td>
        <td style="text-align:left"><span class="badge badge-teal">${r['FORMA DE PAGO']||'-'}</span></td>
      </tr>`).join('');
    return `
      <div class="cierre-cliente-block" style="margin:0 0 12px">
        <div class="cierre-cliente-header">
          <span class="cierre-cliente-nombre">👤 ${escHTML(cliente)}</span>
          <span class="cierre-cliente-meta">💳 ${c.formaPago||'Sin especificar'}</span>
          <span class="cierre-cliente-total">$${totalCliente.toFixed(2)}</span>
        </div>
        <div style="display:flex;gap:24px;flex-wrap:wrap;padding:10px 14px;background:var(--surface2);border-bottom:1px solid var(--border)">
          <div><div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)">Cantidad total</div><div style="font-weight:800;color:var(--navy);font-size:14px">${cantidadTotal%1===0?parseInt(cantidadTotal):cantidadTotal.toFixed(1)} unidad(es)</div></div>
          <div><div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)">Total</div><div style="font-weight:800;color:var(--teal);font-size:14px">$${totalCliente.toFixed(2)}</div></div>
          <div><div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)">Formas de pago</div><div style="margin-top:2px">${tagsPagoCliente}</div></div>
        </div>
        <table class="cierre-cliente-table">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Subtotal</th><th>Total</th><th>Pago</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
  }).join('');
  cont.innerHTML = html;
  card.style.display = 'block';
}

/* ════════════════════════════════════════
   NOTAS VENTAS
════════════════════════════════════════ */
let datosNotasFiltrados = [];
function aplicarNotasFiltros() {
  const fecha  = document.getElementById('notasFecha').value;
  const asesor = document.getElementById('notasAsesor').value;
  const pago   = document.getElementById('notasPago').value;
  let datos = todosLosDatos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== '');
  if (fecha)  datos = datos.filter(r => { const f=String(r['FECHA']||''); return f.startsWith(fecha)||f.includes(fecha.split('-').reverse().join('/')); });
  if (asesor) datos = datos.filter(r => (r['ASESOR / RUTA']||'') === asesor);
  if (pago)   datos = datos.filter(r => (r['FORMA DE PAGO']||'') === pago);
  datosNotasFiltrados = datos;
  const pedidosUnicos = new Set(datos.map(r=>r['_pedidoId'] || `${r['CLIENTE']}-${r['FECHA']}-${r['ASESOR / RUTA']}`)).size; // [FIX] usa el ID real del pedido cuando existe
  const totalVentas   = datos.filter(r=>r['TOTAL PEDIDO ($)']&&parseFloat(r['TOTAL PEDIDO ($)'])>0).reduce((s,r)=>s+(parseFloat(r['TOTAL PEDIDO ($)'])||0),0);
  const totalUnidades = datos.reduce((s,r)=>s+(parseFloat(r['CANTIDAD'])||0),0);
  document.getElementById('notasCount').textContent = datos.length;
  document.getElementById('notasTotalPedidos').textContent = pedidosUnicos;
  document.getElementById('notasTotalVentas').textContent = '$'+totalVentas.toFixed(2);
  document.getElementById('notasTotalUnidades').textContent = totalUnidades;
  const tbody = document.getElementById('tablaNotas');
  const card  = document.getElementById('notasCard');
  if (!datos.length) { tbody.innerHTML=`<tr><td colspan="9"><div class="empty-state"><div class="icon">📋</div>No hay resultados con estos filtros</div></td></tr>`; card.style.display='block'; return; }
  tbody.innerHTML = datos.map(r => {
    const total = r['TOTAL PEDIDO ($)'] ? `<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>` : '';
    return `<tr>
      <td style="font-size:12px;white-space:nowrap">${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
      <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
      <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:right;font-size:12px">$${parseFloat(r['PRECIO UNIT.']||0).toFixed(2)}</td>
      <td style="text-align:center;font-weight:700">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right;font-size:12px;color:var(--muted)">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
      <td style="text-align:right">${total}</td>
      <td><span class="badge badge-teal">${r['FORMA DE PAGO']||'-'}</span></td>
      <td style="font-size:11px;color:var(--muted);white-space:nowrap">${limpiarFecha(r['FECHA'])}</td>
    </tr>`;
  }).join('');
  card.style.display = 'block';
  const pedidosConTotal = datos.filter(r=>r['TOTAL PEDIDO ($)']&&parseFloat(r['TOTAL PEDIDO ($)'])>0);
  const totalReal = pedidosConTotal.reduce((s,r)=>s+(parseFloat(r['TOTAL PEDIDO ($)'])||0),0);
  const clientesUnicos2 = new Set(datos.map(r=>r['CLIENTE'])).size;
  const pedidosUnicos2  = new Set(datos.map(r=>r['_pedidoId'] || `${r['CLIENTE']}-${r['FECHA']}-${r['ASESOR / RUTA']}`)).size; // [FIX] usa el ID real del pedido cuando existe
  const vpa = {};
  pedidosConTotal.forEach(r=>{ const a=r['ASESOR / RUTA']||'Sin asignar'; vpa[a]=(vpa[a]||0)+(parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const at = Object.entries(vpa).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-card teal"><div class="kpi-icon">💰</div><div class="kpi-label">Total ventas</div><div class="kpi-value">$${totalReal.toFixed(2)}</div><div class="kpi-sub">${pedidosUnicos2} pedido(s)</div></div>
    <div class="kpi-card blue"><div class="kpi-icon">💳</div><div class="kpi-label">Total cobrado</div><div class="kpi-value">$0.00</div><div class="kpi-sub">filtrado</div></div>
    <div class="kpi-card red"><div class="kpi-icon">📉</div><div class="kpi-label">Total gastos</div><div class="kpi-value">$0.00</div><div class="kpi-sub">filtrado</div></div>
    <div class="kpi-card orange"><div class="kpi-icon">👥</div><div class="kpi-label">Clientes atendidos</div><div class="kpi-value">${clientesUnicos2}</div><div class="kpi-sub">${pedidosUnicos2} pedido(s)</div></div>
    <div class="kpi-card navy"><div class="kpi-icon">🏆</div><div class="kpi-label">Asesor top</div><div class="kpi-value" style="font-size:1rem">${at?at[0].split(':')[1]?.trim()||at[0]:'—'}</div><div class="kpi-sub">${at?'$'+at[1].toFixed(2):'Sin datos'}</div></div>
    <div class="kpi-card accent"><div class="kpi-icon">📦</div><div class="kpi-label">Líneas de producto</div><div class="kpi-value">${datos.length}</div><div class="kpi-sub">unidades registradas</div></div>
  `;
  renderCharts(datos, pedidosConTotal);
  actualizarTablaCentral(datos);
  card.scrollIntoView({ behavior:'smooth', block:'start' });
}

function actualizarTablaCentral(datos) {
  const tbody = document.getElementById('tablaPedidos');
  const card  = document.getElementById('tableCard');
  card.style.display = 'block';
  pedidosDetalleActuales = datos;
  poblarClienteSelect(datos);
  document.getElementById('clienteCard').style.display = 'block';
  if (!datos.length) { tbody.innerHTML='<tr><td colspan="12"><div class="empty-state"><div class="icon">📋</div>No hay pedidos con estos filtros</div></td></tr>'; return; }
  tbody.innerHTML = datos.map((r, idx) => {
    const gps   = r['LINK GPS'] ? `<a href="${r['LINK GPS']}" target="_blank" style="color:var(--teal);font-weight:700;font-size:11px">📍 Ver</a>` : '<span style="color:var(--muted);font-size:11px">—</span>';
    const total = r['TOTAL PEDIDO ($)'] ? `<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>` : '';
    const pago  = r['FORMA DE PAGO'] ? `<span class="badge badge-teal">${r['FORMA DE PAGO']}</span>` : '';
    const puedeEditar = r['_pedidoId'] && ROL_ACTUAL === 'admin';
    const puedeEliminar = r['_pedidoId'] && ROL_ACTUAL === 'admin';
    const accion = (puedeEditar || puedeEliminar)
      ? `${puedeEditar?`<button class="btn-editar-fila" onclick="abrirEditarPedido('${r['_pedidoId']}')" title="Editar este pedido">✏ Editar</button>`:''}${puedeEliminar?`<button class="btn-eliminar-fila" onclick="eliminarPedidoCompleto('${r['_pedidoId']}')" title="Eliminar este pedido">🗑 Eliminar</button>`:''}`
      : '<span style="color:var(--muted);font-size:11px">—</span>';
    const fila = `<tr>
      <td style="white-space:nowrap;font-size:12px">${limpiarFecha(r['FECHA'])}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--muted)">${escHTML(r['HORA REGISTRO']||'-')}</td>
      <td style="font-size:12px">${escHTML((r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-')}</td>
      <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
      <td style="font-size:12px;color:var(--muted)">${escHTML(r['TELÉFONO']||'-')}</td>
      <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:center;font-size:12px">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right;font-size:12px;color:var(--muted)">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
      <td style="text-align:right">${total}</td>
      <td>${pago}</td>
      <td>${gps}</td>
      <td>${accion}</td>
    </tr>`;
    const este = String(r['CLIENTE']||'').trim().toLowerCase();
    const sig = String(datos[idx+1]?.['CLIENTE']||'').trim().toLowerCase();
    return fila + ((idx < datos.length-1 && este !== sig) ? '<tr class="sep-cliente"><td colspan="12"></td></tr>' : '');
  }).join('');
}

/* ════════════════════════════════════════
   LEAFLET
════════════════════════════════════════ */
function cargarLeaflet(callback) {
  if (leafletLoaded) { callback(); return; }
  const css = document.createElement('link'); css.rel='stylesheet'; css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
  const js = document.createElement('script'); js.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; js.integrity='sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH'; js.crossOrigin='anonymous'; js.onload=()=>{ leafletLoaded=true; callback(); }; document.head.appendChild(js);
}

function shadeColor(color, percent) {
  let R=parseInt(color.substring(1,3),16), G=parseInt(color.substring(3,5),16), B=parseInt(color.substring(5,7),16);
  R=Math.min(255,Math.max(0,R+percent)); G=Math.min(255,Math.max(0,G+percent)); B=Math.min(255,Math.max(0,B+percent));
  return '#'+[R,G,B].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function initLeafletMap() {
  leafletMap = L.map('leafletMap', { zoomControl:true, scrollWheelZoom:true });
  const tileCalles   = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap' });
  const tileSatelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:19, attribution:'© Esri' });
  tileCalles.addTo(leafletMap);
  const MapaCtrl = L.Control.extend({
    options: { position:'topleft' },
    onAdd: function() {
      const div = L.DomUtil.create('div','');
      div.innerHTML=`<div style="background:#fff;border-radius:4px;box-shadow:0 1px 5px rgba(0,0,0,0.25);overflow:hidden;display:flex;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"><button id="btnMapa" onclick="setTile('mapa')" style="padding:6px 14px;font-size:12px;font-weight:700;border:none;background:#1a3a5c;color:#fff;cursor:pointer">Mapa</button><button id="btnSateli" onclick="setTile('satelite')" style="padding:6px 14px;font-size:12px;font-weight:600;border:none;background:#fff;color:#555;cursor:pointer;border-left:1px solid #ddd">Satélite</button></div>`;
      L.DomEvent.disableClickPropagation(div); return div;
    }
  });
  new MapaCtrl().addTo(leafletMap);
  window._tileCalles=tileCalles; window._tileSatelite=tileSatelite;
  leafletMap.setView([-2.134,-79.587],13);
}

function setTile(tipo) {
  if(tipo==='mapa'){
    leafletMap.removeLayer(window._tileSatelite); window._tileCalles.addTo(leafletMap);
    document.getElementById('btnMapa').style.cssText='padding:6px 14px;font-size:12px;font-weight:700;border:none;background:#1a3a5c;color:#fff;cursor:pointer';
    document.getElementById('btnSateli').style.cssText='padding:6px 14px;font-size:12px;font-weight:600;border:none;background:#fff;color:#555;cursor:pointer;border-left:1px solid #ddd';
  } else {
    leafletMap.removeLayer(window._tileCalles); window._tileSatelite.addTo(leafletMap);
    document.getElementById('btnSateli').style.cssText='padding:6px 14px;font-size:12px;font-weight:700;border:none;background:#1a3a5c;color:#fff;cursor:pointer;border-left:1px solid #ddd';
    document.getElementById('btnMapa').style.cssText='padding:6px 14px;font-size:12px;font-weight:600;border:none;background:#fff;color:#555;cursor:pointer';
  }
}

/* ════════════════════════════════════════
   RUTAS DEL DÍA
════════════════════════════════════════ */
function rutasHoy() {
  const el=document.getElementById('rutasFecha');
  if(el) el.value = fechaHoy();
  aplicarRutas();
}
function aplicarRutas() {
  const fecha  = document.getElementById('rutasFecha').value;
  const asesor = document.getElementById('rutasAsesor').value;
  const lu=document.getElementById('rutasLastUpdate');
  if(lu) lu.textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'});
  /* [FIX] El mapa solo ve lo que ya está en memoria (filtro del Dashboard).
     Si pones el 16 en Rutas pero el Dashboard sigue en el 17, todosLosDatos
     no trae el 16 y el diagnóstico sale en 0. Igualamos el rango y recargamos. */
  const fDash=document.getElementById('filtroFecha');
  const hDash=document.getElementById('filtroFechaHasta');
  if(fecha && fDash && hDash && (fDash.value!==fecha || hDash.value!==fecha)){
    fDash.value=fecha;
    hDash.value=fecha;
    if(typeof iniciarListenersDashboard==='function') iniciarListenersDashboard();
    return;
  }
  renderRutasDia(fecha, asesor);
}

function parseCoordenada(val) {
  if (val===null||val===undefined||val==='') return NaN;
  const s=String(val).trim().replace(',','.');
  let n=parseFloat(s);
  if(isNaN(n)) return NaN;
  if(Math.abs(n)>1000) n=n/1000000;
  return n;
}

function coordValida(lat,lng) {
  if(isNaN(lat)||isNaN(lng)) return false;
  if(lat===0&&lng===0) return false;
  if(lat<-60||lat>15) return false;
  if(lng<-82||lng>-60) return false;
  return true;
}

function renderRutasDia(fecha, asesorFiltro) {
  if (!leafletMap) return;
  const diagBox=document.getElementById('gpsDiagBox'), diagContent=document.getElementById('gpsDiagContent');
  let datos=todosLosDatos;
  if(fecha) datos=datos.filter(r=>{ const f=String(r['FECHA']||''); return f.startsWith(fecha)||f.includes(fecha); });
  /* [FIX] Antes comparaba con === exacto: si el campo empleado del pedido tenía
     alguna diferencia de mayúsculas/minúsculas o espacios respecto al valor del
     desplegable (ej. "RUTA 4: WILSON" guardado vs "RUTA 4: Wilson" del filtro),
     no encontraba ningún registro aunque sí existieran pedidos de ese asesor ese día. */
  if(asesorFiltro) datos=datos.filter(r=>(r['ASESOR / RUTA']||'').trim().toLowerCase()===asesorFiltro.trim().toLowerCase());
  const sampleKeys=datos.length>0?Object.keys(datos[0]):[];
  const latKey=sampleKeys.find(k=>/latitud/i.test(k))||'LATITUD';
  const lngKey=sampleKeys.find(k=>/longitud/i.test(k))||'LONGITUD';
  const conCoordsRaw=datos.filter(r=>r[latKey]!==undefined&&r[latKey]!=='');
  const sinCoords=datos.filter(r=>!r[latKey]||r[latKey]==='');
  const datosGPS=datos.filter(r=>{ const lat=parseCoordenada(r[latKey]); const lng=parseCoordenada(r[lngKey]); return coordValida(lat,lng); }).map(r=>({...r,_lat:parseCoordenada(r[latKey]),_lng:parseCoordenada(r[lngKey])}));
  const diagLines=[];
  diagLines.push(`📋 Total registros filtrados: <b>${datos.length}</b>`);
  diagLines.push(`🔑 Clave LATITUD detectada: <b>"${latKey}"</b> | LONGITUD: <b>"${lngKey}"</b>`);
  diagLines.push(`📍 Con coordenadas en sheet: <b>${conCoordsRaw.length}</b> | Sin coordenadas: <b>${sinCoords.length}</b>`);
  diagLines.push(`✅ Coordenadas válidas para Ecuador: <b>${datosGPS.length}</b>`);
  if(conCoordsRaw.length>0&&datosGPS.length===0){
    const ej=conCoordsRaw[0];
    diagLines.push(`⚠️ Ejemplo de valor recibido → lat: <b>"${ej[latKey]}"</b> | lng: <b>"${ej[lngKey]}"</b>`);
    diagLines.push(`💡 <b>Posible causa:</b> Las coordenadas no están en rango Ecuador (-5 a +2 lat, -82 a -75 lng).`);
  } else if(datosGPS.length>0){
    const ej=datosGPS[0];
    diagLines.push(`📌 Ejemplo OK → lat: <b>${ej._lat}</b> | lng: <b>${ej._lng}</b> (${ej['CLIENTE']||''})`);
  }
  diagBox.style.display=(datosGPS.length===0||conCoordsRaw.length===0)?'block':'none';
  diagContent.innerHTML=diagLines.join('<br>');
  const pedidosDatos=datos.filter(r=>r['PRODUCTO']&&r['PRODUCTO']!=='');
  const datosOrdenados=[...pedidosDatos].sort((a,b)=>(horaAMinutos(a['HORA REGISTRO'])||0)-(horaAMinutos(b['HORA REGISTRO'])||0));
  const datosGPSOrdenados=[...datosGPS].sort((a,b)=>(horaAMinutos(a['HORA REGISTRO'])||0)-(horaAMinutos(b['HORA REGISTRO'])||0));
  mapMarkers.forEach(m=>m.remove()); mapPolylines.forEach(p=>p.remove()); mapMarkers=[]; mapPolylines=[];
  const rutasMap={};
  datosGPSOrdenados.forEach(r=>{ const a=r['ASESOR / RUTA']||'Sin asignar'; if(!rutasMap[a])rutasMap[a]=[]; rutasMap[a].push(r); });
  let allBounds=[];
  const markerRefs={};
  Object.entries(rutasMap).forEach(([asesorKey,filas])=>{
    const color=colorDeAsesor(asesorKey);
    const coords=[];
    filas.forEach((r,idx)=>{
      const lat=r._lat, lng=r._lng;
      const precision=parseCoordenada(r['PRECISIÓN GPS'])||0;
      const num=idx+1;
      const borderClr=shadeColor(color,-25);
      const personaSVG=`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="7" r="4"/><path d="M5.5 20c0-3.59 2.91-6.5 6.5-6.5s6.5 2.91 6.5 6.5H5.5z"/></svg>`;
      const iconHtml=`<div style="position:relative;width:42px;height:52px;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.4))"><svg xmlns="http://www.w3.org/2000/svg" width="42" height="52" viewBox="0 0 42 52" style="position:absolute;top:0;left:0"><path d="M21 1C10.5 1 2 9.5 2 20c0 14 19 31 19 31s19-17 19-31C40 9.5 31.5 1 21 1z" fill="${color}" stroke="${borderClr}" stroke-width="2"/><circle cx="21" cy="19" r="13" fill="rgba(255,255,255,0.18)"/></svg><div style="position:absolute;top:5px;left:50%;transform:translateX(-50%);width:18px;height:18px">${personaSVG}</div><div style="position:absolute;top:-4px;right:-4px;background:#fff;color:${color};border:2px solid ${color};border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;line-height:1;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,0.3)">${num}</div></div>`;
      const icon=L.divIcon({className:'',html:iconHtml,iconSize:[42,52],iconAnchor:[21,52],popupAnchor:[0,-54]});
      const marker=L.marker([lat,lng],{icon}).addTo(leafletMap);
      const nombreAsesor=escHTML(asesorKey.split(':')[1]?.trim()||asesorKey);
      const prod=r['PRODUCTO']?`<b>${escHTML(r['PRODUCTO'])}</b> × ${escHTML(String(r['CANTIDAD']||0))}`:'—';
      const total=r['TOTAL PEDIDO ($)']?`<span style="color:#0a7c6e;font-weight:700">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</span>`:'—';
      const notas=r['NOTAS']?`<div style="margin-top:6px;font-style:italic;color:#555;font-size:11px">📝 ${escHTML(r['NOTAS'])}</div>`:'';
      const linkgps=r['LINK GPS']?`<a href="${r['LINK GPS']}" target="_blank" style="display:inline-block;margin-top:8px;background:#0a7c6e;color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none">📍 Abrir GPS</a>`:'';
      const precStr=precision>0?`<div style="font-size:10px;color:#999;margin-top:2px">Precisión: ${precision}m${precision>50?' ⚠️':''}</div>`:'';
      marker.bindPopup(`<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;min-width:200px;max-width:240px"><div style="background:${color};color:#fff;padding:8px 12px;margin:-13px -20px 10px;border-radius:4px 4px 0 0;font-size:12px;font-weight:700">${nombreAsesor} — Parada #${idx+1}</div><div style="font-size:13px;font-weight:700;color:#1a3a5c">${escHTML(r['CLIENTE']||'-')}</div><div style="font-size:11px;color:#666;margin-top:2px">🕐 ${r['HORA REGISTRO']||'-'}</div>${precStr}<div style="margin-top:8px;font-size:12px">${prod}</div><div style="margin-top:2px;font-size:12px">Total: ${total}</div><div style="margin-top:4px;font-size:11px;color:#888">💳 ${r['FORMA DE PAGO']||'—'}</div>${notas}${linkgps}</div>`,{maxWidth:260});
      if(precision>50){ const circle=L.circle([lat,lng],{radius:precision,color,fillColor:color,fillOpacity:0.08,weight:1,dashArray:'4,4'}).addTo(leafletMap); mapMarkers.push(circle); }
      mapMarkers.push(marker); coords.push([lat,lng]); allBounds.push([lat,lng]);
      const key=`${r['CLIENTE']}-${r['HORA REGISTRO']}-${asesorKey}`;
      markerRefs[key]=marker;
    });
    const coordsUnicas=[];
    coords.forEach(pt=>{
      const prev=coordsUnicas[coordsUnicas.length-1];
      if(!prev || prev[0]!==pt[0] || prev[1]!==pt[1]) coordsUnicas.push(pt);
    });
    if(coordsUnicas.length>1){
      const poly=L.polyline(coordsUnicas,{
        color:color, weight:5, opacity:0.92, lineJoin:'round', lineCap:'round',
        dashArray:'10,8'
      }).addTo(leafletMap);
      if(poly.bringToBack) poly.bringToBack();
      mapPolylines.push(poly);
    }
  });
  if(allBounds.length>0) leafletMap.fitBounds(allBounds,{padding:[40,40]});
  renderMapLegend(Object.keys(rutasMap));
  renderAsesorCards(datosOrdenados,datosGPSOrdenados);
  renderRutaTabla(datosOrdenados,markerRefs);
}

function renderMapLegend(asesores) {
  const el=document.getElementById('mapLegend');
  if(!asesores.length){ el.innerHTML='<span style="font-size:11px;color:var(--muted)">Sin datos GPS</span>'; return; }
  el.innerHTML=asesores.map(a=>{ const color=colorDeAsesor(a); const nombre=a.split(':')[1]?.trim()||a; return `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div>${nombre}</div>`; }).join('');
}

function centrarMapa() {
  if(!leafletMap) return;
  const fecha=document.getElementById('rutasFecha').value, asesor=document.getElementById('rutasAsesor').value;
  let datos=todosLosDatos;
  if(fecha) datos=datos.filter(r=>String(r['FECHA']||'').startsWith(fecha));
  if(asesor) datos=datos.filter(r=>(r['ASESOR / RUTA']||'').trim().toLowerCase()===asesor.trim().toLowerCase()); // [FIX] mismo ajuste que renderRutasDia
  const sampleKeys=datos.length>0?Object.keys(datos[0]):[];
  const latKey=sampleKeys.find(k=>/latitud/i.test(k))||'LATITUD';
  const lngKey=sampleKeys.find(k=>/longitud/i.test(k))||'LONGITUD';
  const bounds=datos.map(r=>[parseCoordenada(r[latKey]),parseCoordenada(r[lngKey])]).filter(([lat,lng])=>coordValida(lat,lng));
  if(bounds.length) leafletMap.fitBounds(bounds,{padding:[40,40]});
  else leafletMap.setView([-2.134,-79.587],13);
}

function haversineKm(lat1,lon1,lat2,lon2) {
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function renderAsesorCards(datosAll,datosGPS) {
  const grid=document.getElementById('asesorCardsGrid');
  const asesorMap={};
  datosAll.forEach(r=>{ const a=r['ASESOR / RUTA']||'Sin asignar'; if(!asesorMap[a])asesorMap[a]={filas:[],gps:[]}; asesorMap[a].filas.push(r); });
  datosGPS.forEach(r=>{ const a=r['ASESOR / RUTA']||'Sin asignar'; if(!asesorMap[a])asesorMap[a]={filas:[],gps:[]}; asesorMap[a].gps.push(r); });
  if(!Object.keys(asesorMap).length){ grid.innerHTML='<div class="loading"><span style="color:var(--muted)">📭 Sin datos para el filtro seleccionado</span></div>'; return; }
  grid.innerHTML=Object.entries(asesorMap).map(([asesorKey,data])=>{
    const color=colorDeAsesor(asesorKey), nombre=asesorKey.split(':')[1]?.trim()||asesorKey;
    const filas=data.filas, gps=data.gps;
    const clientes=new Set(filas.map(r=>`${r['CLIENTE']}-${r['FECHA']}`)).size;
    const total=filas.filter(r=>r['TOTAL PEDIDO ($)']&&parseFloat(r['TOTAL PEDIDO ($)'])>0).reduce((s,r)=>s+(parseFloat(r['TOTAL PEDIDO ($)'])||0),0);
    const horas=filas.map(r=>r['HORA REGISTRO']).filter(Boolean).sort((a,b)=>(horaAMinutos(a)||0)-(horaAMinutos(b)||0));
    const primerHora=horas[0]||'—', ultimaHora=horas[horas.length-1]||'—';
    let km=0;
    for(let i=1;i<gps.length;i++){ const lat1=gps[i-1]._lat,lon1=gps[i-1]._lng,lat2=gps[i]._lat,lon2=gps[i]._lng; if(!isNaN(lat1)&&!isNaN(lon1)&&!isNaN(lat2)&&!isNaN(lon2))km+=haversineKm(lat1,lon1,lat2,lon2); }
    return `<div class="asesor-card" style="border-left-color:${color};animation-delay:${Object.keys(asesorMap).indexOf(asesorKey)*0.05}s">
      <div class="asesor-card-header"><div class="asesor-dot" style="background:${color}"></div><div class="asesor-nombre" style="color:${color}">${nombre}</div></div>
      <div class="asesor-stats">
        <div class="asesor-stat"><div class="asesor-stat-label">Clientes</div><div class="asesor-stat-value" style="color:${color}">${clientes}</div></div>
        <div class="asesor-stat"><div class="asesor-stat-label">Total vendido</div><div class="asesor-stat-value" style="color:${color};font-size:1rem">$${total.toFixed(2)}</div></div>
      </div>
      <div class="asesor-horario">
        <div><div class="asesor-horario-label">Primer pedido</div><div class="asesor-horario-value">🕐 ${primerHora}</div></div>
        <div style="text-align:right"><div class="asesor-horario-label">Último pedido</div><div class="asesor-horario-value">🕐 ${ultimaHora}</div></div>
      </div>
      <div class="asesor-km"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 1a5 5 0 0 1 5 5c0 3.5-5 9-5 9S3 9.5 3 6a5 5 0 0 1 5-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="6" r="1.5" stroke="currentColor" stroke-width="1.5"/></svg>${km>0?km.toFixed(1)+' km recorridos':'Sin ruta GPS trazada'}</div>
    </div>`;
  }).join('');
}

function renderRutaTabla(datos,markerRefs) {
  const card=document.getElementById('rutaDetailCard'),tbody=document.getElementById('tablaRutaDetalle'),badge=document.getElementById('rutaCountBadge'),note=document.getElementById('rutaTableNote');
  if(!datos.length){ card.style.display='block'; tbody.innerHTML='<tr><td colspan="11"><div class="empty-state"><div class="icon">🗺️</div>Sin registros para este filtro</div></td></tr>'; badge.textContent='0 registros'; note.textContent=''; return; }
  const mostrar=datos.slice(0,200);
  card.style.display='block'; badge.textContent=mostrar.length+' registro'+(mostrar.length!==1?'s':'');
  note.textContent=datos.length>200?`Mostrando 200 de ${datos.length} registros totales.`:'';
  tbody.innerHTML=mostrar.map((r,idx)=>{
    const asesorKey=r['ASESOR / RUTA']||'', color=asesorKey?colorDeAsesor(asesorKey):'#ccc', nombre=asesorKey.split(':')[1]?.trim()||asesorKey||'-';
    const total=r['TOTAL PEDIDO ($)']?`<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>`:'<span style="color:var(--muted)">—</span>';
    const pago=r['FORMA DE PAGO']?`<span class="badge badge-teal">${r['FORMA DE PAGO']}</span>`:'';
    const notas=r['NOTAS']?`<span style="font-size:11px;color:var(--muted);font-style:italic" title="${escapeAttr(r['NOTAS'])}">${escHTML(r['NOTAS'].substring(0,30))}${r['NOTAS'].length>30?'…':''}</span>`:'<span style="color:var(--muted);font-size:11px">—</span>';
    const gps=r['LINK GPS']?`<a class="btn-gps-small" href="${r['LINK GPS']}" target="_blank" onclick="event.stopPropagation()">📍 Ver</a>`:'<span style="color:var(--muted);font-size:11px">—</span>';
    const hasGPS=!isNaN(parseFloat(r['LATITUD']))&&!isNaN(parseFloat(r['LONGITUD']));
    const rowClick=hasGPS?`onclick="flyToMarker('${(r['CLIENTE']+'-'+r['HORA REGISTRO']+'-'+asesorKey).replace(/'/g,"\\'")}',${parseFloat(r['LATITUD'])},${parseFloat(r['LONGITUD'])})"`:'';
    const rowClass=hasGPS?'clickable-row':'';
    return `<tr class="${rowClass}" id="rrow-${idx}" ${rowClick} ${hasGPS?'title="Click para ver en el mapa"':''}>
      <td style="text-align:center;font-size:11px;color:var(--muted);font-weight:700">${idx+1}</td>
      <td><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block"></span><span style="font-size:11px;font-weight:700;color:${color}">${nombre}</span></span></td>
      <td style="font-size:12px;font-weight:700;white-space:nowrap">${r['HORA REGISTRO']||'-'}</td>
      <td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td>
      <td style="font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAttr(r['DIRECCIÓN']||'')}">${escHTML(r['DIRECCIÓN']||'-')}</td>
      <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:center;font-size:12px;font-weight:700">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right">${total}</td>
      <td>${pago}</td>
      <td>${notas}</td>
      <td>${gps}</td>
    </tr>`;
  }).join('');
}

function flyToMarker(key,lat,lng) {
  if(!leafletMap) return;
  document.querySelectorAll('#tablaRutaDetalle tr').forEach(tr=>tr.classList.remove('highlight-row'));
  leafletMap.flyTo([lat,lng],17,{duration:1});
  setTimeout(()=>{
    mapMarkers.forEach(m=>{ if(m.getLatLng){ const ml=m.getLatLng(); if(Math.abs(ml.lat-lat)<0.0001&&Math.abs(ml.lng-lng)<0.0001&&m.openPopup)m.openPopup(); } });
    document.getElementById('leafletMap').scrollIntoView({behavior:'smooth',block:'center'});
  },900);
}

function exportarClientePDF() {
  if (!clientesSeleccionados.length) { alert('Selecciona al menos un cliente primero.'); return; }
  const items = pedidosDetalleActuales.filter(r => clientesSeleccionados.includes(r['CLIENTE']));
  if (!items.length) { alert('No hay pedidos para estos clientes en el filtro actual.'); return; }

  const fecha = _textoRangoFecha();
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const asesorLabel = asesorSel.split(':')[1]?.trim() || 'Todos';

  const porCliente = {};
  items.forEach(r => { const c = r['CLIENTE']||'Sin nombre'; if (!porCliente[c]) porCliente[c] = []; porCliente[c].push(r); });

  // [NEW] Si se seleccionó un solo cliente, el título muestra su nombre en vez
  // del genérico "Detalle de Clientes" — así el PDF/pestaña se identifica por
  // la selección real, no por el nombre de la sección.
  const tituloSeleccion = clientesSeleccionados.length === 1
    ? clientesSeleccionados[0]
    : `Detalle de Clientes (${clientesSeleccionados.length})`;

  let totalGeneralTodos = 0;
  const bloquesHtml = clientesSeleccionados.filter(c => porCliente[c]).map(cliente => {
    let totalCliente = 0;
    const filas = porCliente[cliente].map(r => {
      const valorTotal = parseFloat(r['SUBTOTAL']||0);
      totalCliente += valorTotal;
      const totalPedido = r['TOTAL PEDIDO ($)'] ? `$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}` : '—';
      return `<tr>
        <td>${escHTML(r['PRODUCTO']||'-')}</td>
        <td style="text-align:center">${r['CANTIDAD']||'-'}</td>
        <td style="text-align:right">$${valorTotal.toFixed(2)}</td>
        <td style="text-align:right;font-weight:700">${totalPedido}</td>
        <td>${escHTML(_textoDesgloseFila(r))}</td>
      </tr>`;
    }).join('');
    totalGeneralTodos += totalCliente;
    return `
      <div class="cliente-bloque">
        <div class="cliente-bloque-titulo">👤 ${escHTML(cliente)} <span>$${totalCliente.toFixed(2)}</span></div>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th><th>Subtotal</th><th>Total</th><th>Pago</th></tr></thead>
          <tbody>
            ${filas}
            <tr class="total-row"><td colspan="2" style="text-align:right">SUBTOTAL</td><td style="text-align:right">$${totalCliente.toFixed(2)}</td><td colspan="2"></td></tr>
          </tbody>
        </table>
      </div>`;
  }).join('');

  const v = window.open('', '_blank', 'width=800,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${escHTML(tituloSeleccion)} — Aqua Luan</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header h1{font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    .cliente-bloque{margin-bottom:22px;page-break-inside:avoid;}
    .cliente-bloque-titulo{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:800;color:#1a3a5c;background:#f0f5f8;border-radius:8px 8px 0 0;padding:8px 12px;border:1px solid #ddd;border-bottom:none;}
    .cliente-bloque-titulo span{color:#0a7c6e;font-family:Georgia,'Times New Roman',serif;font-size:16px;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    thead tr{background:#1a3a5c;}
    thead th{padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#fff;}
    thead th:nth-child(2),thead th:nth-child(3),thead th:nth-child(4){text-align:right}
    thead th:nth-child(2){text-align:center}
    tbody td{padding:9px 12px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
    .total-row{background:#e6f4f2;font-weight:800;color:#085f54;}
    .total-row td{padding:12px;border-top:2px solid #0a7c6e;}
    .total-final{background:#1a3a5c;border-radius:10px;padding:14px 18px;margin-top:10px;display:flex;justify-content:space-between;align-items:center;color:#fff;}
    .total-final b{font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#4ec9a0;}
    @media print{body{padding:12px;} thead{display:table-header-group;}}
  </style></head><body>
  <div class="print-header">
    <h1>${escHTML(tituloSeleccion)}</h1>
    <p>${clientesSeleccionados.length} cliente(s) · Asesor: ${asesorLabel} · Fecha: ${fecha} · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
  </div>
  ${bloquesHtml}
  ${clientesSeleccionados.length > 1 ? `<div class="total-final"><span>TOTAL GENERAL (${clientesSeleccionados.length} clientes)</span><b>$${totalGeneralTodos.toFixed(2)}</b></div>` : ''}
  <script>
    var _impresoPagina=false;
    function _intentarImprimirPagina(){ if(_impresoPagina)return; _impresoPagina=true; window.print(); }
    window.onload=_intentarImprimirPagina;
    setTimeout(_intentarImprimirPagina,180);
  <\/script>
  </body></html>`);
  v.document.close();
  _dispararImpresion(v);
}

/* ════════════════════════════════════════
   CONSULTAR POR CLIENTE
════════════════════════════════════════ */
/* [NEW] Estado de negocio de un cliente, según reglas exactas del negocio:
   VIP: última compra <=30 días Y total histórico >= $500
   ACTIVO: última compra <=30 días Y total histórico < $500
   RIESGO: última compra entre 31 y 60 días
   INACTIVO: última compra >60 días (o nunca ha comprado en el período analizado) */
function _calcularEstadoCliente(diasSinPedido, totalHistorico) {
  if (diasSinPedido <= 30) return totalHistorico >= 500 ? 'VIP' : 'Activo';
  if (diasSinPedido <= 60) return 'Riesgo';
  return 'Inactivo';
}
function _badgeEstadoCliente(estado) {
  const map = {
    'VIP':      '<span class="badge" style="background:#f3e5f5;color:#7b1fa2">VIP</span>',
    'Activo':   '<span class="badge badge-teal">Activo</span>',
    'Riesgo':   '<span class="badge" style="background:#fdf0e2;color:#c05800">Riesgo</span>',
    'Inactivo': '<span class="badge" style="background:#fbe9e7;color:var(--red)">Inactivo</span>'
  };
  return map[estado] || estado;
}

let _clientesTablaDatos = []; // [NEW] estadísticas calculadas por cliente, para la tabla/modal/PDF
let _clientesSeleccionadosPdf = new Set(); // [NEW] checkboxes marcados para exportar

/* [FIX] Esta función se había perdido al reescribir el bloque — agrupa las líneas de
   producto de un mismo pedido real (Cliente+Fecha+Asesor) en un solo grupo. */
function _agruparPedidosReales(datos) {
  const grupos = [];
  let actual = null;
  datos.forEach(r => {
    const total = parseFloat(r['TOTAL PEDIDO ($)']||0);
    if (total > 0) {
      actual = { total, cliente: r['CLIENTE']||'Sin nombre', items: [r] };
      grupos.push(actual);
    } else if (actual) {
      actual.items.push(r);
    } else {
      actual = { total: 0, cliente: r['CLIENTE']||'Sin nombre', items: [r] };
      grupos.push(actual);
    }
  });
  return grupos;
}

function poblarClienteSelect(datos) {
  // [NEW] Calcula, para cada cliente que aparece en el período filtrado (fecha/asesor de
  // arriba), sus estadísticas: pedidos, valor total, último pedido, días sin comprar,
  // asesor (el de su pedido más reciente), estado (VIP/Activo/Riesgo/Inactivo) y Deuda
  // Vigente (esta última siempre sobre TODO el historial, sin filtro de fecha — igual que
  // antes, porque una deuda no se limita a un día en particular).
  const gruposPedido = _agruparPedidosReales(datos);
  const porCliente = {};
  gruposPedido.forEach(g => {
    const primeraLinea = g.items[0] || {};
    if (!porCliente[g.cliente]) porCliente[g.cliente] = { pedidos: 0, total: 0, ultimoFecha: '', asesor: '', telefono: '', direccion: '', items: [] };
    const c = porCliente[g.cliente];
    c.pedidos++;
    c.total += g.total || 0;
    g.items.forEach(r => {
      c.items.push(r);
      if (!c.telefono && r['TELÉFONO']) c.telefono = r['TELÉFONO'];
      if (!c.direccion && r['DIRECCIÓN']) c.direccion = r['DIRECCIÓN'];
    });
    // gruposPedido viene del más reciente al más antiguo (Firestore ordena por creadoEn desc,
    // ordenado del lado del navegador) — el primer grupo visto por cliente es su pedido más
    // reciente, así que fijamos fecha/asesor solo la primera vez.
    if (!c.ultimoFecha) { c.ultimoFecha = primeraLinea['FECHA'] || ''; c.asesor = primeraLinea['ASESOR / RUTA'] || ''; }
  });

  // [FIX] LA PANTALLA SE CONGELABA con muchos clientes/pedidos acumulados: antes, por
  // CADA cliente se recorría TODO "todosLosDatos" dos veces completas (una para sumar
  // sus ventas a crédito, otra para sumar sus pagos) — con cientos de clientes y miles
  // de filas eso son millones de comparaciones repetidas en cada recálculo. Ahora se
  // recorre "todosLosDatos" UNA SOLA VEZ, acumulando crédito y pagos por cliente en un
  // mapa, y luego cada cliente solo consulta su propia entrada en ese mapa (instantáneo).
  // Mismo resultado exacto, verificado comparando ambos cálculos sobre miles de filas
  // simuladas antes de aplicar este cambio — solo cambia cómo se calcula, no el número.
  const _mapaDeudaPorCliente = {};
  todosLosDatos.forEach(r => {
    const cliente = r['CLIENTE'];
    if (!cliente) return;
    if (!_mapaDeudaPorCliente[cliente]) _mapaDeudaPorCliente[cliente] = { credito: 0, pagos: 0 };
    // [FIX] NUEVO FORMATO DE PAGO MÚLTIPLE — antes esto comparaba FORMA DE PAGO
    // contra el string exacto 'Crédito', lo cual dejaba de funcionar en cuanto
    // formapago pasó a valer 'Mixto' (varias formas marcadas + saldo a crédito).
    // Ahora usa CREDITO_PENDIENTE, un campo numérico ya calculado en _filaProducto()
    // que da el mismo resultado para pedidos viejos (con 'abono') y nuevos (con
    // 'pagos'+'creditoPendiente'), sin depender de ningún string de forma de pago.
    const creditoPendiente = parseFloat(r['CREDITO_PENDIENTE']||0);
    if (r['PRODUCTO'] && creditoPendiente > 0) {
      _mapaDeudaPorCliente[cliente].credito += creditoPendiente;
    } else if (!r['PRODUCTO'] && parseFloat(r['TOTAL PEDIDO ($)']||0) > 0 && String(r['TOTAL PEDIDO ($)']).indexOf('-') === -1) {
      _mapaDeudaPorCliente[cliente].pagos += parseFloat(r['TOTAL PEDIDO ($)']||0);
    }
  });

  const hoyMs = Date.now();
  _clientesTablaDatos = Object.entries(porCliente).map(([nombre, c]) => {
    const ultimoDate = c.ultimoFecha ? new Date(c.ultimoFecha + 'T00:00:00') : null;
    const diasSinPedido = ultimoDate ? Math.max(0, Math.floor((hoyMs - ultimoDate.getTime()) / 86400000)) : 9999;
    const estado = _calcularEstadoCliente(diasSinPedido, c.total);
    // Deuda Vigente — sobre TODO el historial del cliente, sin filtro de fecha (igual que
    // antes), ahora leída del mapa precalculado en una sola pasada arriba.
    const _deuda = _mapaDeudaPorCliente[nombre] || { credito: 0, pagos: 0 };
    const deudaVigente = _deuda.credito - _deuda.pagos;
    return {
      nombre, telefono: c.telefono, direccion: c.direccion, pedidos: c.pedidos, total: c.total,
      ultimoFecha: c.ultimoFecha, diasSinPedido, asesor: c.asesor, estado, deudaVigente, items: c.items
    };
  });

  // Población del filtro "Todos los asesores" con las rutas reales
  const selAsesor = document.getElementById('clienteFiltroAsesorTabla');
  if (selAsesor) {
    const valorActual = selAsesor.value;
    selAsesor.innerHTML = '<option value="">Todos los asesores</option>' + _asesoresCache.map(r => `<option value="${escapeAttr(r)}">${r.split(':')[1]?.trim()||r}</option>`).join('');
    if (_asesoresCache.includes(valorActual)) selAsesor.value = valorActual;
  }

  _clientesSeleccionadosPdf.clear(); // el filtro cambió, se limpia la selección de PDF para evitar exportar algo que ya no se ve
  mostrarDetalleCliente();
}

/* [NEW] Pinta la tabla de "Consultar por Cliente" respetando los filtros de búsqueda,
   estado y asesor — y ordenada por llegada (más reciente primero), como ya funcionaba. */
function mostrarDetalleCliente() {
  const cont = document.getElementById('clienteDetalleContenido');
  const contador = document.getElementById('clienteContadorTabla');
  if (!cont) return;

  const q = (document.getElementById('clienteBusquedaTabla')?.value || '').toLowerCase().trim();
  const estadoFiltro = document.getElementById('clienteFiltroEstado')?.value || '';
  const asesorFiltro = document.getElementById('clienteFiltroAsesorTabla')?.value || '';

  let filtrados = _clientesTablaDatos.filter(c => {
    const matchQ = !q || c.nombre.toLowerCase().includes(q) || (c.telefono||'').includes(q) || (c.direccion||'').toLowerCase().includes(q);
    const matchEstado = !estadoFiltro || c.estado === estadoFiltro;
    const matchAsesor = !asesorFiltro || c.asesor === asesorFiltro;
    return matchQ && matchEstado && matchAsesor;
  });
  // Ya vienen en orden de llegada (más reciente primero) desde poblarClienteSelect, gracias
  // al orden de gruposPedido — el filtro de arriba solo reduce la lista, no cambia el orden.

  if (contador) contador.textContent = filtrados.length + ' cliente' + (filtrados.length!==1?'s':'');

  if (!filtrados.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:2rem"><div class="icon">👤</div>No hay clientes que coincidan con estos filtros</div>';
    return;
  }

  const filas = filtrados.map(c => {
    const checked = _clientesSeleccionadosPdf.has(c.nombre) ? 'checked' : '';
    const asesorNombre = (c.asesor||'').split(':')[1]?.trim() || c.asesor || '-';
    const deudaTexto = c.deudaVigente > 0.005 ? `<div style="font-size:11px;font-weight:700;color:var(--red)">$${c.deudaVigente.toFixed(2)}</div>` : '<span style="color:var(--muted);font-size:11px">—</span>';
    return `<tr class="clickable" style="cursor:pointer" onclick="if(event.target.type!=='checkbox')abrirDetalleClienteModal('${encodeURIComponent(c.nombre)}')">
      <td onclick="event.stopPropagation()"><input type="checkbox" ${checked} onchange="toggleClienteSeleccionadoPdf('${encodeURIComponent(c.nombre)}',this.checked)" style="width:16px;height:16px;accent-color:var(--teal);cursor:pointer"></td>
      <td style="font-weight:700;color:var(--navy)">${escHTML(c.nombre)}</td>
      <td style="font-size:12px;color:var(--muted)">${escHTML(c.telefono||'-')}</td>
      <td style="font-size:12px;color:var(--muted);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeAttr(c.direccion||'')}">${escHTML(c.direccion||'-')}</td>
      <td style="text-align:center">${c.pedidos}</td>
      <td style="text-align:right;font-weight:700;color:var(--teal)">$${c.total.toFixed(2)}</td>
      <td style="font-size:12px;white-space:nowrap">${limpiarFecha(c.ultimoFecha)}<br><small style="color:var(--muted)">${c.diasSinPedido} días</small></td>
      <td style="font-size:12px">${escHTML(asesorNombre)}</td>
      <td>${_badgeEstadoCliente(c.estado)}</td>
      <td>${deudaTexto}</td>
    </tr>`;
  }).join('');

  cont.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th></th><th>Cliente</th><th>Teléfono</th><th>Dirección</th><th style="text-align:center">Pedidos</th><th style="text-align:right">Valor Total</th><th>Último pedido</th><th>Asesor</th><th>Estado</th><th>Deuda</th></tr></thead>
    <tbody>${filas}</tbody>
  </table></div>`;

  _actualizarBotonExportarClientes();
}

function toggleClienteSeleccionadoPdf(nombreCodificado, marcado) {
  const nombre = decodeURIComponent(nombreCodificado);
  if (marcado) _clientesSeleccionadosPdf.add(nombre);
  else _clientesSeleccionadosPdf.delete(nombre);
  _actualizarBotonExportarClientes();
}
function _actualizarBotonExportarClientes() {
  const btn = document.getElementById('btnExportarClientesSeleccionados');
  const txt = document.getElementById('btnExportarClientesTexto');
  if (!btn) return;
  const n = _clientesSeleccionadosPdf.size;
  btn.style.display = n > 0 ? 'flex' : 'none';
  if (txt) txt.textContent = `Exportar ${n} seleccionado${n!==1?'s':''} a PDF`;
}

/* [NEW] Modal 360° del cliente — KPIs, Deuda Vigente e historial de pedidos completo */
function abrirDetalleClienteModal(nombreCodificado) {
  const nombre = decodeURIComponent(nombreCodificado);
  const c = _clientesTablaDatos.find(x => x.nombre === nombre);
  if (!c) return;
  document.getElementById('modalClienteNombre').textContent = c.nombre;
  document.getElementById('modalClienteSub').textContent = `${c.telefono||'-'} · ${c.direccion||'-'}`;
  const deudaHtml = c.deudaVigente > 0.005
    ? `<div class="detail-item-dash"><label>Deuda Vigente</label><strong style="color:var(--red)">$${c.deudaVigente.toFixed(2)}</strong></div>`
    : `<div class="detail-item-dash"><label>Deuda Vigente</label><strong style="color:var(--teal)">✅ Al día</strong></div>`;
  document.getElementById('modalClienteStats').innerHTML = `
    <div class="detail-item-dash"><label>Pedidos</label><strong>${c.pedidos}</strong></div>
    <div class="detail-item-dash"><label>Valor total</label><strong>$${c.total.toFixed(2)}</strong></div>
    <div class="detail-item-dash"><label>Último pedido</label><strong>${limpiarFecha(c.ultimoFecha)}</strong></div>
    <div class="detail-item-dash"><label>Días sin compra</label><strong>${c.diasSinPedido}</strong></div>
    <div class="detail-item-dash"><label>Asesor</label><strong>${escHTML((c.asesor||'').split(':')[1]?.trim()||c.asesor||'-')}</strong></div>
    <div class="detail-item-dash"><label>Estado</label>${_badgeEstadoCliente(c.estado)}</div>
    ${deudaHtml}
  `;
  const filasHistorial = c.items.map(r => `<tr>
    <td style="font-size:12px">${limpiarFecha(r['FECHA'])}</td>
    <td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td>
    <td style="text-align:center">${r['CANTIDAD']||'-'}</td>
    <td style="text-align:right;font-weight:700;color:var(--teal)">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
    <td><span class="badge badge-teal">${escHTML(r['FORMA DE PAGO']||'-')}</span></td>
  </tr>`).join('');
  document.getElementById('modalClienteHistorial').innerHTML = filasHistorial || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Sin historial de productos</td></tr>';
  const tel = (c.telefono||'').replace(/\D/g,'');
  const waBtn = document.getElementById('modalClienteWa');
  if (waBtn) waBtn.href = tel ? `https://wa.me/593${tel.replace(/^0/,'')}` : '#';
  window._clienteModalActual = c; // para el botón de imprimir
  document.getElementById('modalClienteOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function cerrarDetalleClienteModal() {
  document.getElementById('modalClienteOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* [NEW] Imprimir / PDF de UN cliente, desde el modal 360° */
function imprimirClienteModal() {
  const c = window._clienteModalActual;
  if (!c) return;
  _imprimirClientesPDF([c]);
}
/* [NEW] Exporta a PDF los clientes marcados con checkbox en la tabla */
function exportarClientesSeleccionadosPDF() {
  const seleccionados = _clientesTablaDatos.filter(c => _clientesSeleccionadosPdf.has(c.nombre));
  if (!seleccionados.length) { alert('Selecciona al menos un cliente primero.'); return; }
  _imprimirClientesPDF(seleccionados);
}
function _imprimirClientesPDF(clientesArr) {
  const bloques = clientesArr.map(c => {
    const filas = c.items.map(r => `<tr><td>${escHTML(r['PRODUCTO']||'-')}</td><td style="text-align:center">${r['CANTIDAD']||'-'}</td><td style="text-align:right">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td><td>${escHTML(r['FORMA DE PAGO']||'-')}</td></tr>`).join('');
    return `<div class="bloque-cliente-pdf">
      <h2>${escHTML(c.nombre)}</h2>
      <p class="sub">${escHTML(c.telefono||'-')} · ${escHTML(c.direccion||'-')}</p>
      <div class="stats">
        <div><label>Pedidos</label><span>${c.pedidos}</span></div>
        <div><label>Valor total</label><span>$${c.total.toFixed(2)}</span></div>
        <div><label>Último pedido</label><span>${limpiarFecha(c.ultimoFecha)}</span></div>
        <div><label>Estado</label><span>${c.estado}</span></div>
        <div><label>Deuda Vigente</label><span>${c.deudaVigente>0.005?'$'+c.deudaVigente.toFixed(2):'Al día'}</span></div>
      </div>
      <table><thead><tr><th>Producto</th><th>Cant.</th><th>Subtotal</th><th>Pago</th></tr></thead><tbody>${filas}</tbody></table>
    </div>`;
  }).join('<hr>');
  // [NEW] Título de pestaña según la selección real: nombre del cliente si es
  // uno solo, o cantidad si son varios — en vez del genérico "Clientes".
  const tituloSeleccion = clientesArr.length === 1 ? clientesArr[0].nombre : `Clientes (${clientesArr.length})`;
  const v = window.open('', '_blank', 'width=800,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${escHTML(tituloSeleccion)} — Aqua Luan</title>
  <style>
    body{font-family:Arial,sans-serif;color:#1a3a5c;padding:24px}
    h2{font-family:Georgia,serif;font-size:20px;margin-bottom:2px}
    .sub{font-size:12px;color:#888;margin-bottom:14px}
    .stats{display:flex;gap:16px;flex-wrap:wrap;background:#f0f5f8;border-radius:10px;padding:12px 16px;margin-bottom:14px}
    .stats div{display:flex;flex-direction:column}
    .stats label{font-size:9px;font-weight:700;text-transform:uppercase;color:#888}
    .stats span{font-size:14px;font-weight:700}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px}
    th{background:#1a3a5c;color:#fff;padding:8px 10px;text-align:left}
    td{padding:7px 10px;border-bottom:1px solid #eee}
    hr{border:none;border-top:2px dashed #ccc;margin:24px 0}
  </style></head><body><p style="font-size:12px;color:#888;margin-bottom:12px">${escHTML(lineaImpresoPor())} · ${new Date().toLocaleString('es-EC')}</p>${bloques}<script>
    var _impresoPagina=false;
    function _intentarImprimirPagina(){ if(_impresoPagina)return; _impresoPagina=true; window.print(); }
    window.onload=_intentarImprimirPagina;
    setTimeout(_intentarImprimirPagina,180);
  <\/script></body></html>`);
  v.document.close();
  _dispararImpresion(v);
}


/* ════════════════════════════════════════════════════════════
   [NEW] REPORTE POR ASESOR — clic en una tarjeta para ver el
   detalle completo: ventas, productos, regalías, cobrado, gastos
   y desglose por forma de pago, respetando el filtro de fecha
   general del dashboard (pero ignorando el filtro de asesor, para
   poder ver siempre todas las tarjetas).
════════════════════════════════════════════════════════════ */
let _asesorReporteSeleccionado = null;

function renderReporteAsesores(){
  const grid = document.getElementById('reporteAsesorCardsGrid');
  if (!grid) return;
  const datos = getDatosSoloFecha();
  const pedidosConTotal = datos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== '' && r['TOTAL PEDIDO ($)'] && parseFloat(r['TOTAL PEDIDO ($)']) > 0);
  const ventasPorRuta = {};
  pedidosConTotal.forEach(r => { const a = r['ASESOR / RUTA']||''; ventasPorRuta[a] = (ventasPorRuta[a]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });

  if (!_asesoresCache.length) { grid.innerHTML = '<div class="empty-state"><div class="icon">👤</div>No hay asesores registrados</div>'; return; }

  grid.innerHTML = _asesoresCache.map(ruta => {
    const color = colorDeAsesor(ruta);
    const nombre = ruta.split(':')[1]?.trim() || ruta;
    const total = ventasPorRuta[ruta] || 0;
    const activo = ruta === _asesorReporteSeleccionado;
    return `<div class="asesor-card" style="border-left-color:${color};cursor:pointer;${activo?'box-shadow:0 0 0 2px '+color+', var(--shadow)':''}" onclick="seleccionarAsesorReporte('${ruta.replace(/'/g,"\\'")}')">
      <div class="asesor-card-header"><div class="asesor-dot" style="background:${color}"></div><div class="asesor-nombre" style="color:${color}">${nombre}</div></div>
      <div class="asesor-stats"><div class="asesor-stat"><div class="asesor-stat-label">Ventas del período</div><div class="asesor-stat-value" style="color:${color}">$${total.toFixed(2)}</div></div></div>
    </div>`;
  }).join('');

  if (_asesorReporteSeleccionado) renderReporteAsesorDetalle();
}

function seleccionarAsesorReporte(ruta){
  _asesorReporteSeleccionado = ruta;
  document.querySelectorAll('#reporteAsesorCardsGrid .asesor-card').forEach(card=>{
    card.style.boxShadow='';
  });
  const grid=document.getElementById('reporteAsesorCardsGrid');
  if(grid){
    const idx=(_asesoresCache||[]).indexOf(ruta);
    const card=grid.children[idx];
    if(card){
      const color=colorDeAsesor(ruta);
      card.style.boxShadow='0 0 0 2px '+color+', var(--shadow)';
    }
  }
  const wrap = document.getElementById('reporteAsesorDetalleWrap');
  if (wrap) wrap.style.display='block';
  requestAnimationFrame(()=>{
    renderReporteAsesorDetalle();
  });
}

function renderReporteAsesorDetalle(){
  const wrap = document.getElementById('reporteAsesorDetalleWrap');
  if (!wrap || !_asesorReporteSeleccionado) return;
  wrap.style.display = 'block';
  const ruta = _asesorReporteSeleccionado;
  const nombre = ruta.split(':')[1]?.trim() || ruta;
  const datos = getDatosSoloFecha().filter(r => (r['ASESOR / RUTA']||'') === ruta);
  const pedidos = datos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== '');
  const pagos   = datos.filter(r => !r['PRODUCTO'] && r['TOTAL PEDIDO ($)'] > 0 && String(r['TOTAL PEDIDO ($)']).indexOf('-') === -1);
  const gastos  = datos.filter(r => String(r['TOTAL PEDIDO ($)']).indexOf('-') !== -1);
  const pedidosConTotal = pedidos.filter(r => r['TOTAL PEDIDO ($)'] && parseFloat(r['TOTAL PEDIDO ($)']) > 0);

  const totalVentas  = pedidosConTotal.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalCobrado = pagos.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalGastos  = gastos.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const clientesUnicos = new Set(pedidos.map(r => r['CLIENTE'])).size;
  const pedidosUnicos  = new Set(pedidos.map(r => r['_pedidoId'] || `${r['CLIENTE']}-${r['FECHA']}`)).size; // [FIX] usa el ID real del pedido cuando existe
  // [FIX] "Total en caja" no puede salir de (Total cobrado − Total gastos):
  // "Total cobrado" solo suma la colección de Pagos (mezclando además
  // Efectivo/Transferencia/Cheque) y nunca incluye las Ventas al Contado del
  // día. Se recalcula aquí igual que en Liquidación: Ventas al Contado (con
  // el ajuste de abono parcial) + Pagos cobrados SOLO en Efectivo − Gastos.
  const pagosEfectivoAsesor = pagos.filter(r => r['FORMA DE PAGO']==='Efectivo').reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  // [FIX] NUEVO FORMATO DE PAGO MÚLTIPLE — antes, un pedido 'Mixto' (varias formas
  // marcadas) nunca coincidía con 'Contado' exacto, así que la parte realmente cobrada
  // en efectivo dentro de esos pedidos se perdía por completo de "Total en caja" de este
  // asesor. Ahora, si el pedido trae el desglose (PAGOS_DESGLOSE), se suma solo la
  // porción marcada como "Contado" dentro de ese desglose.
  const ventasContadoAsesor = pedidosConTotal.reduce((s,r) => {
    const tot = parseFloat(r['TOTAL PEDIDO ($)']) || 0;
    if (r['PAGOS_DESGLOSE'] && r['PAGOS_DESGLOSE'].length) {
      const contadoParte = r['PAGOS_DESGLOSE'].filter(pg => pg.forma === 'Contado').reduce((s2,pg) => s2 + (parseFloat(pg.monto)||0), 0);
      return s + contadoParte;
    }
    const abono = parseFloat(r['ABONO'] || 0);
    if (abono > 0 && abono < tot) return s; // abono parcial: el efectivo real ya se cuenta vía Pagos, no se duplica aquí
    if (abono >= tot && tot > 0) return s + tot; // el abono cubrió el 100% de la venta
    return r['FORMA DE PAGO'] === 'Contado' ? s + tot : s;
  }, 0);
  const totalCajaAsesor = ventasContadoAsesor + pagosEfectivoAsesor - totalGastos;

  const porFormaVentas = {};
  pedidosConTotal.forEach(r => { const f = r['FORMA DE PAGO']||'Sin especificar'; porFormaVentas[f] = (porFormaVentas[f]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const tagsFormaVentas = Object.entries(porFormaVentas).sort(([,a],[,b]) => b-a).map(([f,v]) => `<span class="badge badge-teal" style="margin-right:4px">${f}: $${v.toFixed(2)}</span>`).join('') || '<span style="color:var(--muted);font-size:12px">Sin ventas en este período</span>';

  const porProducto = {}; const porRegalia = {};
  pedidos.forEach(r => {
    const nombreProd = r['PRODUCTO']||'';
    if (nombreProd.startsWith('🎁 REGALO:')) {
      const limpio = nombreProd.replace('🎁 REGALO: ','');
      porRegalia[limpio] = (porRegalia[limpio]||0) + (parseFloat(r['CANTIDAD'])||0);
    } else if (nombreProd) {
      if (!porProducto[nombreProd]) porProducto[nombreProd] = { cantidad:0, subtotal:0 };
      porProducto[nombreProd].cantidad += parseFloat(r['CANTIDAD'])||0;
      porProducto[nombreProd].subtotal += parseFloat(r['SUBTOTAL'])||0;
    }
  });
  const filasProducto = Object.entries(porProducto).sort(([,a],[,b]) => b.subtotal-a.subtotal)
    .map(([n,d]) => `<tr><td style="font-weight:600">${escHTML(n)}</td><td style="text-align:right">${d.cantidad%1===0?parseInt(d.cantidad):d.cantidad.toFixed(1)}</td><td style="text-align:right;font-weight:700;color:var(--teal)">$${d.subtotal.toFixed(2)}</td></tr>`).join('')
    || '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Sin productos vendidos</td></tr>';
  const filasRegalia = Object.entries(porRegalia).sort(([,a],[,b]) => b-a)
    .map(([n,c]) => `<tr><td style="font-weight:600">🎁 ${escHTML(n)}</td><td style="text-align:right">${c%1===0?parseInt(c):c.toFixed(1)}</td></tr>`).join('')
    || '<tr><td colspan="2" style="text-align:center;color:var(--muted)">Sin regalías entregadas</td></tr>';

  const filasPedidos = pedidos.slice(0,150).map(r => {
    const total = r['TOTAL PEDIDO ($)'] ? `<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>` : '';
    const pago = r['FORMA DE PAGO'] ? `<span class="badge badge-teal">${r['FORMA DE PAGO']}</span>` : '';
    return `<tr><td style="font-size:12px">${limpiarFecha(r['FECHA'])}</td><td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td><td style="font-size:12px">${escHTML(r['PRODUCTO']||'-')}</td><td style="text-align:center">${r['CANTIDAD']||'-'}</td><td style="text-align:right">${total}</td><td>${pago}</td></tr>`;
  }).join('') || '<tr><td colspan="6"><div class="empty-state"><div class="icon">📋</div>Sin pedidos en este período</div></td></tr>';

  const filasPagos = pagos.map(r => `<tr><td style="font-weight:600">${escHTML(r['CLIENTE']||'-')}</td><td style="text-align:right;font-weight:700;color:var(--blue)">$${(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td><td>${r['FORMA DE PAGO']?`<span class="badge badge-blue">${r['FORMA DE PAGO']}</span>`:'-'}</td><td style="font-size:12px;color:var(--muted)">${limpiarFecha(r['FECHA'])}</td></tr>`).join('')
    || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sin pagos registrados</td></tr>';
  const filasGastos = gastos.map(r => `<tr><td style="font-weight:600">${escHTML(r['NOTAS']||'-')}</td><td style="text-align:right;font-weight:700;color:var(--red)">$${Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td><td style="font-size:12px;color:var(--muted)">${limpiarFecha(r['FECHA'])}</td></tr>`).join('')
    || '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Sin gastos registrados</td></tr>';

  wrap.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">👤 ${nombre} — Reporte Detallado</div>
        <button class="btn-filter" style="background:#0f7c38" onclick="imprimirReporteAsesor('${ruta.replace(/'/g,"\\'")}')">Imprimir esta ruta</button>
      </div>
      <div class="kpi-grid" style="padding:1rem 1.25rem 0">
        <div class="kpi-card teal"><div class="kpi-icon">💰</div><div class="kpi-label">Total ventas</div><div class="kpi-value">$${totalVentas.toFixed(2)}</div><div class="kpi-sub">${pedidosUnicos} pedido(s)</div></div>
        <div class="kpi-card blue"><div class="kpi-icon">💳</div><div class="kpi-label">Total cobrado</div><div class="kpi-value">$${totalCobrado.toFixed(2)}</div><div class="kpi-sub">${pagos.length} pago(s)</div></div>
        <div class="kpi-card red"><div class="kpi-icon">📉</div><div class="kpi-label">Total gastos</div><div class="kpi-value">$${totalGastos.toFixed(2)}</div><div class="kpi-sub">${gastos.length} gasto(s)</div></div>
        <div class="kpi-card orange"><div class="kpi-icon">👥</div><div class="kpi-label">Clientes atendidos</div><div class="kpi-value">${clientesUnicos}</div></div>
        <div class="kpi-card navy"><div class="kpi-icon">🧮</div><div class="kpi-label">Total en caja</div><div class="kpi-value" style="color:${totalCajaAsesor>=0?'#0a7c6e':'#c0392b'}">$${totalCajaAsesor.toFixed(2)}</div></div>
      </div>
      <div class="table-header"><div class="table-title">💳 Formas de pago (ventas)</div></div>
      <div style="padding:0 1.25rem 14px">${tagsFormaVentas}</div>
      <div class="table-header"><div class="table-title">📦 Productos vendidos</div></div>
      <div class="table-wrap"><table><thead><tr><th>Producto</th><th style="text-align:right">Cant.</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${filasProducto}</tbody></table></div>
      <div class="table-header"><div class="table-title">🎁 Regalías entregadas</div></div>
      <div class="table-wrap"><table><thead><tr><th>Regalía</th><th style="text-align:right">Cant.</th></tr></thead><tbody>${filasRegalia}</tbody></table></div>
      <div class="table-header"><div class="table-title">📋 Detalle de pedidos</div></div>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">Total</th><th>Pago</th></tr></thead><tbody>${filasPedidos}</tbody></table></div>
      <div class="table-header"><div class="table-title">💰 Pagos cobrados</div></div>
      <div class="table-wrap"><table><thead><tr><th>Cliente</th><th style="text-align:right">Monto</th><th>Forma</th><th>Fecha</th></tr></thead><tbody>${filasPagos}</tbody></table></div>
      <div class="table-header"><div class="table-title">Gastos registrados</div></div>
      <div class="table-wrap"><table><thead><tr><th>Descripción</th><th style="text-align:right">Monto</th><th>Fecha</th></tr></thead><tbody>${filasGastos}</tbody></table></div>
    </div>`;
}

function _datosReporteAsesor(ruta){
  const nombre = (ruta||'').split(':')[1]?.trim() || ruta || 'Sin asignar';
  const datos = getDatosSoloFecha().filter(r => (r['ASESOR / RUTA']||'') === ruta);
  const pedidos = datos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== '');
  const pagos   = datos.filter(r => !r['PRODUCTO'] && r['TOTAL PEDIDO ($)'] > 0 && String(r['TOTAL PEDIDO ($)']).indexOf('-') === -1);
  const gastos  = datos.filter(r => String(r['TOTAL PEDIDO ($)']).indexOf('-') !== -1);
  const pedidosConTotal = pedidos.filter(r => r['TOTAL PEDIDO ($)'] && parseFloat(r['TOTAL PEDIDO ($)']) > 0);
  const totalVentas  = pedidosConTotal.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalCobrado = pagos.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalGastos  = gastos.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const clientesUnicos = new Set(pedidos.map(r => r['CLIENTE'])).size;
  const pedidosUnicos  = new Set(pedidos.map(r => r['_pedidoId'] || `${r['CLIENTE']}-${r['FECHA']}`)).size;
  const pagosEfectivoAsesor = pagos.filter(r => r['FORMA DE PAGO']==='Efectivo').reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const ventasContadoAsesor = pedidosConTotal.reduce((s,r) => {
    const tot = parseFloat(r['TOTAL PEDIDO ($)']) || 0;
    if (r['PAGOS_DESGLOSE'] && r['PAGOS_DESGLOSE'].length) {
      const contadoParte = r['PAGOS_DESGLOSE'].filter(pg => pg.forma === 'Contado').reduce((s2,pg) => s2 + (parseFloat(pg.monto)||0), 0);
      return s + contadoParte;
    }
    const abono = parseFloat(r['ABONO'] || 0);
    if (abono > 0 && abono < tot) return s;
    if (abono >= tot && tot > 0) return s + tot;
    return r['FORMA DE PAGO'] === 'Contado' ? s + tot : s;
  }, 0);
  const totalCajaAsesor = ventasContadoAsesor + pagosEfectivoAsesor - totalGastos;
  const porFormaVentas = {};
  pedidosConTotal.forEach(r => { const f = r['FORMA DE PAGO']||'Sin especificar'; porFormaVentas[f] = (porFormaVentas[f]||0) + (parseFloat(r['TOTAL PEDIDO ($)'])||0); });
  const porProducto = {}; const porRegalia = {};
  pedidos.forEach(r => {
    const nombreProd = r['PRODUCTO']||'';
    if (nombreProd.startsWith('🎁 REGALO:')) {
      const limpio = nombreProd.replace('🎁 REGALO: ','');
      porRegalia[limpio] = (porRegalia[limpio]||0) + (parseFloat(r['CANTIDAD'])||0);
    } else if (nombreProd) {
      if (!porProducto[nombreProd]) porProducto[nombreProd] = { cantidad:0, subtotal:0 };
      porProducto[nombreProd].cantidad += parseFloat(r['CANTIDAD'])||0;
      porProducto[nombreProd].subtotal += parseFloat(r['SUBTOTAL'])||0;
    }
  });
  return { nombre, pedidos, pagos, gastos, pedidosConTotal, totalVentas, totalCobrado, totalGastos, clientesUnicos, pedidosUnicos, totalCajaAsesor, porFormaVentas, porProducto, porRegalia };
}
function _htmlPrintReporteAsesor(ruta){
  const d=_datosReporteAsesor(ruta);
  const formas=Object.entries(d.porFormaVentas).sort(([,a],[,b])=>b-a).map(([f,v])=>`${escHTML(f)}: $${v.toFixed(2)}`).join(' · ') || 'Sin ventas';
  const filasProd=Object.entries(d.porProducto).sort(([,a],[,b])=>b.subtotal-a.subtotal).map(([n,p])=>`<tr><td>${escHTML(n)}</td><td style="text-align:right">${p.cantidad%1===0?parseInt(p.cantidad):p.cantidad.toFixed(1)}</td><td style="text-align:right">$${p.subtotal.toFixed(2)}</td></tr>`).join('')||'<tr><td colspan="3">Sin productos</td></tr>';
  const filasReg=Object.entries(d.porRegalia).sort(([,a],[,b])=>b-a).map(([n,c])=>`<tr><td>🎁 ${escHTML(n)}</td><td style="text-align:right">${c%1===0?parseInt(c):c.toFixed(1)}</td></tr>`).join('')||'<tr><td colspan="2">Sin regalías</td></tr>';
  const filasPed=d.pedidos.slice(0,300).map(r=>`<tr><td>${escHTML(limpiarFecha(r['FECHA']))}</td><td>${escHTML(r['CLIENTE']||'-')}</td><td>${escHTML(r['PRODUCTO']||'-')}</td><td style="text-align:center">${escHTML(String(r['CANTIDAD']||'-'))}</td><td style="text-align:right">${r['TOTAL PEDIDO ($)']?'$'+(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2):''}</td><td>${escHTML(r['FORMA DE PAGO']||'')}</td></tr>`).join('')||'<tr><td colspan="6">Sin pedidos</td></tr>';
  const filasPag=d.pagos.map(r=>`<tr><td>${escHTML(r['CLIENTE']||'-')}</td><td style="text-align:right">$${(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td><td>${escHTML(r['FORMA DE PAGO']||'-')}</td><td>${escHTML(limpiarFecha(r['FECHA']))}</td></tr>`).join('')||'<tr><td colspan="4">Sin pagos</td></tr>';
  const filasGas=d.gastos.map(r=>`<tr><td>${escHTML(r['NOTAS']||'-')}</td><td style="text-align:right">$${Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td><td>${escHTML(limpiarFecha(r['FECHA']))}</td></tr>`).join('')||'<tr><td colspan="3">Sin gastos</td></tr>';
  return `<div class="ruta-print">
    <h2>${escHTML(d.nombre)} — ${escHTML(ruta)}</h2>
    <div class="kpis">
      <div><b>Total ventas</b><span>$${d.totalVentas.toFixed(2)}</span><small>${d.pedidosUnicos} pedido(s)</small></div>
      <div><b>Total cobrado</b><span>$${d.totalCobrado.toFixed(2)}</span><small>${d.pagos.length} pago(s)</small></div>
      <div><b>Total gastos</b><span>$${d.totalGastos.toFixed(2)}</span><small>${d.gastos.length} gasto(s)</small></div>
      <div><b>Clientes</b><span>${d.clientesUnicos}</span></div>
      <div><b>Total en caja</b><span>$${d.totalCajaAsesor.toFixed(2)}</span></div>
    </div>
    <p class="formas"><b>Formas de pago:</b> ${formas}</p>
    <h3>Productos vendidos</h3>
    <table><thead><tr><th>Producto</th><th style="text-align:right">Cant.</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${filasProd}</tbody></table>
    <h3>Regalías entregadas</h3>
    <table><thead><tr><th>Regalía</th><th style="text-align:right">Cant.</th></tr></thead><tbody>${filasReg}</tbody></table>
    <h3>Detalle de pedidos</h3>
    <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">Total</th><th>Pago</th></tr></thead><tbody>${filasPed}</tbody></table>
    <h3>Pagos cobrados</h3>
    <table><thead><tr><th>Cliente</th><th style="text-align:right">Monto</th><th>Forma</th><th>Fecha</th></tr></thead><tbody>${filasPag}</tbody></table>
    <h3>Gastos registrados</h3>
    <table><thead><tr><th>Descripción</th><th style="text-align:right">Monto</th><th>Fecha</th></tr></thead><tbody>${filasGas}</tbody></table>
    <div class="firmas">
      <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Liquidadora</div></div>
      <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Asesor</div></div>
      <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Ayudante</div></div>
    </div>
  </div>`;
}
function _abrirPrintReporteAsesor(titulo, bloquesHtml){
  const fecha=_textoRangoFecha();
  const v=window.open('','_blank','width=900,height=900');
  if(!v){ alert('Permite ventanas emergentes para imprimir.'); return; }
  const logoUrl=location.origin+'/logo-luanaqua.png';
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${escHTML(titulo)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:22px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:14px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;}
    .print-header h1{font-family:Georgia,serif;font-size:20px;}
    .print-header p{font-size:11px;color:#888;margin-top:3px;}
    .ruta-print{page-break-after:always;margin-bottom:22px;}
    .ruta-print:last-child{page-break-after:auto;}
    h2{font-size:16px;margin:0 0 10px;color:#1a3a5c;}
    h3{font-size:12px;margin:14px 0 6px;letter-spacing:.04em;text-transform:uppercase;color:#0a7c6e;}
    .kpis{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}
    .kpis div{flex:1;min-width:110px;border:1px solid #d2dae2;border-radius:8px;padding:8px;}
    .kpis b{display:block;font-size:10px;color:#888;text-transform:uppercase;}
    .kpis span{display:block;font-weight:800;font-size:16px;margin-top:2px;}
    .kpis small{color:#888;font-size:10px;}
    .formas{font-size:12px;margin-bottom:8px;}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;}
    th{text-align:left;font-size:9px;color:#888;border-bottom:1px solid #d2dae2;padding:4px;}
    td{padding:4px;border-bottom:1px solid #eef2f6;}
    .firmas{display:flex;justify-content:space-between;gap:30px;margin-top:70px;page-break-inside:avoid;}
    .firmas .firma{flex:1;text-align:center;}
    .firmas .firma-linea{border-top:1.5px solid #1a3a5c;margin-bottom:6px;}
    .firmas .firma-label{font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#1a3a5c;}
    @media print{body{padding:10px;} .firmas{margin-top:60px;}}
  </style></head><body>
  <div class="print-header">
    <img src="${logoUrl}" alt="Aqua Luan" onerror="this.style.display='none'">
    <div>
      <h1>${escHTML(titulo)}</h1>
      <p>Período: ${escHTML(fecha)} · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(typeof lineaImpresoPor==='function'?lineaImpresoPor():'')}</p>
    </div>
  </div>
  ${bloquesHtml}
  <script>
    var _ok=false; function _go(){ if(_ok)return; _ok=true; window.print(); }
    window.onload=_go; setTimeout(_go,180);
  <\/script>
  </body></html>`);
  v.document.close();
  if(typeof _dispararImpresion==='function') _dispararImpresion(v);
}
function imprimirReporteAsesor(ruta){
  const r=ruta||_asesorReporteSeleccionado;
  if(!r){ alert('Selecciona una ruta para imprimir.'); return; }
  const nombre=(r.split(':')[1]||r).trim();
  _abrirPrintReporteAsesor('Reporte por Asesor — '+nombre, _htmlPrintReporteAsesor(r));
}
function imprimirReporteTodasLasRutas(){
  const rutas=(_asesoresCache&&_asesoresCache.length)?_asesoresCache.slice():[];
  if(!rutas.length){ alert('No hay rutas para imprimir.'); return; }
  const html=[];
  let i=0;
  function _paso(){
    const fin=Math.min(i+1, rutas.length);
    for(;i<fin;i++) html.push(_htmlPrintReporteAsesor(rutas[i]));
    if(i<rutas.length){
      setTimeout(_paso,0);
    }else{
      _abrirPrintReporteAsesor('Reporte por Asesor — Todas las rutas', html.join(''));
    }
  }
  _paso();
}

function limpiarFecha(fecha) {
  if(!fecha) return '-';
  const f=String(fecha);
  if(f.includes('T')) return f.split('T')[0];
  return f;
}

/* ════════════════════════════════════════
   CIERRE DEL DÍA
════════════════════════════════════════ */
const ICONOS_PAGO = { 'Contado':'💵','Crédito':'📋','Transferencia':'🏦','Cheque':'📝','Efectivo':'💵','Sin especificar':'❓' };
const COLORES_PAGO = { 'Contado':'#0a7c6e','Crédito':'#1565c0','Transferencia':'#e67e22','Cheque':'#880e4f','Efectivo':'#0a7c6e','Sin especificar':'#888' };

function abrirCierreDia() {
  const fecha = document.getElementById('filtroFecha').value || fechaHoy();
  const datos = todosLosDatos.filter(r => {
    const f = String(r['FECHA']||'');
    return f.startsWith(fecha) || f.includes(fecha);
  });
  const pedidos = datos.filter(r => r['PRODUCTO'] && r['PRODUCTO'] !== ''); /* [FIX] antes exigía TOTAL PEDIDO($)>0, lo que excluía todas las líneas de producto extra y TODAS las regalías de un pedido — el total en $ sigue calculándose igual (vía _pedidosVisto), pero ahora las unidades sí suman completas */

  document.getElementById('cierreFechaBadge').textContent = fecha || 'Todos los registros';

  const body = document.getElementById('cierreBody');

  if (!pedidos.length) {
    body.innerHTML = '<div style="padding:3rem;text-align:center;color:var(--muted)"><div style="font-size:2.5rem;margin-bottom:10px">📭</div>No hay pedidos registrados para esta fecha.</div>';
    document.getElementById('cierreOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    return;
  }

  // ── Agrupar por asesor
  const porAsesor = {};
  pedidos.forEach(r => {
    const asesor = r['ASESOR / RUTA'] || 'Sin asignar';
    if (!porAsesor[asesor]) porAsesor[asesor] = { pedidos:[], productos:{}, formasPago:{}, total:0, clientesUnicos:new Set() };
    const d = porAsesor[asesor];
    d.clientesUnicos.add(r['CLIENTE']||'');
    const tot = parseFloat(r['TOTAL PEDIDO ($)']||0);

    // Acumular producto
    const prod = r['PRODUCTO'] || 'Sin nombre';
    if (!d.productos[prod]) d.productos[prod] = { cantidad:0, dolares:0 };
    d.productos[prod].cantidad += parseFloat(r['CANTIDAD']||0);
    d.productos[prod].dolares  += parseFloat(r['SUBTOTAL']||0);

    // Acumular forma de pago — solo 1 vez por pedido único
    const keyPedido = `${r['CLIENTE']}-${r['FECHA']}-${asesor}`;
    if (!d._pedidosVisto) d._pedidosVisto = new Set();
    if (!d._pedidosVisto.has(keyPedido)) {
      d._pedidosVisto.add(keyPedido);
      const forma = r['FORMA DE PAGO'] || 'Sin especificar';
      d.formasPago[forma] = (d.formasPago[forma]||0) + tot;
      d.total += tot;
    }
    d.pedidos.push(r);
  });

  // ── Total general
  let totalGeneral = 0;
  const formasGlobal = {};
  Object.values(porAsesor).forEach(d => {
    totalGeneral += d.total;
    Object.entries(d.formasPago).forEach(([f,v]) => { formasGlobal[f] = (formasGlobal[f]||0) + v; });
  });

  // ── Renderizar bloques por asesor
  let html = '';
  Object.entries(porAsesor).sort(([,a],[,b]) => b.total - a.total).forEach(([asesor, d]) => {
    const color  = colorDeAsesor(asesor);
    const nombre = asesor.split(':')[1]?.trim() || asesor;
    const numClientes = d.clientesUnicos.size;
    const numPedidos  = d._pedidosVisto ? d._pedidosVisto.size : 0;

    // Filas productos
    const prodsOrdenados = Object.entries(d.productos).sort(([,a],[,b]) => b.dolares - a.dolares);
    const totalCantidad  = prodsOrdenados.reduce((s,[,p]) => s + p.cantidad, 0);
    const totalDolares   = prodsOrdenados.reduce((s,[,p]) => s + p.dolares, 0);

    const filasProductos = prodsOrdenados.map(([nom,p]) => `
      <tr>
        <td><span style="font-weight:600;color:var(--navy)">${escHTML(nom)}</span></td>
        <td style="font-weight:700;color:var(--blue)">${p.cantidad % 1 === 0 ? parseInt(p.cantidad) : p.cantidad.toFixed(1)}</td>
        <td style="font-weight:700;color:var(--teal)">$${p.dolares.toFixed(2)}</td>
      </tr>`).join('');

    // Tags formas de pago del asesor
    const tagsPago = Object.entries(d.formasPago).sort(([,a],[,b]) => b-a).map(([f,v]) => `
      <div class="cierre-pago-tag">
        <span>${ICONOS_PAGO[f]||'💳'}</span>
        <span>${f}</span>
        <span class="cierre-pago-tag-valor">$${v.toFixed(2)}</span>
      </div>`).join('');

    // ── Detalle por cliente (todos los productos con precios, agrupados por cliente)
    const porCliente = {};
    d.pedidos.forEach(r => {
      const cliente = r['CLIENTE'] || 'Sin nombre';
      if (!porCliente[cliente]) porCliente[cliente] = { items: [], hora: '', formaPago: '' };
      porCliente[cliente].items.push(r);
      if (r['HORA REGISTRO']) porCliente[cliente].hora = r['HORA REGISTRO'];
      if (r['FORMA DE PAGO']) porCliente[cliente].formaPago = r['FORMA DE PAGO'];
    });

    const clientesOrdenados = Object.entries(porCliente).sort(([,a],[,b]) => (a.hora||'').localeCompare(b.hora||''));

    const clientesHtml = clientesOrdenados.map(([clienteRaw, c]) => { const cliente = escHTML(clienteRaw);
      const totalesPedido = c.items.map(r => parseFloat(r['TOTAL PEDIDO ($)']||0)).filter(v => v > 0);
      const totalCliente = totalesPedido.length ? totalesPedido[0] : c.items.reduce((s,r) => s + (parseFloat(r['SUBTOTAL']||0)), 0);

      const filasProdCliente = c.items.map(r => `
        <tr>
          <td>${escHTML(r['PRODUCTO']||'-')}</td>
          <td>$${parseFloat(r['PRECIO UNIT.']||0).toFixed(2)}</td>
          <td>${r['CANTIDAD']||'-'}</td>
          <td>$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
        </tr>`).join('');

      return `
        <div class="cierre-cliente-block">
          <div class="cierre-cliente-header">
            <span class="cierre-cliente-nombre">👤 ${cliente}</span>
            <span class="cierre-cliente-meta">${c.hora?'🕐 '+c.hora+'  ·  ':''}${ICONOS_PAGO[c.formaPago]||'💳'} ${c.formaPago||'Sin especificar'}</span>
            <span class="cierre-cliente-total">$${totalCliente.toFixed(2)}</span>
          </div>
          <table class="cierre-cliente-table">
            <thead><tr><th>Producto</th><th>Precio Unit.</th><th>Cant.</th><th>Subtotal</th></tr></thead>
            <tbody>${filasProdCliente}</tbody>
          </table>
        </div>`;
    }).join('');

    html += `
      <div class="cierre-asesor-block">
        <div class="cierre-asesor-header" style="background:${color}">
          <div class="cierre-asesor-nombre">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="white" stroke-width="1.4"/><path d="M2 14c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="white" stroke-width="1.4" stroke-linecap="round"/></svg>
            ${nombre}
            <span style="font-size:10px;font-weight:500;opacity:0.6;text-transform:uppercase;letter-spacing:0.06em">${asesor.includes('RUTA') ? asesor.split(':')[0].trim() : ''}</span>
            <span style="font-size:11px;font-weight:600;opacity:0.75;margin-left:4px">${numClientes} cliente${numClientes!==1?'s':''} · ${numPedidos} pedido${numPedidos!==1?'s':''}</span>
          </div>
          <div class="cierre-asesor-total">$${d.total.toFixed(2)}</div>
        </div>

        <div class="cierre-section-label">📦 Productos vendidos (resumen)</div>
        <table class="cierre-prod-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Total ($)</th>
            </tr>
          </thead>
          <tbody>
            ${filasProductos}
            <tr class="cierre-prod-subtotal">
              <td style="font-weight:800">SUBTOTAL ASESOR</td>
              <td style="font-weight:800;text-align:right;color:var(--blue)">${totalCantidad % 1 === 0 ? parseInt(totalCantidad) : totalCantidad.toFixed(1)}</td>
              <td style="font-weight:800;text-align:right;color:var(--teal)">$${totalDolares.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div class="cierre-section-label">👥 Detalle por cliente</div>
        ${clientesHtml}

        <div class="cierre-section-label">💳 Formas de pago</div>
        <div class="cierre-pago-tags">${tagsPago}</div>
      </div>`;
  });

  // ── Resumen global de formas de pago
  const tagsGlobal = Object.entries(formasGlobal).sort(([,a],[,b]) => b-a).map(([f,v]) => `
    <div class="cierre-pago-tag" style="border-color:var(--teal);background:var(--teal-light)">
      <span>${ICONOS_PAGO[f]||'💳'}</span>
      <span style="color:var(--teal-dark)">${f}</span>
      <span class="cierre-pago-tag-valor" style="font-size:14px">$${v.toFixed(2)}</span>
    </div>`).join('');

  html += `
    <div class="cierre-resumen-pagos-global">
      <div class="cierre-resumen-pagos-title">💳 Resumen global de formas de pago</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${tagsGlobal}</div>
    </div>
    <div class="cierre-total-general">
      <div>
        <div class="cierre-total-label">Total general del día</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px">${pedidos.length} líneas · ${Object.keys(porAsesor).length} asesor${Object.keys(porAsesor).length!==1?'es':''}</div>
      </div>
      <div class="cierre-total-value">$${totalGeneral.toFixed(2)}</div>
    </div>`;

  // [NEW] Cuadre de Caja del día — Ingresos (pagos) vs Egresos (gastos)
  const pagosCierre  = datos.filter(r => !r['PRODUCTO'] && r['TOTAL PEDIDO ($)'] > 0 && String(r['TOTAL PEDIDO ($)']).indexOf('-') === -1);
  const gastosCierre = datos.filter(r => String(r['TOTAL PEDIDO ($)']).indexOf('-') !== -1);
  const totalIngresosCierre = pagosCierre.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalEgresosCierre  = gastosCierre.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const netoCierre = totalIngresosCierre - totalEgresosCierre;
  html += `
    <div class="cierre-resumen-pagos-global" style="margin-top:1rem">
      <div class="cierre-resumen-pagos-title">🧮 Cuadre de Caja del día</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div style="flex:1;min-width:150px;background:var(--teal-light);border:1.5px solid var(--success-border,#4ec9a0);border-radius:var(--radius);padding:12px 16px">
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--teal-dark)">🟢 Ingresos (pagos)</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:1.4rem;color:var(--teal-dark)">$${totalIngresosCierre.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--muted)">${pagosCierre.length} pago(s)</div>
        </div>
        <div style="flex:1;min-width:150px;background:#fdecea;border:1.5px solid #e57373;border-radius:var(--radius);padding:12px 16px">
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--red)">🔴 Egresos (gastos)</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:1.4rem;color:var(--red)">$${totalEgresosCierre.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--muted)">${gastosCierre.length} gasto(s)</div>
        </div>
      </div>
    </div>
    <div class="cierre-total-general" style="background:${netoCierre>=0?'var(--navy)':'#7a2020'}">
      <div>
        <div class="cierre-total-label">🧮 Total en caja (Ingresos − Egresos)</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px">Pagos y gastos registrados este día — no incluye ventas a crédito sin cobrar</div>
      </div>
      <div class="cierre-total-value">$${netoCierre.toFixed(2)}</div>
    </div>`;

  body.innerHTML = html;
  document.getElementById('cierreOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarCierreDia() {
  document.getElementById('cierreOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function imprimirCierre() {
  const fecha  = document.getElementById('cierreFechaBadge').textContent;
  const cuerpo = _quitarEmoji(document.getElementById('cierreBody').innerHTML);
  const v = window.open('','_blank','width=800,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cierre del Día — Aqua Luan — ${fecha}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .cierre-asesor-block{border:1.5px solid #ddd;border-radius:12px;overflow:hidden;margin-bottom:20px;page-break-inside:avoid;}
    .cierre-asesor-header{padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;}
    .cierre-asesor-nombre{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#fff;}
    .cierre-asesor-total{font-family:Georgia,'Times New Roman',serif;font-size:1.3rem;color:#4ec9a0;}
    .cierre-section-label{font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#888;padding:8px 16px 4px;border-bottom:1px solid #eee;background:#f8f8f8;}
    .cierre-prod-table{width:100%;border-collapse:collapse;font-size:12px;}
    .cierre-prod-table th{background:#f0f5f8;padding:7px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;}
    .cierre-prod-table th:nth-child(2),.cierre-prod-table th:nth-child(3){text-align:right;}
    .cierre-prod-table td{padding:9px 14px;border-bottom:1px solid #f0f0f0;font-weight:500;}
    .cierre-prod-table td:nth-child(2),.cierre-prod-table td:nth-child(3){text-align:right;}
    .cierre-prod-subtotal td{background:#e6f4f2!important;font-weight:800;color:#085f54;border-top:2px solid #0a7c6e!important;}
    .cierre-pago-tags{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;border-top:1px solid #eee;}
    .cierre-pago-tag{display:flex;align-items:center;gap:6px;background:#f0f5f8;border:1.5px solid #ddd;border-radius:100px;padding:5px 14px;font-size:12px;font-weight:700;color:#1a3a5c;}
    .cierre-pago-tag-valor{color:#0a7c6e;font-size:13px;margin-left:2px;}
    .cierre-resumen-pagos-global{background:#f0f5f8;border:1.5px solid #ddd;border-radius:12px;padding:14px 16px;margin-top:16px;}
    .cierre-resumen-pagos-title{font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#0a7c6e;margin-bottom:10px;}
    .cierre-total-general{background:#1a3a5c;border-radius:12px;padding:16px 20px;margin-top:16px;display:flex;align-items:center;justify-content:space-between;}
    .cierre-total-label{font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);}
    .cierre-total-value{font-family:Georgia,'Times New Roman',serif;font-size:2rem;color:#4ec9a0;}
    .cierre-cliente-block{border:1px solid #ddd;border-radius:10px;overflow:hidden;margin:8px 16px;page-break-inside:avoid;}
    .cierre-cliente-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 12px;background:#f0f5f8;border-bottom:1px solid #eee;}
    .cierre-cliente-nombre{font-size:12.5px;font-weight:800;color:#1a3a5c;}
    .cierre-cliente-meta{font-size:10.5px;color:#888;font-weight:600;}
    .cierre-cliente-total{font-size:13px;font-weight:800;color:#0a7c6e;}
    .cierre-cliente-table{width:100%;border-collapse:collapse;font-size:11.5px;}
    .cierre-cliente-table th{padding:5px 12px;text-align:left;font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;}
    .cierre-cliente-table th:nth-child(2),.cierre-cliente-table th:nth-child(3),.cierre-cliente-table th:nth-child(4){text-align:right;}
    .cierre-cliente-table td{padding:6px 12px;border-bottom:1px solid #f5f5f5;font-weight:500;}
    .cierre-cliente-table td:nth-child(2),.cierre-cliente-table td:nth-child(3),.cierre-cliente-table td:nth-child(4){text-align:right;}
    .print-header{text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header h1{font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    .btn-cerrar-cierre,.btn-print-cierre{display:none!important;}
    @media print{body{padding:16px;} .cierre-asesor-block{page-break-inside:avoid;}}
  </style></head><body>
  <div class="print-header"><h1>Cierre del Día — Aqua Luan</h1><p>Fecha: ${fecha} · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p></div>
  ${cuerpo}
  <script>
    var _impresoPagina=false;
    function _intentarImprimirPagina(){ if(_impresoPagina)return; _impresoPagina=true; window.print(); }
    window.onload=_intentarImprimirPagina;
    setTimeout(_intentarImprimirPagina,180);
  <\/script>
  </body></html>`);
  v.document.close();
  _dispararImpresion(v);
}

/* [NEW] Exportar Pagos registrados a PDF */
/* [NEW] Reemplaza a exportarPagosPDF() + exportarGastosPDF() por separado —
   ahora un solo botón imprime Pagos y Gastos juntos, en un solo documento. */
function exportarPagosGastosPDF() {
  const pagos = pagosDetalleActuales || [];
  const gastos = gastosDetalleActuales || [];
  if (!pagos.length && !gastos.length) { alert('No hay pagos ni gastos para exportar. Aplica los filtros primero.'); return; }
  const fecha = _textoRangoFecha();
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const asesorLabel = asesorSel.split(':')[1]?.trim() || 'Todas las rutas';
  const totalPagos = pagos.reduce((s,r) => s + (parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const totalGastos = gastos.reduce((s,r) => s + Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0), 0);
  const filasPagos = pagos.map(r => `<tr>
    <td>${escHTML(r['CLIENTE']||'-')}</td>
    <td>${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
    <td>${escHTML(_textoDesgloseFila(r))}</td>
    <td>${limpiarFecha(r['FECHA'])}</td>
    <td style="text-align:right">$${(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td>
  </tr>`).join('');
  const filasGastos = gastos.map(r => {
    const desc = r['NOTAS'] || r['CLIENTE'] || r['DIRECCIÓN'] || '-';
    return `<tr>
      <td>${escHTML(desc)}</td>
      <td>${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
      <td>${limpiarFecha(r['FECHA'])}</td>
      <td style="text-align:right">$${Math.abs(parseFloat(r['TOTAL PEDIDO ($)'])||0).toFixed(2)}</td>
    </tr>`;
  }).join('');
  const v = window.open('', '_blank', 'width=900,height=900');
  // [NEW] URL absoluta del logo — esta ventana se abre en blanco, sin el
  // dashboard como base, así que una ruta relativa no cargaría.
  const logoUrl = location.origin + '/logo-luanaqua.png';
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Pagos y Gastos — ${asesorLabel} — Aqua Luan — ${fecha}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    .seccion-title{font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;margin:22px 0 8px;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    thead th{padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#fff;}
    thead th:last-child{text-align:right}
    tbody td{padding:9px 12px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
    .tabla-pagos thead tr{background:#1565c0;}
    .tabla-gastos thead tr{background:#c0392b;}
    .total-row-pagos{background:#e8f0fd;font-weight:800;color:#0d47a1;}
    .total-row-pagos td{padding:12px;border-top:2px solid #1565c0;}
    .total-row-gastos{background:#fdecea;font-weight:800;color:#a93226;}
    .total-row-gastos td{padding:12px;border-top:2px solid #c0392b;}
    .firmas{display:flex;justify-content:space-between;gap:30px;margin-top:70px;page-break-inside:avoid;}
    .firmas .firma{flex:1;text-align:center;}
    .firmas .firma-linea{border-top:1.5px solid #1a3a5c;margin-bottom:6px;}
    .firmas .firma-label{font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#1a3a5c;}
    @media print{body{padding:12px;} thead{display:table-header-group;} .firmas{margin-top:60px;}}
  </style></head><body>
  <div class="print-header">
    <img src="${logoUrl}" alt="Aqua Luan" onerror="this.style.display='none'">
    <div>
      <h1>Pagos y Gastos — ${escHTML(asesorLabel)}</h1>
      <p>Fecha: ${fecha} · ${pagos.length} pago(s) · ${gastos.length} gasto(s) · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
    </div>
  </div>
  <div class="seccion-title" style="color:#1565c0">Pagos registrados</div>
  <table class="tabla-pagos">
    <thead><tr><th>Cliente</th><th>Asesor</th><th>Forma de Pago</th><th>Fecha</th><th>Monto</th></tr></thead>
    <tbody>
      ${filasPagos || '<tr><td colspan="5" style="text-align:center;color:#888">Sin pagos en este período</td></tr>'}
      <tr class="total-row-pagos"><td colspan="4" style="text-align:right">TOTAL PAGOS</td><td style="text-align:right">$${totalPagos.toFixed(2)}</td></tr>
    </tbody>
  </table>
  <div class="seccion-title" style="color:#c0392b">Gastos registrados</div>
  <table class="tabla-gastos">
    <thead><tr><th>Descripción</th><th>Responsable</th><th>Fecha</th><th>Monto</th></tr></thead>
    <tbody>
      ${filasGastos || '<tr><td colspan="4" style="text-align:center;color:#888">Sin gastos en este período</td></tr>'}
      <tr class="total-row-gastos"><td colspan="3" style="text-align:right">TOTAL GASTOS</td><td style="text-align:right">$${totalGastos.toFixed(2)}</td></tr>
    </tbody>
  </table>
  <div class="firmas">
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Liquidadora</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Asesor</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Ayudante</div></div>
  </div>
  <script>
    var _impresoPagina=false;
    function _intentarImprimirPagina(){ if(_impresoPagina)return; _impresoPagina=true; window.print(); }
    window.onload=_intentarImprimirPagina;
    setTimeout(_intentarImprimirPagina,180);
  <\/script>
  </body></html>`);
  v.document.close();
  _dispararImpresion(v);
}


function _normNombreCliente(n){
  return String(n||'').trim().replace(/\s+/g,' ').toLowerCase();
}
function _creditoDePedido(p){
  if (!p) return 0;
  if (p.pagos !== null && p.pagos !== undefined) return parseFloat(p.creditoPendiente||0)||0;
  const tot=parseFloat(p.total)||0;
  const abono=parseFloat(p.abono||0)||0;
  if (abono>0 && abono<tot) return tot-abono;
  if (abono<=0 && p.formapago==='Crédito') return tot;
  return 0;
}
function _pagadoEnVentaPedido(p){
  const tot=parseFloat(p.total)||0;
  const cred=_creditoDePedido(p);
  return Math.max(0, tot-cred);
}
function _datosCobranzasClientes(){
  const asesorSel=document.getElementById('filtroAsesor')?.value||'';
  const map={};
  const asegurar=(nombre)=>{
    const key=_normNombreCliente(nombre)||'sin-nombre';
    if(!map[key]) map[key]={nombre:nombre||'Sin nombre', telefono:'', asesor:'', ventas:0, pagadoVenta:0, deuda:0, cobros:0, pedidos:0, ingresos:[]};
    return map[key];
  };
  (_pedidosRaw||[]).forEach(p=>{
    if (asesorSel && (p.empleado||'')!==asesorSel) return;
    const c=asegurar(p.cliente);
    const tot=parseFloat(p.total)||0;
    c.ventas+=tot;
    c.pagadoVenta+=_pagadoEnVentaPedido(p);
    c.deuda+=_creditoDePedido(p);
    c.pedidos+=1;
    if (p.telefono) c.telefono=p.telefono;
    if (p.empleado) c.asesor=p.empleado;
  });
  (_pagosRaw||[]).forEach(pg=>{
    if (asesorSel && (pg.empleado||'')!==asesorSel) return;
    const cliente=pg.cliente||'Sin nombre';
    const c=asegurar(cliente);
    const monto=parseFloat(pg.monto)||0;
    c.cobros+=monto;
    c.ingresos.push({fecha:pg.fecha||'', monto, forma:pg.forma||'', asesor:pg.empleado||'', notas:pg.notas||''});
    if (pg.empleado && !c.asesor) c.asesor=pg.empleado;
  });
  return Object.values(map).map(c=>{
    c.saldo=c.deuda-c.cobros;
    c.asesorCorto=String(c.asesor||'').split(':')[1]?.trim()||c.asesor||'—';
    return c;
  }).sort((a,b)=>b.saldo-a.saldo || a.nombre.localeCompare(b.nombre,'es'));
}
function renderCobranzasClientes(){
  const tbody=document.getElementById('tablaCobranzasClientes');
  const kpis=document.getElementById('cobranzasKpis');
  const cont=document.getElementById('cobranzasContador');
  if(!tbody) return;
  const q=_normNombreCliente(document.getElementById('cobranzasBusqueda')?.value||'');
  const filtro=document.getElementById('cobranzasFiltroSaldo')?.value||'';
  let rows=_datosCobranzasClientes();
  if(q){
    rows=rows.filter(c=>_normNombreCliente(c.nombre).includes(q) || _normNombreCliente(c.telefono).includes(q) || _normNombreCliente(c.asesorCorto).includes(q));
  }
  if(filtro==='con_deuda') rows=rows.filter(c=>c.saldo>0.004);
  if(filtro==='al_dia') rows=rows.filter(c=>Math.abs(c.saldo)<=0.004);
  if(filtro==='sobrepago') rows=rows.filter(c=>c.saldo<-0.004);
  const totDeuda=rows.reduce((s,c)=>s+c.deuda,0);
  const totCobros=rows.reduce((s,c)=>s+c.cobros,0);
  const totSaldo=rows.reduce((s,c)=>s+Math.max(0,c.saldo),0);
  const nPend=rows.filter(c=>c.saldo>0.004).length;
  if(cont) cont.textContent=rows.length+' cliente(s)';
  if(kpis){
    kpis.innerHTML=`
      <div class="kpi-card navy"><div class="kpi-label">Clientes</div><div class="kpi-value">${rows.length}</div><div class="kpi-sub">${nPend} con saldo</div></div>
      <div class="kpi-card orange"><div class="kpi-label">Deuda generada</div><div class="kpi-value">$${totDeuda.toFixed(2)}</div><div class="kpi-sub">crédito al vender</div></div>
      <div class="kpi-card teal"><div class="kpi-label">Cobros / ingresos</div><div class="kpi-value">$${totCobros.toFixed(2)}</div><div class="kpi-sub">pagos del cliente</div></div>
      <div class="kpi-card red"><div class="kpi-label">Saldo pendiente</div><div class="kpi-value">$${totSaldo.toFixed(2)}</div><div class="kpi-sub">deuda − cobros (>0)</div></div>`;
  }
  if(!rows.length){
    tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><div class="icon">💰</div>No hay cobranzas en este período</div></td></tr>';
    return;
  }
  if(typeof _cobranzasSeleccion==='undefined') window._cobranzasSeleccion=new Set();
  tbody.innerHTML=rows.map(c=>{
    const saldoTxt=c.saldo>0.004 ? ('$'+c.saldo.toFixed(2)) : (c.saldo<-0.004 ? ('-$'+Math.abs(c.saldo).toFixed(2)) : '$0.00');
    const color=c.saldo>0.004 ? 'var(--red)' : (c.saldo<-0.004 ? '#0a7c6e' : 'var(--muted)');
    const key=_normNombreCliente(c.nombre);
    const keyEsc=escHTML(key);
    const checked=(_cobranzasSeleccion&&_cobranzasSeleccion.has(key))?'checked':'';
    return `<tr style="cursor:pointer" data-cob-key="${keyEsc}" onclick="verDetalleCobranzaCliente('${keyEsc.replace(/'/g,'&#39;')}')">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="cob-chk" data-cob-key="${keyEsc}" ${checked} onchange="toggleCobranzaSeleccion(this)"></td>
      <td style="font-weight:700">${escHTML(c.nombre)}</td>
      <td style="color:var(--muted)">${escHTML(c.telefono||'—')}</td>
      <td>${escHTML(c.asesorCorto)}</td>
      <td style="text-align:right">$${c.ventas.toFixed(2)}</td>
      <td style="text-align:right">$${c.pagadoVenta.toFixed(2)}</td>
      <td style="text-align:right;font-weight:700">$${c.deuda.toFixed(2)}</td>
      <td style="text-align:right;color:var(--teal);font-weight:700">$${c.cobros.toFixed(2)}</td>
      <td style="text-align:right;font-weight:800;color:${color}">${saldoTxt}</td>
    </tr>`;
  }).join('');
}

let _cobranzasSeleccion=new Set();
function toggleCobranzaSeleccion(el){
  if(!_cobranzasSeleccion) _cobranzasSeleccion=new Set();
  const key=el.getAttribute('data-cob-key')||'';
  if(!key) return;
  if(el.checked) _cobranzasSeleccion.add(key); else _cobranzasSeleccion.delete(key);
}
function toggleTodosCobranzas(el){
  if(!_cobranzasSeleccion) _cobranzasSeleccion=new Set();
  document.querySelectorAll('#tablaCobranzasClientes .cob-chk').forEach(chk=>{
    chk.checked=!!el.checked;
    const key=chk.getAttribute('data-cob-key')||'';
    if(!key) return;
    if(el.checked) _cobranzasSeleccion.add(key); else _cobranzasSeleccion.delete(key);
  });
}
function imprimirCobranzasSeleccionadas(){
  const keys=_cobranzasSeleccion && _cobranzasSeleccion.size ? _cobranzasSeleccion : null;
  if(!keys || !keys.size){
    alert('Selecciona uno o más clientes para imprimir.');
    return;
  }
  let rows=_datosCobranzasClientes();
  const q=_normNombreCliente(document.getElementById('cobranzasBusqueda')?.value||'');
  const filtro=document.getElementById('cobranzasFiltroSaldo')?.value||'';
  if(q){
    rows=rows.filter(c=>_normNombreCliente(c.nombre).includes(q) || _normNombreCliente(c.telefono).includes(q) || _normNombreCliente(c.asesorCorto).includes(q));
  }
  if(filtro==='con_deuda') rows=rows.filter(c=>c.saldo>0.004);
  if(filtro==='al_dia') rows=rows.filter(c=>Math.abs(c.saldo)<=0.004);
  if(filtro==='sobrepago') rows=rows.filter(c=>c.saldo<-0.004);
  rows=rows.filter(c=>keys.has(_normNombreCliente(c.nombre)));
  if(!rows.length){ alert('No hay filas seleccionadas visibles para imprimir.'); return; }
  const fecha=(typeof _textoRangoFecha==='function')?_textoRangoFecha():'';
  const totDeuda=rows.reduce((s,c)=>s+c.deuda,0);
  const totCobros=rows.reduce((s,c)=>s+c.cobros,0);
  const totSaldo=rows.reduce((s,c)=>s+c.saldo,0);
  const filas=rows.map(c=>{
    const saldoTxt=c.saldo>0.004 ? ('$'+c.saldo.toFixed(2)) : (c.saldo<-0.004 ? ('-$'+Math.abs(c.saldo).toFixed(2)) : '$0.00');
    return `<tr>
      <td>${escHTML(c.nombre)}</td>
      <td>${escHTML(c.telefono||'—')}</td>
      <td>${escHTML(c.asesorCorto||'—')}</td>
      <td style="text-align:right">$${c.ventas.toFixed(2)}</td>
      <td style="text-align:right">$${c.pagadoVenta.toFixed(2)}</td>
      <td style="text-align:right">$${c.deuda.toFixed(2)}</td>
      <td style="text-align:right">$${c.cobros.toFixed(2)}</td>
      <td style="text-align:right">${saldoTxt}</td>
    </tr>`;
  }).join('');
  const logoUrl=location.origin+'/logo-luanaqua.png';
  const v=window.open('','_blank','width=1000,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Consulta Cobranzas — Aqua Luan</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#1a3a5c;}
    .print-header p{font-size:11px;color:#888;margin-top:3px;}
    table{width:100%;border-collapse:collapse;font-size:11px;}
    th{text-align:left;font-size:9px;letter-spacing:0.04em;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid #d2dae2;color:#888;}
    td{padding:6px 8px;border-bottom:1px solid #eee;}
    .total-row{font-weight:800;background:#e6f4f2;}
    @media print{body{padding:12px;} thead{display:table-header-group;}}
  </style></head><body>
  <div class="print-header">
    <img src="${logoUrl}" alt="Aqua Luan" onerror="this.style.display='none'">
    <div>
      <h1>Consulta Cobranzas — Clientes</h1>
      <p>Período: ${escHTML(fecha)} · ${rows.length} cliente(s) · ${escHTML((typeof lineaImpresoPor==='function')?lineaImpresoPor():'')}</p>
    </div>
  </div>
  <table>
    <thead><tr><th>Cliente</th><th>Teléfono</th><th>Asesor</th><th style="text-align:right">Ventas</th><th style="text-align:right">Pagado en venta</th><th style="text-align:right">Deuda generada</th><th style="text-align:right">Cobros</th><th style="text-align:right">Saldo</th></tr></thead>
    <tbody>
      ${filas}
      <tr class="total-row"><td colspan="5" style="text-align:right">TOTAL</td><td style="text-align:right">$${totDeuda.toFixed(2)}</td><td style="text-align:right">$${totCobros.toFixed(2)}</td><td style="text-align:right">$${totSaldo.toFixed(2)}</td></tr>
    </tbody>
  </table>
  <script>window.onload=function(){window.print();};<\/script>
  </body></html>`);
  v.document.close();
  if(typeof _dispararImpresion==='function') _dispararImpresion(v);
}
function verDetalleCobranzaCliente(key){
  const rows=_datosCobranzasClientes();
  const c=rows.find(x=>_normNombreCliente(x.nombre)===key);
  const box=document.getElementById('cobranzasDetalle');
  if(!box || !c) return;
  const ingresos=c.ingresos.length
    ? c.ingresos.map(i=>`<tr><td>${escHTML(i.fecha||'—')}</td><td>${escHTML(i.forma||'—')}</td><td>${escHTML((i.asesor||'').split(':')[1]?.trim()||i.asesor||'—')}</td><td style="text-align:right">$${(Number(i.monto)||0).toFixed(2)}</td><td>${escHTML(i.notas||'')}</td></tr>`).join('')
    : '<tr><td colspan="5" style="color:#888;font-style:italic">Sin cobros registrados en Pagos para este cliente en el período.</td></tr>';
  box.innerHTML=`<div style="margin-top:16px;border:1px solid var(--border);border-radius:10px;overflow:hidden">
    <div style="padding:10px 14px;background:var(--surface2);font-weight:800;color:var(--navy)">Cruce de ${escHTML(c.nombre)} — deuda $${c.deuda.toFixed(2)} vs cobros $${c.cobros.toFixed(2)}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha cobro</th><th>Forma</th><th>Asesor</th><th style="text-align:right">Monto</th><th>Notas</th></tr></thead>
      <tbody>${ingresos}</tbody>
    </table></div>
  </div>`;
}

function exportarDetallePDF() {
  const datos = _pedidosTablaFiltrados; // [NEW] exporta lo mismo que se ve en pantalla (respeta el filtro de Pago)
  if (!datos.length) { alert('No hay datos para exportar. Aplica los filtros primero.'); return; }
  const fecha = _textoRangoFecha();
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const asesorLabel = asesorSel.split(':')[1]?.trim() || 'Todos';

  const tDet=_totalYEtiquetaDetalleFiltrado(datos);
  const totalGeneral=tDet.total;
  const etiquetaTotal=tDet.label;
  const pagoTxt=tDet.activos.length===FORMAS_PAGO_FIJAS.length?'Todos':tDet.activos.join(', ');
  const prodTxt=tDet.producto;

  const filas = datos.map((r, idx) => {
    const montoF=_montoPedidoSegunFiltroPago(r);
    const tieneTotal=r['TOTAL PEDIDO ($)']!=='' && r['TOTAL PEDIDO ($)']!=null && r['TOTAL PEDIDO ($)']!==undefined;
    const total = tieneTotal ? `$${montoF.toFixed(2)}` : '—';
    const precioUnit = r['PRECIO UNIT.']!==undefined && r['PRECIO UNIT.']!=='' ? `$${parseFloat(r['PRECIO UNIT.']).toFixed(2)}` : '—';
    const fila = `<tr>
      <td>${limpiarFecha(r['FECHA'])}</td>
      <td>${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
      <td>${escHTML(r['CLIENTE']||'-')}</td>
      <td>${escHTML(r['TELÉFONO']||'-')}</td>
      <td>${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:center">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right">${precioUnit}</td>
      <td style="text-align:right">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
      <td style="text-align:right;font-weight:700">${total}</td>
      <td>${escHTML(_etiquetaPagoDetalle(r))}</td>
    </tr>`;
    const este = String(r['CLIENTE']||'').trim().toLowerCase();
    const sig = String(datos[idx+1]?.['CLIENTE']||'').trim().toLowerCase();
    return fila + ((idx < datos.length-1 && este !== sig) ? '<tr class="sep-cliente"><td colspan="10"></td></tr>' : '');
  }).join('');

  // [NEW] URL absoluta del logo — esta ventana de impresión se abre en blanco
  // (sin la URL del dashboard como base), así que una ruta relativa "logo-luanaqua.png"
  // no cargaría. Se arma con location.origin para que funcione en cualquier dominio.
  const logoUrl = location.origin + '/logo-luanaqua.png';

  const v = window.open('', '_blank', 'width=1000,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Detalle de Pedidos — ${asesorLabel} — Aqua Luan — ${fecha}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    table{width:100%;border-collapse:collapse;font-size:11px;}
    thead tr{background:#1a3a5c;}
    thead th{padding:8px 10px;text-align:left;font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#fff;}
    tbody td{padding:7px 10px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
    tbody tr.sep-cliente td{padding:0;height:5px;border:none;background:#0a0a0a;border-bottom:4px solid #000;}
    tbody tr.sep-cliente + tr{background:#fff;}
    .total-row{background:#e6f4f2;font-weight:800;color:#085f54;}
    .total-row td{padding:10px;border-top:2px solid #0a7c6e;}
    .firmas{display:flex;justify-content:space-between;gap:30px;margin-top:70px;page-break-inside:avoid;}
    .firmas .firma{flex:1;text-align:center;}
    .firmas .firma-linea{border-top:1.5px solid #1a3a5c;margin-bottom:6px;}
    .firmas .firma-label{font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#1a3a5c;}
    @media print{body{padding:12px;} thead{display:table-header-group;} .firmas{margin-top:60px;}}
  </style></head><body>
  <div class="print-header">
    <img src="${logoUrl}" alt="Aqua Luan" onerror="this.style.display='none'">
    <div>
      <h1>Detalle de Pedidos — ${escHTML(asesorLabel)}</h1>
      <p>Fecha: ${fecha} · Asesor: ${asesorLabel} · Pago: ${escHTML(pagoTxt)} · Producto: ${escHTML(prodTxt)} · ${datos.length} línea(s) · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
    </div>
  </div>
  <table>
    <thead><tr><th>Fecha</th><th>Asesor</th><th>Cliente</th><th>Teléfono</th><th>Producto</th><th>Cant.</th><th>Precio Unit.</th><th>Subtotal</th><th>Total</th><th>Pago</th></tr></thead>
    <tbody>
      ${filas}
      <tr class="total-row"><td colspan="8" style="text-align:right">${etiquetaTotal}</td><td style="text-align:right">$${totalGeneral.toFixed(2)}</td><td></td></tr>
    </tbody>
  </table>
  <div class="firmas">
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Liquidadora</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Asesor</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Ayudante</div></div>
  </div>
  <script>
    var _impresoPagina=false;
    function _intentarImprimirPagina(){ if(_impresoPagina)return; _impresoPagina=true; window.print(); }
    window.onload=_intentarImprimirPagina;
    setTimeout(_intentarImprimirPagina,180);
  <\/script>
  </body></html>`);
  v.document.close();
  _dispararImpresion(v);
}

function exportarExcel() {
  const datos=datosNotasFiltrados.length>0?datosNotasFiltrados:todosLosDatos.filter(r=>r['PRODUCTO']&&r['PRODUCTO']!=='');
  if(!datos.length){ alert('No hay datos para exportar. Aplica los filtros primero.'); return; }
  const headers=['ASESOR / RUTA','CLIENTE','PRODUCTO','PRECIO UNIT.','CANTIDAD','SUBTOTAL','TOTAL PEDIDO ($)','FORMA DE PAGO','FECHA','TELÉFONO','DIRECCIÓN'];
  const filas=datos.map(r=>headers.map(h=>{ const raw=h==='FORMA DE PAGO'?_textoDesgloseFila(r):(r[h]!==undefined?r[h]:''); const str=String(raw).replace(/"/g,'""'); return str.includes(',')||str.includes('"')||str.includes('\n')?`"${str}"`:str; }).join(','));
  const csv='\uFEFF'+headers.join(',')+'\n'+filas.join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const fecha=document.getElementById('notasFecha').value||new Date().toISOString().split('T')[0];
  const asesor=document.getElementById('notasAsesor').value.split(':')[1]?.trim()||'Todos';
  a.href=url; a.download=`NotasVentas_${fecha}_${asesor}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ════════════════════════════════════════════════════════════
   [NEW] EDITAR PEDIDO — solo visible/usable por el Administrador
   (todo dashboard.html ya está protegido por el login que exige
   esAdmin === true, así que llegar hasta aquí ya implica ser admin)
════════════════════════════════════════════════════════════ */
function abrirEditarPedido(pedidoId){
  const p = _pedidosRaw.find(x => x._id === pedidoId);
  if(ROL_ACTUAL !== 'admin'){
    if(p && !_esRegistroDeHoy(p.fecha||p.FECHA)){ alert('Solo el administrador puede editar pedidos de fechas anteriores.'); return; }
  }
  if(!p){ alert('No se encontró el pedido — puede que otro admin lo haya eliminado.'); return; }
  // Copia editable e independiente, para no mutar los datos en vivo del listener mientras se edita
  editandoPedidoActual = JSON.parse(JSON.stringify(p));
  editandoPedidoActual._id = pedidoId;
  editandoPedidoActual.productos = (editandoPedidoActual.productos || []).map(prod => ({
    nombre: prod.nombre || '', cantidad: prod.cantidad != null ? prod.cantidad : 1, precio: prod.precio != null ? prod.precio : 0,
    regalias: (prod.regalias || []).map(r => ({ nombre: r.nombre || '', cantidad: r.cantidad != null ? r.cantidad : 1 }))
  }));
  renderModalEditarPedido();
  document.getElementById('editarOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarEditarPedido(){
  document.getElementById('editarOverlay').classList.remove('open');
  document.body.style.overflow = '';
  editandoPedidoActual = null;
}

function _totalCalculadoEdicion(){
  if(!editandoPedidoActual) return 0;
  return editandoPedidoActual.productos.reduce((s,prod) => s + ((parseFloat(prod.cantidad)||0) * (parseFloat(prod.precio)||0)), 0);
}

function _parseMontoEditPago(id){
  const el=document.getElementById(id);
  const p=(typeof _parseMontoLiq==='function') ? _parseMontoLiq((el&&el.value)||'') : {ok:false,valor:0};
  return p && p.ok ? p.valor : (parseFloat(String((el&&el.value)||'0').replace(',','.'))||0);
}
function _montosPagoDesdePedido(p){
  const out={Contado:'',Transferencia:'',Cheque:''};
  if(p && Array.isArray(p.pagos) && p.pagos.length){
    p.pagos.forEach(pg=>{
      const f=pg.forma;
      if(out[f]!==undefined) out[f]=String(Number(pg.monto)||0);
    });
    return out;
  }
  const tot=Number(p && p.total)||0;
  const f=String((p&&p.formapago)||'');
  if(f==='Contado' && tot>0) out.Contado=String(tot);
  else if(f==='Transferencia' && tot>0) out.Transferencia=String(tot);
  else if(f==='Cheque' && tot>0) out.Cheque=String(tot);
  return out;
}
let _editPagosAbiertos=new Set();
function _pintarPagoEdit(){
  const mapa={Contado:'#0a7c6e',Transferencia:'#1565c0',Cheque:'#e67e22','Crédito':'#c0392b'};
  document.querySelectorAll('.edit-pago-opt').forEach(btn=>{
    const v=btn.getAttribute('data-pago');
    const on=(v==='Crédito') ? (!_editPagosAbiertos.size) : _editPagosAbiertos.has(v);
    btn.style.borderColor=on?(mapa[v]||'var(--border)'):'var(--border)';
    btn.style.background=on?'#fff':'#fff';
    btn.style.boxShadow=on?('0 0 0 3px '+mapa[v]+'22'):'none';
    btn.style.color=on?(mapa[v]||'var(--navy)'):'var(--navy)';
  });
  const box=document.getElementById('editPagoMontos');
  const rows={Contado:'editRowContado',Transferencia:'editRowTransf',Cheque:'editRowCheque'};
  let alguno=false;
  Object.entries(rows).forEach(([forma,id])=>{
    const el=document.getElementById(id);
    const show=_editPagosAbiertos.has(forma);
    if(el) el.style.display=show?'block':'none';
    if(show) alguno=true;
  });
  if(box) box.style.display=alguno?'flex':'none';
}
function _elegirFormaPagoEdit(valor){
  const ids={Contado:'editPagoContado',Transferencia:'editPagoTransf',Cheque:'editPagoCheque'};
  if(valor==='Crédito'){
    _editPagosAbiertos.clear();
    Object.values(ids).forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  } else if(ids[valor]){
    if(_editPagosAbiertos.has(valor)){
      _editPagosAbiertos.delete(valor);
      const inp=document.getElementById(ids[valor]);
      if(inp) inp.value='';
    } else {
      _editPagosAbiertos.add(valor);
    }
  }
  _pintarPagoEdit();
  _refrescarResumenPagoEdit();
}
function _armarPagoEdicion(total){
  const tot=Number((parseFloat(total)||0).toFixed(2));
  const c=Number(_parseMontoEditPago('editPagoContado').toFixed(2));
  const t=Number(_parseMontoEditPago('editPagoTransf').toFixed(2));
  const q=Number(_parseMontoEditPago('editPagoCheque').toFixed(2));
  if(c+t+q>tot+0.009) return {error:'La suma de Contado + Transferencia + Cheque no puede ser mayor al total.'};
  const pagos=[];
  if(c>0) pagos.push({forma:'Contado',monto:c});
  if(t>0) pagos.push({forma:'Transferencia',monto:t});
  if(q>0) pagos.push({forma:'Cheque',monto:q});
  const creditoPendiente=Number(Math.max(tot-(c+t+q),0).toFixed(2));
  let formapago;
  if(!pagos.length) formapago='Crédito';
  else if(pagos.length>1 || creditoPendiente>0) formapago='Mixto';
  else formapago=pagos[0].forma;
  return {formapago,pagos,creditoPendiente,abono:c};
}
function _refrescarResumenPagoEdit(){
  const box=document.getElementById('editPagoResumen');
  if(!box) return;
  const tot=_totalCalculadoEdicion();
  const arm=_armarPagoEdicion(tot);
  const credEl=document.getElementById('editPagoCreditoMonto');
  if(credEl) credEl.textContent='$'+(arm.creditoPendiente||0).toFixed(2);
  if(arm.error){
    box.style.color='#a93226';
    box.textContent=arm.error;
    return;
  }
  box.style.color='var(--navy)';
  const partes=(arm.pagos||[]).map(pg=>pg.forma+' $'+Number(pg.monto).toFixed(2));
  if(arm.creditoPendiente>0) partes.push('Crédito $'+arm.creditoPendiente.toFixed(2));
  if(!partes.length) partes.push('Crédito $'+tot.toFixed(2));
  box.textContent='Desglose: '+partes.join(' + ')+'  ·  Total $'+tot.toFixed(2);
}

function renderModalEditarPedido(){
  const p = editandoPedidoActual;
  if(!p) return;

  const optionsAsesor = _asesoresCache.map(r => `<option value="${r}" ${p.empleado===r?'selected':''}>${r.split(':')[1]?.trim()||r}</option>`).join('');
  const montosEdit=_montosPagoDesdePedido(p);
  _editPagosAbiertos=new Set();
  if(montosEdit.Contado) _editPagosAbiertos.add('Contado');
  if(montosEdit.Transferencia) _editPagosAbiertos.add('Transferencia');
  if(montosEdit.Cheque) _editPagosAbiertos.add('Cheque');
  if(!_editPagosAbiertos.size && (p.formapago==='Crédito' || Number(p.creditoPendiente)>0)) _editPagosAbiertos=new Set();

  document.getElementById('editarBody').innerHTML = `
    <div class="editar-seccion-label">📋 Datos del pedido</div>
    <div class="editar-grid">
      <div class="editar-field"><label>Fecha</label><input type="date" id="editFecha" value="${p.fecha||''}" min="${document.getElementById('filtroFecha')?.value||''}" max="${document.getElementById('filtroFechaHasta')?.value||''}"></div>
      <div class="editar-field"><label>Asesor</label><select id="editAsesor">${optionsAsesor}</select></div>
      <div class="editar-field"><label>Cliente</label><input type="text" id="editCliente" value="${escapeAttr(p.cliente||'')}"></div>
      <div class="editar-field"><label>Teléfono</label><input type="text" id="editTelefono" value="${escapeAttr(p.telefono||'')}"></div>
      <div class="editar-field"><label>Dirección</label><input type="text" id="editDireccion" value="${escapeAttr(p.direccion||'')}"></div>
    </div>
    <div class="editar-seccion-label">💳 Forma de pago (igual que en la app: puedes marcar 2 o más)</div>
    <div id="editPagoOpts" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px">
      <button type="button" class="edit-pago-opt" data-pago="Contado" onclick="_elegirFormaPagoEdit('Contado')" style="border:1.5px solid var(--border);background:#fff;border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer">💵 CONTADO</button>
      <button type="button" class="edit-pago-opt" data-pago="Transferencia" onclick="_elegirFormaPagoEdit('Transferencia')" style="border:1.5px solid var(--border);background:#fff;border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer">🏦 TRANSFERENCIA</button>
      <button type="button" class="edit-pago-opt" data-pago="Cheque" onclick="_elegirFormaPagoEdit('Cheque')" style="border:1.5px solid var(--border);background:#fff;border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer">📄 CHEQUE</button>
      <button type="button" class="edit-pago-opt" data-pago="Crédito" onclick="_elegirFormaPagoEdit('Crédito')" style="border:1.5px solid var(--border);background:#fff;border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer">📋 CRÉDITO <span id="editPagoCreditoMonto">$0.00</span></button>
    </div>
    <div id="editPagoMontos" style="display:none;flex-direction:column;gap:8px;margin-bottom:8px">
      <div class="editar-field" id="editRowContado" style="display:none"><label>💵 Contado ($)</label><input type="text" id="editPagoContado" inputmode="decimal" value="${montosEdit.Contado||''}" oninput="_filtrarInputMontoLiq(this);_refrescarResumenPagoEdit()"></div>
      <div class="editar-field" id="editRowTransf" style="display:none"><label>🏦 Transferencia ($)</label><input type="text" id="editPagoTransf" inputmode="decimal" value="${montosEdit.Transferencia||''}" oninput="_filtrarInputMontoLiq(this);_refrescarResumenPagoEdit()"></div>
      <div class="editar-field" id="editRowCheque" style="display:none"><label>📄 Cheque ($)</label><input type="text" id="editPagoCheque" inputmode="decimal" value="${montosEdit.Cheque||''}" oninput="_filtrarInputMontoLiq(this);_refrescarResumenPagoEdit()"></div>
    </div>
    <div id="editPagoResumen" style="margin:8px 0 4px;padding:8px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--navy)"></div>
    <div class="editar-grid full" style="margin-top:10px">
      <div class="editar-field"><label>Notas</label><textarea id="editNotas">${escHTML(p.notas||'')}</textarea></div>
    </div>

    <div class="editar-seccion-label">📦 Productos del pedido</div>
    <div id="editProductosWrap"></div>
    <button type="button" class="btn-agregar-linea" onclick="agregarProductoLinea()">+ Agregar producto</button>

    <div class="editar-total-box">
      <span class="lbl">🧮 Total del pedido (recalculado automáticamente)</span>
      <span class="val" id="editTotalCalculado">$${_totalCalculadoEdicion().toFixed(2)}</span>
    </div>

    <div class="editar-seccion-label">📍 Información de registro (solo lectura)</div>
    <div class="editar-readonly-box">
      <div>Latitud: <b>${(p.gps && p.gps.lat!=null) ? p.gps.lat : '—'}</b></div>
      <div>Longitud: <b>${(p.gps && p.gps.lng!=null) ? p.gps.lng : '—'}</b></div>
      <div>Precisión GPS: <b>${(p.gps && p.gps.acc!=null) ? '±'+p.gps.acc+'m' : '—'}</b></div>
      <div>Hora de registro: <b>${_horaDeTs(p.creadoEn)}</b></div>
      <div style="grid-column:1/-1">Link GPS: ${(p.gps && p.gps.url) ? `<a href="${p.gps.url}" target="_blank" style="color:var(--teal);font-weight:700">📍 Abrir en el mapa</a>` : '<b>—</b>'}</div>
    </div>
  `;
  renderProductosEditor();
  _pintarPagoEdit();
  _refrescarResumenPagoEdit();
}

/* [NEW] Redibuja solo la sección de líneas de producto (y sus regalías) tras cada cambio */
function renderProductosEditor(){
  const wrap = document.getElementById('editProductosWrap');
  if(!wrap || !editandoPedidoActual) return;
  const opcionesProductos = _productosCache.map(prod => `<option value="${escapeAttr(prod.nombre)}">${escHTML(prod.nombre)}</option>`).join('');

  wrap.innerHTML = editandoPedidoActual.productos.map((prod, i) => {
    const subtotal = (parseFloat(prod.cantidad)||0) * (parseFloat(prod.precio)||0);
    const regaliasHtml = (prod.regalias||[]).map((reg, j) => `
      <div class="editar-regalia-row">
        <select onchange="actualizarRegaliaLinea(${i},${j},'nombre',this.value)">
          <option value="">-- Selecciona --</option>
          ${_productosCache.map(pr => `<option value="${escapeAttr(pr.nombre)}" ${reg.nombre===pr.nombre?'selected':''}>${pr.nombre}</option>`).join('')}
        </select>
        <input type="number" min="1" step="1" value="${reg.cantidad}" onchange="actualizarRegaliaLinea(${i},${j},'cantidad',this.value)">
        <button type="button" class="btn-quitar-linea" onclick="eliminarRegaliaLinea(${i},${j})" title="Quitar regalía">✕</button>
      </div>`).join('');

    return `
      <div class="editar-linea-producto">
        <div class="editar-linea-producto-row">
          <div class="editar-field" style="margin-bottom:0">
            <label>Producto</label>
            <select onchange="actualizarProductoLinea(${i},'nombre',this.value)">
              <option value="">-- Selecciona --</option>
              ${_productosCache.map(pr => `<option value="${escapeAttr(pr.nombre)}" ${prod.nombre===pr.nombre?'selected':''}>${pr.nombre}</option>`).join('')}
            </select>
          </div>
          <div class="editar-field" style="margin-bottom:0"><label>Cantidad</label><input type="number" min="1" step="1" value="${prod.cantidad}" onchange="actualizarProductoLinea(${i},'cantidad',this.value)"></div>
          <div class="editar-field" style="margin-bottom:0"><label>Precio Unit. ($)</label><input type="number" min="0" step="0.01" value="${prod.precio}" onchange="actualizarProductoLinea(${i},'precio',this.value)"></div>
          <button type="button" class="btn-quitar-linea" onclick="eliminarProductoLinea(${i})" title="Quitar producto">✕</button>
        </div>
        <div class="editar-linea-subtotal">Subtotal: $${subtotal.toFixed(2)}</div>
        <div class="editar-regalias-box">
          <div class="editar-regalias-label">🎁 Regalías de este producto</div>
          ${regaliasHtml || '<div style="font-size:11px;color:var(--muted)">Sin regalías agregadas</div>'}
          <button type="button" class="btn-agregar-linea" style="margin-top:6px" onclick="agregarRegaliaLinea(${i})">+ Agregar regalía</button>
        </div>
      </div>`;
  }).join('') || '<div style="font-size:12px;color:var(--muted);padding:8px 0">Sin productos. Agrega al menos uno.</div>';

  const totalEl = document.getElementById('editTotalCalculado');
  if(totalEl) totalEl.textContent = '$' + _totalCalculadoEdicion().toFixed(2);
  _refrescarResumenPagoEdit();
}

function actualizarProductoLinea(i, campo, valor){
  const prod = editandoPedidoActual.productos[i];
  if(!prod) return;
  prod[campo] = (campo==='cantidad'||campo==='precio') ? (parseFloat(valor)||0) : valor;
  renderProductosEditor();
}
function eliminarProductoLinea(i){
  editandoPedidoActual.productos.splice(i,1);
  renderProductosEditor();
}
function agregarProductoLinea(){
  editandoPedidoActual.productos.push({ nombre:'', cantidad:1, precio:0, regalias:[] });
  renderProductosEditor();
}
function actualizarRegaliaLinea(i, j, campo, valor){
  const reg = editandoPedidoActual.productos[i]?.regalias[j];
  if(!reg) return;
  reg[campo] = campo==='cantidad' ? (parseFloat(valor)||1) : valor;
  renderProductosEditor();
}
function eliminarRegaliaLinea(i, j){
  editandoPedidoActual.productos[i].regalias.splice(j,1);
  renderProductosEditor();
}
function agregarRegaliaLinea(i){
  editandoPedidoActual.productos[i].regalias.push({ nombre:'', cantidad:1 });
  renderProductosEditor();
}

/* [NEW] Guarda solo el documento modificado en Firestore (sin volver a consultar toda la
   colección) y registra cada campo que cambió en historialCambios para auditoría. */
async function guardarEdicionPedido(){
  if(!editandoPedidoActual) return;
  if(ROL_ACTUAL !== 'admin' && !_esRegistroDeHoy(editandoPedidoActual.fecha||editandoPedidoActual.FECHA)){
    alert('Solo el administrador puede guardar cambios de pedidos de fechas anteriores.');
    return;
  }
  if(!confirm('¿Está seguro que desea guardar los cambios de este pedido?')) return;
  const original = _pedidosRaw.find(x => x._id === editandoPedidoActual._id);
  if(!original){ alert('El pedido ya no existe.'); cerrarEditarPedido(); return; }

  const productosLimpios = editandoPedidoActual.productos
    .filter(prod => (prod.nombre||'').trim() !== '')
    .map(prod => {
      const cantidad = parseFloat(prod.cantidad)||0, precio = parseFloat(prod.precio)||0;
      return {
        nombre: prod.nombre.trim(), cantidad, precio, subtotal: +(cantidad*precio).toFixed(2),
        regalias: (prod.regalias||[]).filter(r => (r.nombre||'').trim()!=='').map(r => ({ nombre:r.nombre.trim(), cantidad: parseFloat(r.cantidad)||1 }))
      };
    });

  const cliente = document.getElementById('editCliente').value.trim();
  if(!cliente){ alert('El nombre del cliente no puede quedar vacío.'); return; }
  if(!productosLimpios.length){ alert('El pedido debe tener al menos un producto con nombre.'); return; }

  const totalNuevo=+productosLimpios.reduce((s,prod) => s + prod.subtotal, 0).toFixed(2);
  const pagoArm=_armarPagoEdicion(totalNuevo);
  if(pagoArm.error){ alert(pagoArm.error); return; }
  const nuevo = {
    fecha: document.getElementById('editFecha').value,
    empleado: document.getElementById('editAsesor').value,
    formapago: pagoArm.formapago,
    pagos: pagoArm.pagos,
    creditoPendiente: pagoArm.creditoPendiente,
    abono: pagoArm.abono,
    cliente,
    telefono: document.getElementById('editTelefono').value.trim(),
    direccion: document.getElementById('editDireccion').value.trim(),
    notas: document.getElementById('editNotas').value.trim(),
    productos: productosLimpios,
    total: totalNuevo
  };

  // Detectar cambios campo por campo para el historial de auditoría
  const camposSimples = ['fecha','empleado','formapago','cliente','telefono','direccion','notas','total'];
  const cambios = [];
  camposSimples.forEach(c => {
    const antes = original[c] !== undefined ? original[c] : '';
    const despues = nuevo[c] !== undefined ? nuevo[c] : '';
    if (String(antes) !== String(despues)) cambios.push({ campo:c, antes, despues });
  });
  if (JSON.stringify(original.productos||[]) !== JSON.stringify(nuevo.productos)) {
    cambios.push({ campo:'productos', antes: JSON.stringify(original.productos||[]), despues: JSON.stringify(nuevo.productos) });
  }

  const btn = document.getElementById('btnGuardarEdicion');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try{
    // [NEW] Solo se actualiza este documento puntual — no se vuelve a leer ni recorrer toda la colección
    await db.collection('pedidos').doc(editandoPedidoActual._id).update(nuevo);

    if (cambios.length){
      const lote = db.batch();
      cambios.forEach(c => {
        const ref = db.collection('historialCambios').doc();
        lote.set(ref, {
          tipo: 'pedido', accion: 'edición', registroId: editandoPedidoActual._id, // [NEW] campos genéricos para la pestaña de Auditoría
          pedidoId: editandoPedidoActual._id,
          usuarioAdmin: actorAuditoria(), usuarioUid: (ADMIN_ACTUAL && ADMIN_ACTUAL.uid) || null, usuarioLogin: (ADMIN_ACTUAL && ADMIN_ACTUAL.usuario) || '',
          fecha: fechaHoy(),
          hora: new Date().toLocaleTimeString('es-EC'),
          campo: c.campo,
          valorAnterior: String(c.antes),
          valorNuevo: String(c.despues),
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await lote.commit();
    }

    // El listener en tiempo real de "pedidos" ya activo recibe el cambio y recalcula
    // automáticamente KPIs, gráficos, Resumen por Cliente y Cuadre de Caja — sin recargar.
    Object.assign(original, nuevo);
    if(typeof renderDashboard==='function') renderDashboard();
    mostrarToastEdicion('✅ Pedido actualizado correctamente.');
    cerrarEditarPedido();
  }catch(err){
    console.error(err);
    alert('❌ Ocurrió un error al guardar los cambios: ' + err.message);
  }finally{
    btn.disabled = false; btn.textContent = '✅ Guardar Cambios';
  }
}

/* ════════════════════════════════════════════════════════════
   [NEW] ELIMINAR PEDIDO — con respaldo completo antes de borrar
   El documento original se copia entero a la colección
   `pedidosEliminados` (con fecha, hora y usuario admin que lo
   eliminó) y recién después se borra de `pedidos`. Si algún día
   hace falta, el pedido completo sigue existiendo ahí — nunca se
   pierde información, solo se saca de la vista operativa.
════════════════════════════════════════════════════════════ */
/* [NEW] Helper genérico de auditoría — un solo registro por acción, reutilizable
   para pedidos, pagos, gastos, usuarios, etc. Queda visible en la nueva pestaña
   "Auditoría" del Dashboard: quién, qué tipo de registro, qué acción, cuándo
   (fecha/hora exacta) y el detalle de qué cambió. */
/* [NEW] Modal reutilizable de "Motivo de eliminación" — cualquier flujo de
   eliminar (pedido, pago, gasto) llama a _pedirMotivoEliminar() en vez de
   confirm(). El callback solo se ejecuta si el admin escribe un motivo y
   confirma con el botón "Eliminar" del modal (segundo click). */
let _motivoEliminarCallback = null;
function _pedirMotivoEliminar(mensaje, callback){
  const overlay = document.getElementById('modalMotivoEliminarOverlay');
  const msgEl = document.getElementById('motivoEliminarMensaje');
  const inputEl = document.getElementById('motivoEliminarInput');
  if(!overlay || !msgEl || !inputEl){ callback(''); return; } // red de seguridad si el modal no está en el HTML
  msgEl.textContent = mensaje;
  inputEl.value = '';
  _motivoEliminarCallback = callback;
  overlay.classList.add('open');
  setTimeout(()=>inputEl.focus(), 50);
}
function _cancelarMotivoEliminar(){
  const overlay = document.getElementById('modalMotivoEliminarOverlay');
  if(overlay) overlay.classList.remove('open');
  _motivoEliminarCallback = null;
}
function _confirmarMotivoEliminar(){
  const inputEl = document.getElementById('motivoEliminarInput');
  const motivo = (inputEl.value||'').trim();
  if(!motivo){ alert('Escribe el motivo por el que se elimina.'); inputEl.focus(); return; }
  const cb = _motivoEliminarCallback;
  const overlay = document.getElementById('modalMotivoEliminarOverlay');
  if(overlay) overlay.classList.remove('open');
  _motivoEliminarCallback = null;
  if(cb) cb(motivo);
}
async function _registrarAuditoria(tipo, accion, registroId, detalle, motivo){
  try{
    await db.collection('historialCambios').add({
      tipo, accion, registroId: registroId || null, detalle: detalle || '',
      motivo: motivo || '', // [NEW] motivo de eliminación, cuando aplica
      usuarioAdmin: actorAuditoria(), usuarioUid: (ADMIN_ACTUAL && ADMIN_ACTUAL.uid) || null, usuarioLogin: (ADMIN_ACTUAL && ADMIN_ACTUAL.usuario) || '',
      fecha: fechaHoy(),
      hora: new Date().toLocaleTimeString('es-EC'),
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
  }catch(err){ console.warn('No se pudo registrar en auditoría:', err); } // nunca bloquea la acción principal
}
async function eliminarPedidoCompleto(pedidoId){
  const p = _pedidosRaw.find(x => x._id === pedidoId);
  if(!p){ alert('No se encontró el pedido — puede que ya se haya eliminado.'); return; }
  if(ROL_ACTUAL !== 'admin'){
    alert('Solo el administrador puede eliminar pedidos.');
    return;
  }

  const clienteNombre = p.cliente || 'Sin nombre';
  const totalPedido = p.total != null ? `$${parseFloat(p.total).toFixed(2)}` : '$0.00';
  _pedirMotivoEliminar(`Vas a eliminar por completo el pedido de "${clienteNombre}" (${totalPedido}). Esta acción lo saca del dashboard y de la app de asesores, y también revierte cualquier movimiento de inventario generado automáticamente por esta venta. Queda respaldado en el historial de eliminados, pero ya no aparecerá en ningún reporte activo.`, async (motivo) => {
  try{
    // 1) Respaldo completo del documento original + metadata de la eliminación
    const { _id, ...datosOriginales } = p; // quita el campo interno _id antes de guardar el respaldo
    await db.collection('pedidosEliminados').doc(pedidoId).set({
      ...datosOriginales,
      pedidoIdOriginal: pedidoId,
      eliminadoPor: actorAuditoria(),
      motivoEliminacion: motivo, // [NEW]
      fechaEliminacion: fechaHoy(),
      horaEliminacion: new Date().toLocaleTimeString('es-EC'),
      eliminadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

    // [NEW] Registro de auditoría de esta eliminación
    await _registrarAuditoria('pedido', 'eliminación', pedidoId,
      `Pedido de "${clienteNombre}" (${totalPedido}) eliminado — respaldado en Pedidos Eliminados.`, motivo);

    // 2) [NEW] Borra también los movimientos de inventario que esta venta
    // generó automáticamente (búsqueda por pedidoId, que sí es un campo
    // confiable en inventarioMovimientos — a diferencia de pagos, que no
    // guarda pedidoId y por eso no se puede vincular con certeza).
    try{
      const movInv = await db.collection('inventarioMovimientos').where('pedidoId','==',pedidoId).get();
      if(!movInv.empty){
        const loteInv = db.batch();
        movInv.forEach(docMov => loteInv.delete(docMov.ref));
        await loteInv.commit();
      }
    }catch(errInv){
      console.warn('No se pudieron borrar los movimientos de inventario asociados:', errInv);
      // No bloquea el resto del proceso — el pedido igual se elimina.
    }

    // 3) Recién ahora se borra el documento original de "pedidos"
    await db.collection('pedidos').doc(pedidoId).delete();
    _pedidosRaw = (_pedidosRaw||[]).filter(x=>x._id!==pedidoId);
    if(typeof renderDashboard==='function') renderDashboard();
    mostrarToastEdicion('🗑 Pedido eliminado, respaldado y su inventario revertido correctamente.');
  }catch(err){
    console.error(err);
    alert('❌ Ocurrió un error al eliminar el pedido: ' + err.message);
  }
  });
}

/* ════════════════════════════════════════════════════════════
   [NEW] VER PEDIDOS ELIMINADOS — tabla de respaldo, con fecha,
   hora y usuario de la eliminación, más todo el detalle original
   del pedido (cliente, productos, regalías, pagos, GPS, notas)
   desplegable con un clic sobre la fila.
════════════════════════════════════════════════════════════ */
function renderTablaEliminados(){
  const tbody = document.getElementById('tablaEliminados');
  const count = document.getElementById('eliminadosCount');
  if(!tbody) return;
  const lista = (_eliminadosRaw||[]).filter(p => _estaEnRangoFiltroDash(p.fechaEliminacion || p.fecha, p.eliminadoEn));
  if(count) count.textContent = lista.length + ' registro' + (lista.length!==1?'s':'');
  if(!lista.length){
    tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div class="icon">🗑</div>No hay pedidos eliminados en el período filtrado</div></td></tr>';
    return;
  }
  tbody.innerHTML = lista.map((p, idx) => {
    const total = p.total != null ? `<strong style="color:var(--red)">$${parseFloat(p.total).toFixed(2)}</strong>` : '—';
    const pago = p.formapago ? `<span class="badge badge-red">${escHTML(p.formapago)}</span>` : '';
    const asesorNombre = escHTML((p.empleado||'').split(':')[1]?.trim() || p.empleado || '-');

    // Detalle desplegable: productos, regalías, teléfono, dirección, notas, GPS
    const filasProductos = (p.productos||[]).map(prod => {
      let fila = `<tr>
        <td>${escHTML(prod.nombre||'-')}</td>
        <td style="text-align:center">${prod.cantidad!=null?escHTML(String(prod.cantidad)):'-'}</td>
        <td style="text-align:right">$${parseFloat(prod.precio||0).toFixed(2)}</td>
        <td style="text-align:right">$${parseFloat(prod.subtotal||0).toFixed(2)}</td>
      </tr>`;
      if(prod.regalias && prod.regalias.length){
        fila += prod.regalias.map(reg => `<tr><td colspan="2" style="font-size:11px;color:var(--teal-dark);font-style:italic">🎁 Regalo: ${escHTML(reg.nombre||'-')} x${escHTML(String(reg.cantidad||1))}</td><td colspan="2" style="font-size:11px;color:var(--teal-dark);font-style:italic">Regalo</td></tr>`).join('');
      }
      return fila;
    }).join('');
    const gpsInfo = (p.gps && p.gps.url) ? `<a href="${escapeAttr(p.gps.url)}" target="_blank" style="color:var(--teal);font-weight:700">📍 Ver ubicación del pedido</a>` : 'Sin GPS registrado';

    return `<tr>
      <td style="font-size:12px;white-space:nowrap">${limpiarFecha(p.fechaEliminacion)}</td>
      <td style="font-size:12px;white-space:nowrap">${escHTML(p.horaEliminacion||'-')}</td>
      <td style="font-size:12px;font-weight:700;color:var(--navy)">${escHTML(p.eliminadoPor||'-')}</td>
      <td style="font-weight:600">${escHTML(p.cliente||'-')}</td>
      <td style="font-size:12px">${asesorNombre}</td>
      <td style="font-size:12px;color:var(--muted);white-space:nowrap">${limpiarFecha(p.fecha)}</td>
      <td style="text-align:right">${total}</td>
      <td>${pago}</td>
      <td style="font-size:12px;color:var(--muted);font-style:italic;max-width:180px">${escHTML(p.motivoEliminacion||'-')}</td>
      <td><button class="btn-editar-fila" onclick="toggleEliminadoDetalle(${idx})" id="btnEliminadoToggle-${idx}" title="Ver todo lo que se eliminó">👁 Ver detalle</button></td>
    </tr>
    <tr id="filaEliminadoDetalle-${idx}" style="display:none">
      <td colspan="10" style="background:var(--surface2);padding:14px 18px">
        <div style="font-size:12px;color:var(--muted);line-height:1.9;margin-bottom:10px">
          📞 Teléfono: <b style="color:var(--text)">${escHTML(p.telefono||'-')}</b> &nbsp;·&nbsp;
          📍 Dirección: <b style="color:var(--text)">${escHTML(p.direccion||'-')}</b><br>
          📝 Notas: <b style="color:var(--text)">${escHTML(p.notas||'-')}</b> &nbsp;·&nbsp; ${gpsInfo}
        </div>
        <table class="cierre-cliente-table" style="border:1px solid var(--border);border-radius:8px;overflow:hidden">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
          <tbody>${filasProductos || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sin productos registrados</td></tr>'}</tbody>
        </table>
      </td>
    </tr>`;
  }).join('');
}
function toggleEliminadoDetalle(idx){
  const fila = document.getElementById('filaEliminadoDetalle-'+idx);
  const btn = document.getElementById('btnEliminadoToggle-'+idx);
  if(!fila) return;
  const abrir = fila.style.display === 'none';
  fila.style.display = abrir ? 'table-row' : 'none';
  if(btn) btn.textContent = abrir ? '🙈 Ocultar' : '👁 Ver detalle';
}

/* ════════════════════════════════════════════════════════════
   [NEW] INVENTARIO — entradas y salidas con historial completo
════════════════════════════════════════════════════════════ */
function renderInventario(){
  const sel = document.getElementById('invProducto');
  if (sel) {
    const valorActual = sel.value;
    sel.innerHTML = '<option value="">-- Selecciona --</option>' + _productosCache.map(p => `<option value="${escapeAttrDash(p.nombre)}">${p.nombre}</option>`).join('');
    if (_productosCache.some(p => p.nombre === valorActual)) sel.value = valorActual; /* [FIX] ahora se actualiza siempre, no solo la primera vez, y conserva la selección si sigue existiendo */
  }
  const stock = {};
  _movimientosInvRaw.forEach(m => {
    if (!stock[m.producto]) stock[m.producto] = { entradas: 0, salidas: 0 };
    if (m.tipo === 'entrada') stock[m.producto].entradas += parseFloat(m.cantidad) || 0;
    else stock[m.producto].salidas += parseFloat(m.cantidad) || 0;
  });
  const tbodyStock = document.getElementById('tablaStockActual');
  const entries = Object.entries(stock).sort(([a],[b]) => a.localeCompare(b));
  if (tbodyStock) {
    tbodyStock.innerHTML = entries.length ? entries.map(([nombre,d]) => {
      const actual = d.entradas - d.salidas;
      return `<tr><td style="font-weight:600">${escHTML(nombre)}</td><td style="text-align:right;color:var(--teal)">${d.entradas}</td><td style="text-align:right;color:var(--red)">${d.salidas}</td><td style="text-align:right;font-weight:800;color:${actual<0?'var(--red)':'var(--navy)'}">${actual}</td></tr>`;
    }).join('') : '<tr><td colspan="4"><div class="empty-state"><div class="icon">📦</div>Sin movimientos registrados</div></td></tr>';
  }
  const tbodyMov = document.getElementById('tablaMovimientosInv');
  if (tbodyMov) {
    tbodyMov.innerHTML = _movimientosInvRaw.length ? _movimientosInvRaw.slice(0,150).map(m => {
      const tipoBadge = m.tipo === 'entrada' ? '<span class="badge badge-teal">🟢 Entrada</span>' : '<span class="badge badge-red">🔴 Salida</span>';
      return `<tr><td style="font-size:12px">${limpiarFecha(m.fecha)}</td><td style="font-weight:600">${escHTML(m.producto)}</td><td>${tipoBadge}</td><td style="text-align:right;font-weight:700">${escHTML(String(m.cantidad))}</td><td style="font-size:12px;color:var(--muted)">${escHTML(m.motivo||'-')}</td><td style="font-size:12px">${escHTML(m.usuario||'-')}</td></tr>`;
    }).join('') : '<tr><td colspan="6"><div class="empty-state"><div class="icon">📋</div>Sin historial</div></td></tr>';
  }
}
async function registrarMovimientoInventario(){
  const producto = document.getElementById('invProducto').value;
  const tipo = document.getElementById('invTipo').value;
  const cantidad = parseFloat(document.getElementById('invCantidad').value);
  const fecha = document.getElementById('invFecha').value || fechaHoy();
  const motivo = document.getElementById('invMotivo').value.trim();
  if (!producto) { alert('Selecciona un producto.'); return; }
  if (!cantidad || cantidad <= 0) { alert('Ingresa una cantidad válida.'); return; }
  try {
    await db.collection('inventarioMovimientos').add({
      producto, tipo, cantidad, fecha, motivo,
      usuario: ADMIN_ACTUAL.nombre || ADMIN_ACTUAL.uid || 'admin',
      creadoPor: ADMIN_ACTUAL.uid || null,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('invCantidad').value = '';
    document.getElementById('invMotivo').value = '';
    mostrarToastEdicion('✅ Movimiento de inventario registrado.');
  } catch(err) { console.error(err); alert('❌ No se pudo registrar el movimiento: ' + err.message); }
}
function escapeAttrDash(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
/* [FIX] escapeAttr se había borrado por accidente al reescribir Consultar por Cliente —
   esto rompía TODO lo que la usaba (Consultar por Cliente, Pedidos Eliminados, Editar Pedido, etc.) */
function escapeAttr(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

/* [NEW] Normaliza el texto de Asesor que viene del Excel (ej. "JEFFERSON", "Vicente",
   "jefferson") contra las rutas reales registradas ("RUTA 1: Jefferson", etc.), para que
   el filtro de asesor SIEMPRE encuentre coincidencia exacta después de importar. */
function _matchAsesorCanonico(texto){
  if(!texto) return '';
  const t = texto.toLowerCase().trim();
  let exacto = _asesoresCache.find(r => r.toLowerCase() === t);
  if (exacto) return exacto;
  let porNombre = _asesoresCache.find(r => (r.split(':')[1]||'').trim().toLowerCase() === t);
  if (porNombre) return porNombre;
  let parcial = _asesoresCache.find(r => r.toLowerCase().includes(t) || t.includes((r.split(':')[1]||'').trim().toLowerCase()));
  return parcial || texto; // si no encuentra match, deja el texto original (se ve en la preview)
}

/* [NEW] Migración única — corrige pedidos ya importados cuyo campo 'empleado'
   no coincide exactamente con el formato "RUTA N: Nombre" usado por los filtros. */
async function corregirAsesoresPedidosExistentes(){
  const candidatos = _pedidosRaw.filter(p => p.empleado && !_asesoresCache.includes(p.empleado));
  if(!candidatos.length){ alert('No se encontraron pedidos con asesor mal formateado.'); return; }

  const preview = candidatos.slice(0,15).map(p => `"${p.empleado}" → "${_matchAsesorCanonico(p.empleado)}"`).join('\n');
  if(!confirm(`Se corregirán ${candidatos.length} pedido(s). Ejemplos:\n\n${preview}${candidatos.length>15?'\n...':''}\n\n¿Continuar?`)) return;

  try{
    let lote = db.batch(); let contador = 0;
    for(const p of candidatos){
      const corregido = _matchAsesorCanonico(p.empleado);
      if(corregido !== p.empleado){
        lote.update(db.collection('pedidos').doc(p._id), { empleado: corregido });
        contador++;
        if(contador % 400 === 0){ await lote.commit(); lote = db.batch(); }
      }
    }
    await lote.commit();
    mostrarToastEdicion(`✅ ${contador} pedido(s) corregido(s) correctamente.`);
  }catch(err){ console.error(err); alert('❌ Error al corregir: ' + err.message); }
}

/* ════════════════════════════════════════════════════════════
   [NEW] ROLES DE PAGO — sueldo base + comisión por ventas
   El % de comisión por asesor está en 0 por defecto (aún no hay
   tabla de comisiones); se edita fila por fila y se recuerda para
   los próximos cálculos hasta que definan la tabla oficial.
════════════════════════════════════════════════════════════ */
let _rolesCalculados = [];
function calcularRolesPago(){
  const desde = document.getElementById('rolesDesde').value;
  const hasta = document.getElementById('rolesHasta').value;
  if (!desde || !hasta) { alert('Selecciona el rango de fechas del período.'); return; }
  const pedidosPeriodo = _pedidosRaw.filter(p => p.fecha >= desde && p.fecha <= hasta);
  const ventasPorAsesor = {};
  pedidosPeriodo.forEach(p => { const a = p.empleado || 'Sin asignar'; ventasPorAsesor[a] = (ventasPorAsesor[a]||0) + (parseFloat(p.total)||0); });
  _rolesCalculados = _asesoresCache.map(ruta => {
    const nombre = ruta.split(':')[1]?.trim() || ruta;
    const ventas = ventasPorAsesor[ruta] || 0;
    const existente = _rolesConfig[ruta] || { sueldoBase: 0, comisionPct: 0 };
    const comision = ventas * (existente.comisionPct/100);
    return { ruta, nombre, sueldoBase: existente.sueldoBase, ventas, comisionPct: existente.comisionPct, comision, total: existente.sueldoBase + comision };
  });
  renderTablaRolesPago();
}
function renderTablaRolesPago(){
  const tbody = document.getElementById('tablaRolesPago');
  if (!_rolesCalculados.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">💵</div>Calcula un período para ver los roles</div></td></tr>'; document.getElementById('rolesTotalGeneral').innerHTML = ''; return; }
  let totalGeneral = 0;
  tbody.innerHTML = _rolesCalculados.map((r,i) => {
    totalGeneral += r.total;
    return `<tr>
      <td style="font-weight:600">${r.nombre}</td>
      <td style="text-align:right"><input type="number" min="0" step="0.01" value="${r.sueldoBase}" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;text-align:right" onchange="actualizarRolCampo(${i},'sueldoBase',this.value)"></td>
      <td style="text-align:right;color:var(--teal);font-weight:700">$${r.ventas.toFixed(2)}</td>
      <td style="text-align:right"><input type="number" min="0" max="100" step="0.1" value="${r.comisionPct}" style="width:65px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;text-align:right" onchange="actualizarRolCampo(${i},'comisionPct',this.value)">%</td>
      <td style="text-align:right">$${r.comision.toFixed(2)}</td>
      <td style="text-align:right;font-weight:800;color:var(--navy)">$${r.total.toFixed(2)}</td>
      <td><button class="btn-editar-fila" onclick="guardarRolPago(${i})">💾 Guardar rol</button></td>
    </tr>`;
  }).join('');
  document.getElementById('rolesTotalGeneral').innerHTML = `<div class="editar-total-box"><span class="lbl">Total general del período</span><span class="val">$${totalGeneral.toFixed(2)}</span></div>`;
}
function actualizarRolCampo(i, campo, valor){
  _rolesCalculados[i][campo] = parseFloat(valor) || 0;
  const r = _rolesCalculados[i];
  r.comision = r.ventas * (r.comisionPct/100);
  r.total = r.sueldoBase + r.comision;
  _rolesConfig[r.ruta] = { sueldoBase: r.sueldoBase, comisionPct: r.comisionPct }; // se recuerda para futuros cálculos
  renderTablaRolesPago();
}
async function guardarRolPago(i){
  const r = _rolesCalculados[i];
  const desde = document.getElementById('rolesDesde').value, hasta = document.getElementById('rolesHasta').value;
  try {
    await db.collection('rolesPago').add({
      asesorRuta: r.ruta, asesorNombre: r.nombre, periodoDesde: desde, periodoHasta: hasta,
      sueldoBase: r.sueldoBase, ventasPeriodo: r.ventas, comisionPct: r.comisionPct, comisionCalculada: r.comision, totalPagado: r.total,
      generadoPor: ADMIN_ACTUAL.nombre || 'admin', fechaGeneracion: fechaHoy(),
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    mostrarToastEdicion('✅ Rol de pago guardado para ' + r.nombre + '.');
  } catch(err) { console.error(err); alert('❌ No se pudo guardar el rol: ' + err.message); }
}

/* ════════════════════════════════════════════════════════════
   [NEW] IMPORTAR DATOS — pedidos históricos desde Excel/CSV
   Cada fila = un producto; filas con el mismo Cliente+Fecha+Asesor
   se agrupan en un solo pedido, igual que hace el resto del dashboard.
════════════════════════════════════════════════════════════ */
let _pedidosParaImportar = [];
function actualizarEstadoArchivoImportar(){
  const input=document.getElementById('importarArchivo');
  const btn=document.getElementById('btnQuitarArchivoImportar');
  if(btn) btn.style.display=(input && input.files && input.files.length)?'inline-flex':'none';
}
function limpiarArchivoImportado(){
  const input=document.getElementById('importarArchivo');
  if(input) input.value='';
  const preview=document.getElementById('importarPreview');
  if(preview) preview.innerHTML='';
  if(typeof _pedidosParaImportar!=='undefined') _pedidosParaImportar=[];
  actualizarEstadoArchivoImportar();
}
function procesarArchivoImportado(){
  const input = document.getElementById('importarArchivo');
  const file = input.files[0];
  if (!file) { alert('Selecciona un archivo primero.'); return; }
  const reader = new FileReader();
  reader.onload = function(e){
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(ws, { defval: '' });
      agruparYPrevisualizarImportacion(filas);
    } catch(err) { console.error(err); alert('No se pudo leer el archivo. Verifica que sea un Excel o CSV válido.'); }
  };
  reader.readAsArrayBuffer(file);
}
/* [FIX] Antes esto solo reconocía encabezados con capitalización exacta ('Fecha' o
   'fecha'), así que un Excel con encabezados en MAYÚSCULAS ('FECHA') o con espacios
   ('FORMA DE PAGO') no coincidía con nada y todas las filas se descartaban -- por eso
   no aparecía ningún pedido al importar. Ahora normaliza encabezados (mayúsculas, sin
   tildes, sin espacios) antes de buscarlos, así que funciona sin importar cómo estén
   escritos en el archivo. */
function _normEncabezado(s){
  return String(s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
}
function _valorColumna(filaNormalizada, aliases){
  for (const alias of aliases){
    const v = filaNormalizada[_normEncabezado(alias)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}
/* [FIX] Cuando la columna Fecha en el Excel está formateada como fecha nativa (no como
   texto), SheetJS la entrega como un número de serie (ej. 46267) en vez de "AAAA-MM-DD".
   Eso hacía que "Último pedido" mostrara ese número crudo y "Días sin compra" diera NaN.
   Esto detecta ese caso (puro número, sin guiones) y lo convierte a fecha real. */
function _normalizarFechaImportada(valor){
  const s = String(valor||'').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) { // solo dígitos -> probable número de serie de Excel
    try {
      const d = XLSX.SSF.parse_date_code(Number(s));
      if (d && d.y) { const pad = n => String(n).padStart(2,'0'); return `${d.y}-${pad(d.m)}-${pad(d.d)}`; }
    } catch(e) { /* si falla, se usa el valor tal cual más abajo */ }
  }
  return s;
}
function agruparYPrevisualizarImportacion(filas){
  const grupos = {};
  filas.forEach(f => {
    const filaNorm = {};
    Object.keys(f).forEach(k => { filaNorm[_normEncabezado(k)] = f[k]; });
    const fecha = _normalizarFechaImportada(_valorColumna(filaNorm, ['Fecha']));
    const asesor = _matchAsesorCanonico(_valorColumna(filaNorm, ['Asesor']));
    const cliente = _valorColumna(filaNorm, ['Cliente']);
    if (!fecha || !cliente) return;
    const key = `${cliente}|${fecha}|${asesor}`;
    if (!grupos[key]) grupos[key] = { fecha, empleado: asesor, cliente, telefono: _valorColumna(filaNorm, ['Telefono']), direccion: _valorColumna(filaNorm, ['Direccion']), formapago: _valorColumna(filaNorm, ['FormaPago','Forma de Pago']) || 'Contado', notas: _valorColumna(filaNorm, ['Notas']), productos: [] };
    const cantidad = parseFloat(_valorColumna(filaNorm, ['Cantidad'])) || 0;
    const precio = parseFloat(_valorColumna(filaNorm, ['Precio'])) || 0;
    grupos[key].productos.push({ nombre: _valorColumna(filaNorm, ['Producto']), cantidad, precio, subtotal: +(cantidad*precio).toFixed(2), regalias: [] });
  });
  _pedidosParaImportar = Object.values(grupos).map(p => ({ ...p, total: +p.productos.reduce((s,pr) => s+pr.subtotal, 0).toFixed(2) }));
  renderPreviewImportacion();
}
function renderPreviewImportacion(){
  const cont = document.getElementById('importarPreview');
  if (!_pedidosParaImportar.length) { cont.innerHTML = '<div class="empty-state"><div class="icon">📭</div>No se detectaron pedidos válidos en el archivo. Revisa que las columnas coincidan con el formato indicado arriba.</div>'; return; }
  const filas = _pedidosParaImportar.map(p => `<tr><td style="font-size:12px">${escHTML(p.fecha)}</td><td style="font-size:12px">${escHTML(p.empleado||'-')}</td><td style="font-weight:600">${escHTML(p.cliente)}</td><td style="text-align:center">${p.productos.length}</td><td style="text-align:right;font-weight:700;color:var(--teal)">$${p.total.toFixed(2)}</td></tr>`).join('');
  cont.innerHTML = `
    <div style="margin-bottom:10px;font-size:13px;font-weight:700;color:var(--navy)">Se detectaron ${_pedidosParaImportar.length} pedido(s) — revisa antes de confirmar:</div>
    <div class="table-wrap" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:320px;overflow-y:auto">
      <table><thead><tr><th>Fecha</th><th>Asesor</th><th>Cliente</th><th style="text-align:center">Prod.</th><th style="text-align:right">Total</th></tr></thead><tbody>${filas}</tbody></table>
    </div>
    <button class="btn-filter" id="btnConfirmarImportacion" style="background:var(--red);margin-top:14px" onclick="confirmarImportacionMasiva()">⬆ Confirmar e importar ${_pedidosParaImportar.length} pedido(s) a Firestore</button>
  `;
}
async function confirmarImportacionMasiva(){
  if (!_pedidosParaImportar.length) return;
  if (!confirm(`¿Importar ${_pedidosParaImportar.length} pedido(s) a la base de datos activa? Cada pedido importado queda marcado como "importado:true" para poder identificarlo y eliminarlo individualmente después si hace falta.`)) return;
  const btn = document.getElementById('btnConfirmarImportacion');
  if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }
  try {
    let lote = db.batch(); let contador = 0;
    for (const p of _pedidosParaImportar) {
      const ref = db.collection('pedidos').doc();
      lote.set(ref, { ...p, importado: true, creadoPor: ADMIN_ACTUAL.uid || null, creadoEn: firebase.firestore.FieldValue.serverTimestamp() });
      contador++;
      if (contador % 400 === 0) { await lote.commit(); lote = db.batch(); } // límite de Firestore: 500 operaciones por lote
    }
    await lote.commit();
    mostrarToastEdicion(`✅ ${_pedidosParaImportar.length} pedido(s) importado(s) correctamente.`);
    _pedidosParaImportar = [];
    document.getElementById('importarPreview').innerHTML = '';
    document.getElementById('importarArchivo').value = '';
  } catch(err) { console.error(err); alert('❌ Error al importar: ' + err.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '⬆ Confirmar e importar'; } }
}
/* [NEW] Notificación flotante simple, reutilizable */
function mostrarToastEdicion(msg){
  let t = document.getElementById('toastEdicion');
  if(!t){
    t = document.createElement('div');
    t.id = 'toastEdicion';
    t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--navy);color:#fff;padding:12px 22px;border-radius:100px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;font-weight:700;box-shadow:var(--shadow-lg);z-index:999;opacity:0;transition:opacity .25s;pointer-events:none";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(window._toastEdicionTimer);
  window._toastEdicionTimer = setTimeout(()=>{ t.style.opacity = '0'; }, 2600);
}

/* ════════════════════════════════════════════════════════════
   [NEW] EDITAR / ELIMINAR PAGO Y GASTO — Cuadre de Caja (solo Admin)
════════════════════════════════════════════════════════════ */
const FORMAS_PAGO_COBRO = ['Efectivo','Transferencia','Cheque']; // mismas opciones que usa index.html al registrar un pago
let _editandoPagoGasto = null; // { tipo:'pago'|'gasto', id:'...' }

function _opcionesAsesorCuadre(sel){
  const lista=(Array.isArray(_asesoresCache)&&_asesoresCache.length)?_asesoresCache:[''];
  return lista.map(a=>`<option value="${escHTML(a)}" ${a===sel?'selected':''}>${escHTML((a.split(':')[1]||a).trim()||a)}</option>`).join('');
}
function abrirNuevoPago(){
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const fecha=document.getElementById('filtroFechaHasta')?.value||hoy;
  if(!_puedeEditarCuadreCaja(fecha)){ alert('No se puede añadir un pago en este período.'); return; }
  _editandoPagoGasto={ tipo:'pago-nuevo' };
  document.getElementById('editarPagoGastoTitulo').textContent='＋ Añadir pago';
  const optionsForma=FORMAS_PAGO_COBRO.map(f=>`<option value="${f}">${f}</option>`).join('');
  document.getElementById('editarPagoGastoBody').innerHTML=`
    <div class="editar-grid full">
      <div class="editar-field"><label>Cliente</label><input type="text" id="epgCliente" value=""></div>
      <div class="editar-field"><label>Asesor</label><select id="epgAsesor">${_opcionesAsesorCuadre('')}</select></div>
      <div class="editar-field"><label>Monto ($)</label><input type="number" min="0" step="0.01" id="epgMonto" value=""></div>
      <div class="editar-field"><label>Forma de Pago</label><select id="epgForma">${optionsForma}</select></div>
      <div class="editar-field"><label>Fecha</label><input type="date" id="epgFecha" value="${fecha}"></div>
      <div class="editar-field"><label>Notas / Referencia</label><textarea id="epgNotas"></textarea></div>
    </div>`;
  document.getElementById('editarPagoGastoOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function abrirNuevoGasto(){
  const hoy=(typeof fechaHoy==='function')?fechaHoy():'';
  const fecha=document.getElementById('filtroFechaHasta')?.value||hoy;
  if(!_puedeEditarCuadreCaja(fecha)){ alert('No se puede añadir un gasto en este período.'); return; }
  _editandoPagoGasto={ tipo:'gasto-nuevo' };
  document.getElementById('editarPagoGastoTitulo').textContent='＋ Añadir gasto';
  document.getElementById('editarPagoGastoBody').innerHTML=`
    <div class="editar-grid full">
      <div class="editar-field"><label>Descripción</label><input type="text" id="epgDesc" value=""></div>
      <div class="editar-field"><label>Categoría</label><input type="text" id="epgCategoria" value=""></div>
      <div class="editar-field"><label>Asesor / responsable</label><select id="epgAsesor">${_opcionesAsesorCuadre('')}</select></div>
      <div class="editar-field"><label>Monto ($)</label><input type="number" min="0" step="0.01" id="epgMonto" value=""></div>
      <div class="editar-field"><label>Fecha</label><input type="date" id="epgFecha" value="${fecha}"></div>
      <div class="editar-field"><label>Comprobante / Referencia</label><input type="text" id="epgRef" value=""></div>
    </div>`;
  document.getElementById('editarPagoGastoOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function abrirEditarPago(id){
  const p = _pagosRaw.find(x => x._id === id);
  if(!p){ alert('No se encontró el pago — puede que ya se haya eliminado.'); return; }
  if(!_puedeEditarCuadreCaja(p.fecha)){ alert('No se puede editar este pago en el período.'); return; }
  _editandoPagoGasto = { tipo:'pago', id };
  document.getElementById('editarPagoGastoTitulo').textContent = '✏ Editar Pago';
  const optionsForma = FORMAS_PAGO_COBRO.map(f => `<option value="${f}" ${p.forma===f?'selected':''}>${f}</option>`).join('');
  document.getElementById('editarPagoGastoBody').innerHTML = `
    <div class="editar-grid full">
      <div class="editar-field"><label>Cliente</label><input type="text" id="epgCliente" value="${escapeAttr(p.cliente||'')}"></div>
      <div class="editar-field"><label>Monto ($)</label><input type="number" min="0" step="0.01" id="epgMonto" value="${parseFloat(p.monto)||0}"></div>
      <div class="editar-field"><label>Forma de Pago</label><select id="epgForma">${optionsForma}</select></div>
      <div class="editar-field"><label>Fecha</label><input type="date" id="epgFecha" value="${p.fecha||''}"></div>
      <div class="editar-field"><label>Notas / Referencia</label><textarea id="epgNotas">${escHTML(p.notas||'')}</textarea></div>
    </div>`;
  document.getElementById('editarPagoGastoOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function abrirEditarGasto(id){
  const g = _gastosRaw.find(x => x._id === id);
  if(!g){ alert('No se encontró el gasto — puede que ya se haya eliminado.'); return; }
  if(!_puedeEditarCuadreCaja(g.fecha)){ alert('No se puede editar este gasto en el período.'); return; }
  _editandoPagoGasto = { tipo:'gasto', id };
  document.getElementById('editarPagoGastoTitulo').textContent = '✏ Editar Gasto';
  document.getElementById('editarPagoGastoBody').innerHTML = `
    <div class="editar-grid full">
      <div class="editar-field"><label>Descripción</label><input type="text" id="epgDesc" value="${escapeAttr(g.desc||'')}"></div>
      <div class="editar-field"><label>Categoría</label><input type="text" id="epgCategoria" value="${escapeAttr(g.categoria||'')}"></div>
      <div class="editar-field"><label>Monto ($)</label><input type="number" min="0" step="0.01" id="epgMonto" value="${parseFloat(g.monto)||0}"></div>
      <div class="editar-field"><label>Fecha</label><input type="date" id="epgFecha" value="${g.fecha||''}"></div>
      <div class="editar-field"><label>Comprobante / Referencia</label><input type="text" id="epgRef" value="${escapeAttr(g.ref||'')}"></div>
    </div>`;
  document.getElementById('editarPagoGastoOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarEditarPagoGasto(){
  document.getElementById('editarPagoGastoOverlay').classList.remove('open');
  document.body.style.overflow = '';
  _editandoPagoGasto = null;
}

async function guardarEdicionPagoGasto(){
  if(!_editandoPagoGasto) return;
  if(!confirm('¿Está seguro que desea guardar los cambios?')) return;
  const { tipo, id } = _editandoPagoGasto;
  const monto = parseFloat(document.getElementById('epgMonto').value);
  if(!monto || monto <= 0){ alert('Ingresa un monto válido mayor a $0.'); return; }
  const btn = document.getElementById('btnGuardarPagoGasto');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try{
    if(tipo === 'pago' || tipo === 'pago-nuevo'){
      const cliente = document.getElementById('epgCliente').value.trim();
      if(!cliente){ alert('El nombre del cliente no puede quedar vacío.'); btn.disabled=false; btn.textContent='✅ Guardar Cambios'; return; }
      const payloadPago={
        cliente, monto, forma: document.getElementById('epgForma').value,
        fecha: document.getElementById('epgFecha').value, notas: document.getElementById('epgNotas').value.trim()
      };
      const asEl=document.getElementById('epgAsesor');
      if(asEl) payloadPago.empleado=asEl.value;
      if(tipo==='pago-nuevo'){
        payloadPago.creadoEn=firebase.firestore.FieldValue.serverTimestamp();
        payloadPago.creadoPor=actorAuditoria();
        await db.collection('pagos').add(payloadPago);
      } else {
        await db.collection('pagos').doc(id).update(payloadPago);
      }
    } else {
      const desc = document.getElementById('epgDesc').value.trim();
      if(!desc){ alert('La descripción no puede quedar vacía.'); btn.disabled=false; btn.textContent='✅ Guardar Cambios'; return; }
      const payloadGasto={
        desc, categoria: document.getElementById('epgCategoria').value.trim(), monto,
        fecha: document.getElementById('epgFecha').value, ref: document.getElementById('epgRef').value.trim()
      };
      const asEl=document.getElementById('epgAsesor');
      if(asEl) payloadGasto.empleado=asEl.value;
      if(tipo==='gasto-nuevo'){
        payloadGasto.creadoEn=firebase.firestore.FieldValue.serverTimestamp();
        payloadGasto.creadoPor=actorAuditoria();
        await db.collection('gastos').add(payloadGasto);
      } else {
        await db.collection('gastos').doc(id).update(payloadGasto);
      }
    }
    const esAlta=tipo==='pago-nuevo'||tipo==='gasto-nuevo';
    const tipoAud=tipo.indexOf('gasto')===0?'gasto':'pago';
    await _registrarAuditoria(tipoAud, esAlta?'creación':'edición', id||'', (tipoAud==='pago'?'Pago':'Gasto') + (esAlta?' añadido':' editado') + ' por ' + actorAuditoria() + ' — monto $' + monto.toFixed(2));
    mostrarToastEdicion(esAlta ? (tipoAud==='pago'?'✅ Pago añadido.':'✅ Gasto añadido.') : (tipoAud==='pago'?'✅ Pago actualizado correctamente.':'✅ Gasto actualizado correctamente.'));
    cerrarEditarPagoGasto();
    if(typeof _refrescarDashboardTrasMB==='function') _refrescarDashboardTrasMB();
  }catch(err){
    console.error(err);
    alert('❌ Ocurrió un error al guardar: ' + err.message);
  }finally{
    btn.disabled = false; btn.textContent = '✅ Guardar Cambios';
  }
}

async function eliminarPagoDash(id){
  const pagoChk = (_pagosRaw||[]).find(x => x._id === id);
  if(!_puedeEditarCuadreCaja(pagoChk&&pagoChk.fecha)){ alert('No se puede eliminar este pago en el período.'); return; }

  const p = _pagosRaw.find(x => x._id === id);
  _pedirMotivoEliminar(`Vas a eliminar el pago de "${p?.cliente||'este cliente'}" ($${(parseFloat(p?.monto)||0).toFixed(2)}). Esta acción no se puede deshacer.`, async (motivo) => {
  try{
    await db.collection('pedidosEliminados').doc('pago_'+id).set({
      tipoRegistro:'pago', cliente:p?.cliente||'', empleado:p?.empleado||'', fecha:p?.fecha||'',
      total:parseFloat(p?.monto)||0, formapago:p?.forma||'Pago',
      pedidoIdOriginal:id, eliminadoPor:actorAuditoria(), motivoEliminacion:motivo,
      fechaEliminacion:fechaHoy(), horaEliminacion:new Date().toLocaleTimeString('es-EC'),
      eliminadoEn:firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('pagos').doc(id).delete();
    await _registrarAuditoria('pago', 'eliminación', id, 'Pago eliminado por ' + actorAuditoria(), motivo);
    mostrarToastEdicion('🗑 Pago eliminado correctamente.');
    if(typeof _refrescarDashboardTrasMB==='function') _refrescarDashboardTrasMB();
  }catch(err){ console.error(err); alert('❌ No se pudo eliminar el pago: ' + err.message); }
  });
}

async function eliminarGastoDash(id){
  const g = _gastosRaw.find(x => x._id === id);
  if(!_puedeEditarCuadreCaja(g&&g.fecha)){ alert('No se puede eliminar este gasto en el período.'); return; }
  _pedirMotivoEliminar(`Vas a eliminar el gasto "${g?.desc||g?.categoria||'este gasto'}" ($${(parseFloat(g?.monto)||0).toFixed(2)}). Esta acción no se puede deshacer.`, async (motivo) => {
  try{
    await db.collection('pedidosEliminados').doc('gasto_'+id).set({
      tipoRegistro:'gasto', cliente:g?.desc||g?.categoria||'Gasto', empleado:g?.empleado||'', fecha:g?.fecha||'',
      total:parseFloat(g?.monto)||0, formapago:'Gasto',
      pedidoIdOriginal:id, eliminadoPor:actorAuditoria(), motivoEliminacion:motivo,
      fechaEliminacion:fechaHoy(), horaEliminacion:new Date().toLocaleTimeString('es-EC'),
      eliminadoEn:firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('gastos').doc(id).delete();
    await _registrarAuditoria('gasto', 'eliminación', id, 'Gasto eliminado por ' + actorAuditoria(), motivo);
    mostrarToastEdicion('🗑 Gasto eliminado correctamente.');
    if(typeof _refrescarDashboardTrasMB==='function') _refrescarDashboardTrasMB();
  }catch(err){ console.error(err); alert('❌ No se pudo eliminar el gasto: ' + err.message); }
  });
}

/* ════════════════════════════════════════════════════════════
   [NEW] PEDIDOS WEB — cola de pedidos de la página pública (colección
   aislada `pedidosWeb`, con create público abierto). El admin revisa
   cada uno y lo Aprueba (creando el pedido real, con asesor y forma de
   pago asignados) o lo Rechaza — nunca entran solos al sistema real.
════════════════════════════════════════════════════════════ */
let _unsubPedidosWeb = null, _pedidosWebRaw = [];
function _iniciarListenerPedidosWeb(){
  if(_unsubPedidosWeb){_unsubPedidosWeb();_unsubPedidosWeb=null;}
  _unsubPedidosWeb = db.collection('pedidosWeb').onSnapshot(snap => {
    _pedidosWebRaw = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .filter(p => !p.estado || p.estado === 'pendiente') // [NEW] trata como pendiente cualquier doc sin campo 'estado' — la web pública podría no enviarlo
      .sort((a,b) => (a.creadoEn?.toMillis?.()||0) - (b.creadoEn?.toMillis?.()||0)); // más antiguo primero, como cola de trabajo
    renderPedidosWeb();
  }, err => console.error('listener pedidosWeb:', err));
}
function detenerListenerPedidosWeb(){ if(_unsubPedidosWeb){_unsubPedidosWeb();_unsubPedidosWeb=null;} }

function renderPedidosWeb(){
  const cont = document.getElementById('listaPedidosWeb');
  const count = document.getElementById('pedidosWebCount');
  if(!cont) return;
  if(count) count.textContent = _pedidosWebRaw.length + ' pendiente' + (_pedidosWebRaw.length!==1?'s':'');
  if(!_pedidosWebRaw.length){
    cont.innerHTML = '<div class="empty-state"><div class="icon">🌐</div>No hay pedidos web pendientes de aprobación</div>';
    return;
  }
  const optionsAsesor = _asesoresCache.map(r => `<option value="${escapeAttr(r)}">${r.split(':')[1]?.trim()||r}</option>`).join('');
  cont.innerHTML = _pedidosWebRaw.map((p, idx) => {
    const productos = (p.productos||[]).map(pr => `<tr><td>${escHTML(pr.nombre||'-')}</td><td style="text-align:center">${pr.cantidad||'-'}</td><td style="text-align:right">$${parseFloat(pr.precio||0).toFixed(2)}</td><td style="text-align:right">$${(parseFloat(pr.cantidad||0)*parseFloat(pr.precio||0)).toFixed(2)}</td></tr>`).join('');
    const totalWeb = (p.productos||[]).reduce((s,pr)=> s + (parseFloat(pr.cantidad||0)*parseFloat(pr.precio||0)), 0);
    return `
    <div class="cierre-cliente-block" style="margin:0 0 14px">
      <div class="cierre-cliente-header">
        <span class="cierre-cliente-nombre">🌐 ${escHTML(p.cliente||'Sin nombre')}</span>
        <span class="cierre-cliente-meta">📞 ${escHTML(p.telefono||'-')} · 📍 ${escHTML(p.direccion||'-')}</span>
        <span class="cierre-cliente-total">$${totalWeb.toFixed(2)}</span>
      </div>
      <table class="cierre-cliente-table">
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>${productos || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sin productos</td></tr>'}</tbody>
      </table>
      ${p.notas ? `<div style="padding:8px 14px;font-size:12px;color:var(--muted);border-top:1px solid var(--border)">📝 ${escHTML(p.notas)}</div>` : ''}
      <div style="padding:12px 14px;border-top:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="editar-field" style="margin-bottom:0;min-width:180px"><label>Asesor / Ruta</label><select id="pwAsesor-${idx}"><option value="">-- Selecciona --</option>${optionsAsesor}</select></div>
        <div class="editar-field" style="margin-bottom:0;min-width:150px"><label>Forma de Pago</label><select id="pwForma-${idx}"><option value="">-- Selecciona --</option><option value="Contado">Contado</option><option value="Crédito">Crédito</option><option value="Transferencia">Transferencia</option><option value="Cheque">Cheque</option></select></div>
        <button class="btn-guardar-edicion" style="padding:9px 16px" onclick="aprobarPedidoWeb('${p._id}', ${idx})">✅ Aprobar</button>
        <button class="btn-eliminar-fila" style="padding:9px 16px" onclick="rechazarPedidoWeb('${p._id}')">❌ Rechazar</button>
      </div>
    </div>`;
  }).join('');
}

async function aprobarPedidoWeb(id, idx){
  const p = _pedidosWebRaw.find(x => x._id === id);
  if(!p){ alert('Este pedido web ya no existe.'); return; }
  const asesor = document.getElementById(`pwAsesor-${idx}`).value;
  const formapago = document.getElementById(`pwForma-${idx}`).value;
  if(!asesor){ alert('Selecciona a qué asesor/ruta se le asigna este pedido.'); return; }
  if(!formapago){ alert('Selecciona la forma de pago.'); return; }
  const productos = (p.productos||[]).map(pr => ({ nombre: pr.nombre||'', cantidad: parseFloat(pr.cantidad)||0, precio: parseFloat(pr.precio)||0, subtotal: +((parseFloat(pr.cantidad)||0)*(parseFloat(pr.precio)||0)).toFixed(2), regalias: [] }));
  if(!productos.length){ alert('Este pedido no tiene productos válidos.'); return; }
  const total = +productos.reduce((s,pr)=>s+pr.subtotal,0).toFixed(2);
  try{
    await db.collection('pedidos').add({
      empleado: asesor, cliente: p.cliente||'Sin nombre', telefono: p.telefono||'', direccion: p.direccion||'',
      fecha: fechaHoy(), notas: (p.notas||'') + ' [Pedido recibido desde la página web]',
      formapago, total, productos, gps: null, origenWeb: true,
      creadoPor: ADMIN_ACTUAL.uid || null, creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('pedidosWeb').doc(id).update({ estado: 'aprobado', aprobadoPor: ADMIN_ACTUAL.nombre||'admin', aprobadoEn: firebase.firestore.FieldValue.serverTimestamp() });
    mostrarToastEdicion('✅ Pedido web aprobado — ya forma parte de las ventas reales.');
  }catch(err){ console.error(err); alert('❌ No se pudo aprobar el pedido: ' + err.message); }
}

async function rechazarPedidoWeb(id){
  if(!confirm('¿Rechazar este pedido web? No se creará ninguna venta real a partir de él.')) return;
  try{
    await db.collection('pedidosWeb').doc(id).update({ estado: 'rechazado', rechazadoPor: ADMIN_ACTUAL.nombre||'admin', rechazadoEn: firebase.firestore.FieldValue.serverTimestamp() });
    mostrarToastEdicion('❌ Pedido web rechazado.');
  }catch(err){ console.error(err); alert('❌ No se pudo rechazar el pedido: ' + err.message); }
}

/* ════════════════════════════════════════════════════════════
   [NEW] CREAR USUARIOS — Secretaria (solo Admin), ahora como pestaña
   del menú lateral en vez de modal — acceso de solo lectura al Dashboard.
════════════════════════════════════════════════════════════ */
async function poblarSelectEliminarSecretaria(){
  const sel = document.getElementById('sec-eliminar-select');
  sel.innerHTML = '<option value="">-- Selecciona --</option>';
  try{
    const snap = await db.collection('usuarios').where('esSecretaria','==',true).get();
    snap.forEach(doc => {
      const d = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = `${d.nombre||'Secretaria'} (${d.usuario||'-'})`;
      sel.appendChild(opt);
    });
  }catch(e){ console.error(e); }
}
async function crearSecretariaReal(){
  const nombre = document.getElementById('sec-nombre').value.trim();
  const usuario = document.getElementById('sec-usuario').value.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  const pass = document.getElementById('sec-pass').value;
  if(!nombre){ alert('Ingresa el nombre completo.'); return; }
  if(!usuario){ alert('Ingresa un usuario válido (solo letras y números, sin espacios).'); return; }
  if(!pass || pass.length<6){ alert('Firebase exige contraseñas de al menos 6 caracteres.'); return; }
  const email = _emailDeUsuario(usuario);
  const btn = document.getElementById('sec-btn-crear');
  btn.disabled = true; btn.textContent = 'Creando...';
  try{
    const cred = await _secondaryAuthDash.createUserWithEmailAndPassword(email, pass);
    const uid = cred.user.uid;
    await _secondaryAuthDash.signOut(); // limpia la instancia secundaria, no toca la sesión del admin
    await db.collection('usuarios').doc(uid).set({
      usuario, nombre, esAdmin: false, esSecretaria: true, rol: 'SECRETARIA',
      creadoPor: ADMIN_ACTUAL.uid || null, creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('sec-resultado').innerHTML = `✓ Cuenta creada — usuario: <b>${usuario}</b>. Ya puede iniciar sesión en este mismo Dashboard con acceso de solo lectura.`;
    document.getElementById('sec-resultado').style.display = 'block';
    document.getElementById('sec-nombre').value = '';
    document.getElementById('sec-usuario').value = '';
    document.getElementById('sec-pass').value = '';
    poblarSelectEliminarSecretaria();
  }catch(err){
    console.error(err);
    let msg = 'No se pudo crear la cuenta.';
    if(err.code === 'auth/email-already-in-use') msg = 'Ese usuario ya existe.';
    else if(err.code === 'auth/weak-password') msg = 'La contraseña es muy débil (mínimo 6 caracteres).';
    alert(msg);
  }finally{
    btn.disabled = false; btn.textContent = '✅ Crear Secretaria';
  }
}
/* [NEW] Llama a una Cloud Function enviando el token de sesión a mano (mismo patrón
   ya usado en index.html para eliminar asesores/resetear contraseñas). */
async function _llamarFuncion(nombre, datos){
  const cu = auth.currentUser;
  if(!cu) throw new Error('No hay sesión activa. Vuelve a iniciar sesión.');
  const token = await cu.getIdToken(true);
  const url = `https://us-central1-luan-aqua.cloudfunctions.net/${nombre}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ data: datos })
  });
  const rawText = await resp.text();
  let json;
  try{ json = JSON.parse(rawText); }catch{ json = {}; }
  if(!resp.ok){ throw new Error((json.error && json.error.message) || json.error || 'Error al llamar la función.'); }
  return json.result !== undefined ? json.result : json;
}
async function eliminarSecretariaSeleccionada(){
  const uid = document.getElementById('sec-eliminar-select').value;
  if(!uid){ alert('Selecciona una cuenta de la lista.'); return; }
  const sel = document.getElementById('sec-eliminar-select');
  const nombreSeleccionado = sel.options[sel.selectedIndex]?.text || 'esta cuenta';
  _pedirMotivoEliminar(`Vas a quitar el acceso de "${nombreSeleccionado}". Ya no podrá iniciar sesión, y el usuario quedará libre para volver a crearse si hace falta.`, async (motivo) => {
  try{
    // [FIX] Antes solo se borraba el perfil de Firestore y la cuenta de Firebase
    // Auth quedaba huérfana (con el mismo usuario/correo "ocupado" para siempre).
    // Ahora reutiliza la Cloud Function eliminarAsesorCompleto, que borra las DOS
    // cosas — funciona igual para secretaria que para asesor (solo exige que la
    // cuenta objetivo no sea admin).
    await _llamarFuncion('eliminarAsesorCompleto', { uid });
    // [NEW] Registro de auditoría de esta eliminación de usuario, con motivo —
    // válido para cualquier cuenta que se borre por esta misma vía en el futuro,
    // no solo secretarias.
    await _registrarAuditoria('usuario', 'eliminación', uid,
      `Cuenta de "${nombreSeleccionado}" eliminada — acceso revocado por completo.`, motivo);
    mostrarToastEdicion('✓ Acceso de Secretaria revocado por completo. El usuario queda libre para volver a crearse.');
    poblarSelectEliminarSecretaria();
  }catch(err){ console.error(err); alert('No se pudo eliminar: ' + (err.message || 'error desconocido')); }
  });
}
