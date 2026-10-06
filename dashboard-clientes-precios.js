/* ════════════════════════════════════════════════════════════
   [NEW] CLIENTES Y PRECIOS — solo Administración
   Gestiona la lista de precios oficial por cliente (colección 'preciosClientes',
   la misma que llena Importar Datos y que la app de pedidos usa para BLOQUEAR el precio).

   · PENDIENTES (se calculan solos, sin campos nuevos en los pedidos):
       A) Clientes con ventas en una ruta con lista, pero que NO están en la lista
          (clientes nuevos creados por el asesor con "➕ Cliente nuevo", o clientes
          antiguos sin lista). Acciones: ✅ Aprobar (crea su lista con los precios
          cobrados, editables) · 🔗 Unir con un cliente existente (corrige el nombre
          en sus pedidos, pagos y envases).
       B) Precios faltantes: cliente en lista que compró un producto sin precio de lista.
          Acción: ✅ Aprobar el precio cobrado (editable).
   · CLIENTES: ver, editar precios/teléfono/dirección, quitar de la lista, agregar a mano.

   Archivo independiente: no modifica ninguna función existente de dashboard.js.
   No toca ventas, liquidación, cobranzas ni comisiones (solo 'preciosClientes', y
   el nombre del cliente en pedidos/pagos/envases cuando se usa "Unir").
════════════════════════════════════════════════════════════ */
let _cpdRuta = '', _cpdCatalogo = [], _cpdLista = {}, _cpdPedidos = [], _cpdPend = { clientes: [], precios: [] }, _cpdTab = 'pendientes', _cpdCargando = false;

function _cpdNorm(s){ return String(s||'').trim().toLocaleUpperCase('es-EC'); }
function _cpdFlex(s){ return _cpdNorm(s).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
function _cpdId(ruta, cliente){
  if (typeof _idPrecioCliente === 'function') return _idPrecioCliente(ruta, cliente);
  const sl = t => String(t||'').toLocaleUpperCase('es-EC').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'SIN';
  return `${sl(ruta)}__${sl(cliente)}`.slice(0,700);
}
function _cpdF2(n){ return (Number(n)||0).toFixed(2); }
function _cpdToast(m){ if (typeof mostrarToastEdicion === 'function') mostrarToastEdicion(m); else alert(m); }
function _cpdUid(){ return (typeof ADMIN_ACTUAL !== 'undefined' && ADMIN_ACTUAL && ADMIN_ACTUAL.uid) || null; }

function cpdAlEntrar(){
  const sel = document.getElementById('cpdRuta');
  if (sel) {
    const actual = sel.value;
    const rutas = (Array.isArray(_asesoresCache) ? _asesoresCache.slice() : []).sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
    sel.innerHTML = rutas.map(r => `<option value="${escHTML(r)}">${escHTML(r)}</option>`).join('');
    if (actual && rutas.includes(actual)) sel.value = actual;
    else { const r3 = rutas.find(r => /^RUTA\s*3\b/i.test(r)); if (r3) sel.value = r3; }
  }
  cpdCargar();
}

async function cpdCargar(){
  const sel = document.getElementById('cpdRuta');
  const cont = document.getElementById('cpdContenido');
  if (!sel || !cont || _cpdCargando) return;
  _cpdRuta = sel.value;
  if (!_cpdRuta) { cont.innerHTML = '<div class="empty-state">No hay rutas cargadas.</div>'; return; }
  _cpdCargando = true;
  cont.innerHTML = '<div class="loading"><div class="spinner"></div><span>Cargando clientes y precios de ' + escHTML(_cpdRuta) + '...</span></div>';
  try {
    const [sProd, sPre, sPed] = await Promise.all([
      db.collection('productos').get(),
      db.collection('preciosClientes').where('empleado','==',_cpdRuta).get(),
      db.collection('pedidos').where('empleado','==',_cpdRuta).get()
    ]);
    _cpdCatalogo = [];
    sProd.forEach(d => { const x = d.data(); if (x && x.nombre && x.activo !== false) _cpdCatalogo.push(x.nombre); });
    _cpdCatalogo.sort((a,b) => a.localeCompare(b,'es'));
    _cpdLista = {};
    sPre.forEach(d => { const x = d.data(); if (!x || !x.cliente) return; _cpdLista[_cpdNorm(x.cliente)] = { id: d.id, ref: d.ref, cliente: _cpdNorm(x.cliente), telefono: x.telefono || '', direccion: x.direccion || '', precios: Object.assign({}, x.precios || {}) }; });
    _cpdPedidos = sPed.docs.map(d => ({ _id: d.id, ...d.data() }));
    _cpdCalcularPendientes();
    cpdRender();
  } catch (err) {
    console.error(err);
    cont.innerHTML = `<div style="background:#fdecea;border:1.5px solid #c0392b;border-radius:var(--radius);padding:12px 16px;color:#c0392b">❌ ${escHTML(err.message||String(err))}</div>`;
  } finally { _cpdCargando = false; }
}

function _cpdCalcularPendientes(){
  const sinLista = {}, faltan = {};
  _cpdPedidos.forEach(p => {
    const key = _cpdNorm(p.cliente); if (!key) return;
    const f = String(p.fecha || '');
    const enLista = _cpdLista[key];
    if (!enLista) {
      const c = sinLista[key] || (sinLista[key] = { key, cliente: key, escritos: new Set(), tel: '', dir: '', _f: '', pedidos: 0, primero: '', ultimo: '', prods: {} });
      c.escritos.add(String(p.cliente));
      c.pedidos++;
      if (f && (!c.primero || f < c.primero)) c.primero = f;
      if (f >= c.ultimo) c.ultimo = f;
      if (f >= c._f) { c._f = f; if (p.telefono) c.tel = p.telefono; if (p.direccion) c.dir = _cpdNorm(p.direccion); }
      (p.productos || []).forEach(pr => {
        const precio = parseFloat(pr.precio); if (!pr.nombre || !(precio > 0)) return;
        const L = c.prods[pr.nombre] || (c.prods[pr.nombre] = { precio, fecha: f, veces: 0 });
        L.veces++; if (f >= L.fecha) { L.precio = precio; L.fecha = f; }
      });
    } else {
      (p.productos || []).forEach(pr => {
        const precio = parseFloat(pr.precio); if (!pr.nombre || !(precio > 0)) return;
        if (parseFloat(enLista.precios[pr.nombre]) > 0) return;
        const k = key + '||' + pr.nombre;
        const L = faltan[k] || (faltan[k] = { key, cliente: enLista.cliente, producto: pr.nombre, precio, fecha: f, veces: 0 });
        L.veces++; if (f >= L.fecha) { L.precio = precio; L.fecha = f; }
      });
    }
  });
  _cpdPend.clientes = Object.values(sinLista).sort((a,b) => (b.ultimo||'').localeCompare(a.ultimo||'') || a.cliente.localeCompare(b.cliente,'es'));
  _cpdPend.precios = Object.values(faltan).sort((a,b) => a.cliente.localeCompare(b.cliente,'es') || a.producto.localeCompare(b.producto,'es'));
}

function cpdCambiarTab(t){ _cpdTab = t; cpdRender(); }

function cpdRender(){
  const cont = document.getElementById('cpdContenido'); if (!cont) return;
  const nPend = _cpdPend.clientes.length + _cpdPend.precios.length;
  const nCli = Object.keys(_cpdLista).length;
  const tabBtn = (id, txt) => `<button class="btn-filter" style="background:${_cpdTab===id?'var(--navy)':'var(--muted)'}" onclick="cpdCambiarTab('${id}')">${txt}</button>`;
  let html = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${tabBtn('pendientes', '⏳ Pendientes (' + nPend + ')')}
      ${tabBtn('clientes', '👥 Clientes en lista (' + nCli + ')')}
      <button class="btn-filter" style="background:var(--teal)" onclick="cpdAbrirEditor(null)">➕ Agregar cliente</button>
    </div>`;
  if (!nCli) html += `<div style="background:#fff4e5;border:1.5px solid #f0c040;border-radius:var(--radius);padding:10px 14px;font-size:12.5px;color:#7a5700;margin-bottom:12px">Esta ruta aún no tiene lista de precios: en la app de pedidos sigue funcionando como siempre (sin bloqueo). El bloqueo se activa en cuanto la ruta tenga al menos un cliente en la lista.</div>`;
  html += _cpdTab === 'clientes' ? _cpdHtmlClientes() : _cpdHtmlPendientes();
  cont.innerHTML = html;
}

const _cpdTabla = (head, body) => `<div class="table-wrap" style="border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:520px;margin-bottom:16px"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
const _cpdBtn = (txt, bg, onclick) => `<button class="btn-filter" style="background:${bg};padding:6px 10px;font-size:12px;margin:2px" onclick="${onclick}">${txt}</button>`;

function _cpdHtmlPendientes(){
  const A = _cpdPend.clientes, B = _cpdPend.precios;
  if (!A.length && !B.length) return '<div class="empty-state"><div class="icon">✅</div>No hay pendientes en esta ruta.</div>';
  let h = '';
  if (A.length) {
    h += `<div style="font-size:13px;font-weight:800;color:var(--navy);margin:4px 0 6px">🆕 Clientes sin lista de precios (${A.length})</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Clientes nuevos que registró el asesor, o clientes antiguos que nunca entraron a la lista. <b>Aprobar</b> crea su lista con los precios que se les cobró (puedes corregirlos). <b>Unir</b> sirve si el asesor lo escribió distinto y en realidad ya existe.</div>`;
    h += _cpdTabla('<th>Cliente</th><th>Teléfono / Dirección</th><th style="text-align:center">Pedidos</th><th>Último</th><th>Precios cobrados</th><th>Acción</th>',
      A.map((c, i) => {
        const prods = Object.entries(c.prods).map(([n, L]) => `${escHTML(n)}: <b>$${_cpdF2(L.precio)}</b>`).join(' · ') || '<span style="color:var(--muted)">solo regalías / $0</span>';
        const nuevo = c.primero && c.pedidos <= 3 ? ' <span style="background:#fff4e5;color:#b45309;border-radius:6px;padding:1px 6px;font-size:10px;font-weight:800">RECIENTE</span>' : '';
        return `<tr><td style="font-weight:700">${escHTML(c.cliente)}${nuevo}</td>
          <td style="font-size:12px">${escHTML(c.tel||'—')}<br><span style="color:var(--muted)">${escHTML(c.dir||'')}</span></td>
          <td style="text-align:center">${c.pedidos}</td><td style="font-size:12px">${escHTML(c.ultimo||'')}</td>
          <td style="font-size:12px;max-width:420px">${prods}</td>
          <td style="white-space:nowrap">${_cpdBtn('✅ Aprobar','var(--teal)',`cpdAprobarCliente(${i})`)}${_cpdBtn('🔗 Unir','var(--orange)',`cpdAbrirUnir(${i})`)}</td></tr>`;
      }).join(''));
  }
  if (B.length) {
    h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0 6px">
        <div style="font-size:13px;font-weight:800;color:var(--navy)">💲 Precios faltantes en la lista (${B.length})</div>
        ${_cpdBtn('✅ Aprobar todos los precios','var(--teal)','cpdAprobarTodosPrecios()')}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Clientes que ya están en la lista y compraron un producto que no tenía precio. Al aprobar, ese precio queda fijo (bloqueado) en la app.</div>`;
    h += _cpdTabla('<th>Cliente</th><th>Producto</th><th>Último cobrado</th><th style="text-align:center">Veces</th><th>Precio a aprobar</th><th>Acción</th>',
      B.map((L, i) => `<tr><td style="font-weight:700">${escHTML(L.cliente)}</td><td>${escHTML(L.producto)}</td>
        <td style="font-size:12px">$${_cpdF2(L.precio)} <span style="color:var(--muted)">(${escHTML(L.fecha||'')})</span></td>
        <td style="text-align:center">${L.veces}</td>
        <td><input type="number" min="0" step="0.01" id="cpdPrecioPend${i}" value="${_cpdF2(L.precio)}" style="width:90px;padding:6px;border:1px solid var(--border);border-radius:6px"></td>
        <td>${_cpdBtn('✅ Aprobar','var(--teal)',`cpdAprobarPrecio(${i})`)}</td></tr>`).join(''));
  }
  return h;
}

function _cpdHtmlClientes(){
  const lista = Object.values(_cpdLista).sort((a,b) => a.cliente.localeCompare(b.cliente,'es'));
  if (!lista.length) return '<div class="empty-state"><div class="icon">👥</div>No hay clientes en la lista de esta ruta.</div>';
  return `<input id="cpdBuscar" placeholder="Buscar cliente o teléfono..." oninput="cpdFiltrarClientes()" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;width:100%;max-width:340px;margin-bottom:10px">` +
    _cpdTabla('<th>Cliente</th><th>Teléfono</th><th>Dirección</th><th>Precios de lista</th><th>Acción</th>',
      lista.map(c => {
        const pr = Object.entries(c.precios).filter(([,v]) => parseFloat(v) > 0).sort((a,b)=>a[0].localeCompare(b[0],'es')).map(([n,v]) => `${escHTML(n)}: <b>$${_cpdF2(v)}</b>`).join(' · ');
        const k = escHTML(c.cliente).replace(/'/g,'&#39;');
        return `<tr class="cpd-fila" data-buscar="${escHTML(_cpdFlex(c.cliente + ' ' + c.telefono))}"><td style="font-weight:700">${escHTML(c.cliente)}</td><td style="font-size:12px">${escHTML(c.telefono||'—')}</td><td style="font-size:12px">${escHTML(c.direccion||'')}</td>
          <td style="font-size:12px;max-width:460px">${pr || '<span style="color:var(--muted)">sin precios</span>'}</td>
          <td style="white-space:nowrap">${_cpdBtn('✏ Editar','var(--navy)',`cpdAbrirEditor('${k}')`)}${_cpdBtn('🗑','var(--red)',`cpdQuitarCliente('${k}')`)}</td></tr>`;
      }).join(''));
}
function cpdFiltrarClientes(){
  const q = _cpdFlex((document.getElementById('cpdBuscar')||{}).value || '');
  document.querySelectorAll('#cpdContenido .cpd-fila').forEach(tr => { tr.style.display = !q || tr.dataset.buscar.includes(q) ? '' : 'none'; });
}

/* ── Editor (agregar / editar / aprobar) ── */
let _cpdEditor = null; // { modo:'nuevo'|'editar'|'aprobar', key }
function _cpdModal(html){
  let ov = document.getElementById('cpdOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'cpdOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,25,40,.55);z-index:900;display:flex;align-items:flex-start;justify-content:center;padding:30px 12px;overflow:auto';
    ov.addEventListener('click', e => { if (e.target === ov) cpdCerrarModal(); });
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:14px;max-width:620px;width:100%;padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,.3)">${html}</div>`;
  ov.style.display = 'flex';
}
function cpdCerrarModal(){ const ov = document.getElementById('cpdOverlay'); if (ov) ov.style.display = 'none'; _cpdEditor = null; }

function cpdAbrirEditor(key, prefill){
  const existente = key ? _cpdLista[key] : null;
  const modo = prefill ? 'aprobar' : (existente ? 'editar' : 'nuevo');
  _cpdEditor = { modo, key: key || null };
  const base = existente || prefill || { cliente: '', telefono: '', direccion: '', precios: {} };
  const productos = _cpdCatalogo.slice();
  Object.keys(base.precios || {}).forEach(n => { if (!productos.includes(n)) productos.push(n); });
  const titulo = modo === 'nuevo' ? '➕ Agregar cliente' : (modo === 'aprobar' ? '✅ Aprobar cliente' : '✏ Editar cliente');
  const inp = (id, val, ph, extra) => `<input id="${id}" value="${escHTML(val||'')}" placeholder="${ph}" ${extra||''} style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;text-transform:uppercase">`;
  _cpdModal(`
    <div style="font-size:16px;font-weight:800;color:var(--navy);margin-bottom:4px">${titulo}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Ruta: <b>${escHTML(_cpdRuta)}</b>. Los precios que dejes vacíos no se bloquean (si el cliente pide ese producto, el asesor pone el precio y queda pendiente).</div>
    <label style="font-size:11px;font-weight:800;color:var(--navy)">CLIENTE</label>
    ${inp('cpdEdNombre', base.cliente, 'NOMBRE DEL CLIENTE', modo === 'nuevo' ? '' : 'disabled')}
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-top:8px">
      <div><label style="font-size:11px;font-weight:800;color:var(--navy)">TELÉFONO</label>${inp('cpdEdTel', base.telefono, '09...')}</div>
      <div><label style="font-size:11px;font-weight:800;color:var(--navy)">DIRECCIÓN</label>${inp('cpdEdDir', base.direccion, 'SECTOR / CALLE')}</div>
    </div>
    <div style="font-size:11px;font-weight:800;color:var(--navy);margin:14px 0 6px">PRECIOS DE LISTA ($)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px">
      ${productos.map((n, i) => { const v = parseFloat((base.precios||{})[n]); return `<label style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;border-bottom:1px dashed var(--border);padding:3px 0"><span>${escHTML(n)}</span><input type="number" min="0" step="0.01" class="cpd-ed-precio" data-prod="${escHTML(n)}" value="${v > 0 ? _cpdF2(v) : ''}" style="width:86px;padding:5px 6px;border:1px solid var(--border);border-radius:6px;text-align:right"></label>`; }).join('')}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
      <button class="btn-filter" style="background:var(--muted)" onclick="cpdCerrarModal()">Cancelar</button>
      <button class="btn-filter" id="cpdBtnGuardar" style="background:var(--teal)" onclick="cpdGuardarEditor()">💾 Guardar</button>
    </div>`);
}

function cpdAprobarCliente(i){
  const c = _cpdPend.clientes[i]; if (!c) return;
  const precios = {}; Object.entries(c.prods).forEach(([n, L]) => { precios[n] = L.precio; });
  cpdAbrirEditor(null, { cliente: c.cliente, telefono: c.tel, direccion: c.dir, precios });
}

async function cpdGuardarEditor(){
  if (!_cpdEditor) return;
  const nombre = _cpdNorm(document.getElementById('cpdEdNombre').value).replace(/\s+/g,' ');
  const telefono = String(document.getElementById('cpdEdTel').value || '').trim();
  const direccion = _cpdNorm(document.getElementById('cpdEdDir').value);
  if (!nombre) { alert('Escribe el nombre del cliente.'); return; }
  const precios = {};
  for (const el of document.querySelectorAll('#cpdOverlay .cpd-ed-precio')) {
    const v = String(el.value || '').trim(); if (!v) continue;
    const n = parseFloat(v);
    if (!(n >= 0) || n > 99999) { alert('Precio inválido en ' + el.dataset.prod); return; }
    if (n > 0) precios[el.dataset.prod] = +n.toFixed(2);
  }
  const { modo } = _cpdEditor;
  if (modo === 'nuevo') {
    if (_cpdLista[nombre]) { alert('Ese cliente ya está en la lista de esta ruta. Usa ✏ Editar.'); return; }
    const flex = _cpdFlex(nombre);
    const conocidos = new Set([...Object.keys(_cpdLista), ..._cpdPedidos.map(p => _cpdNorm(p.cliente))]);
    const parecido = [...conocidos].find(k => k !== nombre && _cpdFlex(k) === flex);
    if (parecido && !confirm(`Ya existe "${parecido}", que es casi igual.\n\n¿Seguro que "${nombre}" es otro cliente distinto?`)) return;
  }
  const btn = document.getElementById('cpdBtnGuardar'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  const ahora = firebase.firestore.FieldValue.serverTimestamp();
  try {
    if (modo === 'editar') {
      const c = _cpdLista[_cpdEditor.key];
      await c.ref.update({ precios, telefono, direccion, actualizadoPor: _cpdUid(), actualizadoEn: ahora });
    } else {
      const id = _cpdId(_cpdRuta, nombre);
      await db.collection('preciosClientes').doc(id).set({ cliente: nombre, clienteKey: nombre, empleado: _cpdRuta, precios, telefono, direccion, fuente: modo === 'aprobar' ? 'aprobacion' : 'dashboard', actualizadoPor: _cpdUid(), actualizadoEn: ahora }, { merge: true });
    }
    cpdCerrarModal();
    _cpdToast(modo === 'editar' ? '✅ Cliente actualizado.' : (modo === 'aprobar' ? '✅ Cliente aprobado y agregado a la lista.' : '✅ Cliente agregado a la lista.'));
    await cpdCargar();
  } catch (err) {
    console.error(err); alert('❌ No se pudo guardar: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar'; }
  }
}

async function cpdAprobarPrecio(i, silencioso){
  const L = _cpdPend.precios[i]; if (!L) return false;
  const el = document.getElementById('cpdPrecioPend' + i);
  const v = parseFloat(el ? el.value : L.precio);
  if (!(v > 0)) { if (!silencioso) alert('Escribe un precio mayor a 0.'); return false; }
  const c = _cpdLista[L.key]; if (!c) return false;
  await c.ref.set({ precios: { [L.producto]: +v.toFixed(2) }, actualizadoPor: _cpdUid(), actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  if (!silencioso) { _cpdToast(`✅ ${L.cliente}: ${L.producto} $${_cpdF2(v)}`); await cpdCargar(); }
  return true;
}
async function cpdAprobarTodosPrecios(){
  const n = _cpdPend.precios.length; if (!n) return;
  if (!confirm(`¿Aprobar los ${n} precio(s) faltantes con los valores escritos en la tabla?`)) return;
  let ok = 0;
  try { for (let i = 0; i < n; i++) { if (await cpdAprobarPrecio(i, true)) ok++; } }
  catch (err) { console.error(err); alert('❌ ' + err.message); }
  _cpdToast(`✅ ${ok} precio(s) aprobados.`); await cpdCargar();
}

async function cpdQuitarCliente(key){
  const c = _cpdLista[key]; if (!c) return;
  if (!confirm(`¿Quitar a "${c.cliente}" de la lista de precios de ${_cpdRuta}?\n\nNo borra sus pedidos ni pagos. En la app ya no tendrá precios bloqueados y volverá a aparecer en Pendientes si tiene ventas.`)) return;
  try { await c.ref.delete(); _cpdToast('🗑 Cliente quitado de la lista.'); await cpdCargar(); }
  catch (err) { console.error(err); alert('❌ ' + err.message); }
}

/* ── Unir un cliente pendiente con uno existente (corrige el nombre en sus registros) ── */
function cpdAbrirUnir(i){
  const c = _cpdPend.clientes[i]; if (!c) return;
  const destinos = Object.keys(_cpdLista).sort((a,b) => a.localeCompare(b,'es'));
  if (!destinos.length) { alert('No hay clientes en la lista de esta ruta para unir.'); return; }
  const flex = _cpdFlex(c.cliente).split(' ');
  const sugerido = destinos.map(d => ({ d, s: _cpdFlex(d).split(' ').filter(w => w.length > 2 && flex.includes(w)).length })).sort((a,b) => b.s - a.s)[0];
  _cpdModal(`
    <div style="font-size:16px;font-weight:800;color:var(--navy);margin-bottom:6px">🔗 Unir cliente</div>
    <div style="font-size:12.5px;color:var(--muted);margin-bottom:12px">Usa esto cuando el asesor registró como nuevo a un cliente que ya existe. Sus <b>${c.pedidos} pedido(s)</b>, sus pagos y sus envases pasarán al nombre elegido. No cambia montos ni fechas.</div>
    <div style="font-size:13px;margin-bottom:6px">Cliente registrado: <b>${escHTML(c.cliente)}</b> ${c.tel ? '· ' + escHTML(c.tel) : ''}</div>
    <label style="font-size:11px;font-weight:800;color:var(--navy)">ES EL MISMO QUE</label>
    <input id="cpdUnirDestino" list="cpdUnirLista" value="${sugerido && sugerido.s ? escHTML(sugerido.d) : ''}" placeholder="Escribe o elige el cliente existente" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;text-transform:uppercase">
    <datalist id="cpdUnirLista">${destinos.map(d => `<option value="${escHTML(d)}">`).join('')}</datalist>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
      <button class="btn-filter" style="background:var(--muted)" onclick="cpdCerrarModal()">Cancelar</button>
      <button class="btn-filter" id="cpdBtnUnir" style="background:var(--orange)" onclick="cpdConfirmarUnir(${i})">🔗 Unir</button>
    </div>`);
}

async function cpdConfirmarUnir(i){
  const c = _cpdPend.clientes[i]; if (!c) return;
  const destino = _cpdNorm((document.getElementById('cpdUnirDestino')||{}).value);
  if (!destino || !_cpdLista[destino]) { alert('Elige un cliente que esté en la lista de esta ruta.'); return; }
  if (destino === c.cliente) { alert('Es el mismo nombre.'); return; }
  const nombres = [...c.escritos];
  const btn = document.getElementById('cpdBtnUnir'); if (btn) { btn.disabled = true; btn.textContent = 'Buscando registros...'; }
  try {
    const refs = [];
    _cpdPedidos.filter(p => _cpdNorm(p.cliente) === c.key).forEach(p => refs.push(db.collection('pedidos').doc(p._id)));
    for (const col of ['pagos', 'envasesPrestamos']) {
      for (const n of nombres) {
        try { const s = await db.collection(col).where('cliente','==',n).get(); s.forEach(d => { if ((d.data().empleado||'') === _cpdRuta) refs.push(d.ref); }); }
        catch (e) { console.warn('Unir: no se pudo leer ' + col, e); }
      }
    }
    if (!confirm(`¿Unir "${c.cliente}" con "${destino}"?\n\nSe cambiará el nombre del cliente en ${refs.length} registro(s) (pedidos, pagos y envases) de ${_cpdRuta}.\nNo cambia montos, fechas ni productos.`)) { if (btn) { btn.disabled = false; btn.textContent = '🔗 Unir'; } return; }
    if (btn) btn.textContent = 'Uniendo...';
    for (let k = 0; k < refs.length; k += 400) {
      const lote = db.batch();
      refs.slice(k, k + 400).forEach(r => lote.update(r, { cliente: destino }));
      await lote.commit();
    }
    cpdCerrarModal();
    _cpdToast(`✅ ${c.cliente} → ${destino}: ${refs.length} registro(s) actualizados.`);
    await cpdCargar();
  } catch (err) {
    console.error(err); alert('❌ No se pudo unir: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = '🔗 Unir'; }
  }
}
