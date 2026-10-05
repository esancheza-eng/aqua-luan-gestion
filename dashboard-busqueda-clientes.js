/* ════════════════════════════════════════════════════════════
   [NEW] CONSULTAR POR CLIENTE — búsqueda en TODO el historial (con caché
   y SIN perder el tiempo real)
   Al escribir 2+ letras en el buscador de "Consultar por Cliente", se
   busca en todo el historial guardado, sin borrar la fecha a mano.

   - El historial antiguo se descarga UNA sola vez por sesión (lectura única)
     y se guarda en memoria; las búsquedas siguientes solo releen los días
     recientes. Así se gastan menos lecturas de Firebase.
   - El tiempo real del rango que ya estaba abierto (ej. Hoy) NO se cierra:
     los pedidos/pagos nuevos de los asesores siguen apareciendo en vivo
     mientras se busca, combinados con el historial guardado.
   - Al salir de la sección se vuelve al rango de fechas anterior.
   - Al cerrar sesión la copia se borra.

   No modifica ninguna fórmula ni función existente: entrega los datos a
   las mismas variables y al mismo recálculo que ya usa el dashboard.
════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var COLS = ['pedidos', 'pagos', 'gastos'];
  var _cache = null;          // { pedidos: {id: doc}, pagos: {...}, gastos: {...}, hastaFecha }
  var _modoBusqueda = false;  // true mientras se muestra el historial completo
  var _fechasPrevias = null;  // fechas del filtro antes de buscar
  var _rango = null;          // rango que cubren los listeners en vivo { desde, hasta }
  var _vivo = null;           // últimos datos en vivo por colección (solo el rango del listener)
  var _asignado = null;       // arreglos combinados que este módulo entregó al dashboard
  var _cargando = null;
  var _restaurandoPropio = false;

  function _el(id) { return document.getElementById(id); }
  function _ms(x) { return (x && x.creadoEn && x.creadoEn.toMillis) ? x.creadoEn.toMillis() : 0; }
  function _enRango(doc) {
    var f = doc && doc.fecha;
    return typeof f === 'string' && f >= _rango.desde && f <= _rango.hasta;
  }
  function _getRaw(c) { return c === 'pedidos' ? _pedidosRaw : c === 'pagos' ? _pagosRaw : _gastosRaw; }
  function _setRaw(c, arr) {
    if (c === 'pedidos') _pedidosRaw = arr;
    else if (c === 'pagos') _pagosRaw = arr;
    else _gastosRaw = arr;
  }

  /* Descarga (1.ª vez) o actualiza solo los días recientes (siguientes veces). */
  function _asegurarCache(hoy) {
    if (_cargando) return _cargando;
    var desde = _cache ? _cache.hastaFecha : null;
    _cargando = Promise.all(COLS.map(function (c) {
      var q = db.collection(c);
      if (desde) q = q.where('fecha', '>=', desde);
      return q.where('fecha', '<=', hoy).get();
    })).then(function (snaps) {
      if (!_cache) _cache = { pedidos: {}, pagos: {}, gastos: {}, hastaFecha: hoy };
      snaps.forEach(function (s, i) {
        var mapa = _cache[COLS[i]];
        if (desde) {
          // Esos días se releen completos: se quitan de la copia para reflejar también eliminados.
          Object.keys(mapa).forEach(function (k) {
            var f = mapa[k].fecha;
            if (typeof f === 'string' && f >= desde && f <= hoy) delete mapa[k];
          });
        }
        s.docs.forEach(function (d) { var o = d.data(); o._id = d.id; mapa[d.id] = o; });
      });
      _cache.hastaFecha = hoy;
    });
    _cargando = _cargando.then(function () { _cargando = null; }, function (e) { _cargando = null; throw e; });
    return _cargando;
  }

  /* Combina: historial guardado (fuera del rango en vivo) + datos en vivo del rango. */
  function _combinar() {
    _asignado = {};
    COLS.forEach(function (c) {
      var mapa = _cache[c];
      var arr = [];
      Object.keys(mapa).forEach(function (k) { if (!_enRango(mapa[k])) arr.push(mapa[k]); });
      arr = arr.concat(_vivo[c]);
      if (c === 'pedidos') arr.sort(function (a, b) { return _ms(b) - _ms(a); });
      _asignado[c] = arr;
      _setRaw(c, arr);
    });
  }

  /* Revisa qué colección trae datos nuevos (del listener en vivo o de una edición/eliminación
     hecha en el dashboard) y vuelve a combinar. */
  function _absorberCambios() {
    var huboCambio = false;
    COLS.forEach(function (c) {
      var actual = _getRaw(c);
      if (actual === _asignado[c]) return;
      huboCambio = true;
      var fuera = actual.filter(function (x) { return !_enRango(x); });
      _vivo[c] = actual.filter(_enRango);
      if (fuera.length) {
        // El dashboard quitó un registro de la lista combinada (ej. eliminó un pedido antiguo):
        // se refleja también en la copia guardada.
        var ids = {};
        fuera.forEach(function (x) { ids[x._id] = true; });
        var mapa = _cache[c];
        Object.keys(mapa).forEach(function (k) { if (!_enRango(mapa[k]) && !ids[k]) delete mapa[k]; });
      }
    });
    if (huboCambio) _combinar();
  }

  function _entrarModoBusqueda() {
    if (_modoBusqueda || _cargando) return;
    var d = _el('filtroFecha'), h = _el('filtroFechaHasta');
    if (!d || !h || !d.value) return; // sin fecha de inicio ya se está viendo todo ("Todo")
    if (!_rangoListeners || !_rangoListeners.desde || !_unsubPedidosAll) return;
    var hoy = fechaHoy();
    var contador = _el('clienteContadorTabla');
    if (contador) contador.textContent = 'Buscando en todo el historial…';

    _asegurarCache(hoy).then(function () {
      var sec = _el('seccion-cliente');
      if (!sec || !sec.classList.contains('active')) return; // salió mientras cargaba
      if (!_rangoListeners || !_rangoListeners.desde) return;
      _rango = { desde: _rangoListeners.desde, hasta: _rangoListeners.hasta };
      _vivo = { pedidos: _pedidosRaw.slice(), pagos: _pagosRaw.slice(), gastos: _gastosRaw.slice() };
      _fechasPrevias = { desde: d.value, hasta: h.value };
      d.value = '';
      h.value = hoy;
      _modoBusqueda = true;
      _combinar();
      _flushRecalcInmediato();
    }).catch(function (err) {
      console.error('Búsqueda en todo el historial:', err);
      if (contador) contador.textContent = '⚠️ No se pudo cargar el historial';
    });
  }

  /* Devuelve al dashboard solo los datos en vivo de su rango (como estaba antes de buscar). */
  function _devolverDatosEnVivo() {
    _absorberCambios();
    COLS.forEach(function (c) { _setRaw(c, _vivo[c]); });
    _modoBusqueda = false;
    _asignado = null; _vivo = null; _rango = null;
  }

  function _salirModoBusqueda() {
    if (!_modoBusqueda) return;
    var previas = _fechasPrevias;
    _fechasPrevias = null;
    _devolverDatosEnVivo();
    var d = _el('filtroFecha'), h = _el('filtroFechaHasta');
    if (d && h && previas) { d.value = previas.desde; h.value = previas.hasta; }
    if (typeof _sincronizarFechaRutasConDashboard === 'function') _sincronizarFechaRutasConDashboard();
    _restaurandoPropio = true;
    try { iniciarListenersDashboard(); } finally { _restaurandoPropio = false; }
  }

  function _enganchar() {
    var input = _el('clienteBusquedaTabla');
    if (input) {
      input.addEventListener('input', function () {
        if ((input.value || '').trim().length >= 2) _entrarModoBusqueda();
      });
    }

    // Cada vez que llega un cambio en vivo, se combina con el historial antes del recálculo.
    if (typeof _onSnapshotColeccionLista === 'function') {
      var _snapAnterior = _onSnapshotColeccionLista;
      _onSnapshotColeccionLista = function () {
        if (_modoBusqueda) _absorberCambios();
        return _snapAnterior.apply(this, arguments);
      };
    }
    // Ediciones/eliminaciones hechas en el dashboard mientras se busca.
    if (typeof _recalcularTodosLosDatos === 'function') {
      var _recalcAnterior = _recalcularTodosLosDatos;
      _recalcularTodosLosDatos = function () {
        if (_modoBusqueda) _absorberCambios();
        return _recalcAnterior.apply(this, arguments);
      };
    }

    // Al salir de "Consultar por Cliente" se vuelve al rango anterior.
    if (typeof switchSeccionDash === 'function') {
      var _switchAnterior = switchSeccionDash;
      switchSeccionDash = function (sec) {
        var r = _switchAnterior.apply(this, arguments);
        if (sec !== 'cliente') _salirModoBusqueda();
        return r;
      };
    }

    // Si el usuario pulsa Hoy / Aplicar / Todo mientras busca, manda su elección.
    if (typeof iniciarListenersDashboard === 'function') {
      var _iniciarAnterior = iniciarListenersDashboard;
      iniciarListenersDashboard = function () {
        if (!_restaurandoPropio && _modoBusqueda) { _fechasPrevias = null; _devolverDatosEnVivo(); }
        return _iniciarAnterior.apply(this, arguments);
      };
    }

    // Al cerrar sesión se borra la copia en memoria.
    if (typeof auth !== 'undefined' && auth.onAuthStateChanged) {
      auth.onAuthStateChanged(function (u) {
        if (!u) { _cache = null; _modoBusqueda = false; _fechasPrevias = null; _asignado = null; _vivo = null; _rango = null; }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _enganchar);
  else _enganchar();
})();
