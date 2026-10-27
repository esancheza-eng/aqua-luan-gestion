/* ══════════════════════════════════════════════════════════════════════
   [NEW 27-oct-2026] ACCESOS POR USUARIO (Secretaria)
   Ajusta qué secciones del menú ve UN usuario de Secretaria en particular,
   sin cambiar lo que ven las demás secretarias ni Administración.

   · JSIGUENZA → + Clientes y Precios · − Consulta Cobranzas (queda Cobranzas por Asesor)
   · JLOPEZ    → − Consulta Cobranzas (queda Cobranzas por Asesor)

   Cómo funciona: antes de que el dashboard aplique las restricciones de rol
   (aplicarRestriccionesRol), se ajusta la lista SECCIONES_SECRETARIA según el
   usuario que inició sesión; al entrar otro usuario se restaura la lista base.
   Archivo independiente: no modifica ninguna función ni fórmula existente.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  try {
    /* Usuario (en MAYÚSCULAS) → secciones a agregar / quitar */
    var ACCESOS_POR_USUARIO = {
      'JSIGUENZA': { agregar: ['clientesPrecios'], quitar: ['cobranzasClientes'] },
      'JLOPEZ':    { agregar: [],                  quitar: ['cobranzasClientes'] }
    };

    var aplicado = { agregados: [], quitados: [] };

    function usuarioActual() {
      var u = (typeof ADMIN_ACTUAL !== 'undefined' && ADMIN_ACTUAL && ADMIN_ACTUAL.usuario) || '';
      if (!u) {
        try {
          var em = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.email) || '';
          u = em.split('@')[0] || '';
        } catch (e) {}
      }
      return String(u).trim().toUpperCase();
    }

    function ajustarSecciones() {
      if (typeof SECCIONES_SECRETARIA === 'undefined' || !Array.isArray(SECCIONES_SECRETARIA)) return;
      /* 1) Restaurar la lista base (deshacer lo aplicado al usuario anterior) */
      aplicado.agregados.forEach(function (s) {
        var i = SECCIONES_SECRETARIA.indexOf(s);
        if (i >= 0) SECCIONES_SECRETARIA.splice(i, 1);
      });
      aplicado.quitados.forEach(function (s) {
        if (SECCIONES_SECRETARIA.indexOf(s) < 0) SECCIONES_SECRETARIA.push(s);
      });
      aplicado = { agregados: [], quitados: [] };

      /* 2) Aplicar los accesos del usuario actual (solo Secretaria) */
      if (typeof ROL_ACTUAL === 'undefined' || ROL_ACTUAL !== 'secretaria') return;
      var cfg = ACCESOS_POR_USUARIO[usuarioActual()];
      if (!cfg) return;
      (cfg.agregar || []).forEach(function (s) {
        if (SECCIONES_SECRETARIA.indexOf(s) < 0) { SECCIONES_SECRETARIA.push(s); aplicado.agregados.push(s); }
      });
      (cfg.quitar || []).forEach(function (s) {
        var i = SECCIONES_SECRETARIA.indexOf(s);
        if (i >= 0) { SECCIONES_SECRETARIA.splice(i, 1); aplicado.quitados.push(s); }
      });
    }

    /* Enganche: se ajusta la lista justo antes de ocultar/mostrar el menú */
    if (typeof aplicarRestriccionesRol === 'function') {
      var _aplicarOriginal = aplicarRestriccionesRol;
      aplicarRestriccionesRol = function () {
        try { ajustarSecciones(); } catch (e) { console.warn('accesos-usuario', e); }
        return _aplicarOriginal.apply(this, arguments);
      };
    }

    /* Por si la sesión ya estaba iniciada cuando cargó este archivo */
    if (typeof ROL_ACTUAL !== 'undefined' && ROL_ACTUAL && typeof aplicarRestriccionesRol === 'function') {
      try { aplicarRestriccionesRol(); } catch (e) {}
    }
  } catch (e) {
    console.warn('dashboard-accesos-usuario.js', e);
  }
})();
