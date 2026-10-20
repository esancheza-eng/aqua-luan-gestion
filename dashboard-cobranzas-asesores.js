/* ══════════════════════════════════════════════════════════════════════
   AQUA LUAN — DASHBOARD · Consulta Cobranzas por Asesor
   ══════════════════════════════════════════════════════════════════════
   Archivo NUEVO. No modifica nada de dashboard.js ni de "Consulta Cobranzas":
   solo agrega una sección al menú y LEE los mismos datos.

   - Usa el MISMO histórico completo que Consulta Cobranzas (_cobPedidosHist /
     _cobPagosHist, mismo listener _iniciarListenerCobranzasHist) y las MISMAS
     fórmulas: _creditoDePedido, _pagadoEnVentaPedido y _normNombreCliente.
   - [CAMBIO 2026-10-20] ASESOR PRINCIPAL POR CLIENTE (deuda por ruta):
     cada cliente pertenece a UN solo asesor (su ruta) y TODA su deuda y TODOS
     sus cobros se suman a ese asesor, aunque lo haya atendido o cobrado otro.
     Ej.: Washington es de Wilson; si Jefferson le vendió o le cobró, la deuda
     sigue con Wilson. El principal se calcula solo, en cada actualización:
       1) el asesor con MÁS pedidos a ese cliente;
       2) si empatan, el que lo atendió MÁS recientemente;
       3) si el cliente no tiene pedidos (solo pagos), el que más le cobró.
     Cada pedido y cada pago se cuentan una sola vez, así que la suma de todos
     los asesores CUADRA con el total de Consulta Cobranzas (Todos).
   - En el detalle se ve qué asesor atendió/cobró cada movimiento.
   Visible para Administrador y Secretaria (igual que Consulta Cobranzas).
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  try {
    var SEC = 'cobranzasAsesores';
    var EST = { filas: [], porKey: {}, seleccion: new Set(), filtroPrev: null };

    function esc(s) { return (typeof escHTML === 'function') ? escHTML(s) : String(s == null ? '' : s); }
    function norm(n) { return (typeof _normNombreCliente === 'function') ? _normNombreCliente(n) : String(n || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
    function sinTildes(s) { return (typeof _sinTildesBusq === 'function') ? _sinTildesBusq(s) : String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    function corto(a) { if (!a) return 'Sin asesor'; return String(a).split(':')[1] ? String(a).split(':')[1].trim() : String(a); }
    function fmtSaldo(v) {
      if (typeof _fmtSaldoCob === 'function') return _fmtSaldoCob(v);
      return v > 0.004 ? ('$' + v.toFixed(2)) : (v < -0.004 ? ('-$' + Math.abs(v).toFixed(2)) : '$0.00');
    }
    function colorSaldo(v) { return v > 0.004 ? 'var(--red)' : (v < -0.004 ? '#0a7c6e' : 'var(--muted)'); }
    function visible() { var s = document.getElementById('seccion-' + SEC); return !!(s && s.classList.contains('active')); }
    var CTRL = "background:var(--surface2);border:1.5px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;padding:9px 12px;outline:none";

    /* ── 1. Menú y sección (se insertan sin tocar el HTML existente) ── */
    if (typeof SECCIONES_SECRETARIA !== 'undefined' && Array.isArray(SECCIONES_SECRETARIA)) {
      if (SECCIONES_SECRETARIA.indexOf(SEC) < 0) SECCIONES_SECRETARIA.push(SEC);
    }
    function crearMenuYSeccion() {
      var ancla = document.getElementById('navCobranzasClientes');
      var secAncla = document.getElementById('seccion-cobranzasClientes');
      if (!ancla || !secAncla || document.getElementById('navCobranzasAsesores')) return;

      var b = document.createElement('button');
      b.className = 'dash-nav-item'; b.dataset.section = SEC; b.id = 'navCobranzasAsesores';
      b.setAttribute('onclick', "switchSeccionDash('" + SEC + "')");
      b.innerHTML = '<svg class="nav-ico" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v8M21.5 10H18a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-3.5"/></svg>Cobranzas por Asesor';
      ancla.parentNode.insertBefore(b, ancla.nextSibling);

      var s = document.createElement('div');
      s.className = 'dash-section'; s.id = 'seccion-' + SEC;
      s.innerHTML =
        '<div class="table-card" id="cobAsCard">' +
          '<div class="table-header">' +
            '<div class="table-title">💰 Consulta Cobranzas — por Asesor</div>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<span style="font-size:12px;color:var(--muted)" id="cobAsContador">0 clientes</span>' +
              '<button class="btn-filter" style="background:#0f7c38;display:flex;align-items:center;gap:6px" onclick="imprimirCobranzasAsesores()">Imprimir</button>' +
            '</div>' +
          '</div>' +
          '<div style="padding:12px 20px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border)">' +
            'Las mismas deudas y cobros de <b>Consulta Cobranzas</b>, agrupados por el <b>asesor principal</b> de cada cliente (su ruta): toda la deuda y todos los cobros del cliente quedan con ese asesor, aunque lo haya atendido otro. ' +
            'El principal es el asesor con más pedidos al cliente (si empatan, el más reciente). La suma de todos los asesores cuadra con el total de Consulta Cobranzas. Todo el historial (no depende del filtro de fechas).' +
          '</div>' +
          '<div style="padding:14px 20px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--border)">' +
            '<input type="text" id="cobAsBusqueda" placeholder="Buscar cliente, teléfono o asesor..." oninput="renderCobranzasAsesores()" style="flex:1;min-width:240px;' + CTRL + '">' +
            '<select id="cobAsAsesor" onchange="renderCobranzasAsesores()" style="' + CTRL + ';cursor:pointer;min-width:200px"><option value="__todos__">Todos los asesores</option></select>' +
            '<div style="position:relative">' +
              '<button type="button" onclick="toggleFiltroSaldoCobAs(event)" style="' + CTRL + ';cursor:pointer;min-width:230px;display:flex;align-items:center;justify-content:space-between;gap:10px"><span id="cobAsFiltroSaldoTxt">Todos</span><span style="font-size:10px">▼</span></button>' +
              '<div id="cobAsFiltroSaldo" onclick="event.stopPropagation()" style="display:none;position:absolute;right:0;top:calc(100% + 4px);z-index:50;background:var(--surface,#fff);border:1.5px solid var(--border);border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.12);padding:6px 0;min-width:260px;font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;color:var(--text)">' +
                '<label style="display:flex;align-items:center;gap:8px;padding:8px 14px;cursor:pointer"><input type="checkbox" id="cobAsFiltroSaldoTodos" checked onchange="cambiarFiltroSaldoCobAs(this)"> Todos</label>' +
                '<label style="display:flex;align-items:center;gap:8px;padding:8px 14px;cursor:pointer"><input type="checkbox" class="cobas-filtro-saldo" value="con_deuda" onchange="cambiarFiltroSaldoCobAs(this)"> Con saldo pendiente</label>' +
                '<label style="display:flex;align-items:center;gap:8px;padding:8px 14px;cursor:pointer"><input type="checkbox" class="cobas-filtro-saldo" value="al_dia" onchange="cambiarFiltroSaldoCobAs(this)"> Al día (saldo 0)</label>' +
                '<label style="display:flex;align-items:center;gap:8px;padding:8px 14px;cursor:pointer"><input type="checkbox" class="cobas-filtro-saldo" value="sobrepago" onchange="cambiarFiltroSaldoCobAs(this)"> Cobros mayores a la deuda</label>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="padding:1rem 1.25rem 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px" id="cobAsKpis"></div>' +
          '<div style="padding:1rem 1.25rem 0"><div style="font-weight:800;color:var(--navy);margin-bottom:6px">Resumen por asesor</div>' +
            '<div class="table-wrap"><table><thead><tr><th>Asesor principal</th><th style="text-align:right">Clientes</th><th style="text-align:right">Con saldo</th><th style="text-align:right">Ventas</th><th style="text-align:right">Deuda generada</th><th style="text-align:right">Cobros / ingresos</th><th style="text-align:right">Saldo pendiente</th></tr></thead>' +
            '<tbody id="tablaCobAsResumen"></tbody></table></div></div>' +
          '<div class="table-wrap" style="margin-top:1rem">' +
            '<table><thead><tr>' +
              '<th style="width:36px"><input type="checkbox" id="cobAsChkTodos" onclick="toggleTodosCobranzasAsesores(this)" title="Seleccionar todos"></th>' +
              '<th>Cliente</th><th>Teléfono</th><th>Asesor principal</th>' +
              '<th style="text-align:right">Ventas</th><th style="text-align:right">Pagado en venta</th><th style="text-align:right">Deuda generada</th>' +
              '<th style="text-align:right">Cobros / ingresos</th><th style="text-align:right">Saldo pendiente</th><th>Atendido también por</th>' +
            '</tr></thead><tbody id="tablaCobranzasAsesores"></tbody></table>' +
          '</div>' +
          '<div id="cobAsDetalle" style="padding:0 1.25rem 1.25rem"></div>' +
        '</div>';
      secAncla.parentNode.insertBefore(s, secAncla.nextSibling);
    }

    /* ── 2. Datos: mismas fuentes y fórmulas que _datosCobranzasClientes(true) ── */
    function fuentes() {
      var ped = (typeof _cobPedidosHist !== 'undefined' && _cobPedidosHist) ? _cobPedidosHist : ((typeof _pedidosRaw !== 'undefined' && _pedidosRaw) || []);
      var pag = (typeof _cobPagosHist !== 'undefined' && _cobPagosHist) ? _cobPagosHist : ((typeof _pagosRaw !== 'undefined' && _pagosRaw) || []);
      return { ped: ped, pag: pag };
    }
    function msDe(x) { return (x && x.creadoEn && x.creadoEn.toMillis) ? x.creadoEn.toMillis() : 0; }
    /* Fecha en formato AAAA-MM-DD solo para comparar cuál es más reciente (acepta dd/mm/aaaa de datos importados) */
    function isoCmp(x) { return (typeof _isoFechaDash === 'function') ? _isoFechaDash(x && x.fecha, x && x.creadoEn) : String((x && x.fecha) || ''); }
    /* Elige el asesor principal del cliente: más pedidos → más reciente → más cobros */
    function elegirPrincipal(porAsesor) {
      var lista = Object.keys(porAsesor).map(function (a) { return porAsesor[a]; });
      var conPedidos = lista.filter(function (x) { return x.pedidos > 0; });
      if (conPedidos.length) {
        conPedidos.sort(function (a, b) {
          return (b.pedidos - a.pedidos) ||
            String(b.ultFechaPed).localeCompare(String(a.ultFechaPed)) ||
            (b.ultMsPed - a.ultMsPed) ||
            (a.asesor ? 0 : 1) - (b.asesor ? 0 : 1);
        });
        return conPedidos[0].asesor;
      }
      lista.sort(function (a, b) {
        return (b.cobros - a.cobros) ||
          String(b.ultFechaPag).localeCompare(String(a.ultFechaPag)) ||
          (b.ultMsPag - a.ultMsPag);
      });
      return lista.length ? lista[0].asesor : '';
    }
    function datos() {
      var f = fuentes();
      var cli = {};
      function asegurar(nombre) {
        var ck = norm(nombre) || 'sin-nombre';
        if (!cli[ck]) cli[ck] = { ck: ck, nombre: nombre || 'Sin nombre', telefono: '', ventas: 0, pagadoVenta: 0, deuda: 0, cobros: 0, pedidos: 0, ingresos: [], deudas: [], porAsesor: {} };
        return cli[ck];
      }
      function stat(c, asesor) {
        var a = asesor || '';
        if (!c.porAsesor[a]) c.porAsesor[a] = { asesor: a, pedidos: 0, deuda: 0, cobros: 0, ultFechaPed: '', ultMsPed: 0, ultFechaPag: '', ultMsPag: 0 };
        return c.porAsesor[a];
      }
      f.ped.forEach(function (p) {
        var c = asegurar(p.cliente);
        var st = stat(c, p.empleado);
        var tot = parseFloat(p.total) || 0;
        var cred = _creditoDePedido(p);
        var ms = msDe(p), fe = p.fecha || '', fc = isoCmp(p);
        c.ventas += tot;
        c.pagadoVenta += _pagadoEnVentaPedido(p);
        c.deuda += cred;
        c.pedidos += 1;
        if (cred > 0.004) c.deudas.push({ fecha: fe, total: tot, credito: cred, ms: ms, asesor: p.empleado || '' });
        if (p.telefono) c.telefono = p.telefono;
        st.pedidos += 1; st.deuda += cred;
        if (fc > st.ultFechaPed || (fc === st.ultFechaPed && ms > st.ultMsPed)) { st.ultFechaPed = fc; st.ultMsPed = ms; }
      });
      f.pag.forEach(function (pg) {
        var c = asegurar(pg.cliente || 'Sin nombre');
        var st = stat(c, pg.empleado);
        var monto = parseFloat(pg.monto) || 0;
        var ms = msDe(pg), fe = pg.fecha || '', fc = isoCmp(pg);
        c.cobros += monto;
        c.ingresos.push({ fecha: fe, monto: monto, forma: pg.forma || '', notas: pg.notas || '', ms: ms, asesor: pg.empleado || '' });
        st.cobros += monto;
        if (fc > st.ultFechaPag || (fc === st.ultFechaPag && ms > st.ultMsPag)) { st.ultFechaPag = fc; st.ultMsPag = ms; }
      });
      var filas = Object.keys(cli).map(function (ck) {
        var c = cli[ck];
        c.asesor = elegirPrincipal(c.porAsesor);
        c.asesorCorto = corto(c.asesor);
        c.key = c.asesor + '||' + ck;
        c.saldo = c.deuda - c.cobros;
        c.saldoCliente = c.saldo;
        c.otrosAsesores = Object.keys(c.porAsesor).filter(function (a) { return a !== c.asesor; });
        return c;
      });
      return { filas: filas, clientes: cli };
    }
    function agruparPorAsesor(rows) {
      var g = {};
      rows.forEach(function (c) {
        if (!g[c.asesor]) g[c.asesor] = { asesor: c.asesor, asesorCorto: c.asesorCorto, filas: [], ventas: 0, pagadoVenta: 0, deuda: 0, cobros: 0, saldo: 0, conSaldo: 0 };
        var x = g[c.asesor];
        x.filas.push(c); x.ventas += c.ventas; x.pagadoVenta += c.pagadoVenta; x.deuda += c.deuda; x.cobros += c.cobros; x.saldo += c.saldo;
        if (c.saldo > 0.004) x.conSaldo += 1;
      });
      var lista = Object.keys(g).map(function (k) { return g[k]; });
      lista.forEach(function (x) { x.filas.sort(function (a, b) { return b.saldo - a.saldo || a.nombre.localeCompare(b.nombre, 'es'); }); });
      lista.sort(function (a, b) {
        if (!a.asesor && b.asesor) return 1;
        if (a.asesor && !b.asesor) return -1;
        return a.asesorCorto.localeCompare(b.asesorCorto, 'es');
      });
      return lista;
    }

    /* ── 3. Filtros (mismo comportamiento que Consulta Cobranzas) ── */
    function filtrosSaldo() {
      return Array.prototype.slice.call(document.querySelectorAll('#cobAsFiltroSaldo .cobas-filtro-saldo:checked')).map(function (x) { return x.value; });
    }
    function aplicarFiltroSaldo(rows, sel) {
      if (!sel.length) return rows;
      return rows.filter(function (c) {
        return (sel.indexOf('con_deuda') >= 0 && c.saldo > 0.004) ||
               (sel.indexOf('al_dia') >= 0 && Math.abs(c.saldo) <= 0.004) ||
               (sel.indexOf('sobrepago') >= 0 && c.saldo < -0.004);
      });
    }
    function etiquetaFiltroSaldo() {
      var nombres = { con_deuda: 'Con saldo pendiente', al_dia: 'Al día (saldo 0)', sobrepago: 'Cobros mayores a la deuda' };
      var sel = filtrosSaldo();
      return sel.length ? sel.map(function (v) { return nombres[v] || v; }).join(' + ') : 'Todos';
    }
    function asesorSel() { var el = document.getElementById('cobAsAsesor'); return el ? el.value : '__todos__'; }
    function poblarSelectAsesores(filas) {
      var sel = document.getElementById('cobAsAsesor');
      if (!sel) return;
      var set = {};
      filas.forEach(function (c) { set[c.asesor] = 1; });
      if (typeof _asesoresCache !== 'undefined' && Array.isArray(_asesoresCache)) _asesoresCache.forEach(function (r) { set[r] = 1; });
      var lista = Object.keys(set).sort(function (a, b) {
        if (!a) return 1; if (!b) return -1;
        return corto(a).localeCompare(corto(b), 'es');
      });
      var actual = sel.value;
      var html = '<option value="__todos__">Todos los asesores</option>' + lista.map(function (a) { return '<option value="' + esc(a) + '">' + esc(corto(a)) + '</option>'; }).join('');
      if (sel.innerHTML !== html) {
        sel.innerHTML = html;
        sel.value = (actual === '__todos__' || lista.indexOf(actual) >= 0) ? actual : '__todos__';
      }
    }
    function filasFiltradas(base) {
      var q = norm((document.getElementById('cobAsBusqueda') || {}).value || '');
      var a = asesorSel();
      var rows = base;
      if (a !== '__todos__') rows = rows.filter(function (c) { return c.asesor === a; });
      if (q) {
        var qB = sinTildes(q);
        rows = rows.filter(function (c) {
          return sinTildes(norm(c.nombre)).indexOf(qB) >= 0 || norm(c.telefono).indexOf(q) >= 0 || sinTildes(norm(c.asesorCorto)).indexOf(qB) >= 0 ||
            c.otrosAsesores.some(function (o) { return sinTildes(norm(corto(o))).indexOf(qB) >= 0; });
        });
      }
      return { rows: aplicarFiltroSaldo(rows, filtrosSaldo()), q: q, a: a };
    }

    /* ── 4. Render ── */
    function totales(rows) {
      return rows.reduce(function (t, c) { t.ventas += c.ventas; t.pagadoVenta += c.pagadoVenta; t.deuda += c.deuda; t.cobros += c.cobros; t.saldo += c.saldo; return t; },
        { ventas: 0, pagadoVenta: 0, deuda: 0, cobros: 0, saldo: 0 });
    }
    function saldoClientesUnicos(rows, clientes) {
      var vistos = {}, s = 0;
      rows.forEach(function (c) { if (!vistos[c.ck]) { vistos[c.ck] = 1; s += clientes[c.ck] ? (clientes[c.ck].deuda - clientes[c.ck].cobros) : 0; } });
      return { saldo: s, n: Object.keys(vistos).length };
    }
    var _ultimoClientes = {};
    function render() {
      var tbody = document.getElementById('tablaCobranzasAsesores');
      var kpis = document.getElementById('cobAsKpis');
      var cont = document.getElementById('cobAsContador');
      var resumen = document.getElementById('tablaCobAsResumen');
      if (!tbody) return;
      if (typeof _cobranzasHistCargando === 'function' && _cobranzasHistCargando()) {
        if (cont) cont.textContent = 'Cargando…';
        if (kpis) kpis.innerHTML = '';
        if (resumen) resumen.innerHTML = '';
        tbody.innerHTML = '<tr><td colspan="10"><div class="loading" style="padding:18px 8px"><div class="spinner"></div><span>Cargando todas las deudas del historial…</span></div></td></tr>';
        return;
      }
      var d = datos();
      _ultimoClientes = d.clientes;
      poblarSelectAsesores(d.filas);
      var ff = filasFiltradas(d.filas);
      var grupos = agruparPorAsesor(ff.rows);
      var rows = [];
      grupos.forEach(function (g) { rows = rows.concat(g.filas); });
      EST.filas = rows;
      EST.porKey = {};
      d.filas.forEach(function (c) { EST.porKey[c.key] = c; });

      var t = totales(rows);
      var totSaldoPos = rows.reduce(function (s, c) { return s + Math.max(0, c.saldo); }, 0);
      var nPend = rows.filter(function (c) { return c.saldo > 0.004; }).length;
      var dif = t.deuda - t.cobros;
      var uni = saldoClientesUnicos(rows, d.clientes);
      if (cont) cont.textContent = uni.n + ' cliente(s) · ' + grupos.length + ' asesor(es)';
      if (kpis) {
        kpis.innerHTML =
          '<div class="kpi-card navy"><div class="kpi-label">Asesores</div><div class="kpi-value">' + grupos.length + '</div><div class="kpi-sub">' + uni.n + ' cliente(s) · ' + nPend + ' con saldo</div></div>' +
          '<div class="kpi-card orange"><div class="kpi-label">Deuda generada</div><div class="kpi-value">$' + t.deuda.toFixed(2) + '</div><div class="kpi-sub">crédito al vender</div></div>' +
          '<div class="kpi-card teal"><div class="kpi-label">Cobros / ingresos</div><div class="kpi-value">$' + t.cobros.toFixed(2) + '</div><div class="kpi-sub">pagos del cliente</div></div>' +
          '<div class="kpi-card red"><div class="kpi-label">Saldo pendiente</div><div class="kpi-value">$' + totSaldoPos.toFixed(2) + '</div><div class="kpi-sub">deuda − cobros (&gt;0)</div></div>' +
          '<div class="kpi-card navy"><div class="kpi-label">Diferencia de saldos</div><div class="kpi-value" style="color:' + colorSaldo(dif) + '">' + fmtSaldo(dif) + '</div><div class="kpi-sub">deuda generada − cobros</div></div>';
      }
      if (resumen) {
        var td = 'padding:10px;border-top:2px solid var(--navy,#1a3a5c);background:var(--surface2);font-weight:800';
        resumen.innerHTML = grupos.length ? grupos.map(function (g) {
          return '<tr style="cursor:pointer" data-a="' + esc(g.asesor) + '" onclick="filtrarCobranzasAsesor(this.getAttribute(\'data-a\'))">' +
            '<td style="font-weight:700">' + esc(g.asesorCorto) + '</td>' +
            '<td style="text-align:right">' + g.filas.length + '</td>' +
            '<td style="text-align:right">' + g.conSaldo + '</td>' +
            '<td style="text-align:right">$' + g.ventas.toFixed(2) + '</td>' +
            '<td style="text-align:right;font-weight:700">$' + g.deuda.toFixed(2) + '</td>' +
            '<td style="text-align:right;color:var(--teal);font-weight:700">$' + g.cobros.toFixed(2) + '</td>' +
            '<td style="text-align:right;font-weight:800;color:' + colorSaldo(g.saldo) + '">' + fmtSaldo(g.saldo) + '</td></tr>';
        }).join('') +
          '<tr><td style="' + td + '">TOTAL</td><td style="' + td + ';text-align:right">' + rows.length + '</td><td style="' + td + ';text-align:right">' + nPend + '</td>' +
          '<td style="' + td + ';text-align:right">$' + t.ventas.toFixed(2) + '</td><td style="' + td + ';text-align:right">$' + t.deuda.toFixed(2) + '</td>' +
          '<td style="' + td + ';text-align:right;color:var(--teal)">$' + t.cobros.toFixed(2) + '</td><td style="' + td + ';text-align:right;color:' + colorSaldo(t.saldo) + '">' + fmtSaldo(t.saldo) + '</td></tr>'
          : '<tr><td colspan="7" style="color:var(--muted);font-style:italic">Sin datos</td></tr>';
      }
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div class="icon">💰</div>No hay cobranzas registradas</div></td></tr>';
        return;
      }
      /* Paginación de 100 (la común del Dashboard): al cambiar filtros vuelve a la página 1 */
      var firma = ff.q + '|' + ff.a + '|' + filtrosSaldo().join(',');
      if (EST.filtroPrev !== null && EST.filtroPrev !== firma && typeof _paginasTablas !== 'undefined') _paginasTablas[SEC] = 1;
      EST.filtroPrev = firma;
      var pg = _paginarTabla(SEC, rows);
      var subt = {};
      grupos.forEach(function (g) { subt[g.asesor] = g; });
      var html = '', ultimo = null;
      pg.items.forEach(function (c, i) {
        if (c.asesor !== ultimo) {
          var g = subt[c.asesor];
          html += '<tr class="cobas-grupo"><td colspan="10" style="background:var(--surface2);font-weight:800;color:var(--navy);padding:10px">' +
            '👤 ' + esc(g.asesorCorto) + ' · ' + g.filas.length + ' cliente(s) · deuda $' + g.deuda.toFixed(2) + ' · cobros $' + g.cobros.toFixed(2) +
            ' · saldo <span style="color:' + colorSaldo(g.saldo) + '">' + fmtSaldo(g.saldo) + '</span></td></tr>';
          ultimo = c.asesor;
        }
        var kEsc = esc(c.key);
        var chk = EST.seleccion.has(c.key) ? 'checked' : '';
        var otros = c.otrosAsesores.length ? ' <span title="También lo atendieron: ' + esc(c.otrosAsesores.map(corto).join(', ')) + '" style="font-size:11px;color:#b45309">⇄</span>' : '';
        var otrosTxt = c.otrosAsesores.length ? c.otrosAsesores.map(corto).join(', ') : '—';
        html += '<tr style="cursor:pointer" data-k="' + kEsc + '" onclick="verDetalleCobranzaAsesor(this.getAttribute(\'data-k\'))">' +
          '<td onclick="event.stopPropagation()"><input type="checkbox" class="cobas-chk" data-k="' + kEsc + '" ' + chk + ' onchange="toggleCobranzaAsesorSeleccion(this)"></td>' +
          '<td style="font-weight:700">' + esc(c.nombre) + otros + '</td>' +
          '<td style="color:var(--muted)">' + esc(c.telefono || '—') + '</td>' +
          '<td>' + esc(c.asesorCorto) + '</td>' +
          '<td style="text-align:right">$' + c.ventas.toFixed(2) + '</td>' +
          '<td style="text-align:right">$' + c.pagadoVenta.toFixed(2) + '</td>' +
          '<td style="text-align:right;font-weight:700">$' + c.deuda.toFixed(2) + '</td>' +
          '<td style="text-align:right;color:var(--teal);font-weight:700">$' + c.cobros.toFixed(2) + '</td>' +
          '<td style="text-align:right;font-weight:800;color:' + colorSaldo(c.saldo) + '">' + fmtSaldo(c.saldo) + '</td>' +
          '<td style="font-size:12px;color:' + (c.otrosAsesores.length ? '#b45309' : 'var(--muted)') + '">' + esc(otrosTxt) + '</td>' +
        '</tr>';
        var sig = pg.items[i + 1];
        var finGrupo = !sig || sig.asesor !== c.asesor;
        var ultimoDelGrupo = finGrupo && (subt[c.asesor].filas[subt[c.asesor].filas.length - 1] === c);
        if (ultimoDelGrupo) html += filaSubtotal(subt[c.asesor]);
      });
      var tdT = 'padding:12px 10px;border-top:2px solid var(--navy,#1a3a5c);background:var(--surface2);font-weight:800';
      html += '<tr class="cob-total-row">' +
        '<td style="' + tdT + '"></td><td style="' + tdT + '" colspan="3">TOTAL (' + uni.n + ' cliente' + (uni.n === 1 ? '' : 's') + ' · ' + grupos.length + ' asesor' + (grupos.length === 1 ? '' : 'es') + ')</td>' +
        '<td style="' + tdT + ';text-align:right">$' + t.ventas.toFixed(2) + '</td>' +
        '<td style="' + tdT + ';text-align:right">$' + t.pagadoVenta.toFixed(2) + '</td>' +
        '<td style="' + tdT + ';text-align:right">$' + t.deuda.toFixed(2) + '</td>' +
        '<td style="' + tdT + ';text-align:right;color:var(--teal)">$' + t.cobros.toFixed(2) + '</td>' +
        '<td style="' + tdT + ';text-align:right;color:' + colorSaldo(t.saldo) + '">' + fmtSaldo(t.saldo) + '</td>' +
        '<td style="' + tdT + '"></td>' +
      '</tr>';
      tbody.innerHTML = html + _htmlPaginadorTabla(SEC, pg, 10, 'renderCobranzasAsesores');
    }
    function filaSubtotal(g) {
      var td = 'padding:9px 10px;border-top:1px solid var(--border);font-weight:800;color:var(--navy)';
      return '<tr class="cobas-subtotal"><td style="' + td + '"></td><td style="' + td + '" colspan="3">Subtotal ' + esc(g.asesorCorto) + ' (' + g.filas.length + ')</td>' +
        '<td style="' + td + ';text-align:right">$' + g.ventas.toFixed(2) + '</td>' +
        '<td style="' + td + ';text-align:right">$' + g.pagadoVenta.toFixed(2) + '</td>' +
        '<td style="' + td + ';text-align:right">$' + g.deuda.toFixed(2) + '</td>' +
        '<td style="' + td + ';text-align:right;color:var(--teal)">$' + g.cobros.toFixed(2) + '</td>' +
        '<td style="' + td + ';text-align:right;color:' + colorSaldo(g.saldo) + '">' + fmtSaldo(g.saldo) + '</td>' +
        '<td style="' + td + '"></td></tr>';
    }

    /* ── 5. Detalle del cruce cliente ↔ asesor ── */
    function verDetalle(key) {
      var c = EST.porKey[key];
      var box = document.getElementById('cobAsDetalle');
      if (!box || !c) return;
      function quien(a) {
        return a === c.asesor ? esc(corto(a)) : '<span style="color:#b45309;font-weight:700">' + esc(corto(a)) + '</span>';
      }
      var deudas = c.deudas.length
        ? c.deudas.slice().sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)) || a.ms - b.ms; }).map(function (x) {
            return '<tr><td>' + esc(x.fecha || '—') + '</td><td>' + quien(x.asesor) + '</td><td style="text-align:right">$' + x.total.toFixed(2) + '</td><td style="text-align:right;font-weight:700">$' + x.credito.toFixed(2) + '</td></tr>';
          }).join('')
        : '<tr><td colspan="4" style="color:#888;font-style:italic">Este cliente no tiene ventas a crédito.</td></tr>';
      var ingresos = c.ingresos.length
        ? c.ingresos.slice().sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)) || a.ms - b.ms; }).map(function (i) {
            return '<tr><td>' + esc(i.fecha || '—') + '</td><td>' + quien(i.asesor) + '</td><td>' + esc(i.forma || '—') + '</td><td style="text-align:right">$' + (Number(i.monto) || 0).toFixed(2) + '</td><td>' + esc(i.notas || '') + '</td></tr>';
          }).join('')
        : '<tr><td colspan="5" style="color:#888;font-style:italic">Sin cobros registrados en Pagos para este cliente.</td></tr>';
      var resumenAs = Object.keys(c.porAsesor).map(function (a) { return c.porAsesor[a]; })
        .sort(function (a, b) { return (a.asesor === c.asesor ? -1 : 0) - (b.asesor === c.asesor ? -1 : 0) || b.pedidos - a.pedidos; })
        .map(function (x) {
          return '<tr><td>' + quien(x.asesor) + (x.asesor === c.asesor ? ' <b style="color:var(--teal)">(principal)</b>' : '') + '</td>' +
            '<td style="text-align:right">' + x.pedidos + '</td><td style="text-align:right">$' + x.deuda.toFixed(2) + '</td><td style="text-align:right">$' + x.cobros.toFixed(2) + '</td></tr>';
        }).join('');
      var nota = c.otrosAsesores.length
        ? '<div style="padding:10px 14px;font-size:12px;color:#b45309;border-top:1px solid var(--border)">⇄ También lo atendieron: <b>' + esc(c.otrosAsesores.map(corto).join(', ')) +
          '</b>. Todo lo que vendieron o cobraron se suma a <b>' + esc(c.asesorCorto) + '</b>, que es el asesor principal de este cliente.</div>'
        : '';
      box.innerHTML = '<div style="margin-top:16px;border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
        '<div style="padding:10px 14px;background:var(--surface2);font-weight:800;color:var(--navy)">' + esc(c.nombre) + ' — asesor principal ' + esc(c.asesorCorto) + ' · deuda $' + c.deuda.toFixed(2) + ' vs cobros $' + c.cobros.toFixed(2) + ' · saldo ' + fmtSaldo(c.saldo) + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Asesor que lo atendió</th><th style="text-align:right">Pedidos</th><th style="text-align:right">Crédito que generó</th><th style="text-align:right">Cobró</th></tr></thead><tbody>' + resumenAs + '</tbody></table></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Fecha venta a crédito</th><th>Vendió</th><th style="text-align:right">Total venta</th><th style="text-align:right">Crédito</th></tr></thead><tbody>' + deudas + '</tbody></table></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Fecha cobro</th><th>Cobró</th><th>Forma</th><th style="text-align:right">Monto</th><th>Notas</th></tr></thead><tbody>' + ingresos + '</tbody></table></div>' +
        nota + '</div>';
      if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* ── 6. Selección e impresión (igual que Consulta Cobranzas) ── */
    function imprimir() {
      if (!EST.seleccion.size) { alert('Selecciona uno o más clientes para imprimir.'); return; }
      var d = datos();
      var ff = filasFiltradas(d.filas);
      var rows = ff.rows.filter(function (c) { return EST.seleccion.has(c.key); });
      if (!rows.length) { alert('No hay filas seleccionadas visibles para imprimir.'); return; }
      var grupos = agruparPorAsesor(rows);
      var t = totales(rows);
      var uni = saldoClientesUnicos(rows, d.clientes);
      var cuerpo = grupos.map(function (g) {
        return '<tr class="grupo"><td colspan="9">' + esc(g.asesorCorto) + '</td></tr>' +
          g.filas.map(function (c) {
            return '<tr><td>' + esc(c.nombre) + '</td><td>' + esc(c.telefono || '—') + '</td>' +
              '<td style="text-align:right">$' + c.ventas.toFixed(2) + '</td><td style="text-align:right">$' + c.pagadoVenta.toFixed(2) + '</td>' +
              '<td style="text-align:right">$' + c.deuda.toFixed(2) + '</td><td style="text-align:right">$' + c.cobros.toFixed(2) + '</td>' +
              '<td style="text-align:right">' + fmtSaldo(c.saldo) + '</td><td>' + esc(c.otrosAsesores.length ? c.otrosAsesores.map(corto).join(', ') : '—') + '</td><td></td></tr>';
          }).join('') +
          '<tr class="sub"><td colspan="2" style="text-align:right">Subtotal ' + esc(g.asesorCorto) + ' (' + g.filas.length + ')</td>' +
          '<td style="text-align:right">$' + g.ventas.toFixed(2) + '</td><td style="text-align:right">$' + g.pagadoVenta.toFixed(2) + '</td>' +
          '<td style="text-align:right">$' + g.deuda.toFixed(2) + '</td><td style="text-align:right">$' + g.cobros.toFixed(2) + '</td>' +
          '<td style="text-align:right">' + fmtSaldo(g.saldo) + '</td><td></td><td></td></tr>';
      }).join('');
      var logoUrl = location.origin + '/logo-luanaqua.png';
      var aTxt = ff.a === '__todos__' ? 'Todos los asesores' : corto(ff.a);
      var v = _abrirVentanaImpresion();
      v.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Consulta Cobranzas por Asesor — Aqua Luan</title>' +
        '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:system-ui,-apple-system,\'Segoe UI\',Roboto,Arial,sans-serif;color:#1a3a5c;padding:24px;background:#fff;}' +
        '.print-header{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #1a3a5c;}' +
        '.print-header img{height:46px;width:auto;}.print-header h1{font-family:Georgia,\'Times New Roman\',serif;font-size:20px;color:#1a3a5c;}.print-header p{font-size:11px;color:#888;margin-top:3px;}' +
        'table{width:100%;border-collapse:collapse;font-size:11px;}th{text-align:left;font-size:9px;letter-spacing:0.04em;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid #d2dae2;color:#888;}' +
        'td{padding:6px 8px;border-bottom:1px solid #eee;}.grupo td{background:#eef2f6;font-weight:800;padding-top:10px;}.sub td{font-weight:800;border-bottom:1px solid #d2dae2;}.total-row{font-weight:800;background:#e6f4f2;}' +
        '@media print{body{padding:12px;} thead{display:table-header-group;}}</style></head><body>' +
        '<div class="print-header"><img src="' + logoUrl + '" alt="Aqua Luan" onerror="this.style.display=\'none\'"><div>' +
        '<h1>Consulta Cobranzas — por Asesor principal</h1>' +
        '<p>Período: Todo el historial · Asesor: ' + esc(aTxt) + ' · Filtro: ' + esc(etiquetaFiltroSaldo()) + ' · ' + uni.n + ' cliente(s) · ' + esc((typeof lineaImpresoPor === 'function') ? lineaImpresoPor() : '') + '</p>' +
        '</div></div>' +
        '<table><thead><tr><th>Cliente</th><th>Teléfono</th><th style="text-align:right">Ventas</th><th style="text-align:right">Pagado en venta</th><th style="text-align:right">Deuda generada</th><th style="text-align:right">Cobros</th><th style="text-align:right">Saldo pendiente</th><th>Atendido también por</th><th></th></tr></thead><tbody>' +
        cuerpo +
        '<tr class="total-row"><td colspan="2" style="text-align:right">TOTAL (' + uni.n + ' cliente' + (uni.n === 1 ? '' : 's') + ')</td>' +
        '<td style="text-align:right">$' + t.ventas.toFixed(2) + '</td><td style="text-align:right">$' + t.pagadoVenta.toFixed(2) + '</td>' +
        '<td style="text-align:right">$' + t.deuda.toFixed(2) + '</td><td style="text-align:right">$' + t.cobros.toFixed(2) + '</td>' +
        '<td style="text-align:right">' + fmtSaldo(t.saldo) + '</td><td></td><td></td></tr>' +
        '</tbody></table><script>window.onload=function(){window.print();};<\/script></body></html>');
      v.document.close();
      if (typeof _dispararImpresion === 'function') _dispararImpresion(v);
    }

    /* ── 7. Funciones globales (las usan los onclick del HTML) ── */
    window.renderCobranzasAsesores = render;
    window.verDetalleCobranzaAsesor = verDetalle;
    window.imprimirCobranzasAsesores = imprimir;
    window.filtrarCobranzasAsesor = function (a) {
      var sel = document.getElementById('cobAsAsesor');
      if (!sel) return;
      sel.value = (sel.value === a) ? '__todos__' : a;
      render();
    };
    window.toggleCobranzaAsesorSeleccion = function (el) {
      var k = el.getAttribute('data-k') || '';
      if (!k) return;
      if (el.checked) EST.seleccion.add(k); else EST.seleccion.delete(k);
    };
    window.toggleTodosCobranzasAsesores = function (el) {
      document.querySelectorAll('#tablaCobranzasAsesores .cobas-chk').forEach(function (chk) { chk.checked = !!el.checked; });
      (EST.filas || []).forEach(function (c) { if (el.checked) EST.seleccion.add(c.key); else EST.seleccion.delete(c.key); });
    };
    window.toggleFiltroSaldoCobAs = function (ev) {
      if (ev) ev.stopPropagation();
      var p = document.getElementById('cobAsFiltroSaldo');
      if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
    };
    window.cambiarFiltroSaldoCobAs = function (el) {
      var todos = document.getElementById('cobAsFiltroSaldoTodos');
      var opts = document.querySelectorAll('#cobAsFiltroSaldo .cobas-filtro-saldo');
      if (el === todos) {
        if (todos.checked) opts.forEach(function (o) { o.checked = false; });
        else if (!filtrosSaldo().length) todos.checked = true;
      } else if (todos) {
        todos.checked = !filtrosSaldo().length;
      }
      var txt = document.getElementById('cobAsFiltroSaldoTxt');
      if (txt) txt.textContent = etiquetaFiltroSaldo();
      render();
    };
    document.addEventListener('click', function () {
      var p = document.getElementById('cobAsFiltroSaldo');
      if (p && p.style.display !== 'none') p.style.display = 'none';
    });

    /* ── 8. Enganches (sin tocar el código existente) ── */
    if (typeof switchSeccionDash === 'function') {
      var _switchOriginal = switchSeccionDash;
      switchSeccionDash = function (sec) {
        var r = _switchOriginal.apply(this, arguments);
        try {
          if (sec === SEC && visible()) {
            if (typeof _iniciarListenerCobranzasHist === 'function') _iniciarListenerCobranzasHist();
            /* Al entrar, toma el asesor elegido arriba (si hay uno) como punto de partida */
            var fa = document.getElementById('filtroAsesor');
            var sel = document.getElementById('cobAsAsesor');
            if (fa && sel && fa.value) {
              if (!Array.prototype.some.call(sel.options, function (o) { return o.value === fa.value; })) {
                var op = document.createElement('option'); op.value = fa.value; op.textContent = corto(fa.value); sel.appendChild(op);
              }
              sel.value = fa.value;
            }
            render();
          }
        } catch (e) { console.warn(e); }
        return r;
      };
    }
    /* Cuando llegan cambios del histórico (pedidos/pagos), Consulta Cobranzas se refresca
       con _refrescarCobranzasSiVisible; aquí se le suma esta sección. */
    if (typeof _refrescarCobranzasSiVisible === 'function') {
      var _refOriginal = _refrescarCobranzasSiVisible;
      _refrescarCobranzasSiVisible = function () {
        var r = _refOriginal.apply(this, arguments);
        try { if (visible()) render(); } catch (e) { console.warn(e); }
        return r;
      };
    }
    if (typeof auth !== 'undefined' && auth.onAuthStateChanged) {
      auth.onAuthStateChanged(function (u) { if (!u) { EST.seleccion = new Set(); EST.filas = []; EST.porKey = {}; } });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', crearMenuYSeccion);
    else crearMenuYSeccion();
  } catch (err) { console.warn('Módulo Cobranzas por Asesor no se pudo iniciar:', err); }
})();
