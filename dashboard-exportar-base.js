/* ════════════════════════════════════════════════════════════
   [NEW][TEMPORAL] EXPORTAR BASE — clientes, productos, precios,
   direcciones y teléfonos por ruta, a un Excel.

   · SOLO LECTURA: lee 'pedidos', 'preciosClientes' y 'productos'.
     No escribe, no edita y no borra nada en Firebase.
   · Archivo independiente: no modifica ninguna función existente.
     Para quitarlo basta con borrar este archivo, su <script> y el
     botón/sección "Exportar Base" de index.html.
   · Solo Administración (no está en SECCIONES_SECRETARIA, así que el
     botón se oculta solo para la secretaria).

   Además define cargarXLSX(): el comentario de index.html dice que
   SheetJS se carga "la primera vez que el admin entra a Importar Datos
   (ver cargarXLSX en dashboard.js)", pero esa función no existe en
   dashboard.js, así que XLSX nunca se cargaba y "Leer archivo" fallaba.
   Aquí se carga al entrar a Importar Datos o a Exportar Base.
════════════════════════════════════════════════════════════ */
(function(){
  const URLS_XLSX = [
    'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  ];
  let _promesaXLSX = null;
  function _cargarScript(url){
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => ok(); s.onerror = () => { s.remove(); mal(new Error('No cargó ' + url)); };
      document.head.appendChild(s);
    });
  }
  window.cargarXLSX = function(){
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (_promesaXLSX) return _promesaXLSX;
    _promesaXLSX = (async () => {
      for (const u of URLS_XLSX) {
        try { await _cargarScript(u); if (window.XLSX) return window.XLSX; } catch(e) { console.warn(e.message); }
      }
      _promesaXLSX = null;
      throw new Error('No se pudo descargar la librería de Excel (SheetJS). Revisa la conexión a internet.');
    })();
    return _promesaXLSX;
  };
  // Precarga al entrar a Importar Datos / Exportar Base (solo agrega un listener; no toca switchSeccionDash)
  document.addEventListener('click', function(e){
    const b = e.target && e.target.closest && e.target.closest('#navImportar, #navExportarBase');
    if (b) window.cargarXLSX().catch(err => console.warn(err.message));
    if (b && b.id === 'navExportarBase') ebPoblarRutas();
  }, true);
})();

function _ebNorm(s){ return String(s||'').trim().replace(/\s+/g,' ').toLocaleUpperCase('es-EC'); }
/* Clave "flexible" para detectar el mismo cliente escrito distinto: sin tildes, sin puntos/guiones, espacios simples */
function _ebClaveFlex(s){ return _ebNorm(s).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9Ñ ]/g,' ').replace(/\s+/g,' ').trim(); }
function _ebTel(s){ const d = String(s||'').replace(/\D/g,''); return d.length >= 7 ? d : ''; }
function _ebRuta(emp){
  const t = String(emp||'').trim();
  if (!t) return 'SIN RUTA';
  return (typeof _matchAsesorCanonico === 'function' ? _matchAsesorCanonico(t) : t) || t;
}
function _ebFechaHoy(){ const d = new Date(), p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }

function ebPoblarRutas(){
  const sel = document.getElementById('ebRuta');
  if (!sel) return;
  const actual = sel.value;
  const rutas = (Array.isArray(_asesoresCache) ? _asesoresCache.slice() : []).sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
  sel.innerHTML = '<option value="">— Todas las rutas —</option>' + rutas.map(r => `<option value="${escHTML(r)}">${escHTML(r)}</option>`).join('');
  if (sel.dataset.inicializado) { if (actual === '' || rutas.includes(actual)) sel.value = actual; }
  else { const r3 = rutas.find(r => /^RUTA\s*3\b/i.test(r)); if (r3) sel.value = r3; }
  sel.dataset.inicializado = '1';
}

async function ebGenerarExportacion(){
  const btn = document.getElementById('btnEbExportar');
  const out = document.getElementById('ebResultado');
  const rutaSel = (document.getElementById('ebRuta') || {}).value || '';
  const set = (html) => { if (out) out.innerHTML = html; };
  if (btn) { btn.disabled = true; btn.textContent = 'Leyendo base...'; }
  set('<div class="loading"><div class="spinner"></div><span>Leyendo pedidos, lista de precios y catálogo (solo lectura)...</span></div>');
  try {
    const XL = await window.cargarXLSX();
    const [snapPed, snapPre, snapProd] = await Promise.all([
      db.collection('pedidos').get(),
      db.collection('preciosClientes').get(),
      db.collection('productos').get().catch(() => null)
    ]);

    // ── Catálogo
    const catalogo = [];
    if (snapProd) snapProd.forEach(d => { const x = d.data(); if (x && x.nombre) catalogo.push({ nombre: x.nombre, activo: x.activo !== false }); });
    catalogo.sort((a,b) => a.nombre.localeCompare(b.nombre,'es'));
    const catActivos = new Set(catalogo.filter(c => c.activo).map(c => c.nombre));
    const enCatalogo = (n) => !catalogo.length ? '' : (catActivos.has(n) ? 'SI' : 'NO');

    const clientes = {};   // ruta||CLIENTE
    const lineas = {};     // ruta||CLIENTE||PRODUCTO
    const kCli = (ruta, cli) => ruta + '||' + _ebNorm(cli);
    const getCli = (ruta, cli) => {
      const k = kCli(ruta, cli);
      return clientes[k] || (clientes[k] = { ruta, cliente: _ebNorm(cli), tel:'', dir:'', _fTel:'', _fDir:'', pedidos:0, importados:0, primero:'', ultimo:'', total:0, lista:false, nLista:0, escritos:new Set() });
    };
    const getLin = (c, prod) => {
      const k = c.ruta + '||' + c.cliente + '||' + prod;
      return lineas[k] || (lineas[k] = { c, producto: prod, precioLista:null, ultPrecio:null, fUltPrecio:'', veces:0, cantidad:0 });
    };

    // ── Pedidos
    let pedLeidos = 0;
    snapPed.forEach(doc => {
      const p = doc.data();
      if (!p || !p.cliente) return;
      const ruta = _ebRuta(p.empleado);
      if (rutaSel && ruta !== rutaSel) return;
      pedLeidos++;
      const c = getCli(ruta, p.cliente);
      const f = String(p.fecha || '');
      c.escritos.add(String(p.cliente).trim());
      c.pedidos++; if (p.importado) c.importados++;
      c.total += parseFloat(p.total) || 0;
      if (f && (!c.primero || f < c.primero)) c.primero = f;
      if (f >= c.ultimo) c.ultimo = f;
      if (p.telefono && f >= c._fTel) { c.tel = String(p.telefono).trim(); c._fTel = f; }
      if (p.direccion && f >= c._fDir) { c.dir = _ebNorm(p.direccion); c._fDir = f; }
      (p.productos || []).forEach(pr => {
        if (!pr || !pr.nombre) return;
        const L = getLin(c, String(pr.nombre).trim());
        const cant = parseFloat(pr.cantidad) || 0, precio = parseFloat(pr.precio);
        L.veces++; L.cantidad += cant;
        if (precio > 0 && f >= L.fUltPrecio) { L.ultPrecio = precio; L.fUltPrecio = f; } // regalías / $0 no cuentan como precio
      });
    });

    // ── Lista de precios oficial
    snapPre.forEach(doc => {
      const x = doc.data();
      if (!x || !x.cliente) return;
      const ruta = _ebRuta(x.empleado);
      if (rutaSel && ruta !== rutaSel) return;
      const c = getCli(ruta, x.cliente);
      c.escritos.add(String(x.cliente).trim());
      c.lista = true;
      if (!c.tel && x.telefono) c.tel = String(x.telefono).trim();
      if (!c.dir && x.direccion) c.dir = _ebNorm(x.direccion);
      Object.entries(x.precios || {}).forEach(([prod, pr]) => {
        const L = getLin(c, String(prod).trim());
        L.precioLista = parseFloat(pr) || 0; c.nLista++;
      });
    });

    const listaCli = Object.values(clientes).sort((a,b) => a.ruta.localeCompare(b.ruta,'es',{numeric:true}) || a.cliente.localeCompare(b.cliente,'es'));
    const listaLin = Object.values(lineas).sort((a,b) => a.c.ruta.localeCompare(b.c.ruta,'es',{numeric:true}) || a.c.cliente.localeCompare(b.c.cliente,'es') || a.producto.localeCompare(b.producto,'es'));

    // ── Posibles duplicados (dentro de la misma ruta)
    const dup = [];
    const porRuta = {};
    listaCli.forEach(c => (porRuta[c.ruta] = porRuta[c.ruta] || []).push(c));
    Object.entries(porRuta).forEach(([ruta, cs]) => {
      const flex = {}, tel = {};
      cs.forEach(c => {
        (flex[_ebClaveFlex(c.cliente)] = flex[_ebClaveFlex(c.cliente)] || []).push(c);
        const t = _ebTel(c.tel); if (t) (tel[t] = tel[t] || []).push(c);
      });
      Object.values(flex).filter(g => g.length > 1).forEach(g => dup.push({ ruta, motivo:'Mismo nombre escrito distinto (tildes, puntos o espacios)', g }));
      Object.entries(tel).filter(([,g]) => g.length > 1).forEach(([t, g]) => dup.push({ ruta, motivo:'Mismo teléfono ' + t, g }));
    });

    // ── Hojas
    const hCli = listaCli.map(c => ({
      'RUTA': c.ruta, 'CLIENTE': c.cliente, 'TELEFONO': c.tel, 'DIRECCION': c.dir,
      'N PEDIDOS': c.pedidos, 'PEDIDOS IMPORTADOS': c.importados,
      'PRIMER PEDIDO': c.primero, 'ULTIMO PEDIDO': c.ultimo, 'TOTAL COMPRADO $': +c.total.toFixed(2),
      'EN LISTA DE PRECIOS': c.lista ? 'SI' : 'NO', 'PRECIOS EN LISTA': c.nLista
    }));
    const hLin = listaLin.map(L => ({
      'RUTA': L.c.ruta, 'CLIENTE': L.c.cliente, 'TELEFONO': L.c.tel, 'DIRECCION': L.c.dir,
      'PRODUCTO': L.producto, 'PRODUCTO EN CATALOGO': enCatalogo(L.producto),
      'PRECIO LISTA OFICIAL': L.precioLista != null ? L.precioLista : '',
      'ULTIMO PRECIO VENDIDO': L.ultPrecio != null ? L.ultPrecio : '', 'FECHA ULTIMO PRECIO': L.fUltPrecio,
      'PRECIO QUE SUGIERE LA APP': (L.precioLista > 0 ? L.precioLista : (L.ultPrecio != null ? L.ultPrecio : '')),
      'VECES COMPRADO': L.veces, 'CANTIDAD TOTAL': L.cantidad
    }));
    const hDup = [];
    dup.forEach((d, i) => d.g.forEach(c => hDup.push({ 'GRUPO': i+1, 'RUTA': d.ruta, 'MOTIVO': d.motivo, 'CLIENTE': c.cliente, 'TELEFONO': c.tel, 'DIRECCION': c.dir, 'N PEDIDOS': c.pedidos, 'EN LISTA DE PRECIOS': c.lista ? 'SI' : 'NO' })));
    const hCat = catalogo.map(c => ({ 'PRODUCTO': c.nombre, 'ACTIVO': c.activo ? 'SI' : 'NO' }));
    const fueraCat = [...new Set(listaLin.filter(L => enCatalogo(L.producto) === 'NO').map(L => L.producto))].sort();

    const wb = XL.utils.book_new();
    const hoja = (rows, vacio, anchos) => { const ws = XL.utils.json_to_sheet(rows.length ? rows : [{ 'INFO': vacio }]); if (anchos) ws['!cols'] = anchos.map(w => ({ wch: w })); return ws; };
    XL.utils.book_append_sheet(wb, hoja(hCli, 'Sin clientes', [18,32,13,34,10,11,13,13,13,11,10]), 'CLIENTES');
    XL.utils.book_append_sheet(wb, hoja(hLin, 'Sin productos', [18,32,13,34,22,12,12,12,13,14,10,10]), 'PRODUCTOS_PRECIOS');
    XL.utils.book_append_sheet(wb, hoja(hDup, 'No se detectaron posibles duplicados', [7,18,52,32,13,34,10,11]), 'POSIBLES_DUPLICADOS');
    XL.utils.book_append_sheet(wb, hoja(hCat, 'No se pudo leer el catálogo', [26,8]), 'CATALOGO_PRODUCTOS');
    const nombreRuta = rutaSel ? rutaSel.replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'') : 'TODAS';
    const archivo = `Base_AquaLuan_${nombreRuta}_${_ebFechaHoy()}.xlsx`;
    XL.writeFile(wb, archivo);

    set(`<div style="background:#e6f4f2;border:1.5px solid #4ec9a0;border-radius:var(--radius);padding:12px 16px;font-size:13px;line-height:1.8;color:var(--navy)">
      ✅ Descargado <b>${escHTML(archivo)}</b><br>
      Ruta: <b>${escHTML(rutaSel || 'Todas')}</b> · Pedidos leídos: <b>${pedLeidos}</b> · Clientes: <b>${listaCli.length}</b> · Líneas cliente/producto: <b>${listaLin.length}</b><br>
      Clientes en lista de precios: <b>${listaCli.filter(c=>c.lista).length}</b> · Con pedidos importados antes: <b>${listaCli.filter(c=>c.importados).length}</b><br>
      Posibles duplicados: <b style="color:${dup.length?'var(--red)':'inherit'}">${dup.length} grupo(s)</b> (hoja POSIBLES_DUPLICADOS)
      ${fueraCat.length ? `<br>⚠️ Productos que <b>no están en el catálogo</b> actual (nombres viejos o mal escritos): ${fueraCat.map(escHTML).join(' · ')}` : ''}
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Solo lectura: no se modificó nada en la base.</div></div>`);
  } catch(err) {
    console.error(err);
    set(`<div style="background:#fdecea;border:1.5px solid #c0392b;border-radius:var(--radius);padding:12px 16px;font-size:13px;color:#c0392b">❌ ${escHTML(err.message || String(err))}</div>`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Generar y descargar Excel'; }
  }
}
