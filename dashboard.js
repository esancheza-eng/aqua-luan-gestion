/* Restaura dashboard.js original (commit b9afe62) y aplica corrección de Movimientos Bancarios. */
(function () {
  var ORIGIN = 'https://cdn.jsdelivr.net/gh/esancheza-eng/aqua-luan-gestion@b9afe629a48daeded2457f9fe120a2734a404e96/dashboard.js';
  var s = document.createElement('script');
  s.src = ORIGIN;
  s.onload = function () {
    if (typeof renderMovimientosBancarios !== 'function') return;

    renderMovimientosBancarios = async function () {
      const tbody = document.getElementById('mbTbody');
      const totalEl = document.getElementById('mbTotal');
      const st = document.getElementById('mbStatus');
      const btn = document.getElementById('mbBtnGuardar');
      if (!tbody) return;
      let lineas = _lineasMovimientosDesdeDatos();
      try {
        if (typeof db !== 'undefined') {
          const rutasSet = new Set([...(Array.isArray(_asesoresCache) ? _asesoresCache : []), ...(_pedidosRaw || []).map(p => p.empleado || ''), ...(_pagosRaw || []).map(p => p.empleado || '')].filter(Boolean));
          const entregas = await Promise.all([...rutasSet].map(async nombre => {
            try {
              const snap = await db.collection('cierresLiquidacion').doc(_idEntregaLiquidacion(nombre)).get();
              return { nombre, data: snap.exists ? snap.data() : {} };
            } catch (err) { return { nombre, data: {} }; }
          }));
          entregas.forEach(({ nombre, data }) => {
            const deps = Array.isArray(data.depositos) && data.depositos.length ? data.depositos : null;
            if (deps) {
              deps.forEach(dep => {
                const monto = dep && dep.marcado ? (Number(dep.monto) || 0) : 0;
                if (monto > 0) lineas.push({ asesor: nombre, valor: monto, metodo: 'Depósito' });
              });
            } else {
              const dep = data.deposito;
              const monto = dep && dep.marcado ? (Number(dep.monto) || 0) : 0;
              if (monto > 0) lineas.push({ asesor: nombre, valor: monto, metodo: 'Depósito' });
            }
          });
        }
      } catch (err) { console.warn('movimientosBancarios depositos:', err); }
      lineas.sort((a, b) => {
        const na = _nombreCortoAsesor(a.asesor).localeCompare(_nombreCortoAsesor(b.asesor), 'es');
        if (na !== 0) return na;
        return String(a.metodo).localeCompare(String(b.metodo), 'es');
      });
      let guardado = {};
      try {
        if (typeof db !== 'undefined') {
          const id = _idMovimientosBancarios();
          const snapCierre = await db.collection('cierresDelDia').doc(id).get();
          const dataCierre = snapCierre.exists ? (snapCierre.data() || {}) : {};
          if (dataCierre.movimientosBancarios && typeof dataCierre.movimientosBancarios === 'object') {
            guardado = dataCierre.movimientosBancarios || {};
          } else {
            try {
              const snap = await db.collection('movimientosBancarios').doc(id).get();
              if (snap.exists) guardado = snap.data() || {};
            } catch (errCol) { console.warn('movimientosBancarios lectura coleccion:', errCol); }
          }
        }
      } catch (err) { console.warn('movimientosBancarios lectura:', err); }
      _mbBloqueado = !!guardado.bloqueado;
      const porId = {};
      (guardado.filas || []).forEach(f => { if (f && f.id) porId[f.id] = f; });
      const total = lineas.reduce((sum, l) => sum + (Number(l.valor) || 0), 0);
      if (totalEl) totalEl.textContent = '$' + total.toFixed(2);
      if (!lineas.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;font-style:italic;padding:18px">No hay transferencias, cheques ni depósitos en este período.</td></tr>';
      } else {
        tbody.innerHTML = lineas.map((l, idx) => {
          const id = _idFilaMovBanc(l, idx);
          const saved = porId[id] || {};
          const cuenta = saved.cuenta || '';
          const banco = saved.banco || '';
          const dis = _mbBloqueado ? 'disabled' : '';
          return `<tr data-mb-id="${escHTML(id)}" data-asesor="${escHTML(l.asesor)}" data-valor="${Number(l.valor).toFixed(2)}" data-metodo="${escHTML(l.metodo)}">
        <td style="font-weight:800;color:var(--navy)">${escHTML(_nombreCortoAsesor(l.asesor))}</td>
        <td style="text-align:right;font-weight:700">$${Number(l.valor).toFixed(2)}</td>
        <td>${escHTML(l.metodo)}</td>
        <td>${_htmlSelectCuentaMB(cuenta, dis)}</td>
        <td>${_htmlInputBancoMB(banco, dis)}</td>
      </tr>`;
        }).join('');
      }
      if (btn) {
        btn.style.display = _mbBloqueado ? 'none' : 'inline-flex';
        btn.disabled = _mbBloqueado;
      }
      if (st) {
        st.textContent = _mbBloqueado
          ? ('Guardado' + (guardado.actualizadoPor ? ' por ' + guardado.actualizadoPor : '') + ' — ya no se puede editar.')
          : 'Elige la cuenta y el banco (o escribe otro banco). Al guardar se bloquea la hoja.';
      }
    };

    guardarMovimientosBancarios = async function () {
      if (_mbBloqueado) { alert('Esta hoja ya fue guardada y no se puede editar.'); return; }
      if (typeof db === 'undefined') { alert('No hay conexión para guardar.'); return; }
      const filas = [...document.querySelectorAll('#mbTbody tr[data-mb-id]')].map(tr => ({
        id: tr.dataset.mbId || '',
        asesor: tr.dataset.asesor || '',
        valor: parseFloat(tr.dataset.valor || 0) || 0,
        metodo: tr.dataset.metodo || '',
        cuenta: (tr.querySelector('.mb-cuenta')?.value || '').trim(),
        banco: _valorBancoFilaMB(tr)
      }));
      if (!filas.length) { alert('No hay movimientos para guardar en este período.'); return; }
      const incompletas = filas.filter(f => !f.cuenta || !f.banco);
      if (incompletas.length) {
        const nombres = [...new Set(incompletas.map(f => _nombreCortoAsesor(f.asesor)))].join(', ');
        alert('Completa Nombre de cuenta y Banco en todas las filas antes de guardar.\nFaltan: ' + nombres);
        const st0 = document.getElementById('mbStatus');
        if (st0) st0.textContent = 'Falta cuenta o banco en una o más filas.';
        return;
      }
      if (!confirm('Al guardar, Nombre de cuenta y Banco quedarán bloqueados. ¿Continuar?')) return;
      const st = document.getElementById('mbStatus');
      if (st) st.textContent = 'Guardando…';
      const periodo = _idMovimientosBancarios();
      const payload = {
        periodo,
        bloqueado: true,
        filas,
        actualizadoPor: (typeof actorAuditoria === 'function') ? actorAuditoria() : 'sistema',
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
      };
      try {
        await db.collection('cierresDelDia').doc(periodo).set({
          movimientosBancarios: payload,
          actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
          actualizadoPor: payload.actualizadoPor
        }, { merge: true });
        try {
          await db.collection('movimientosBancarios').doc(periodo).set(payload, { merge: true });
        } catch (errCol) {
          console.warn('movimientosBancarios coleccion opcional:', errCol);
        }
        if (typeof _registrarAuditoria === 'function') {
          _registrarAuditoria('movimientosBancarios', 'edición', periodo, 'Movimientos bancarios guardados por ' + payload.actualizadoPor);
        }
        _mbBloqueado = true;
        await renderMovimientosBancarios();
        if (st) st.textContent = 'Guardado correctamente — ya no se puede editar.';
      } catch (err) {
        console.warn('movimientosBancarios escritura:', err);
        const detalle = (err && (err.message || err.code)) ? String(err.message || err.code) : 'error desconocido';
        alert('No se pudo guardar los movimientos bancarios.\nDetalle: ' + detalle);
        if (st) st.textContent = 'No se pudo guardar. ' + detalle;
      }
    };
  };
  s.onerror = function () {
    console.error('No se pudo cargar dashboard.js original desde jsDelivr');
  };
  document.head.appendChild(s);
})();
