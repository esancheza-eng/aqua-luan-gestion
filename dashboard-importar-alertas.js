/* ════════════════════════════════════════════════════════════
   [NEW] IMPORTAR DATOS — ALERTAS ANTES DE CONFIRMAR
   Al leer el archivo, revisa contra la base COMPLETA (no solo el rango de
   fechas filtrado) y avisa:

   PEDIDOS
     · DUPLICADO: el mismo pedido (Asesor + Cliente + Fecha + Total) ya existe.
     · DEUDA ANTERIOR YA SUBIDA: el cliente ya tiene un pedido "SALDO ANT - ...".
     · CLIENTE NUEVO: no existe en esa ruta; muestra nombres parecidos de la
       misma ruta y si ese nombre existe en otra ruta.
     · ASESOR NO RECONOCIDO: el asesor no es una de las rutas del sistema.

   LISTA DE PRECIOS
     · PRECIO QUE CAMBIA: el cliente ya tiene precio (aprobado / importado /
       manual) para ese producto y el Excel trae otro distinto.
     · CLIENTE NO ESTÁ EN LA LISTA: se crearía un cliente nuevo en la lista;
       muestra parecidos de la misma ruta (ej. JEAN CARLOS / JUAN CARLOS).
     · PRODUCTO NO ESTÁ EN EL CATÁLOGO.
     · ASESOR NO RECONOCIDO.

   Al confirmar pide aceptar las alertas, permite omitir los pedidos duplicados
   y permite NO reemplazar los precios que ya existen.

   SOLO AGREGA: no cambia cómo se agrupan, calculan ni guardan los pedidos ni
   los precios. Envuelve renderPreviewImportacion / confirmarImportacionMasiva
   y luego llama a las funciones originales tal cual. Solo lectura de
   'pedidos' y 'preciosClientes' (la escritura la sigue haciendo la original).
════════════════════════════════════════════════════════════ */
(function(){
  if (typeof renderPreviewImportacion !== 'function' || typeof confirmarImportacionMasiva !== 'function') return;

  const _renderOriginal = renderPreviewImportacion;
  const _confirmarOriginal = confirmarImportacionMasiva;
  let _analisis = null;        // resultado de la última revisión
  let _analisisPromesa = null; // revisión en curso
  let _token = 0;

  const esc = (s) => (typeof escHTML === 'function') ? escHTML(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const money = (n) => '$' + (Number(n) || 0).toFixed(2);
  // Clave flexible: mayúsculas, sin tildes, sin signos, espacios simples
  const norm = (s) => String(s || '').toLocaleUpperCase('es-EC').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const kRuta = (r) => norm(r);
  const esSaldoAnt = (n) => /^SALDO ANT - /i.test(String(n || '').trim());
  const pedidoEsSaldoAnt = (p) => { const pr = (p && p.productos) || []; return pr.length > 0 && pr.every(x => esSaldoAnt(x && x.nombre)); };
  const fechaDe = (p) => String(p.fecha || p.FECHA || '').slice(0, 10);
  const totalDe = (p) => { const t = parseFloat(p.total); if (!isNaN(t)) return t; return ((p && p.productos) || []).reduce((s, x) => s + (parseFloat(x.subtotal) || 0), 0); };
  const etiquetaFuente = (f) => ({ aprobacion: 'aprobado', importacion: 'importado', dashboard: 'manual' }[f] || 'en lista');
  const pedidosLote = () => (typeof _pedidosParaImportar !== 'undefined' && Array.isArray(_pedidosParaImportar)) ? _pedidosParaImportar : [];
  const preciosLote = () => (typeof _preciosParaImportar !== 'undefined' && Array.isArray(_preciosParaImportar)) ? _preciosParaImportar : [];

  function similitud(a, b){ // 0..1 (Levenshtein normalizado)
    if (a === b) return 1;
    const m = a.length, n = b.length; if (!m || !n) return 0;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n);
  }
  function parecidos(nombre, candidatos){
    const n = norm(nombre); const pal = n.split(' ').filter(w => w.length >= 3);
    return candidatos.filter(c => norm(c) !== n).map(c => {
      const cn = norm(c); const cp = cn.split(' ');
      let comunes = 0; pal.forEach(w => { if (cp.some(x => x === w || (w.length >= 4 && similitud(w, x) >= 0.75))) comunes++; });
      const sim = similitud(n, cn);
      return { nombre: c, puntaje: comunes + (sim >= 0.75 ? 2 : 0) + sim };
    }).filter(x => x.puntaje >= 1).sort((a, b) => b.puntaje - a.puntaje).slice(0, 5).map(x => x.nombre);
  }

  async function analizar(){
    const pedidosNuevos = pedidosLote();
    const preciosNuevos = preciosLote();
    const [snapPed, snapPre] = await Promise.all([
      db.collection('pedidos').get(),
      db.collection('preciosClientes').get().catch(() => null)
    ]);

    const clientesPorRuta = {};   // rutaKey -> Map(normCliente -> nombre original)  (pedidos + lista)
    const rutasPorCliente = {};   // normCliente -> Set(ruta original)
    const listaPorRuta = {};      // rutaKey -> Map(normCliente -> doc de preciosClientes)
    const listaPorId = {};        // id de preciosClientes -> doc
    const firmas = {};            // ruta|cliente|fecha -> [total,...]
    const saldoAnt = {};          // ruta|cliente -> total deuda anterior ya subida
    const addCliente = (ruta, cliente) => {
      const rk = kRuta(ruta), ck = norm(cliente); if (!ck) return;
      (clientesPorRuta[rk] = clientesPorRuta[rk] || new Map()).has(ck) || clientesPorRuta[rk].set(ck, String(cliente).trim());
      (rutasPorCliente[ck] = rutasPorCliente[ck] || new Set()).add(String(ruta || 'SIN ASESOR'));
    };
    snapPed.forEach(d => {
      const p = d.data() || {}; const ruta = p.empleado || p.asesor || ''; const cli = p.cliente || '';
      addCliente(ruta, cli);
      if (p.estado === 'rechazado') return;
      const k = kRuta(ruta) + '|' + norm(cli);
      (firmas[k + '|' + fechaDe(p)] = firmas[k + '|' + fechaDe(p)] || []).push(totalDe(p));
      if (pedidoEsSaldoAnt(p)) saldoAnt[k] = (saldoAnt[k] || 0) + totalDe(p);
    });
    if (snapPre) snapPre.forEach(d => {
      const x = d.data() || {}; addCliente(x.empleado || '', x.cliente || '');
      const doc = { id: d.id, cliente: x.cliente || '', empleado: x.empleado || '', precios: x.precios || {}, fuente: x.fuente || '' };
      listaPorId[d.id] = doc;
      (listaPorRuta[kRuta(doc.empleado)] = listaPorRuta[kRuta(doc.empleado)] || new Map()).set(norm(doc.cliente), doc);
    });

    const asesores = (Array.isArray(_asesoresCache) ? _asesoresCache : []).map(kRuta);
    const asesorMal = (ruta) => asesores.length && !asesores.includes(kRuta(ruta));
    const textoNuevo = (ruta, cliente, base) => {
      const mapaRuta = clientesPorRuta[kRuta(ruta)];
      const sug = mapaRuta ? parecidos(cliente, Array.from(mapaRuta.values())) : [];
      const otras = Array.from(rutasPorCliente[norm(cliente)] || []).filter(r => kRuta(r) !== kRuta(ruta));
      let t = base;
      if (otras.length) t += ` · Existe en: ${otras.join(', ')}`;
      if (sug.length) t += ` · Parecidos: ${sug.join(', ')}`;
      return t;
    };

    // ── Pedidos
    const items = pedidosNuevos.map((p, i) => {
      const ruta = p.empleado || ''; const k = kRuta(ruta) + '|' + norm(p.cliente);
      const alertas = [];
      if (asesorMal(ruta)) alertas.push({ tipo: 'asesor', texto: `Asesor "${ruta || 'vacío'}" no es una ruta del sistema` });
      const previos = firmas[k + '|' + p.fecha] || [];
      const dup = previos.some(t => Math.abs(t - p.total) < 0.01);
      if (dup) alertas.push({ tipo: 'duplicado', texto: `Ya existe un pedido igual (${p.fecha}, ${money(p.total)})` });
      if (pedidoEsSaldoAnt(p) && saldoAnt[k] && !dup) alertas.push({ tipo: 'saldo', texto: `Ya tiene deuda anterior subida: ${money(saldoAnt[k])}` });
      const mapaRuta = clientesPorRuta[kRuta(ruta)];
      if (!mapaRuta || !mapaRuta.has(norm(p.cliente))) alertas.push({ tipo: 'nuevo', texto: textoNuevo(ruta, p.cliente, 'Cliente nuevo en esta ruta (se creará sin teléfono ni dirección)') });
      return { i, pedido: p, alertas };
    });
    const cuenta = (t) => items.filter(x => x.alertas.some(a => a.tipo === t)).length;

    // ── Lista de precios
    const catalogo = new Set((Array.isArray(_productosCache) ? _productosCache : []).map(p => norm(p.nombre)).filter(Boolean));
    const itemsPrecios = preciosNuevos.map(c => {
      const ruta = c.empleado || '';
      const alertas = []; const cambios = [];
      if (asesorMal(ruta)) alertas.push({ tipo: 'asesor', texto: `Asesor "${ruta || 'vacío'}" no es una ruta del sistema` });
      const actual = listaPorId[c.id] || (listaPorRuta[kRuta(ruta)] || new Map()).get(norm(c.cliente)) || null;
      if (!actual) {
        const tienePedidos = (clientesPorRuta[kRuta(ruta)] || new Map()).has(norm(c.cliente));
        const listaRuta = listaPorRuta[kRuta(ruta)];
        const sugLista = listaRuta ? parecidos(c.cliente, Array.from(listaRuta.values()).map(x => x.cliente)) : [];
        let t = tienePedidos ? 'No está en la lista de precios (sí tiene pedidos en esta ruta): se agregará' : 'Cliente nuevo: no está en la lista ni tiene pedidos en esta ruta';
        const otras = Array.from(rutasPorCliente[norm(c.cliente)] || []).filter(r => kRuta(r) !== kRuta(ruta));
        if (otras.length) t += ` · Existe en: ${otras.join(', ')}`;
        if (sugLista.length) t += ` · Parecidos en la lista: ${sugLista.join(', ')}`;
        alertas.push({ tipo: 'nolista', texto: t });
      } else {
        Object.keys(c.precios || {}).forEach(prod => {
          const viejo = parseFloat((actual.precios || {})[prod]);
          const nuevo = parseFloat(c.precios[prod]);
          if (!isNaN(viejo) && Math.abs(viejo - nuevo) >= 0.005) cambios.push({ prod, viejo, nuevo });
        });
        if (cambios.length) alertas.push({ tipo: 'cambio', texto: cambios.map(x => `${x.prod}: ${etiquetaFuente(actual.fuente)} ${money(x.viejo)} → nuevo ${money(x.nuevo)}`).join(' · ') });
      }
      if (catalogo.size) {
        const fuera = Object.keys(c.precios || {}).filter(prod => !catalogo.has(norm(prod)));
        if (fuera.length) alertas.push({ tipo: 'catalogo', texto: `No está en el catálogo de productos: ${fuera.join(', ')}` });
      }
      return { c, alertas, cambios };
    });
    const cuentaP = (t) => itemsPrecios.filter(x => x.alertas.some(a => a.tipo === t)).length;

    return {
      items, nDuplicados: cuenta('duplicado'), nSaldo: cuenta('saldo'), nNuevos: cuenta('nuevo'), nAsesor: cuenta('asesor'),
      precios: {
        items: itemsPrecios,
        nCambios: itemsPrecios.reduce((s, x) => s + x.cambios.length, 0),
        nClientesCambio: cuentaP('cambio'), nNoLista: cuentaP('nolista'), nCatalogo: cuentaP('catalogo'), nAsesor: cuentaP('asesor')
      }
    };
  }

  const COLOR = { duplicado: '#c0392b', saldo: '#c0392b', asesor: '#c0392b', catalogo: '#c0392b', nuevo: '#b9770e', nolista: '#b9770e', cambio: '#1f5fa8' };
  const ICONO = { duplicado: '⛔', saldo: '⛔', asesor: '⛔', catalogo: '⛔', nuevo: '🆕', nolista: '🆕', cambio: '💲' };
  const tabla = (filas) => `<div class="table-wrap" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:260px;overflow-y:auto;background:#fff">
      <table><thead><tr><th>Asesor</th><th>Cliente</th><th style="text-align:right">Total</th><th>Alerta</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  const filaHTML = (ruta, cliente, total, alertas) => `<tr>
      <td style="font-size:12px">${esc(ruta || '-')}</td>
      <td style="font-weight:700">${esc(cliente)}</td>
      <td style="text-align:right;font-weight:700">${total == null ? '' : money(total)}</td>
      <td style="font-size:12px">${alertas.map(a => `<div style="color:${COLOR[a.tipo]};margin:2px 0">${ICONO[a.tipo]} ${esc(a.texto)}</div>`).join('')}</td>
    </tr>`;

  function colocarCaja(cont){
    let box = document.getElementById('importarAlertasBox');
    if (!box) { box = document.createElement('div'); box.id = 'importarAlertasBox'; }
    const btn = document.getElementById('btnConfirmarImportacion');
    if (btn && btn.parentNode === cont) cont.insertBefore(box, btn); else cont.appendChild(box);
    return box;
  }

  function pintar(cont, res){
    const box = colocarCaja(cont);
    if (res.error) {
      box.innerHTML = `<div style="margin:6px 0 12px;padding:10px 14px;border-radius:8px;background:#fff4e5;border:1px solid #f0b46a;font-size:12px;color:#8a4b00">⚠️ No se pudo verificar duplicados, clientes nuevos ni cambios de precio (${esc(res.error)}). Revisa el archivo manualmente antes de importar.</div>`;
      return;
    }
    const pedAlerta = res.items.filter(x => x.alertas.length);
    const preAlerta = res.precios.items.filter(x => x.alertas.length);
    if (!pedAlerta.length && !preAlerta.length) {
      box.innerHTML = `<div style="margin:6px 0 12px;padding:10px 14px;border-radius:8px;background:#e8f7ef;border:1px solid #9bd3b4;font-size:13px;color:#1e6b43;font-weight:700">✅ Verificado contra la base: sin duplicados, sin deuda anterior repetida, sin cambios de precio y todos los clientes ya existen en su ruta.</div>`;
      return;
    }
    let html = '';
    if (pedAlerta.length) {
      const resumen = [
        res.nDuplicados ? `<b style="color:#c0392b">⛔ ${res.nDuplicados} duplicado(s)</b>` : '',
        res.nSaldo ? `<b style="color:#c0392b">⛔ ${res.nSaldo} con deuda anterior ya subida</b>` : '',
        res.nAsesor ? `<b style="color:#c0392b">⛔ ${res.nAsesor} con asesor no reconocido</b>` : '',
        res.nNuevos ? `<b style="color:#b9770e">🆕 ${res.nNuevos} cliente(s) nuevo(s)</b>` : ''
      ].filter(Boolean).join(' · ');
      const omitir = (res.nDuplicados || res.nSaldo) ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:700;color:var(--navy);margin:8px 0 4px;cursor:pointer">
          <input type="checkbox" id="importarOmitirDuplicados" checked> Omitir al importar los ${res.nDuplicados + res.nSaldo} pedido(s) marcados con ⛔ duplicado / deuda ya subida (recomendado)</label>` : '';
      html += `<div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:6px">🧾 Pedidos: ${resumen}</div>
        ${tabla(pedAlerta.map(x => filaHTML(x.pedido.empleado, x.pedido.cliente, x.pedido.total, x.alertas)).join(''))}${omitir}`;
    }
    if (preAlerta.length) {
      const P = res.precios;
      const resumen = [
        P.nCambios ? `<b style="color:#1f5fa8">💲 ${P.nCambios} precio(s) que cambian en ${P.nClientesCambio} cliente(s)</b>` : '',
        P.nNoLista ? `<b style="color:#b9770e">🆕 ${P.nNoLista} cliente(s) que no están en la lista</b>` : '',
        P.nCatalogo ? `<b style="color:#c0392b">⛔ ${P.nCatalogo} con producto fuera del catálogo</b>` : '',
        P.nAsesor ? `<b style="color:#c0392b">⛔ ${P.nAsesor} con asesor no reconocido</b>` : ''
      ].filter(Boolean).join(' · ');
      const conservar = P.nCambios ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:700;color:var(--navy);margin:8px 0 4px;cursor:pointer">
          <input type="checkbox" id="importarConservarPrecios"> No reemplazar los ${P.nCambios} precio(s) que ya existen (mantener el precio actual y solo agregar los que faltan)</label>` : '';
      html += `<div style="font-size:13px;font-weight:800;color:var(--navy);margin:${pedAlerta.length ? '14px' : '0'} 0 6px">💲 Lista de precios: ${resumen}</div>
        ${tabla(preAlerta.map(x => filaHTML(x.c.empleado, x.c.cliente, null, x.alertas)).join(''))}${conservar}`;
    }
    box.innerHTML = `<div style="margin:6px 0 12px;padding:12px 14px;border-radius:8px;background:#fffaf0;border:1.5px solid #f0b46a">
        <div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:8px">⚠️ Revisa antes de importar</div>
        ${html}
        <div style="font-size:11px;color:var(--muted);margin-top:6px">Si un cliente "nuevo" en realidad es uno de los parecidos, corrige el nombre en el Excel (igual que en el sistema) y vuelve a leer el archivo.</div>
      </div>`;
  }

  // ── Envoltura del preview: dibuja lo original y luego agrega las alertas
  renderPreviewImportacion = function(){
    _renderOriginal.apply(this, arguments);
    _analisis = null; _analisisPromesa = null;
    const cont = document.getElementById('importarPreview');
    if (!cont || (!pedidosLote().length && !preciosLote().length)) return;
    const miToken = ++_token;
    const box = colocarCaja(cont);
    box.innerHTML = '<div style="margin:6px 0 12px;font-size:12px;color:var(--muted)">🔎 Verificando duplicados, clientes nuevos y cambios de precio contra la base completa...</div>';
    _analisisPromesa = analizar().then(res => {
      if (miToken !== _token) return null;
      _analisis = res; pintar(cont, res); return res;
    }).catch(err => {
      console.error('alertas importación:', err);
      if (miToken !== _token) return null;
      _analisis = { error: err.message || String(err), items: [], precios: { items: [] } }; pintar(cont, _analisis); return _analisis;
    });
  };

  // ── Envoltura del confirmar: pide aceptar las alertas, omite duplicados y conserva precios si se marcó
  confirmarImportacionMasiva = async function(){
    if (pedidosLote().length || preciosLote().length) {
      if (!_analisis && _analisisPromesa) {
        const btn = document.getElementById('btnConfirmarImportacion');
        if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }
        try { await _analisisPromesa; } finally { if (btn) { btn.disabled = false; btn.textContent = '⬆ Confirmar e importar'; } }
      }
      const res = _analisis;
      if (res && res.error) {
        if (!confirm('⚠️ No se pudo verificar duplicados, clientes nuevos ni cambios de precio.\n\n¿Importar de todas formas?')) return;
      } else if (res && (res.items.some(x => x.alertas.length) || res.precios.items.some(x => x.alertas.length))) {
        const chkDup = document.getElementById('importarOmitirDuplicados');
        const omitir = !!(chkDup && chkDup.checked);
        const chkPre = document.getElementById('importarConservarPrecios');
        const conservar = !!(chkPre && chkPre.checked);
        const lista = (arr, f) => arr.slice(0, 12).map(f).join('\n') + (arr.length > 12 ? `\n   … y ${arr.length - 12} más` : '');
        const lineas = [];
        // Pedidos
        const bloqueados = new Set(res.items.filter(x => x.alertas.some(a => a.tipo === 'duplicado' || a.tipo === 'saldo')).map(x => x.pedido));
        if (res.nDuplicados) lineas.push(`⛔ ${res.nDuplicados} pedido(s) DUPLICADO(S)` + (omitir ? ' → se omitirán' : ' → SE VAN A IMPORTAR OTRA VEZ'));
        if (res.nSaldo) lineas.push(`⛔ ${res.nSaldo} cliente(s) que YA TIENEN deuda anterior subida` + (omitir ? ' → se omitirán' : ' → se sumará otra vez'));
        if (res.nAsesor) lineas.push(`⛔ ${res.nAsesor} pedido(s) con asesor no reconocido`);
        if (res.nNuevos) {
          const nuevos = res.items.filter(x => x.alertas.some(a => a.tipo === 'nuevo'));
          lineas.push(`🆕 ${res.nNuevos} CLIENTE(S) NUEVO(S) en pedidos:\n` + lista(nuevos, x => `   • ${x.pedido.cliente} (${x.pedido.empleado || '-'})`));
        }
        // Precios
        const P = res.precios;
        if (P.nCambios) {
          const cambios = []; P.items.forEach(x => x.cambios.forEach(ch => cambios.push({ cli: x.c.cliente, ...ch })));
          lineas.push(`💲 ${P.nCambios} PRECIO(S) QUE CAMBIAN` + (conservar ? ' → se MANTIENE el precio actual' : ' → se REEMPLAZAN') + ':\n'
            + lista(cambios, ch => `   • ${ch.cli} · ${ch.prod}: ${money(ch.viejo)} → ${money(ch.nuevo)}`));
        }
        if (P.nNoLista) {
          const nl = P.items.filter(x => x.alertas.some(a => a.tipo === 'nolista'));
          lineas.push(`🆕 ${P.nNoLista} cliente(s) se AGREGARÁN a la lista de precios:\n` + lista(nl, x => `   • ${x.c.cliente} (${x.c.empleado || '-'})`));
        }
        if (P.nCatalogo) lineas.push(`⛔ ${P.nCatalogo} cliente(s) con productos que no están en el catálogo`);
        if (P.nAsesor) lineas.push(`⛔ ${P.nAsesor} cliente(s) de la lista con asesor no reconocido`);

        if (!confirm('Revisión antes de importar:\n\n' + lineas.join('\n\n') + '\n\n¿Confirmas que está correcto y deseas continuar?')) return;

        if (omitir && bloqueados.size) _pedidosParaImportar = _pedidosParaImportar.filter(p => !bloqueados.has(p));
        if (conservar && P.nCambios) {
          const quitar = new Map(P.items.filter(x => x.cambios.length).map(x => [x.c, new Set(x.cambios.map(ch => ch.prod))]));
          _preciosParaImportar = _preciosParaImportar.map(c => {
            const q = quitar.get(c); if (!q) return c;
            const precios = {}; Object.keys(c.precios || {}).forEach(prod => { if (!q.has(prod)) precios[prod] = c.precios[prod]; });
            return { ...c, precios };
          }).filter(c => Object.keys(c.precios || {}).length);
        }
        if (!_pedidosParaImportar.length && !_preciosParaImportar.length) { alert('No queda nada por importar: todo eran duplicados o precios que se mantienen.'); return; }
      }
    }
    return _confirmarOriginal.apply(this, arguments);
  };
})();
