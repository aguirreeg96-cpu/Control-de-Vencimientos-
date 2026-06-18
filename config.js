/* ============================================================
   LOGICONTROL PRO — config.js
   Configuración de URL del backend.
   Cargado antes de api.js.

   En producción: reemplazar el placeholder con la URL real
   de Render una vez que esté disponible.
   ============================================================ */
(function () {
  'use strict';

  var hostname = window.location.hostname;
  var isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  window.APP_CONFIG = {
    // URL base de la API (sin barra final)
    API_BASE_URL: isLocal
      ? 'http://localhost:3000/api'
      : 'https://REEMPLAZAR-CON-URL-DE-RENDER.onrender.com/api',
  };
})();
