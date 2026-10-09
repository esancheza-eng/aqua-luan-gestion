/* ════════════════════════════════════════════════════════════
   [NEW] IMPORTAR DATOS — ALERTAS ANTES DE CONFIRMAR
   Al leer el archivo, revisa contra la base COMPLETA (no solo el rango de
   fechas filtrado) y avisa:
     · DUPLICADO: el mismo pedido (Asesor + Cliente + Fecha + Total) ya existe.
     · DEUDA ANTERIOR YA SUBIDA: el cliente ya tiene un pedido "SALDO ANT - ...".
     · CLIENTE NUEVO: no existe en esa ruta; muestra nombres parecidos de la
       misma ruta y si ese nombre existe en otra ruta.
     · ASESOR NO RECONOCIDO: el asesor no es una de las rutas del sistema.
   Al confirmar pide aceptar las alertas y permite omitir los duplicados.

   SOLO AGREGA: no cambia cómo se agrupan, calculan ni guardan los pedidos.
   Envuelve renderPreviewImportacion / confirmarImportacionMasiva y luego
   llama a las funciones originales tal cual. Solo lectura de 'pedidos' y
   'preciosClientes' (la escritura la sigue haciendo la función original).
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
  const norm = (s) => String(s || '').toLocaleUpperCase('es-EC').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const kRuta = (r) => norm(r);
  const esSaldoAnt = (n) => /^SALDO ANT - /i.test(String(n || '').trim());
  const pedidoEsSaldoAnt = (p) => { const pr = (p && p.productos) || []; return pr.length > 0 && pr.every(x => esSaldoAnt(x && x.nombre)); };
  const fechaDe = (p) => String(p.fecha || p.FECHA || '').slice(0, 10);
  const totalDe = (p) => { const t = parseFloat(p.total); if (!isNaN(t)) return t; return ((p && p.productos) || []).reduce((s, x) => s + (parseFloat(x.subtotal) || 0), 0); };

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
    return candidatos.map(c => {
      const cn = norm(c); const cp = cn.split(' ');
      let comunes = 0; pal.forEach(w => { if (cp.some(x => x === w || (w.length >= 5 && similitud(w, x) >= 0.8))) comunes++; });
      const sim = similitud(n, cn);
      return { nombre: c, puntaje: comunes + (sim >= 0.75 ? 2 : 0) + sim };
    }).filter(x => x.puntaje >= 1).sort((a, b) => b.puntaje - a.puntaje).slice(0, 5).map(x => x.nombre);
  }

  async function analizar(){
    const pedidosNuevos = (typeof _pedidosParaImportar !== 'undefined' && Array.isArray(_pedidosParaImportar)) ? _pedidosParaImportar : [];
    const [snapPed, snapPre] = await Promise.all([
      db.collection('pedidos').get(),
      db.collection('preciosClientes').get().catch(() => null)
    ]);

    const clientesPorRuta = {};   // rutaKey -> Map(normCliente -> nombre original)
    const rutasPorCliente = {};   // normCliente -> Set(ruta original)
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
    if (snapPre) snapPre.forEach(d => { const x = d.data() || {}; addCliente(x.empleado || '', x.cliente || ''); });

    const asesores = (Array.isArray(_asesoresCache) ? _asesoresCache : []).map(kRuta);
    const items = pedidosNuevos.map((p, i) => {
      const ruta = p.empleado || ''; const k = kRuta(ruta) + '|' + norm(p.cliente);
      const alertas = [];
      if (asesores.length && !asesores.includes(kRuta(ruta))) alertas.push({ tipo: 'asesor', texto: `Asesor "${ruta || 'vacío'}" no es una ruta del sistema` });
      const previos = firmas[k + '|' + p.fecha] || [];
      const dup = previos.some(t => Math.abs(t - p.total) < 0.01);
      if (dup) alertas.push({ tipo: 'duplicado', texto: `Ya existe un pedido igual (${p.fecha}, ${money(p.total)})` });
      if (pedidoEsSaldoAnt(p) && saldoAnt[k] && !dup) alertas.push({ tipo: 'saldo', texto: `Ya tiene deuda anterior subida: ${money(saldoAnt[k])}` });
      const mapaRuta = clientesPorRuta[kRuta(ruta)];
      if (!mapaRuta || !mapaRuta.has(norm(p.cliente))) {
        const sug = mapaRuta ? parecidos(p.cliente, Array.from(mapaRuta.values())) : [];
        const otras = Array.from(rutasPorCliente[norm(p.cliente)] || []).filter(r => kRuta(r) !== kRuta(ruta));
        let t = 'Cliente nuevo en esta ruta (se creará sin teléfono ni dirección)';
        if (otras.length) t += ` · Existe en: ${otras.join(', ')}`;
        if (sug.length) t += ` · Parecidos: ${sug.join(', ')}`;
        alertas.push({ tipo: 'nuevo', texto: t });
      }
      return { i, pedido: p, alertas };
    });
    const cuenta = (t) => items.filter(x => x.alertas.some(a => a.tipo === t)).length;
    return { items, nDuplicados: cuenta('duplicado'), nSaldo: cuenta('saldo'), nNuevos: cuenta('nuevo'), nAsesor: cuenta('asesor'), firmaLote: pedidosNuevos };
  }

  function pintar(cont, res){
    let box = document.getElementById('importarAlertasBox');
    if (!box) { box = document.createElement('div'); box.id = 'importarAlertasBox'; }
    const btn = document.getElementById('btnConfirmarImportacion');
    if (btn && btn.parentNode === cont) cont.insertBefore(box, btn); else cont.appendChild(box);

    if (res.error) {
      box.innerHTML = `<div style="margin:6px 0 12px;padding:10px 14px;border-radius:8px;background:#fff4e5;border:1px solid #f0b46a;font-size:12px;color:#8a4b00">⚠️ No se pudo verificar duplicados ni clientes nuevos (${esc(res.error)}). Revisa el archivo manualmente antes de importar.</div>`;
      return;
    }
    const conAlerta = res.items.filter(x => x.alertas.length);
    if (!conAlerta.length) {
      box.innerHTML = `<div style="margin:6px 0 12px;padding:10px 14px;border-radius:8px;background:#e8f7ef;border:1px solid #9bd3b4;font-size:13px;color:#1e6b43;font-weight:700">✅ Verificado contra la base: sin duplicados, sin deuda anterior repetida y todos los clientes ya existen en su ruta.</div>`;
      return;
    }
    const color = { duplicado: '#c0392b', saldo: '#c0392b', asesor: '#c0392b', nuevo: '#b9770e' };
    const icono = { duplicado: '⛔', saldo: '⛔', asesor: '⛔', nuevo: '🆕' };
    const resumen = [
      res.nDuplicados ? `<b style="color:#c0392b">⛔ ${res.nDuplicados} duplicado(s)</b>` : '',
      res.nSaldo ? `<b style="color:#c0392b">⛔ ${res.nSaldo} con deuda anterior ya subida</b>` : '',
      res.nAsesor ? `<b style="color:#c0392b">⛔ ${res.nAsesor} con asesor no reconocido</b>` : '',
      res.nNuevos ? `<b style="color:#b9770e">🆕 ${res.nNuevos} cliente(s) nuevo(s)</b>` : ''
    ].filter(Boolean).join(' · ');
    const filas = conAlerta.map(x => `<tr>
        <td style="font-size:12px">${esc(x.pedido.empleado || '-')}</td>
        <td style="font-weight:700">${esc(x.pedido.cliente)}</td>
        <td style="text-align:right;font-weight:700">${money(x.pedido.total)}</td>
        <td style="font-size:12px">${x.alertas.map(a => `<div style="color:${color[a.tipo]};margin:2px 0">${icono[a.tipo]} ${esc(a.texto)}</div>`).join('')}</td>
      </tr>`).join('');
    const omitir = (res.nDuplicados || res.nSaldo) ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:700;color:var(--navy);margin:8px 0 4px;cursor:pointer">
        <input type="checkbox" id="importarOmitirDuplicados" checked> Omitir al importar los ${res.nDuplicados + res.nSaldo} pedido(s) marcados con ⛔ duplicado / deuda ya subida (recomendado)</label>` : '';
    box.innerHTML = `<div style="margin:6px 0 12px;padding:12px 14px;border-radius:8px;background:#fffaf0;border:1.5px solid #f0b46a">
        <div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:6px">⚠️ Revisa antes de importar: ${resumen}</div>
        <div class="table-wrap" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:260px;overflow-y:auto;background:#fff">
          <table><thead><tr><th>Asesor</th><th>Cliente</th><th style="text-align:right">Total</th><th>Alerta</th></tr></thead><tbody>${filas}</tbody></table>
        </div>
        ${omitir}
        <div style="font-size:11px;color:var(--muted);margin-top:6px">Si un "cliente nuevo" en realidad es uno de los parecidos, corrige el nombre en el Excel (igual que en el sistema) y vuelve a leer el archivo.</div>
      </div>`;
  }

  // ── Envoltura del preview: dibuja lo original y luego agrega las alertas
  renderPreviewImportacion = function(){
    _renderOriginal.apply(this, arguments);
    _analisis = null; _analisisPromesa = null;
    const cont = document.getElementById('importarPreview');
    if (!cont || typeof _pedidosParaImportar === 'undefined' || !_pedidosParaImportar.length) return;
    const miToken = ++_token;
    const box = document.createElement('div'); box.id = 'importarAlertasBox';
    box.innerHTML = '<div style="margin:6px 0 12px;font-size:12px;color:var(--muted)">🔎 Verificando duplicados y clientes nuevos contra la base completa...</div>';
    const btn = document.getElementById('btnConfirmarImportacion');
    if (btn && btn.parentNode === cont) cont.insertBefore(box, btn); else cont.appendChild(box);
    _analisisPromesa = analizar().then(res => {
      if (miToken !== _token) return null;
      _analisis = res; pintar(cont, res); return res;
    }).catch(err => {
      console.error('alertas importación:', err);
      if (miToken !== _token) return null;
      _analisis = { error: err.message || String(err), items: [] }; pintar(cont, _analisis); return _analisis;
    });
  };

  // ── Envoltura del confirmar: pide aceptar las alertas y omite duplicados si se marcó
  confirmarImportacionMasiva = async function(){
    if (typeof _pedidosParaImportar !== 'undefined' && _pedidosParaImportar.length) {
      if (!_analisis && _analisisPromesa) {
        const btn = document.getElementById('btnConfirmarImportacion');
        if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }
        try { await _analisisPromesa; } finally { if (btn) { btn.disabled = false; btn.textContent = '⬆ Confirmar e importar'; } }
      }
      const res = _analisis;
      if (res && res.error) {
        if (!confirm('⚠️ No se pudo verificar duplicados ni clientes nuevos.\n\n¿Importar de todas formas?')) return;
      } else if (res && res.items.some(x => x.alertas.length)) {
        const chk = document.getElementById('importarOmitirDuplicados');
        const omitir = !!(chk && chk.checked);
        const bloqueados = new Set(res.items.filter(x => x.alertas.some(a => a.tipo === 'duplicado' || a.tipo === 'saldo')).map(x => x.pedido));
        const lineas = [];
        if (res.nDuplicados) lineas.push(`⛔ ${res.nDuplicados} pedido(s) DUPLICADO(S)` + (omitir ? ' → se omitirán' : ' → SE VAN A IMPORTAR OTRA VEZ'));
        if (res.nSaldo) lineas.push(`⛔ ${res.nSaldo} cliente(s) que YA TIENEN deuda anterior subida` + (omitir ? ' → se omitirán' : ' → se sumará otra vez'));
        if (res.nAsesor) lineas.push(`⛔ ${res.nAsesor} pedido(s) con asesor no reconocido`);
        if (res.nNuevos) {
          const nombres = res.items.filter(x => x.alertas.some(a => a.tipo === 'nuevo')).map(x => '   • ' + x.pedido.cliente + ' (' + (x.pedido.empleado || '-') + ')');
          lineas.push(`🆕 ${res.nNuevos} CLIENTE(S) NUEVO(S) que se crearán:\n` + nombres.slice(0, 15).join('\n') + (nombres.length > 15 ? `\n   … y ${nombres.length - 15} más` : ''));
        }
        if (!confirm('Revisión antes de importar:\n\n' + lineas.join('\n\n') + '\n\n¿Confirmas que está correcto y deseas continuar?')) return;
        if (omitir && bloqueados.size) {
          _pedidosParaImportar = _pedidosParaImportar.filter(p => !bloqueados.has(p));
          if (!_pedidosParaImportar.length && !(_preciosParaImportar || []).length) { alert('No quedan pedidos por importar: todos eran duplicados.'); return; }
        }
      }
    }
    return _confirmarOriginal.apply(this, arguments);
  };
})();
