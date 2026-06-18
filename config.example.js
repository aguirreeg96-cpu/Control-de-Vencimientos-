/* ============================================================
   LOGICONTROL PRO — config.example.js
   Ejemplo de cómo debería quedar config.js en producción.
   NO es el archivo activo. Editar config.js directamente.
   ============================================================ */
(function () {
  'use strict';

  var hostname = window.location.hostname;
  var isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  window.APP_CONFIG = {
    API_BASE_URL: isLocal
      ? 'http://localhost:3000/api'
      : 'https://logicontrol-pro-api.onrender.com/api',
  };
})();
