/* ══════════════════════════════════════════════════════════════════════
   AQUA LUAN — DASHBOARD · Envases prestados + Cuadre del camión
   ══════════════════════════════════════════════════════════════════════
   Archivo NUEVO. No modifica nada de dashboard.js: solo agrega dos
   secciones al menú y LEE datos (no cambia pedidos, cajas, liquidación,
   inventario ni ninguna fórmula existente).

   - ♻ Envases prestados: clientes que deben envases (prestado − devuelto),
     según lo que los asesores registran en la app de pedidos
     (colección `envasesPrestamos`). Se puede anular un registro mal hecho.
   - ⚖ Cuadre del camión: por asesor y día, lo cargado en bodega vs. lo
     vendido en pedidos (incluye regalías) vs. lo devuelto a bodega; y los
     envases recuperados de clientes vs. entregados en bodega.
   Visible para Administrador y Secretaria.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  try {
    var ENV = { movs: [], unsub: null, cargado: false, filtroAsesor: '', q: '', verHist: false };
    var CUA = { fecha: '', cache: {}, cargando: false, error: '' };

    function esc(s) { return (typeof escHTML === 'function') ? escHTML(String(s == null ? '' : s)) : String(s == null ? '' : s); }
    function hoy() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function fmt(f) { if (!f || f.length < 10) return f || '-'; var p = f.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
    function num(n) { return (Number(n) || 0).toLocaleString('es-EC'); }
    function ms(m) { return (m.creadoEn && m.creadoEn.toMillis) ? m.creadoEn.toMillis() : (m.creadoLocal || 0); }
    function nombreAsesor(r) { var x = String(r || '').split(':'); return x[1] ? x[1].trim() : (r || ''); }
    function esStaffDash() { return typeof ROL_ACTUAL !== 'undefined' && (ROL_ACTUAL === 'admin' || ROL_ACTUAL === 'secretaria'); }

    /* ── 1. Menú y secciones (se insertan sin tocar el HTML existente) ── */
    if (typeof SECCIONES_SECRETARIA !== 'undefined' && Array.isArray(SECCIONES_SECRETARIA)) {
      if (SECCIONES_SECRETARIA.indexOf('envasesPrestados') < 0) SECCIONES_SECRETARIA.push('envasesPrestados');
      if (SECCIONES_SECRETARIA.indexOf('cuadreCamion') < 0) SECCIONES_SECRETARIA.push('cuadreCamion');
    }
    function crearMenuYSecciones() {
      var ancla = document.getElementById('navControlTickets') || document.querySelector('.dash-nav-item:last-of-type');
      var contenido = document.querySelector('.dash-content');
      if (!ancla || !contenido || document.getElementById('navEnvasesPrestados')) return;
      var b1 = document.createElement('button');
      b1.className = 'dash-nav-item'; b1.dataset.section = 'envasesPrestados'; b1.id = 'navEnvasesPrestados';
      b1.setAttribute('onclick', "switchSeccionDash('envasesPrestados')");
      b1.innerHTML = '<svg class="nav-ico" viewBox="0 0 24 24"><path d="M7 19H4.8a1.8 1.8 0 0 1-1.6-2.7L7 9.5"/><path d="M11 19h8.2a1.8 1.8 0 0 0 1.6-2.7l-1.2-2"/><path d="M14 16l-3 3 3 3"/><path d="M8.3 13.6L7 9.5l-4 1.2"/><path d="M9.3 5.8L10.5 3.6a1.8 1.8 0 0 1 3.1 0l3.9 6.6"/><path d="M13.4 9.7l4.1 1.1 1-4.1"/></svg>Envases prestados';
      var b2 = document.createElement('button');
      b2.className = 'dash-nav-item'; b2.dataset.section = 'cuadreCamion'; b2.id = 'navCuadreCamion';
      b2.setAttribute('onclick', "switchSeccionDash('cuadreCamion')");
      b2.innerHTML = '<svg class="nav-ico" viewBox="0 0 24 24"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>Cuadre del camión';
      ancla.parentNode.insertBefore(b2, ancla.nextSibling);
      ancla.parentNode.insertBefore(b1, ancla.nextSibling);

      var s1 = document.createElement('div');
      s1.className = 'dash-section'; s1.id = 'seccion-envasesPrestados';
      s1.innerHTML =
        '<div class="kpi-grid" id="envKpis"></div>' +
        '<div class="table-card"><div class="table-header"><div class="table-title">♻ Clientes con envases pendientes</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<select id="envFiltroAsesor" class="env-ctrl"></select>' +
            '<input id="envBuscar" class="env-ctrl" placeholder="Buscar cliente…">' +
          '</div></div>' +
          '<div style="padding:0 1.25rem 1.25rem;overflow-x:auto"><table class="cierre-prod-table"><thead><tr>' +
            '<th style="text-align:left">Cliente</th><th style="text-align:left">Teléfono</th><th style="text-align:left">Asesor</th><th style="text-align:left">Envase</th>' +
            '<th style="text-align:right">Prestados</th><th style="text-align:right">Devueltos</th><th style="text-align:right">Pendiente</th><th style="text-align:left">Primer préstamo</th>' +
          '</tr></thead><tbody id="envPendTbody"></tbody></table></div></div>' +
        '<div class="table-card" style="margin-top:1.25rem"><div class="table-header"><div class="table-title">📋 Registros de préstamos y devoluciones</div>' +
          '<button class="env-btn" id="envBtnHist">Mostrar</button></div>' +
          '<div id="envHistWrap" style="display:none;padding:0 1.25rem 1.25rem;overflow-x:auto"><table class="cierre-prod-table"><thead><tr>' +
            '<th style="text-align:left">Fecha</th><th style="text-align:left">Asesor</th><th style="text-align:left">Cliente</th><th style="text-align:left">Movimiento</th>' +
            '<th style="text-align:left">Envase</th><th style="text-align:right">Cant.</th><th></th>' +
          '</tr></thead><tbody id="envHistTbody"></tbody></table></div></div>';
      var s2 = document.createElement('div');
      s2.className = 'dash-section'; s2.id = 'seccion-cuadreCamion';
      s2.innerHTML =
        '<div class="table-card"><div class="table-header"><div class="table-title">⚖ Cuadre del camión</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="date" id="cuaFecha" class="env-ctrl">' +
          '<button class="env-btn" id="cuaActualizar">↻ Actualizar</button></div></div>' +
          '<div style="font-size:12px;color:var(--muted);padding:0 1.25rem 12px;line-height:1.5">Compara lo cargado al camión en la app de Bodega con lo vendido en la app de pedidos (incluye regalías) y lo devuelto a bodega. ' +
          '<b>Faltan</b> = no regresó a bodega. <b>Sobran</b> = regresó más de lo esperado (posible venta sin registrar).</div>' +
          '<div id="cuaCuerpo" style="padding:0 1.25rem 1.25rem"></div></div>';
      contenido.appendChild(s1); contenido.appendChild(s2);

      document.getElementById('envFiltroAsesor').addEventListener('change', function () { ENV.filtroAsesor = this.value; renderEnvases(); });
      document.getElementById('envBuscar').addEventListener('input', function () { ENV.q = this.value.trim().toUpperCase(); renderEnvases(); });
      document.getElementById('envBtnHist').addEventListener('click', function () {
        ENV.verHist = !ENV.verHist; this.textContent = ENV.verHist ? 'Ocultar' : 'Mostrar';
        document.getElementById('envHistWrap').style.display = ENV.verHist ? 'block' : 'none'; renderEnvases();
      });
      document.getElementById('cuaFecha').addEventListener('change', function () { CUA.fecha = this.value; CUA.error = ''; cargarCuadre(CUA.fecha); });
      document.getElementById('cuaActualizar').addEventListener('click', function () { cargarCuadre(CUA.fecha || hoy(), true); });

      var st = document.createElement('style');
      st.textContent = '.env-ctrl{background:var(--surface2);border:1.5px solid var(--border);border-radius:8px;color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:13px;padding:7px 10px}' +
        '.env-btn{background:var(--surface2);border:1.5px solid var(--border);border-radius:8px;color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:700;padding:7px 12px;cursor:pointer}' +
        '.env-bad{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:800}' +
        '.env-ok{background:rgba(16,185,129,.15);color:#059669}.env-falta{background:rgba(239,68,68,.15);color:#dc2626}.env-sobra{background:rgba(245,158,11,.18);color:#b45309}' +
        '.env-ruta{font-weight:800;font-size:15px;margin:14px 0 6px}';
      document.head.appendChild(st);
    }

    /* ── 2. Envases prestados ── */
    function iniciarListenerEnvases() {
      if (ENV.unsub || !esStaffDash()) return;
      ENV.unsub = db.collection('envasesPrestamos').onSnapshot(function (snap) {
        ENV.movs = snap.docs.map(function (d) { var x = d.data(); x._id = d.id; return x; });
        if (document.getElementById('seccion-envasesPrestados') && document.getElementById('seccion-envasesPrestados').classList.contains('active')) renderEnvases();
      }, function (err) {
        console.warn('envasesPrestamos:', err);
        var tb = document.getElementById('envPendTbody');
        if (tb) tb.innerHTML = '<tr><td colspan="8" style="color:#dc2626">No se pudo leer envasesPrestamos (' + esc(err.code || err.message) + '). Revisa que las reglas de Firestore estén publicadas.</td></tr>';
      });
    }
    function saldosEnvases() {
      var g = {};
      ENV.movs.filter(function (m) { return !m.anulado; }).forEach(function (m) {
        var k = (m.cliente || '') + '|' + (m.envase || '');
        var r = g[k] = g[k] || { cliente: m.cliente || '', envase: m.envase || '', telefono: '', asesores: {}, prest: 0, dev: 0, primer: '' };
        var q = Number(m.cantidad) || 0;
        if (m.tipo === 'PRESTAMO') { r.prest += q; if (!r.primer || m.fecha < r.primer) r.primer = m.fecha; }
        else r.dev += q;
        if (m.telefono) r.telefono = m.telefono;
        if (m.empleado) r.asesores[m.empleado] = true;
      });
      return Object.keys(g).map(function (k) { var r = g[k]; r.pend = r.prest - r.dev; r.asesor = Object.keys(r.asesores).join(', '); return r; });
    }
    function renderEnvases() {
      var tb = document.getElementById('envPendTbody'); if (!tb) return;
      var t = hoy(), lista = saldosEnvases();
      var activos = ENV.movs.filter(function (m) { return !m.anulado; });
      var pend = lista.filter(function (r) { return r.pend > 0; });
      var clientes = {}; pend.forEach(function (r) { clientes[r.cliente] = 1; });
      var kp = document.getElementById('envKpis');
      if (kp) {
        var card = function (cls, ico, label, val) { return '<div class="kpi-card ' + cls + '"><div class="kpi-icon">' + ico + '</div><div class="kpi-label">' + label + '</div><div class="kpi-value">' + val + '</div></div>'; };
        var hoyP = activos.filter(function (m) { return m.fecha === t && m.tipo === 'PRESTAMO'; }).reduce(function (a, m) { return a + (Number(m.cantidad) || 0); }, 0);
        var hoyD = activos.filter(function (m) { return m.fecha === t && m.tipo === 'DEVOLUCION'; }).reduce(function (a, m) { return a + (Number(m.cantidad) || 0); }, 0);
        kp.innerHTML = card('navy', '👥', 'Clientes con pendientes', Object.keys(clientes).length) +
          card('red', '♻', 'Envases por recuperar', num(pend.reduce(function (a, r) { return a + r.pend; }, 0))) +
          card('blue', '↗', 'Prestados hoy', num(hoyP)) + card('teal', '↙', 'Recuperados hoy', num(hoyD));
      }
      var sel = document.getElementById('envFiltroAsesor');
      if (sel) {
        var rutas = {}; ENV.movs.forEach(function (m) { if (m.empleado) rutas[m.empleado] = 1; });
        var v = ENV.filtroAsesor;
        sel.innerHTML = '<option value="">Todos los asesores</option>' + Object.keys(rutas).sort().map(function (r) { return '<option value="' + esc(r) + '"' + (r === v ? ' selected' : '') + '>' + esc(nombreAsesor(r)) + '</option>'; }).join('');
      }
      var vis = pend.filter(function (r) {
        return (!ENV.filtroAsesor || r.asesores[ENV.filtroAsesor]) && (!ENV.q || r.cliente.toUpperCase().indexOf(ENV.q) >= 0);
      }).sort(function (a, b) { return (a.primer || '').localeCompare(b.primer || '') || a.cliente.localeCompare(b.cliente); });
      tb.innerHTML = vis.length ? vis.map(function (r) {
        return '<tr><td style="font-weight:700">' + esc(r.cliente) + '</td><td>' + esc(r.telefono || '-') + '</td><td>' + esc(r.asesor.split(', ').map(nombreAsesor).join(', ')) + '</td><td>' + esc(r.envase) +
          '</td><td style="text-align:right">' + num(r.prest) + '</td><td style="text-align:right">' + num(r.dev) + '</td><td style="text-align:right;font-weight:800;color:#dc2626">' + num(r.pend) + '</td><td>' + fmt(r.primer) + '</td></tr>';
      }).join('') : '<tr><td colspan="8" style="color:var(--muted);font-style:italic">No hay clientes con envases pendientes.</td></tr>';
      if (ENV.verHist) {
        var ht = document.getElementById('envHistTbody');
        var hs = ENV.movs.filter(function (m) { return (!ENV.filtroAsesor || m.empleado === ENV.filtroAsesor) && (!ENV.q || String(m.cliente || '').toUpperCase().indexOf(ENV.q) >= 0); })
          .sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || '') || ms(b) - ms(a); }).slice(0, 200);
        ht.innerHTML = hs.length ? hs.map(function (m) {
          return '<tr style="' + (m.anulado ? 'opacity:.45;text-decoration:line-through' : '') + '"><td>' + fmt(m.fecha) + '</td><td>' + esc(nombreAsesor(m.empleado)) + '</td><td>' + esc(m.cliente) + '</td><td>' +
            (m.tipo === 'PRESTAMO' ? '↗ Préstamo' : '↙ Devolución') + '</td><td>' + esc(m.envase) + '</td><td style="text-align:right">' + num(m.cantidad) + '</td><td>' +
            (m.anulado ? 'Anulado' : '<button class="env-btn" style="padding:3px 9px;font-size:12px" onclick="_envAnularRegistro(\'' + m._id + '\')">Anular</button>') + '</td></tr>';
        }).join('') : '<tr><td colspan="7" style="color:var(--muted);font-style:italic">Sin registros.</td></tr>';
      }
    }
    window._envAnularRegistro = function (id) {
      var m = ENV.movs.find(function (x) { return x._id === id; }); if (!m) return;
      var motivo = prompt('Anular ' + (m.tipo === 'PRESTAMO' ? 'préstamo' : 'devolución') + ' de ' + m.cantidad + ' ' + m.envase + ' — ' + m.cliente + '.\nEscribe el motivo:');
      if (motivo === null) return;
      if (!motivo.trim()) { alert('Escribe el motivo.'); return; }
      var quien = (typeof ADMIN_ACTUAL !== 'undefined' && ADMIN_ACTUAL && (ADMIN_ACTUAL.nombre || ADMIN_ACTUAL.uid)) || ROL_ACTUAL;
      db.collection('envasesPrestamos').doc(id).update({
        anulado: true, motivoAnulacion: motivo.trim().toUpperCase(), anuladoPor: String(quien), anuladoEn: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(function (e) { alert('❌ No se pudo anular: ' + e.message); });
    };

    /* ── 3. Cuadre del camión ── */
    function cargarCuadre(fecha, forzar) {
      if (!esStaffDash()) return;
      if (!forzar && CUA.cache[fecha]) { renderCuadre(); return; }
      CUA.cargando = true; CUA.error = ''; renderCuadre();
      Promise.all([
        db.collection('pedidos').where('fecha', '==', fecha).get(),
        db.collection('bodMovimientos').where('fecha', '==', fecha).get(),
        db.collection('envasesPrestamos').where('fecha', '==', fecha).get()
      ]).then(function (r) {
        CUA.cache[fecha] = { pedidos: r[0].docs.map(function (d) { return d.data(); }), bod: r[1].docs.map(function (d) { return d.data(); }), env: r[2].docs.map(function (d) { return d.data(); }) };
        CUA.cargando = false; renderCuadre();
      }).catch(function (e) {
        console.error(e); CUA.cargando = false;
        CUA.error = e.code === 'permission-denied' ? 'Sin permiso para leer los datos. Revisa que las reglas de Firestore nuevas estén publicadas.' : (e.message || 'Error al cargar');
        renderCuadre();
      });
    }
    function renderCuadre() {
      var cont = document.getElementById('cuaCuerpo'); if (!cont) return;
      if (!CUA.fecha) CUA.fecha = hoy();
      var inp = document.getElementById('cuaFecha'); if (inp && inp.value !== CUA.fecha) inp.value = CUA.fecha;
      if (CUA.cargando) { cont.innerHTML = '<div style="color:var(--muted)">Cargando…</div>'; return; }
      if (CUA.error) { cont.innerHTML = '<div style="color:#dc2626;font-weight:700">' + esc(CUA.error) + '</div>'; return; }
      var d = CUA.cache[CUA.fecha]; if (!d) { cargarCuadre(CUA.fecha); return; }
      var R = {};
      function A(r) { return R[r] = R[r] || { prod: {}, env: {}, pedidos: 0 }; }
      function P(r, n) { var a = A(r).prod; return a[n] = a[n] || { carga: 0, vend: 0, dev: 0 }; }
      function V(r, n) { var a = A(r).env; return a[n] = a[n] || { prest: 0, recup: 0, entreg: 0 }; }
      d.bod.filter(function (m) { return !m.anulado && m.ruta; }).forEach(function (m) {
        (m.items || []).forEach(function (it) {
          var q = Number(it.cantidad) || 0;
          if (m.etapa === 'CARGA') P(m.ruta, it.nombre).carga += q;
          if (m.etapa === 'DEVOLUCION') P(m.ruta, it.nombre).dev += q;
          if (m.etapa === 'RETORNO_ENVASE') V(m.ruta, it.nombre).entreg += q;
        });
      });
      d.pedidos.forEach(function (p) {
        if (!p.empleado) return; A(p.empleado).pedidos++;
        (p.productos || []).forEach(function (x) {
          P(p.empleado, x.nombre).vend += Number(x.cantidad) || 0;
          (x.regalias || []).forEach(function (g) { P(p.empleado, g.nombre).vend += Number(g.cantidad) || 0; });
        });
      });
      d.env.filter(function (e) { return !e.anulado && e.empleado; }).forEach(function (e) {
        if (e.tipo === 'PRESTAMO') V(e.empleado, e.envase).prest += Number(e.cantidad) || 0;
        if (e.tipo === 'DEVOLUCION') V(e.empleado, e.envase).recup += Number(e.cantidad) || 0;
      });
      var dif = function (n) {
        return n === 0 ? '<span class="env-bad env-ok">✓ cuadra</span>' : n < 0 ? '<span class="env-bad env-falta">faltan ' + num(-n) + '</span>' : '<span class="env-bad env-sobra">sobran ' + num(n) + '</span>';
      };
      var rutas = Object.keys(R).sort(), malas = 0;
      var html = rutas.map(function (r) {
        var a = R[r];
        var prods = Object.keys(a.prod).filter(function (n) { var x = a.prod[n]; return x.carga || x.vend || x.dev; }).sort();
        var envs = Object.keys(a.env).filter(function (n) { var x = a.env[n]; return x.prest || x.recup || x.entreg; }).sort();
        prods.forEach(function (n) { var x = a.prod[n]; if (x.dev - (x.carga - x.vend) !== 0) malas++; });
        envs.forEach(function (n) { var x = a.env[n]; if (x.entreg - x.recup !== 0) malas++; });
        return '<div class="env-ruta">' + esc(r) + ' <span style="font-weight:600;font-size:12px;color:var(--muted)">· ' + a.pedidos + ' pedido(s)</span></div>' +
          (prods.length ? '<div style="overflow-x:auto"><table class="cierre-prod-table"><thead><tr><th style="text-align:left">Producto</th><th style="text-align:right">Cargado</th><th style="text-align:right">Vendido*</th><th style="text-align:right">Debe regresar</th><th style="text-align:right">Devolvió</th><th style="text-align:left">Resultado</th></tr></thead><tbody>' +
            prods.map(function (n) { var x = a.prod[n], debe = x.carga - x.vend;
              return '<tr><td style="font-weight:700">' + esc(n) + '</td><td style="text-align:right">' + num(x.carga) + '</td><td style="text-align:right">' + num(x.vend) + '</td><td style="text-align:right">' + num(debe) + '</td><td style="text-align:right">' + num(x.dev) + '</td><td>' + dif(x.dev - debe) + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : '') +
          (envs.length ? '<div style="overflow-x:auto;margin-top:8px"><table class="cierre-prod-table"><thead><tr><th style="text-align:left">♻ Envase prestado</th><th style="text-align:right">Prestó</th><th style="text-align:right">Recuperó de clientes</th><th style="text-align:right">Entregó en bodega</th><th style="text-align:left">Resultado</th></tr></thead><tbody>' +
            envs.map(function (n) { var x = a.env[n];
              return '<tr><td style="font-weight:700">' + esc(n) + '</td><td style="text-align:right">' + num(x.prest) + '</td><td style="text-align:right">' + num(x.recup) + '</td><td style="text-align:right">' + num(x.entreg) + '</td><td>' + dif(x.entreg - x.recup) + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : '');
      }).join('');
      cont.innerHTML = rutas.length
        ? '<div style="font-weight:800;margin-bottom:6px;color:' + (malas ? '#b45309' : '#059669') + '">' + (malas ? '⚠ ' + malas + ' línea(s) no cuadran ese día.' : '✓ Todo cuadra ese día.') + '</div>' + html
        : '<div style="color:var(--muted);font-style:italic">No hay cargas, ventas ni envases registrados el ' + fmt(CUA.fecha) + '.</div>';
    }

    /* ── 4. Engancha el cambio de sección (sin tocar switchSeccionDash) ── */
    if (typeof switchSeccionDash === 'function') {
      var _switchOriginal = switchSeccionDash;
      switchSeccionDash = function (sec) {
        var r = _switchOriginal.apply(this, arguments);
        try {
          if (sec === 'envasesPrestados') { iniciarListenerEnvases(); renderEnvases(); }
          if (sec === 'cuadreCamion') { renderCuadre(); }
        } catch (e) { console.warn(e); }
        return r;
      };
    }
    if (typeof auth !== 'undefined' && auth.onAuthStateChanged) {
      auth.onAuthStateChanged(function (u) {
        if (!u) { if (ENV.unsub) { try { ENV.unsub(); } catch (e) {} } ENV.unsub = null; ENV.movs = []; CUA.cache = {}; }
      });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', crearMenuYSecciones);
    else crearMenuYSecciones();
  } catch (err) { console.warn('Módulo Envases/Cuadre no se pudo iniciar:', err); }
})();
