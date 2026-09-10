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
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => console.warn('No se pudo fijar persistencia LOCAL de Auth:', err));
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
function _textoDesgloseFila(r){
  const cred=parseFloat(r['CREDITO_PENDIENTE']||0);
  if (r['PAGOS_DESGLOSE'] && r['PAGOS_DESGLOSE'].length) {
    const partes=r['PAGOS_DESGLOSE'].map(pg => `${pg.forma} $${(parseFloat(pg.monto)||0).toFixed(2)}`).join(' + ');
    return cred>0.004 ? partes + ' + Crédito $' + cred.toFixed(2) : partes;
  }
  return r['FORMA DE PAGO'] || '-';
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
const SECCIONES_SECRETARIA = ['pedidos','caja','liquidacionDash','cierreDelDia','notasAdicionalesDash'];

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
  if (sec === 'notasAdicionalesDash' && typeof renderNotasAdicionalesDash === 'function') renderNotasAdicionalesDash(); // [NEW] sección independiente de Notas Adicionales
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
function switchTab(tab) {
  if (ROL_ACTUAL === 'secretaria' && tab === 'rutas') tab = 'dashboard';
  document.getElementById('viewDashboard').classList.toggle('active', tab === 'dashboard');
  document.getElementById('viewRutas').classList.toggle('active', tab === 'rutas');
  document.getElementById('tabDashboard').classList.toggle('active', tab === 'dashboard');
  document.getElementById('tabRutas').classList.toggle('active', tab === 'rutas');
  if (tab === 'rutas') {
    cargarLeaflet(() => {
      if (!leafletMap) initLeafletMap();
      rutasHoy();
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
let _unsubAuditoria=null;
function _iniciarListenerAuditoria(){
  if(_unsubAuditoria){_unsubAuditoria();_unsubAuditoria=null;}
  _unsubAuditoria = db.collection('historialCambios').orderBy('creadoEn','desc').limit(300).onSnapshot(snap => {
    const registros = snap.docs.map(d => d.data());
    const tbody = document.getElementById('auditoriaTbody');
    const count = document.getElementById('auditoriaCount');
    if (count) count.textContent = `${registros.length} registro${registros.length!==1?'s':''}`;
    if (!tbody) return;
    const badgeAccion = (a) => {
      const color = a==='eliminación' ? '#b71c1c' : (a==='edición' ? '#8a6d00' : '#0a7c6e');
      const fondo = a==='eliminación' ? '#fee2e2' : (a==='edición' ? '#fff3cd' : '#e6f4f2');
      return `<span style="display:inline-block;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700;background:${fondo};color:${color}">${a||'-'}</span>`;
    };
    // [NEW] Para las ediciones de pedidos (que se guardan un registro por CAMPO
    // cambiado), arma el detalle como "campo: antes → después" en vez de mostrar
    // los campos internos crudos.
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
      </tr>`).join('') : '<tr><td colspan="6"><div class="empty-state"><div class="icon">🕵️</div>Sin registros de auditoría aún</div></td></tr>';
  }, err => console.error('listener auditoría:', err));
}
function detenerListenerAuditoria(){ if(_unsubAuditoria){_unsubAuditoria();_unsubAuditoria=null;} }

/* [NEW] Liquidación de Efectivo por Asesor — versión Dashboard de la misma pantalla
   que ya existe en la app de ventas (index.html), pero usando los datos que el
   Dashboard ya tiene cargados (_pedidosRaw/_pagosRaw/_gastosRaw), respetando el
   filtro de fecha/asesor activo arriba, en vez de depender de la sesión del día
   de un asesor en particular. Misma fórmula exacta, para que el número coincida
   siempre con lo que ve el asesor en su propia app. */
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
function renderLiquidacionDash(){
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
  let totalGeneral = 0;
  cont.innerHTML = asesores.map(nombre=>{
    const d = porAsesor[nombre];
    const totalEntregar = d.ventasContado + d.pagosEfectivo - d.gastos;
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
    return `<div class="table-card" style="margin-bottom:12px">
      <div style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;background:var(--surface2)">
        <span style="font-weight:800;color:var(--navy)">${escHTML(nombre)}</span>
        <span style="font-weight:800;font-size:16px;color:${totalEntregar>=0?'#0f7c38':'#a93226'}">$${totalEntregar.toFixed(2)}</span>
      </div>
      <div style="padding:10px 16px;font-size:13px">
        <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Ventas al contado</span><b>$${d.ventasContado.toFixed(2)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Pagos cobrados en efectivo</span><b>$${d.pagosEfectivo.toFixed(2)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Gastos de la ruta</span><b>-$${d.gastos.toFixed(2)}</b></div>
      </div>
      <div style="margin:0 16px 14px;padding:10px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;font-size:12.5px">
        <div style="font-weight:800;color:#0f7c38;margin-bottom:6px;text-transform:uppercase;font-size:10px;letter-spacing:0.05em">Total a entregar — paso a paso</div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>${escHTML(nombre)}</span><span>$${totalRuta.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>+ Pagos</span><span>$${totalPagosAsesor.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;font-weight:700"><span>= Total de Ingresos</span><span>$${totalIngresos.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Créditos</span><span>$${creditos.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Gastos</span><span>$${d.gastos.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Transferencias</span><span>$${transferencias.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Cheques</span><span>$${cheques.toFixed(2)}</span></div>
        ${sinClasificar>0?`<div style="display:flex;justify-content:space-between;padding:2px 0"><span>− Sin clasificar</span><span>$${sinClasificar.toFixed(2)}</span></div>`:''}
        <div style="display:flex;justify-content:space-between;padding-top:6px;margin-top:4px;border-top:1px solid var(--border);font-weight:800"><span>Total a Entregar</span><span style="color:${totalEntregar>=0?'#0f7c38':'#a93226'}">$${totalEntregar.toFixed(2)}</span></div>
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
  asesores.forEach(nombre=>_cargarEntregaAsesor(nombre));
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
function _htmlTablaCierreDelDia(tablaNum, asesores, datos, filas, guardado){
  const thead = '<tr><th>Ruta</th>' + asesores.map(a=>`<th>${escHTML(a)}</th>`).join('') + '<th>Total</th></tr>';
  const tbody = filas.map(f=>{
    let total = 0;
    const celdas = asesores.map((a, colIdx)=>{
      const guardadoVal = guardado?.[f.etiqueta]?.[a];
      const v = (guardadoVal !== undefined && guardadoVal !== null && guardadoVal !== '') ? (Number(guardadoVal)||0) : (f.valor(datos[colIdx]) || 0);
      total += v;
      return `<td><input type="text" class="cdd-input" inputmode="decimal" data-etiqueta="${escHTML(f.etiqueta)}" data-asesor="${escHTML(a)}" value="${v.toFixed(2)}" disabled oninput="_filtrarInputMontoLiq(this);_recalcularFilaCierreDelDia(this)"></td>`;
    }).join('');
    return `<tr${f.destacado?' class="cierre-matriz-destacado"':''}><td>${escHTML(f.etiqueta)}</td>${celdas}<td>$${total.toFixed(2)}</td></tr>`;
  }).join('');
  return `<table class="cierre-matriz-table" id="cierreDelDiaTabla${tablaNum}"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}
function _recalcularFilaCierreDelDia(input){
  const tr = input.closest('tr');
  if(!tr) return;
  let total = 0;
  tr.querySelectorAll('.cdd-input').forEach(el=>{ const p=_parseMontoLiq(el.value); total += p.ok ? p.valor : 0; });
  const totalCell = tr.querySelector('td:last-child');
  if(totalCell) totalCell.textContent = '$'+total.toFixed(2);
}
function _setCierreDelDiaEditable(on){
  document.querySelectorAll('.cdd-input').forEach(el => el.disabled = !on);
  const ed=document.getElementById('cddBtnEditar');
  const gu=document.getElementById('cddBtnGuardar');
  const ca=document.getElementById('cddBtnCancelar');
  if(ed) ed.style.display = on ? 'none' : '';
  if(gu) gu.style.display = on ? '' : 'none';
  if(ca) ca.style.display = on ? '' : 'none';
}
function _editarCierreDelDia(){ _setCierreDelDiaEditable(true); }
function _cancelarCierreDelDia(){ renderCierreDelDia(); }
function _confirmarGuardarCierreDelDia(){
  if(!confirm('¿Está seguro que desea guardar el Cierre del Día?')) return;
  _guardarCierreDelDia();
}
async function _guardarCierreDelDia(){
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
    if (typeof _registrarAuditoria === 'function') {
      _registrarAuditoria('cierreDelDia', 'edición', _idCierreDelDia(), 'Cierre del Día guardado por '+actorAuditoria());
    }
    if(st) st.textContent='Guardado correctamente — última actualización por '+(typeof actorAuditoria==='function'?actorAuditoria():'');
    _setCierreDelDiaEditable(false);
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
function imprimirCierreDelDia(){
  const asesores=_cierreDelDiaAsesoresCache||[];
  if(!asesores.length){ alert('No hay datos para imprimir en este período.'); return; }
  const fecha = _textoRangoFecha();
  const filaAHtml = tr => {
    const celdas=[...tr.querySelectorAll('td')].map((td,i)=>{
      if(i===0) return `<td>${escHTML(td.textContent)}</td>`;
      const inp=td.querySelector('input');
      const val = inp ? (parseFloat(inp.value)||0) : (parseFloat((td.textContent||'').replace('$',''))||0);
      return `<td style="text-align:right">$${val.toFixed(2)}</td>`;
    }).join('');
    return `<tr>${celdas}</tr>`;
  };
  const armarTabla = (tablaId, titulo) => {
    const tabla=document.getElementById(tablaId);
    if(!tabla) return '';
    const thead=tabla.querySelector('thead').innerHTML;
    const filas=[...tabla.querySelectorAll('tbody tr')].map(filaAHtml).join('');
    return `<div class="cdd-print-title">${titulo}</div><table class="cdd-print-table"><thead>${thead}</thead><tbody>${filas}</tbody></table>`;
  };
  const bloque1 = armarTabla('cierreDelDiaTabla1', 'CIERRE DEL DÍA');
  const bloque2 = armarTabla('cierreDelDiaTabla2', 'FORMA DE ENTREGA DE DINERO');
  const v = window.open('', '_blank', 'width=900,height=900');
  const logoUrl = location.origin + '/logo-luanaqua.png';
  v.document.write(`<html><head><title>Cierre del Día</title><style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:20px;color:#1a3a5c;}
    .print-header p{font-size:11px;color:#888;margin-top:3px;}
    .cdd-print-title{font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#1a3a5c;margin:18px 0 8px;}
    .cdd-print-table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px;}
    .cdd-print-table th{text-align:right;font-size:9px;font-weight:800;letter-spacing:0.04em;color:#888;padding:5px 6px;border-bottom:1px solid #d2dae2;}
    .cdd-print-table th:first-child{text-align:left;}
    .cdd-print-table td{padding:5px 6px;border-bottom:1px solid #e6ebf0;}
    .cdd-print-table td:first-child{font-weight:700;text-align:left;}
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
  <div class="firmas-box">
    <div class="firma-linea"><div class="raya">&nbsp;</div>Firma — ${escHTML(_firmaUsuarioActualCierreDia())}</div>
  </div>
  <script>
    var _impresoCierreDia=false;
    function _intentarImprimirCierreDia(){ if(_impresoCierreDia)return; _impresoCierreDia=true; window.print(); }
    window.onload=_intentarImprimirCierreDia;
    setTimeout(_intentarImprimirCierreDia,1200);
  <\/script>
  </body></html>`);
  v.document.close();
}
async function renderCierreDelDia(){
  const cont1 = document.getElementById('cierreDelDiaTabla1Wrap');
  const cont2 = document.getElementById('cierreDelDiaTabla2Wrap');
  const emptyMsg = document.getElementById('cierreDelDiaEmptyMsg');
  const st = document.getElementById('cierreDelDiaStatus');
  if(!cont1 || !cont2) return;
  const porAsesor = _calcularLiquidacionDash();
  const asesores = Object.keys(porAsesor).sort((a,b)=>a.localeCompare(b,'es'));
  if(!asesores.length){
    cont1.innerHTML=''; cont2.innerHTML='';
    if(emptyMsg) emptyMsg.style.display='block';
    if(st) st.textContent='';
    _cierreDelDiaAsesoresCache=[];
    return;
  }
  if(emptyMsg) emptyMsg.style.display='none';
  _cierreDelDiaAsesoresCache = asesores;

  // Tabla 1 — Cierre del Día (mismos campos que ya calcula la Liquidación)
  const datosAsesores = asesores.map(a=>porAsesor[a]);
  const filas1 = [
    { etiqueta:'Valor/Liquidación', valor: n => n.ventasContado },
    { etiqueta:'Pagos', valor: n => n.pagosEfectivo },
    { etiqueta:'Créditos', valor: n => n.ventasCredito },
    { etiqueta:'Gastos', valor: n => n.gastos },
    { etiqueta:'Transferencias', valor: n => n.ventasTransferencia + n.pagosTransferencia },
    { etiqueta:'Cheques', valor: n => n.ventasCheque + n.pagosCheque },
    { etiqueta:'Valor a Entregar', valor: n => n.ventasContado + n.pagosEfectivo - n.gastos, destacado:true }
  ];

  // Tabla 2 — Forma de Entrega de Dinero (lee lo guardado por cada asesor en Liquidación)
  const entregas = await Promise.all(asesores.map(async nombre=>{
    try{
      if(typeof db==='undefined') return {};
      const snap = await db.collection('cierresLiquidacion').doc(_idEntregaLiquidacion(nombre)).get();
      return snap.exists ? snap.data() : {};
    }catch(err){ console.warn('cierreDelDia lectura entrega:', err); return {}; }
  }));
  const filas2 = [
    { etiqueta:'Efectivo', valor: e => (e.efectivo?.marcado ? (Number(e.efectivo.monto)||0) : 0) },
    { etiqueta:'Depósito', valor: e => (e.deposito?.marcado ? (Number(e.deposito.monto)||0) : 0) },
    { etiqueta:'Transferencia', valor: e => (e.transferencia?.marcado ? (Number(e.transferencia.monto)||0) : 0) },
    { etiqueta:'Faltante 1', valor: e => Number(e.faltantes?.[0]?.monto)||0 },
    { etiqueta:'Faltante 2', valor: e => Number(e.faltantes?.[1]?.monto)||0 },
    { etiqueta:'Faltante 3', valor: e => Number(e.faltantes?.[2]?.monto)||0 }
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

  cont1.innerHTML = _htmlTablaCierreDelDia(1, asesores, datosAsesores, filas1, guardado.tabla1||{});
  cont2.innerHTML = _htmlTablaCierreDelDia(2, asesores, entregas, filas2, guardado.tabla2||{});
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
  tbody.innerHTML = pedidosConNota.map(p => `
    <tr>
      <td style="white-space:nowrap;font-weight:700;color:var(--navy)">${escHTML(p.fecha||'-')}</td>
      <td style="font-weight:700;color:var(--navy)">${escHTML(p.empleado||'-')}</td>
      <td style="font-weight:700;color:var(--navy)">${escHTML(p.cliente||'-')}</td>
      <td style="font-weight:700;color:var(--navy)">📝 ${escHTML(p.notas)}</td>
    </tr>`).join('');
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
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:20px;color:#1a3a5c;}
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
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Secretaria</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Asesor</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Ayudante</div></div>
  </div>
  <script>
    var _impresoNotas=false;
    function _intentarImprimirNotas(){ if(_impresoNotas)return; _impresoNotas=true; window.print(); }
    window.onload=_intentarImprimirNotas;
    setTimeout(_intentarImprimirNotas,1200);
  <\/script>
  </body></html>`);
  v.document.close();
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
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><input type="checkbox" class="liq-chk-dep" onchange="_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))"><span style="min-width:130px;font-weight:700">Depósito</span><input type="text" class="liq-monto-dep" placeholder="0.00" inputmode="decimal" style="flex:1;height:36px;border:1.5px solid var(--border);border-radius:8px;padding:0 10px" oninput="_filtrarInputMontoLiq(this);_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))"></label>
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><input type="checkbox" class="liq-chk-tr" onchange="_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))"><span style="min-width:130px;font-weight:700">Transferencia</span><input type="text" class="liq-monto-tr" placeholder="0.00" inputmode="decimal" style="flex:1;height:36px;border:1.5px solid var(--border);border-radius:8px;padding:0 10px" oninput="_filtrarInputMontoLiq(this);_actualizarCuadreBox(this.closest('.liq-entrega-asesor'))"></label>
    <div class="liq-faltantes-lista"></div>
    <button type="button" class="liq-btn-add-falt" onclick="_agregarFaltanteAsesor(this)" style="display:none;margin:4px 0 8px;padding:8px 12px;border:1.5px dashed var(--border);background:#fff;border-radius:8px;font-weight:700;cursor:pointer;color:var(--navy)">+ Añadir faltante</button>
    <div class="liq-entrega-cuadre" style="font-size:12px;margin-top:8px;font-weight:700"></div>
    <div class="liq-entrega-status" style="font-size:11px;color:var(--muted);margin-top:6px"></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button type="button" class="liq-btn-editar" onclick="_editarEntregaAsesor('${safe}')" style="padding:8px 14px;border:none;border-radius:8px;background:var(--navy);color:#fff;font-weight:700;cursor:pointer">✏ Editar</button>
      <button type="button" class="liq-btn-guardar" onclick="_confirmarGuardarEntregaAsesor('${safe}')" style="display:none;padding:8px 14px;border:none;border-radius:8px;background:#0f7c38;color:#fff;font-weight:700;cursor:pointer">💾 Guardar</button>
      <button type="button" class="liq-btn-cancelar" onclick="_cancelarEntregaAsesor('${safe}')" style="display:none;padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;background:#fff;font-weight:700;cursor:pointer">Cancelar</button>
    </div>
  </div>`;
}

function _setEntregaEditable(box, on){
  if(!box) return;
  box.dataset.editando = on ? '1' : '0';
  box.querySelectorAll('input').forEach(el => { el.disabled = !on; });
  const add=box.querySelector('.liq-btn-add-falt');
  const ed=box.querySelector('.liq-btn-editar');
  const gu=box.querySelector('.liq-btn-guardar');
  const ca=box.querySelector('.liq-btn-cancelar');
  if(add) add.style.display = on ? '' : 'none';
  if(ed) ed.style.display = on ? 'none' : '';
  if(gu) gu.style.display = on ? '' : 'none';
  if(ca) ca.style.display = on ? '' : 'none';
}
function _editarEntregaAsesor(nombre){
  const box=_boxEntregaAsesor(nombre);
  _setEntregaEditable(box, true);
}
function _cancelarEntregaAsesor(nombre){
  _cargarEntregaAsesor(nombre);
}
function _confirmarGuardarEntregaAsesor(nombre){
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
  return {
    efectivo:{marcado:!!box.querySelector('.liq-chk-ef')?.checked, monto:n('.liq-monto-ef')},
    deposito:{marcado:!!box.querySelector('.liq-chk-dep')?.checked, monto:n('.liq-monto-dep')},
    transferencia:{marcado:!!box.querySelector('.liq-chk-tr')?.checked, monto:n('.liq-monto-tr')},
    faltantes,
    invalido:[n('.liq-monto-ef'),n('.liq-monto-dep'),n('.liq-monto-tr')].some(v=>Number.isNaN(v)) || faltantes.some(f=>!f.montoOk)
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
function _guardarEntregaDesdeFila(el){
  const box=el.closest('.liq-entrega-asesor');
  if(box) _actualizarCuadreBox(box);
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
  const suma=(u.efectivo.marcado?u.efectivo.monto:0)+(u.deposito.marcado?u.deposito.monto:0)+(u.transferencia.marcado?u.transferencia.monto:0)+(u.faltantes||[]).reduce((s,f)=>s+(f.montoOk?f.monto:0),0);
  if(suma===0 && !u.efectivo.marcado && !u.deposito.marcado && !u.transferencia.marcado){
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
    chk('.liq-chk-dep', d.deposito?.marcado);
    chk('.liq-chk-tr', d.transferencia?.marcado);
    setN('.liq-monto-ef', d.efectivo?.monto);
    setN('.liq-monto-dep', d.deposito?.monto);
    setN('.liq-monto-tr', d.transferencia?.monto);
    let filas=Array.isArray(d.faltantes)?d.faltantes.map(f=>({monto:f.monto||'',motivo:f.motivo||''})):[];
    const list=box.querySelector('.liq-faltantes-lista');
    if(list) list.innerHTML=(filas.length?filas:[{monto:'',motivo:''}]).map((f,i)=>_htmlFilaFaltanteAsesor(i,f.monto,f.motivo)).join('');
    const st=box.querySelector('.liq-entrega-status');
    if(st) st.textContent=snap.exists?'Entrega guardada de este asesor.':'Sin entrega registrada aún.';
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
  const u=_leerEntregaDesdeBox(box);
  if(u.invalido) return;
  const st=box.querySelector('.liq-entrega-status');
  try{
    const faltantes=(u.faltantes||[]).map(f=>({monto:f.montoOk?Number(f.monto)||0:0, motivo:f.motivo||''}));
    const tot=parseFloat(box.dataset.total||0)||0;
    await db.collection('cierresLiquidacion').doc(_idEntregaLiquidacion(nombre)).set({
      asesor:nombre,
      efectivo:u.efectivo, deposito:u.deposito, transferencia:u.transferencia,
      faltantes,
      totalEntregar:tot,
      desde:document.getElementById('filtroFecha')?.value||'',
      hasta:document.getElementById('filtroFechaHasta')?.value||'',
      actualizadoEn:firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: (typeof actorAuditoria==='function') ? actorAuditoria() : ''
    }, {merge:true});
    if(st) st.textContent='Entrega guardada.';
    if (typeof _registrarAuditoria === 'function') {
      _registrarAuditoria('liquidacion', 'edición', _idEntregaLiquidacion(nombre),
        'Entrega de '+nombre+' por '+actorAuditoria());
    }
    _actualizarCuadreBox(box);
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
      ${fila(u.deposito.marcado,'Depósito',u.deposito.monto)}
      ${fila(u.transferencia.marcado,'Transferencia',u.transferencia.monto)}
      ${(u.faltantes||[]).filter(f=>f.montoOk&&f.monto>0).map((f,i)=>`<div class="ruta-linea"><span>Faltante ${i+1}${f.motivo?' — '+escHTML(f.motivo):''}</span><b>$${f.monto.toFixed(2)}</b></div>`).join('')||'<div class="ruta-linea"><span>Faltantes</span><b>$0.00</b></div>'}
    </div>`;
  }).join('');
}


function imprimirLiquidacionDash(){
  const porAsesor = _calcularLiquidacionDash();
  const asesores = Object.keys(porAsesor).sort((a,b)=>a.localeCompare(b,'es'));
  const fecha = _textoRangoFecha();
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const asesorLabel = asesorSel.split(':')[1]?.trim() || 'General';
  let totalGeneral = 0;
  const bloques = asesores.map(nombre=>{
    const d = porAsesor[nombre];
    const totalEntregar = d.ventasContado + d.pagosEfectivo - d.gastos;
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
      ${bloqueProductos}
    </div>`;
  }).join('');
  const v = window.open('', '_blank', 'width=900,height=900');
  // [NEW] URL absoluta del logo — esta ventana se abre en blanco, sin el
  // dashboard como base, así que una ruta relativa no cargaría. Mismo patrón
  // que ya se usa en Pagos y Gastos / Detalle de Pedidos.
  const logoUrl = location.origin + '/logo-luanaqua.png';
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Liquidación de Efectivo — ${asesorLabel} — Aqua Luan — ${fecha}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:20px;color:#1a3a5c;}
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
    .total-general span:last-child{font-family:'DM Serif Display',serif;font-size:22px;color:#4ec9a0;}
    .firmas-box{display:flex;justify-content:space-between;gap:20px;margin-top:48px;}
    .firma-linea{flex:1;text-align:center;font-size:11px;color:#1a3a5c;}
    .firma-linea .raya{border-top:1px solid #1a3a5c;margin-bottom:6px;}
    @media print{body{padding:12px;}}
  </style></head><body>
  <div class="print-header">
    <img src="${logoUrl}" alt="Aqua Luan" onerror="this.style.display='none'">
    <div>
      <h1>LIQUIDACIÓN DE EFECTIVO — ${escHTML(asesorLabel)}</h1>
      <p>Fecha: ${fecha} · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
    </div>
  </div>
  ${bloques || '<p style="color:#888;font-style:italic">No hay ventas, pagos ni gastos registrados en este período.</p>'}
  <div class="total-general">
    <span>TOTAL EFECTIVO A ENTREGAR HOY</span>
    <span>$${totalGeneral.toFixed(2)}</span>
  </div>
  ${_htmlEntregaLiquidacionPrint()}
  <div class="firmas-box">
    <div class="firma-linea"><div class="raya">&nbsp;</div>Firma secretaria</div>
    <div class="firma-linea"><div class="raya">&nbsp;</div>Firma asesor</div>
    <div class="firma-linea"><div class="raya">&nbsp;</div>Firma ayudante</div>
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
    setTimeout(_intentarImprimirLiquidacion,1200);
  <\/script>
  </body></html>`);
  v.document.close();
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
  // [NEW] misma lógica de refresco perezoso para la sección independiente de Notas Adicionales
  const seccionNotasAdicionalesVisible = document.getElementById('seccion-notasAdicionalesDash')?.classList.contains('active');
  if (seccionNotasAdicionalesVisible && typeof renderNotasAdicionalesDash === 'function') renderNotasAdicionalesDash();
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
function filtrarHoy() { const hoy = fechaHoy(); document.getElementById('filtroFecha').value = hoy; document.getElementById('filtroFechaHasta').value = hoy; iniciarListenersDashboard(); }
function limpiarFiltro() { document.getElementById('filtroFecha').value = ''; document.getElementById('filtroFechaHasta').value = fechaHoy(); if (document.getElementById('filtroAsesor')) document.getElementById('filtroAsesor').value = ''; iniciarListenersDashboard(); }
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
    .reduce((s,d) => s + d.ventasContado + d.pagosEfectivo - d.gastos, 0);
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
  _pedidosTablaFiltrados = _filtrarPorPagoChecklist(pedidos);
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
  renderReporteAsesores(); // [NEW]
}

/* ════════════════════════════════════════
   [NEW] DETALLE DE PAGOS Y GASTOS
════════════════════════════════════════ */
let pagosDetalleActuales = [], gastosDetalleActuales = []; // [NEW] para exportar a PDF

function renderPagosGastosDetalle(pagos, gastos) {
  pagosDetalleActuales = pagos; gastosDetalleActuales = gastos; // [NEW]
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
      const puedePago = r['_pagoId'] && (ROL_ACTUAL === 'admin' || ROL_ACTUAL === 'secretaria') && _esRegistroDeHoy(r['FECHA']||r['fecha']);
      const accionesPago = puedePago ? `<button class="btn-editar-fila" onclick="abrirEditarPago('${r['_pagoId']}')" title="Editar este pago">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarPagoDash('${r['_pagoId']}')" title="Eliminar este pago">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>';
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
      const puedeGasto = r['_gastoId'] && (ROL_ACTUAL === 'admin' || ROL_ACTUAL === 'secretaria') && _esRegistroDeHoy(r['FECHA']||r['fecha']);
      const accionesGasto = puedeGasto ? `<button class="btn-editar-fila" onclick="abrirEditarGasto('${r['_gastoId']}')" title="Editar este gasto">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarGastoDash('${r['_gastoId']}')" title="Eliminar este gasto">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>';
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
   Se guarda como un Set de formas de pago DESMARCADAS (ocultas) -- vacío significa
   "sin filtro, mostrar todo". Así, cualquier forma de pago nueva que aparezca
   (ej. al importar datos) se muestra por defecto, sin tener que "agregarla" al filtro. */
let _pagoFiltroExcluidos = new Set();
function _opcionesPagoDisponibles(pedidos) {
  const set = new Set();
  pedidos.forEach(r => { set.add(r['FORMA DE PAGO'] || 'Sin especificar'); });
  return [...set].sort((a,b) => a.localeCompare(b,'es'));
}
function _filtrarPorPagoChecklist(pedidos) {
  if (_pagoFiltroExcluidos.size === 0) return pedidos;
  return pedidos.filter(r => !_pagoFiltroExcluidos.has(r['FORMA DE PAGO'] || 'Sin especificar'));
}
function renderFiltroPagoDropdown(pedidosSinFiltrarPago) {
  const cont = document.getElementById('filtroPagoOpciones');
  if (!cont) return;
  const opciones = _opcionesPagoDisponibles(pedidosSinFiltrarPago);
  cont.innerHTML = opciones.length ? opciones.map(o => `
    <label class="filtro-pago-item">
      <input type="checkbox" ${_pagoFiltroExcluidos.has(o) ? '' : 'checked'} onchange="toggleFiltroPago('${escHTML(o).replace(/'/g,"\\'")}', this.checked)">
      ${escHTML(o)}
    </label>
  `).join('') : '<div style="font-size:12px;color:var(--muted);padding:6px 8px">No hay pedidos en este período</div>';
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
  else { _opcionesPagoDisponibles(pedidosDetalleActuales || []).forEach(o => _pagoFiltroExcluidos.add(o)); }
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

function renderTabla(pedidos) {
  const tbody = document.getElementById('tablaPedidos');
  if (!pedidos.length) { tbody.innerHTML = '<tr><td colspan="12"><div class="empty-state"><div class="icon">📋</div>No hay pedidos en este período</div></td></tr>'; return; }
  tbody.innerHTML = pedidos.slice(0,100).map(r => {
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
    let detallePago = '';
    if (r['PAGOS_DESGLOSE'] && r['PAGOS_DESGLOSE'].length) {
      const partes = r['PAGOS_DESGLOSE'].map(pg => `${pg.forma} $${(parseFloat(pg.monto)||0).toFixed(2)}`).join(' + ');
      detallePago = `<div style="font-size:10px;color:var(--muted);margin-top:2px;white-space:nowrap">${partes}</div>`;
      if (tieneSaldo) detallePago += `<div style="font-size:10px;color:var(--red);white-space:nowrap">Saldo crédito $${creditoPend.toFixed(2)}</div>`;
    } else if (tieneSaldo) {
      const abonoVal = parseFloat(r['ABONO']||0);
      detallePago = `<div style="font-size:10px;color:var(--red);margin-top:2px;white-space:nowrap">Abono $${abonoVal.toFixed(2)} · Saldo $${creditoPend.toFixed(2)}</div>`;
    }
    const pago  = r['FORMA DE PAGO'] ? `<span class="badge badge-teal">${r['FORMA DE PAGO']}</span>${detallePago}` : '';
    /* [NEW] Botón Editar — solo funciona si la fila trae el id real del pedido en Firestore
       (las filas de pagos/gastos no lo traen, pero renderTabla solo recibe pedidos con producto) */
    const puedeAB = r['_pedidoId'] && (ROL_ACTUAL === 'admin' || ROL_ACTUAL === 'secretaria') && _esRegistroDeHoy(r['FECHA']||r['fecha']);
    const accion = puedeAB ? `<button class="btn-editar-fila" onclick="abrirEditarPedido('${r['_pedidoId']}')" title="Editar este pedido">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarPedidoCompleto('${r['_pedidoId']}')" title="Eliminar este pedido">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>';
    return `<tr>
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
  }).join('');
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
  tbody.innerHTML = datos.map(r => {
    const gps   = r['LINK GPS'] ? `<a href="${r['LINK GPS']}" target="_blank" style="color:var(--teal);font-weight:700;font-size:11px">📍 Ver</a>` : '<span style="color:var(--muted);font-size:11px">—</span>';
    const total = r['TOTAL PEDIDO ($)'] ? `<strong style="color:var(--teal)">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</strong>` : '';
    const pago  = r['FORMA DE PAGO'] ? `<span class="badge badge-teal">${r['FORMA DE PAGO']}</span>` : '';
    const puedeAB = r['_pedidoId'] && (ROL_ACTUAL === 'admin' || ROL_ACTUAL === 'secretaria') && _esRegistroDeHoy(r['FECHA']||r['fecha']);
    const accion = puedeAB ? `<button class="btn-editar-fila" onclick="abrirEditarPedido('${r['_pedidoId']}')" title="Editar este pedido">✏ Editar</button><button class="btn-eliminar-fila" onclick="eliminarPedidoCompleto('${r['_pedidoId']}')" title="Eliminar este pedido">🗑 Eliminar</button>` : '<span style="color:var(--muted);font-size:11px">—</span>';
    return `<tr>
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
      div.innerHTML=`<div style="background:#fff;border-radius:4px;box-shadow:0 1px 5px rgba(0,0,0,0.25);overflow:hidden;display:flex;font-family:'DM Sans',sans-serif"><button id="btnMapa" onclick="setTile('mapa')" style="padding:6px 14px;font-size:12px;font-weight:700;border:none;background:#1a3a5c;color:#fff;cursor:pointer">Mapa</button><button id="btnSateli" onclick="setTile('satelite')" style="padding:6px 14px;font-size:12px;font-weight:600;border:none;background:#fff;color:#555;cursor:pointer;border-left:1px solid #ddd">Satélite</button></div>`;
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
function rutasHoy() { document.getElementById('rutasFecha').value = fechaHoy(); }
function aplicarRutas() {
  const fecha  = document.getElementById('rutasFecha').value;
  const asesor = document.getElementById('rutasAsesor').value;
  document.getElementById('rutasLastUpdate').textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'});
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
      const iconHtml=`<div style="position:relative;width:42px;height:52px;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.4))"><svg xmlns="http://www.w3.org/2000/svg" width="42" height="52" viewBox="0 0 42 52" style="position:absolute;top:0;left:0"><path d="M21 1C10.5 1 2 9.5 2 20c0 14 19 31 19 31s19-17 19-31C40 9.5 31.5 1 21 1z" fill="${color}" stroke="${borderClr}" stroke-width="2"/><circle cx="21" cy="19" r="13" fill="rgba(255,255,255,0.18)"/></svg><div style="position:absolute;top:5px;left:50%;transform:translateX(-50%);width:18px;height:18px">${personaSVG}</div><div style="position:absolute;top:-4px;right:-4px;background:#fff;color:${color};border:2px solid ${color};border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;line-height:1;font-family:'DM Sans',sans-serif;box-shadow:0 1px 4px rgba(0,0,0,0.3)">${num}</div></div>`;
      const icon=L.divIcon({className:'',html:iconHtml,iconSize:[42,52],iconAnchor:[21,52],popupAnchor:[0,-54]});
      const marker=L.marker([lat,lng],{icon}).addTo(leafletMap);
      const nombreAsesor=escHTML(asesorKey.split(':')[1]?.trim()||asesorKey);
      const prod=r['PRODUCTO']?`<b>${escHTML(r['PRODUCTO'])}</b> × ${escHTML(String(r['CANTIDAD']||0))}`:'—';
      const total=r['TOTAL PEDIDO ($)']?`<span style="color:#0a7c6e;font-weight:700">$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}</span>`:'—';
      const notas=r['NOTAS']?`<div style="margin-top:6px;font-style:italic;color:#555;font-size:11px">📝 ${escHTML(r['NOTAS'])}</div>`:'';
      const linkgps=r['LINK GPS']?`<a href="${r['LINK GPS']}" target="_blank" style="display:inline-block;margin-top:8px;background:#0a7c6e;color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none">📍 Abrir GPS</a>`:'';
      const precStr=precision>0?`<div style="font-size:10px;color:#999;margin-top:2px">Precisión: ${precision}m${precision>50?' ⚠️':''}</div>`:'';
      marker.bindPopup(`<div style="font-family:'DM Sans',sans-serif;min-width:200px;max-width:240px"><div style="background:${color};color:#fff;padding:8px 12px;margin:-13px -20px 10px;border-radius:4px 4px 0 0;font-size:12px;font-weight:700">${nombreAsesor} — Parada #${idx+1}</div><div style="font-size:13px;font-weight:700;color:#1a3a5c">${escHTML(r['CLIENTE']||'-')}</div><div style="font-size:11px;color:#666;margin-top:2px">🕐 ${r['HORA REGISTRO']||'-'}</div>${precStr}<div style="margin-top:8px;font-size:12px">${prod}</div><div style="margin-top:2px;font-size:12px">Total: ${total}</div><div style="margin-top:4px;font-size:11px;color:#888">💳 ${r['FORMA DE PAGO']||'—'}</div>${notas}${linkgps}</div>`,{maxWidth:260});
      if(precision>50){ const circle=L.circle([lat,lng],{radius:precision,color,fillColor:color,fillOpacity:0.08,weight:1,dashArray:'4,4'}).addTo(leafletMap); mapMarkers.push(circle); }
      mapMarkers.push(marker); coords.push([lat,lng]); allBounds.push([lat,lng]);
      const key=`${r['CLIENTE']}-${r['HORA REGISTRO']}-${asesorKey}`;
      markerRefs[key]=marker;
    });
    if(coords.length>1){ const poly=L.polyline(coords,{color:'#1a6fd4',weight:3.5,opacity:0.88,lineJoin:'round',lineCap:'round'}).addTo(leafletMap); mapPolylines.push(poly); }
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
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:22px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    .cliente-bloque{margin-bottom:22px;page-break-inside:avoid;}
    .cliente-bloque-titulo{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:800;color:#1a3a5c;background:#f0f5f8;border-radius:8px 8px 0 0;padding:8px 12px;border:1px solid #ddd;border-bottom:none;}
    .cliente-bloque-titulo span{color:#0a7c6e;font-family:'DM Serif Display',serif;font-size:16px;}
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
    .total-final b{font-family:'DM Serif Display',serif;font-size:18px;color:#4ec9a0;}
    @media print{body{padding:12px;} thead{display:table-header-group;}}
  </style></head><body>
  <div class="print-header">
    <h1>🔍 ${escHTML(tituloSeleccion)}</h1>
    <p>${clientesSeleccionados.length} cliente(s) · Asesor: ${asesorLabel} · Fecha: ${fecha} · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
  </div>
  ${bloquesHtml}
  ${clientesSeleccionados.length > 1 ? `<div class="total-final"><span>TOTAL GENERAL (${clientesSeleccionados.length} clientes)</span><b>$${totalGeneralTodos.toFixed(2)}</b></div>` : ''}
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  v.document.close();
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
  </style></head><body><p style="font-size:12px;color:#888;margin-bottom:12px">${escHTML(lineaImpresoPor())} · ${new Date().toLocaleString('es-EC')}</p>${bloques}<script>window.onload=function(){window.print();}<\/script></body></html>`);
  v.document.close();
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
  renderReporteAsesores();
  renderReporteAsesorDetalle();
  const wrap = document.getElementById('reporteAsesorDetalleWrap');
  if (wrap) wrap.scrollIntoView({ behavior:'smooth', block:'start' });
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
      <div class="table-header"><div class="table-title">👤 ${nombre} — Reporte Detallado</div></div>
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
      <div class="table-header"><div class="table-title">📉 Gastos registrados</div></div>
      <div class="table-wrap"><table><thead><tr><th>Descripción</th><th style="text-align:right">Monto</th><th>Fecha</th></tr></thead><tbody>${filasGastos}</tbody></table></div>
    </div>`;
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
          <div style="font-family:'DM Serif Display',serif;font-size:1.4rem;color:var(--teal-dark)">$${totalIngresosCierre.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--muted)">${pagosCierre.length} pago(s)</div>
        </div>
        <div style="flex:1;min-width:150px;background:#fdecea;border:1.5px solid #e57373;border-radius:var(--radius);padding:12px 16px">
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--red)">🔴 Egresos (gastos)</div>
          <div style="font-family:'DM Serif Display',serif;font-size:1.4rem;color:var(--red)">$${totalEgresosCierre.toFixed(2)}</div>
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
  const cuerpo = document.getElementById('cierreBody').innerHTML;
  const v = window.open('','_blank','width=800,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cierre del Día — Aqua Luan — ${fecha}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .cierre-asesor-block{border:1.5px solid #ddd;border-radius:12px;overflow:hidden;margin-bottom:20px;page-break-inside:avoid;}
    .cierre-asesor-header{padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;}
    .cierre-asesor-nombre{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#fff;}
    .cierre-asesor-total{font-family:'DM Serif Display',serif;font-size:1.3rem;color:#4ec9a0;}
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
    .cierre-total-value{font-family:'DM Serif Display',serif;font-size:2rem;color:#4ec9a0;}
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
    .print-header h1{font-family:'DM Serif Display',serif;font-size:24px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    .btn-cerrar-cierre,.btn-print-cierre{display:none!important;}
    @media print{body{padding:16px;} .cierre-asesor-block{page-break-inside:avoid;}}
  </style></head><body>
  <div class="print-header"><h1>📅 Cierre del Día — Aqua Luan</h1><p>Fecha: ${fecha} · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p></div>
  ${cuerpo}
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  v.document.close();
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
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:22px;color:#1a3a5c;}
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
      <h1>💳 Pagos y Gastos — ${escHTML(asesorLabel)}</h1>
      <p>Fecha: ${fecha} · ${pagos.length} pago(s) · ${gastos.length} gasto(s) · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
    </div>
  </div>
  <div class="seccion-title" style="color:#1565c0">💰 Pagos registrados</div>
  <table class="tabla-pagos">
    <thead><tr><th>Cliente</th><th>Asesor</th><th>Forma de Pago</th><th>Fecha</th><th>Monto</th></tr></thead>
    <tbody>
      ${filasPagos || '<tr><td colspan="5" style="text-align:center;color:#888">Sin pagos en este período</td></tr>'}
      <tr class="total-row-pagos"><td colspan="4" style="text-align:right">TOTAL PAGOS</td><td style="text-align:right">$${totalPagos.toFixed(2)}</td></tr>
    </tbody>
  </table>
  <div class="seccion-title" style="color:#c0392b">📉 Gastos registrados</div>
  <table class="tabla-gastos">
    <thead><tr><th>Descripción</th><th>Responsable</th><th>Fecha</th><th>Monto</th></tr></thead>
    <tbody>
      ${filasGastos || '<tr><td colspan="4" style="text-align:center;color:#888">Sin gastos en este período</td></tr>'}
      <tr class="total-row-gastos"><td colspan="3" style="text-align:right">TOTAL GASTOS</td><td style="text-align:right">$${totalGastos.toFixed(2)}</td></tr>
    </tbody>
  </table>
  <div class="firmas">
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Secretaria</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Asesor</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Ayudante</div></div>
  </div>
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  v.document.close();
}

function exportarDetallePDF() {
  const datos = _pedidosTablaFiltrados; // [NEW] exporta lo mismo que se ve en pantalla (respeta el filtro de Pago)
  if (!datos.length) { alert('No hay datos para exportar. Aplica los filtros primero.'); return; }
  const fecha = _textoRangoFecha();
  const asesorSel = document.getElementById('filtroAsesor') ? document.getElementById('filtroAsesor').value : '';
  const asesorLabel = asesorSel.split(':')[1]?.trim() || 'Todos';

  const totalGeneral = datos.filter(r=>r['TOTAL PEDIDO ($)']&&parseFloat(r['TOTAL PEDIDO ($)'])>0).reduce((s,r)=>s+(parseFloat(r['TOTAL PEDIDO ($)'])||0),0);

  const filas = datos.map(r => {
    const total = r['TOTAL PEDIDO ($)'] ? `$${parseFloat(r['TOTAL PEDIDO ($)']).toFixed(2)}` : '—';
    const precioUnit = r['PRECIO UNIT.']!==undefined && r['PRECIO UNIT.']!=='' ? `$${parseFloat(r['PRECIO UNIT.']).toFixed(2)}` : '—';
    return `<tr>
      <td>${limpiarFecha(r['FECHA'])}</td>
      <td>${(r['ASESOR / RUTA']||'').split(':')[1]?.trim()||r['ASESOR / RUTA']||'-'}</td>
      <td>${escHTML(r['CLIENTE']||'-')}</td>
      <td>${escHTML(r['TELÉFONO']||'-')}</td>
      <td>${escHTML(r['PRODUCTO']||'-')}</td>
      <td style="text-align:center">${r['CANTIDAD']||'-'}</td>
      <td style="text-align:right">${precioUnit}</td>
      <td style="text-align:right">$${parseFloat(r['SUBTOTAL']||0).toFixed(2)}</td>
      <td style="text-align:right;font-weight:700">${total}</td>
      <td>${escHTML(_textoDesgloseFila(r))}</td>
    </tr>`;
  }).join('');

  // [NEW] URL absoluta del logo — esta ventana de impresión se abre en blanco
  // (sin la URL del dashboard como base), así que una ruta relativa "logo-luanaqua.png"
  // no cargaría. Se arma con location.origin para que funcione en cualquier dominio.
  const logoUrl = location.origin + '/logo-luanaqua.png';

  const v = window.open('', '_blank', 'width=1000,height=900');
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Detalle de Pedidos — ${asesorLabel} — Aqua Luan — ${fecha}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',sans-serif;color:#1a3a5c;padding:24px;background:#fff;}
    .print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}
    .print-header img{height:46px;width:auto;}
    .print-header h1{font-family:'DM Serif Display',serif;font-size:22px;color:#1a3a5c;}
    .print-header p{font-size:12px;color:#888;margin-top:4px;}
    table{width:100%;border-collapse:collapse;font-size:11px;}
    thead tr{background:#1a3a5c;}
    thead th{padding:8px 10px;text-align:left;font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#fff;}
    tbody td{padding:7px 10px;border-bottom:1px solid #eee;}
    tbody tr:nth-child(even){background:#f7fafb;}
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
      <h1>📋 Detalle de Pedidos — ${escHTML(asesorLabel)}</h1>
      <p>Fecha: ${fecha} · Asesor: ${asesorLabel} · ${datos.length} línea(s) · Generado: ${new Date().toLocaleString('es-EC')} · ${escHTML(lineaImpresoPor())}</p>
    </div>
  </div>
  <table>
    <thead><tr><th>Fecha</th><th>Asesor</th><th>Cliente</th><th>Teléfono</th><th>Producto</th><th>Cant.</th><th>Precio Unit.</th><th>Subtotal</th><th>Total</th><th>Pago</th></tr></thead>
    <tbody>
      ${filas}
      <tr class="total-row"><td colspan="8" style="text-align:right">TOTAL GENERAL</td><td style="text-align:right">$${totalGeneral.toFixed(2)}</td><td></td></tr>
    </tbody>
  </table>
  <div class="firmas">
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Secretaria</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Asesor</div></div>
    <div class="firma"><div class="firma-linea">&nbsp;</div><div class="firma-label">Firma Ayudante</div></div>
  </div>
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  v.document.close();
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
const FORMAS_PAGO_FIJAS = ['Contado','Crédito','Transferencia','Cheque'];

function abrirEditarPedido(pedidoId){
  const p = _pedidosRaw.find(x => x._id === pedidoId);
  if(p && !_esRegistroDeHoy(p.fecha||p.FECHA)){ alert('Solo se pueden editar pedidos del día de hoy.'); return; }
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

function renderModalEditarPedido(){
  const p = editandoPedidoActual;
  if(!p) return;

  const optionsAsesor = _asesoresCache.map(r => `<option value="${r}" ${p.empleado===r?'selected':''}>${r.split(':')[1]?.trim()||r}</option>`).join('');
  // [FIX] NUEVO FORMATO DE PAGO MÚLTIPLE — este selector solo conocía las 4 formas
  // fijas (Contado/Crédito/Transferencia/Cheque). Si el pedido se creó con pago
  // múltiple, su 'formapago' vale 'Mixto', y como esa opción no existía aquí, el
  // <select> se quedaba sin ninguna marcada — al guardar CUALQUIER otro cambio (ej.
  // solo el teléfono), esto sobrescribía 'Mixto' por el valor por defecto del
  // desplegable sin que el admin lo pidiera. Este editor no soporta re-editar el
  // desglose de pago múltiple en sí (pagos[]/creditoPendiente quedan intactos porque
  // guardarEdicionPedido() solo actualiza los campos que sí edita este formulario);
  // esta opción es solo para que 'Mixto' se conserve tal cual si no se toca.
  const optionsPagoBase = p.formapago === 'Mixto'
    ? [`<option value="Mixto" selected>Mixto (pago múltiple — no editable aquí)</option>`, ...FORMAS_PAGO_FIJAS.map(f => `<option value="${f}">${f}</option>`)]
    : FORMAS_PAGO_FIJAS.map(f => `<option value="${f}" ${p.formapago===f?'selected':''}>${f}</option>`);
  const optionsPago = optionsPagoBase.join('');

  document.getElementById('editarBody').innerHTML = `
    <div class="editar-seccion-label">📋 Datos del pedido</div>
    <div class="editar-grid">
      <div class="editar-field"><label>Fecha</label><input type="date" id="editFecha" value="${p.fecha||''}"></div>
      <div class="editar-field"><label>Asesor</label><select id="editAsesor">${optionsAsesor}</select></div>
      <div class="editar-field"><label>Forma de Pago</label><select id="editFormaPago">${optionsPago}</select></div>
      <div class="editar-field"><label>Cliente</label><input type="text" id="editCliente" value="${escapeAttr(p.cliente||'')}"></div>
      <div class="editar-field"><label>Teléfono</label><input type="text" id="editTelefono" value="${escapeAttr(p.telefono||'')}"></div>
      <div class="editar-field"><label>Dirección</label><input type="text" id="editDireccion" value="${escapeAttr(p.direccion||'')}"></div>
    </div>
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
  if(!_esRegistroDeHoy(editandoPedidoActual.fecha||editandoPedidoActual.FECHA)){ alert('Solo se pueden editar pedidos del día de hoy.'); return; }
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

  const nuevo = {
    fecha: document.getElementById('editFecha').value,
    empleado: document.getElementById('editAsesor').value,
    formapago: document.getElementById('editFormaPago').value,
    cliente,
    telefono: document.getElementById('editTelefono').value.trim(),
    direccion: document.getElementById('editDireccion').value.trim(),
    notas: document.getElementById('editNotas').value.trim(),
    productos: productosLimpios,
    total: +productosLimpios.reduce((s,prod) => s + prod.subtotal, 0).toFixed(2)
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
async function _registrarAuditoria(tipo, accion, registroId, detalle){
  try{
    await db.collection('historialCambios').add({
      tipo, accion, registroId: registroId || null, detalle: detalle || '',
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
  if(!_esRegistroDeHoy(p.fecha||p.FECHA)){ alert('Solo se pueden eliminar pedidos del día de hoy.'); return; }

  const clienteNombre = p.cliente || 'Sin nombre';
  const totalPedido = p.total != null ? `$${parseFloat(p.total).toFixed(2)}` : '$0.00';
  const confirmado = confirm(`¿Eliminar por completo el pedido de "${clienteNombre}" (${totalPedido})?\n\nEsta acción lo saca del dashboard y de la app de asesores, y también revierte cualquier movimiento de inventario generado automáticamente por esta venta. Queda respaldado en el historial de eliminados, pero ya no aparecerá en ningún reporte activo.`);
  if(!confirmado) return;

  try{
    // 1) Respaldo completo del documento original + metadata de la eliminación
    const { _id, ...datosOriginales } = p; // quita el campo interno _id antes de guardar el respaldo
    await db.collection('pedidosEliminados').doc(pedidoId).set({
      ...datosOriginales,
      pedidoIdOriginal: pedidoId,
      eliminadoPor: actorAuditoria(),
      fechaEliminacion: fechaHoy(),
      horaEliminacion: new Date().toLocaleTimeString('es-EC'),
      eliminadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

    // [NEW] Registro de auditoría de esta eliminación
    await _registrarAuditoria('pedido', 'eliminación', pedidoId,
      `Pedido de "${clienteNombre}" (${totalPedido}) eliminado — respaldado en Pedidos Eliminados.`);

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

    // El listener en tiempo real ya activo quita el pedido de la tabla, KPIs,
    // Resumen por Cliente y Cuadre de Caja automáticamente — sin recargar.
    mostrarToastEdicion('🗑 Pedido eliminado, respaldado y su inventario revertido correctamente.');
  }catch(err){
    console.error(err);
    alert('❌ Ocurrió un error al eliminar el pedido: ' + err.message);
  }
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
  if(count) count.textContent = _eliminadosRaw.length + ' registro' + (_eliminadosRaw.length!==1?'s':'');
  if(!_eliminadosRaw.length){
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="icon">🗑</div>No hay pedidos eliminados registrados</div></td></tr>';
    return;
  }
  tbody.innerHTML = _eliminadosRaw.map((p, idx) => {
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
      <td><button class="btn-editar-fila" onclick="toggleEliminadoDetalle(${idx})" id="btnEliminadoToggle-${idx}" title="Ver todo lo que se eliminó">👁 Ver detalle</button></td>
    </tr>
    <tr id="filaEliminadoDetalle-${idx}" style="display:none">
      <td colspan="9" style="background:var(--surface2);padding:14px 18px">
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
    t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--navy);color:#fff;padding:12px 22px;border-radius:100px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;box-shadow:var(--shadow-lg);z-index:999;opacity:0;transition:opacity .25s;pointer-events:none";
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

function abrirEditarPago(id){
  const p = _pagosRaw.find(x => x._id === id);
  if(!p){ alert('No se encontró el pago — puede que ya se haya eliminado.'); return; }
  if(!_esRegistroDeHoy(p.fecha||p.FECHA)){ alert('Solo se pueden editar pagos del día de hoy.'); return; }
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
  if(!_esRegistroDeHoy(g.fecha||g.FECHA)){ alert('Solo se pueden editar gastos del día de hoy.'); return; }
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
    if(tipo === 'pago'){
      const cliente = document.getElementById('epgCliente').value.trim();
      if(!cliente){ alert('El nombre del cliente no puede quedar vacío.'); btn.disabled=false; btn.textContent='✅ Guardar Cambios'; return; }
      await db.collection('pagos').doc(id).update({
        cliente, monto, forma: document.getElementById('epgForma').value,
        fecha: document.getElementById('epgFecha').value, notas: document.getElementById('epgNotas').value.trim()
      });
    } else {
      const desc = document.getElementById('epgDesc').value.trim();
      if(!desc){ alert('La descripción no puede quedar vacía.'); btn.disabled=false; btn.textContent='✅ Guardar Cambios'; return; }
      await db.collection('gastos').doc(id).update({
        desc, categoria: document.getElementById('epgCategoria').value.trim(), monto,
        fecha: document.getElementById('epgFecha').value, ref: document.getElementById('epgRef').value.trim()
      });
    }
    await _registrarAuditoria(tipo, 'edición', id, (tipo==='pago'?'Pago':'Gasto') + ' editado por ' + actorAuditoria() + ' — monto $' + monto.toFixed(2));
    mostrarToastEdicion(tipo === 'pago' ? '✅ Pago actualizado correctamente.' : '✅ Gasto actualizado correctamente.');
    cerrarEditarPagoGasto();
  }catch(err){
    console.error(err);
    alert('❌ Ocurrió un error al guardar: ' + err.message);
  }finally{
    btn.disabled = false; btn.textContent = '✅ Guardar Cambios';
  }
}

async function eliminarPagoDash(id){
  const pagoChk = (_pagosRaw||[]).find(x => x._id === id);
  if(pagoChk && !_esRegistroDeHoy(pagoChk.fecha||pagoChk.FECHA)){ alert('Solo se pueden eliminar pagos del día de hoy.'); return; }

  const p = _pagosRaw.find(x => x._id === id);
  if(!confirm(`¿Eliminar el pago de "${p?.cliente||'este cliente'}" ($${(parseFloat(p?.monto)||0).toFixed(2)})? Esta acción no se puede deshacer.`)) return;
  try{
    await db.collection('pagos').doc(id).delete();
    await _registrarAuditoria('pago', 'eliminación', id, 'Pago eliminado por ' + actorAuditoria());
    mostrarToastEdicion('🗑 Pago eliminado correctamente.');
  }catch(err){ console.error(err); alert('❌ No se pudo eliminar el pago: ' + err.message); }
}

async function eliminarGastoDash(id){
  const g = _gastosRaw.find(x => x._id === id);
  if(g && !_esRegistroDeHoy(g.fecha||g.FECHA)){ alert('Solo se pueden eliminar gastos del día de hoy.'); return; }
  if(!confirm(`¿Eliminar el gasto "${g?.desc||g?.categoria||'este gasto'}" ($${(parseFloat(g?.monto)||0).toFixed(2)})? Esta acción no se puede deshacer.`)) return;
  try{
    await db.collection('gastos').doc(id).delete();
    await _registrarAuditoria('gasto', 'eliminación', id, 'Gasto eliminado por ' + actorAuditoria());
    mostrarToastEdicion('🗑 Gasto eliminado correctamente.');
  }catch(err){ console.error(err); alert('❌ No se pudo eliminar el gasto: ' + err.message); }
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
  if(!confirm('¿Quitar el acceso de esta Secretaria? Ya no podrá iniciar sesión, y el usuario quedará libre para volver a crearse si hace falta.')) return;
  try{
    // [FIX] Antes solo se borraba el perfil de Firestore y la cuenta de Firebase
    // Auth quedaba huérfana (con el mismo usuario/correo "ocupado" para siempre).
    // Ahora reutiliza la Cloud Function eliminarAsesorCompleto, que borra las DOS
    // cosas — funciona igual para secretaria que para asesor (solo exige que la
    // cuenta objetivo no sea admin).
    await _llamarFuncion('eliminarAsesorCompleto', { uid });
    mostrarToastEdicion('✓ Acceso de Secretaria revocado por completo. El usuario queda libre para volver a crearse.');
    poblarSelectEliminarSecretaria();
  }catch(err){ console.error(err); alert('No se pudo eliminar: ' + (err.message || 'error desconocido')); }
}
