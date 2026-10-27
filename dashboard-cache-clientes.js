/* ════════════════════════════════════════════════════════════════════════
   [NEW 27-oct] CONSULTAR POR CLIENTE — Memoria en el navegador + Registro de cambios
   ────────────────────────────────────────────────────────────────────────
   Objetivo: no volver a leer TODO el historial de pedidos y pagos de Firestore
   cada vez que se abre "Consultar por Cliente".

   1) REGISTRO DE CAMBIOS  → colección "cambiosRegistros"
      Cada vez que el dashboard (o el admin desde la app) EDITA o ELIMINA un pedido
      o un pago, deja un aviso mínimo: { coleccion, ids:[...], accion, creadoEn }.
      Los registros NUEVOS no necesitan aviso: ya traen su hora de servidor (creadoEn).
      ► REGLA PARA EL FUTURO: toda función nueva que edite o elimine pedidos/pagos
        debe llamar a _registrarCambioRegistro('pedidos'|'pagos', id(s), 'edición'|'eliminación').

   2) MEMORIA EN EL NAVEGADOR  → IndexedDB
      Guarda los pedidos y pagos ya leídos. Al volver a abrir solo se piden a Firebase
      los registros nuevos y los avisos de cambio desde la última vez.
      - Se descarta y se vuelve a leer todo si tiene más de CACHE_DIAS_MAX días
        (red de seguridad por si algún cambio no dejó aviso, ej. una edición a mano
        en la consola de Firebase).
      - Solo se guarda si el registro de cambios funciona (permisos OK); si no,
        el sistema trabaja como antes y no guarda nada en el navegador.
      - Firebase sigue siendo la única fuente de verdad: si la memoria se borra
        o se daña, simplemente se vuelve a leer todo una vez.

   Este archivo NO cambia ninguna fórmula ni cálculo del dashboard.
════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CACHE_VERSION = 1;              // subir este número invalida la memoria de todos los navegadores
  var CACHE_DIAS_MAX = 7;             // recarga completa automática cada 7 días
  var IDB_NOMBRE = 'aqualuan-dashboard-cache';
  var IDB_STORE = 'datos';
  var IDB_CLAVE = 'consultarCliente';
  var IDS_POR_AVISO = 400;            // máximo de ids por documento de aviso

  /* ───────────── 1) Registro de cambios ───────────── */
  /* No bloquea nunca: si el aviso falla, la edición ya quedó guardada igual. */
  function _registrarCambioRegistro(coleccion, ids, accion) {
    try {
      if (typeof db === 'undefined' || !db) return;
      if (coleccion !== 'pedidos' && coleccion !== 'pagos') return;
      var lista = (Array.isArray(ids) ? ids : [ids]).filter(function (x) { return typeof x === 'string' && x; });
      if (!lista.length) return;
      var por = '';
      try { por = (typeof actorAuditoria === 'function') ? String(actorAuditoria() || '') : ''; } catch (e) { por = ''; }
      for (var k = 0; k < lista.length; k += IDS_POR_AVISO) {
        db.collection('cambiosRegistros').add({
          coleccion: coleccion,
          ids: lista.slice(k, k + IDS_POR_AVISO),
          accion: String(accion || 'edición'),
          por: por.slice(0, 80),
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function (err) { console.warn('Aviso de cambio no registrado (' + coleccion + '):', err); });
      }
    } catch (e) { console.warn('_registrarCambioRegistro:', e); }
  }
  window._registrarCambioRegistro = _registrarCambioRegistro;

  /* ───────────── 2) Serialización (Timestamp / GeoPoint) ───────────── */
  function _serializar(v) {
    if (v === null || v === undefined) return v;
    if (typeof v !== 'object') return v;
    if (typeof v.toMillis === 'function' && 'seconds' in v) return { __ts: v.toMillis() };
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && typeof v.isEqual === 'function') return { __geo: [v.latitude, v.longitude] };
    if (Array.isArray(v)) return v.map(_serializar);
    if (v instanceof Date) return { __ts: v.getTime() };
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = _serializar(v[k]); });
    return o;
  }
  function _revivir(v) {
    if (v === null || v === undefined || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(_revivir);
    if (typeof v.__ts === 'number' && Object.keys(v).length === 1) return firebase.firestore.Timestamp.fromMillis(v.__ts);
    if (Array.isArray(v.__geo) && Object.keys(v).length === 1) return new firebase.firestore.GeoPoint(v.__geo[0], v.__geo[1]);
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = _revivir(v[k]); });
    return o;
  }

  /* ───────────── 3) IndexedDB ───────────── */
  function _abrirIDB() {
    return new Promise(function (resolve) {
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
        var req = indexedDB.open(IDB_NOMBRE, 1);
        req.onupgradeneeded = function () {
          try { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); } catch (e) {}
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function _idb(modo, accion) {
    return _abrirIDB().then(function (bd) {
      if (!bd) return null;
      return new Promise(function (resolve) {
        try {
          var tx = bd.transaction(IDB_STORE, modo);
          var st = tx.objectStore(IDB_STORE);
          var r = accion(st);
          tx.oncomplete = function () { resolve(r && 'result' in r ? r.result : true); bd.close(); };
          tx.onerror = tx.onabort = function () { resolve(null); try { bd.close(); } catch (e) {} };
        } catch (e) { resolve(null); try { bd.close(); } catch (e2) {} }
      });
    });
  }
  function _proyecto() {
    try { return firebase.app().options.projectId || ''; } catch (e) { return ''; }
  }

  /* Devuelve la memoria válida o null (no existe, otra versión, otro proyecto, vencida o dañada) */
  window._cacheClientesLeer = function () {
    return _idb('readonly', function (st) { return st.get(IDB_CLAVE); }).then(function (c) {
      try {
        if (!c || c.version !== CACHE_VERSION || c.proyecto !== _proyecto()) return null;
        if (!c.cargaCompletaMs || (Date.now() - c.cargaCompletaMs) > CACHE_DIAS_MAX * 86400000) return null;
        if (!Array.isArray(c.pedidos) || !Array.isArray(c.pagos)) return null;
        return {
          pedidos: c.pedidos.map(_revivir),
          pagos: c.pagos.map(_revivir),
          cursorPedidos: Number(c.cursorPedidos) || 0,
          cursorPagos: Number(c.cursorPagos) || 0,
          cursorCambios: Number(c.cursorCambios) || 0,
          cambiosVistos: Array.isArray(c.cambiosVistos) ? c.cambiosVistos : [],
          cargaCompletaMs: c.cargaCompletaMs
        };
      } catch (e) { console.warn('Memoria de clientes dañada, se leerá todo:', e); return null; }
    }).catch(function () { return null; });
  };

  var _timerGuardar = null, _pendienteGuardar = null;
  /* Guardado diferido (espera 4 s de calma) para no escribir en cada cambio */
  window._cacheClientesGuardar = function (estado) {
    _pendienteGuardar = estado;
    if (_timerGuardar) clearTimeout(_timerGuardar);
    _timerGuardar = setTimeout(function () {
      _timerGuardar = null;
      var e = _pendienteGuardar; _pendienteGuardar = null;
      if (!e) return;
      try {
        var datos = {
          version: CACHE_VERSION,
          proyecto: _proyecto(),
          cargaCompletaMs: e.cargaCompletaMs,
          cursorPedidos: e.cursorPedidos, cursorPagos: e.cursorPagos, cursorCambios: e.cursorCambios,
          cambiosVistos: (e.cambiosVistos || []).slice(-300),
          pedidos: e.pedidos.map(_serializar),
          pagos: e.pagos.map(_serializar),
          guardadoMs: Date.now()
        };
        _idb('readwrite', function (st) { return st.put(datos, IDB_CLAVE); });
      } catch (err) { console.warn('No se pudo guardar la memoria de clientes:', err); }
    }, 4000);
  };

  /* ───────────── 4) Limpieza de avisos viejos ─────────────
     Solo el admin (las reglas solo le permiten borrar a él), máximo una vez al día.
     Borra avisos de más de 30 días: ya no sirven porque la memoria se recarga
     completa cada 7 días. Nunca toca pedidos ni pagos. */
  window._limpiarAvisosCambioViejos = function () {
    try {
      if (typeof ROL_ACTUAL !== 'undefined' && ROL_ACTUAL === 'secretaria') return;
      if (typeof db === 'undefined' || !db) return;
      var hoy = new Date().toISOString().slice(0, 10);
      var clave = 'aqualuan-limpieza-avisos';
      try { if (localStorage.getItem(clave) === hoy) return; localStorage.setItem(clave, hoy); } catch (e) {}
      var limite = firebase.firestore.Timestamp.fromMillis(Date.now() - 30 * 86400000);
      db.collection('cambiosRegistros').where('creadoEn', '<', limite).limit(400).get().then(function (s) {
        if (s.empty) return;
        var lote = db.batch();
        s.forEach(function (d) { lote.delete(d.ref); });
        return lote.commit();
      }).catch(function (e) { console.warn('Limpieza de avisos viejos:', e); });
    } catch (e) { console.warn('Limpieza de avisos viejos:', e); }
  };

  window._cacheClientesBorrar = function () {
    if (_timerGuardar) { clearTimeout(_timerGuardar); _timerGuardar = null; }
    _pendienteGuardar = null;
    return _idb('readwrite', function (st) { return st.delete(IDB_CLAVE); });
  };
})();
