# LOGICONTROL PRO — Guía de Despliegue en Producción

Backend: Render · Frontend: Netlify · Base de datos: Supabase (existente)

---

## Orden de despliegue

```
1. Publicar backend en Render     → obtenés URL pública del backend
2. Actualizar config.js           → reemplazar placeholder con URL de Render → commit → push
3. Publicar frontend en Netlify   → obtenés URL pública del frontend
4. Configurar FRONTEND_URL        → agregar URL de Netlify en Render → reiniciar backend
5. Probar login desde Netlify
```

---

## 1. Backend en Render

### 1.1 Crear el servicio

1. Entrá a [render.com](https://render.com) y creá una cuenta si no tenés una.
2. Nuevo → **Web Service**.
3. Conectá tu cuenta de GitHub y elegí el repositorio `Control-de-Vencimientos-`.
4. Seleccioná la rama: `claude/bold-gauss-0mgzfe` (o `main` si ya mergeaste).

### 1.2 Configuración del servicio

| Campo | Valor |
|---|---|
| **Name** | `logicontrol-pro-api` (o el que quieras) |
| **Root Directory** | `backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npx prisma generate && npx prisma migrate deploy && npm run build` |
| **Start Command** | `npm run start:prod` |
| **Health Check Path** | `/api/health` |

> Render ejecuta los comandos desde el `Root Directory`, por eso no necesitás `cd backend`.

### 1.3 Variables de entorno

En la sección **Environment** de Render, agregar las siguientes variables. Nunca las incluyas en código.

| Variable | Descripción |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` (Render asigna el suyo, pero dejalo en 10000 por defecto) |
| `DATABASE_URL` | Connection string de Supabase (ver sección 1.4) |
| `JWT_ACCESS_SECRET` | Secret aleatorio largo (ver cómo generarlo abajo) |
| `JWT_REFRESH_SECRET` | Secret aleatorio largo, **distinto** al anterior |
| `JWT_ACCESS_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `FRONTEND_URL` | URL de Netlify — la configurás **después** de publicar el frontend |

**Cómo generar los JWT secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Ejecutalo dos veces y usá cada resultado para `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET`.

### 1.4 DATABASE_URL de Supabase

Usar el **Session Pooler** de Supabase para compatibilidad con IPv4 de Render:

1. En Supabase → Settings → Database.
2. Sección **Connection pooling** → modo **Session**.
3. Copiar la connection string. Tiene este formato:
   ```
   postgresql://postgres.XXXX:TU_CONTRASEÑA@aws-0-REGION.pooler.supabase.com:5432/postgres
   ```
4. Si la contraseña tiene caracteres especiales, encodearlos:
   - `@` → `%40`
   - `#` → `%23`
   - `!` → `%21`
   - espacio → `%20`

> Esta es la misma base de datos que usás en desarrollo. No se crea una nueva ni se borran datos.

### 1.5 Desplegar

1. Click en **Create Web Service**.
2. Render ejecutará el build. Podés ver los logs en tiempo real.
3. Si el build falla, revisar la sección "Errores comunes" al final.
4. Una vez que el deploy diga **Live**, copiá la URL pública:
   ```
   https://logicontrol-pro-api.onrender.com
   ```

### 1.6 Verificar backend

```
GET https://logicontrol-pro-api.onrender.com/api/health
```

Debe responder:
```json
{ "status": "ok", "service": "control-documentacion-api" }
```

### 1.7 Cómo volver a desplegar

- Render hace deploy automático al hacer push a la rama configurada.
- Para forzar un deploy manual: Dashboard → tu servicio → **Manual Deploy**.

### 1.8 Rollback en Render

1. Dashboard → tu servicio → **Deploys**.
2. Buscá el deploy anterior que funcionaba.
3. Click en los tres puntos → **Rollback to this deploy**.

---

## 2. Actualizar config.js con la URL del backend

Una vez que tenés la URL de Render, actualizá `config.js` en la raíz del repositorio:

```javascript
window.APP_CONFIG = {
  API_BASE_URL: isLocal
    ? 'http://localhost:3000/api'
    : 'https://TU-NOMBRE-REAL.onrender.com/api',  // ← reemplazá esto
};
```

Luego commitear y pushear:
```bash
git add config.js
git commit -m "config: set production API URL"
git push
```

---

## 3. Frontend en Netlify

### 3.1 Conectar el repositorio

1. Entrá a [netlify.com](https://netlify.com) y creá una cuenta.
2. **Add new site** → **Import an existing project** → GitHub.
3. Elegí el repositorio `Control-de-Vencimientos-`.
4. Seleccioná la misma rama del backend.

### 3.2 Configuración del build

| Campo | Valor |
|---|---|
| **Base directory** | *(vacío — raíz del repositorio)* |
| **Publish directory** | `.` |
| **Build command** | *(vacío — sin build)* |

### 3.3 Desplegar

1. Click en **Deploy site**.
2. Netlify publica el sitio estático directamente.
3. Obtenés una URL del estilo `https://logicontrol-pro.netlify.app`.

### 3.4 Verificar frontend

Abrí la URL de Netlify y verificá que aparece el formulario de login.

### 3.5 Rollback en Netlify

1. Site overview → **Deploys**.
2. Click en un deploy anterior → **Publish deploy**.

---

## 4. Configurar FRONTEND_URL en Render

1. Copiá la URL de Netlify: `https://logicontrol-pro.netlify.app`
2. En Render → tu servicio → **Environment**.
3. Actualizá `FRONTEND_URL` con esa URL (sin barra final).
4. Guardá. Render va a reiniciar el backend automáticamente.

---

## 5. Plan de pruebas

Después del despliegue completo, verificar:

1. Abrir URL de Netlify en el navegador.
2. Iniciar sesión con un usuario existente.
3. Crear un chofer nuevo.
4. Crear un vehículo nuevo.
5. Crear un vencimiento.
6. Crear un documento de residuos peligrosos.
7. Recargar la página (F5).
8. Confirmar que los datos persisten.
9. Abrir en otra computadora o en modo incógnito.
10. Iniciar sesión con el mismo usuario.
11. Confirmar que aparecen los mismos datos.
12. Cerrar sesión.
13. Confirmar que la aplicación vuelve al login.

---

## 6. Plan de rollback general

**Si el backend falla después de un deploy:**
1. En Render → Deploys → rollback al deploy anterior (ver sección 1.8).
2. Las migraciones ya aplicadas **no se revierten** — no es necesario ni conveniente hacerlo manualmente.
3. Si el problema es de código, hacer el fix, commitear y pushear.

**Si el frontend falla:**
1. En Netlify → Deploys → publicar el deploy anterior (ver sección 3.5).

**Si hay un problema de datos en Supabase:**
1. No borrar tablas manualmente — puede dejar el sistema inconsistente.
2. Contactar al administrador de Supabase para restaurar desde backup automático si el plan lo permite.

**Por qué no revertir migraciones:**
- Las migraciones en producción son acumulativas. Revertirlas manualmente puede corromper datos.
- Si una migración nueva rompe algo, el rollback correcto es de código (volver al commit anterior), no de schema.

---

## 7. Activar Content-Security-Policy (opcional)

Una vez que tenés ambas URLs, podés descomentar la CSP en `netlify.toml`:

```toml
Content-Security-Policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://TU-BACKEND.onrender.com; img-src 'self' data:; font-src 'self'"
```

Reemplazar `TU-BACKEND.onrender.com` con la URL real y hacer push.

---

## 8. Variables de entorno — resumen

### Backend (Render) — cargar manualmente en el dashboard

| Variable | Ejemplo / Descripción |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `DATABASE_URL` | `postgresql://postgres.XXX:PASS@pooler.supabase.com:5432/postgres` |
| `JWT_ACCESS_SECRET` | 128 hex chars generados con crypto.randomBytes |
| `JWT_REFRESH_SECRET` | 128 hex chars generados con crypto.randomBytes |
| `JWT_ACCESS_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `FRONTEND_URL` | `https://tu-sitio.netlify.app` |

### Frontend (Netlify)
No tiene variables de entorno. La URL del backend está en `config.js`.

---

## Errores comunes

**Build falla con "Cannot find module '@prisma/client'"**
→ Verificar que el Build Command incluye `npx prisma generate` antes de `npm run build`.

**Error de conexión a Supabase en Render**
→ Usar el Session Pooler (puerto 5432), no el Direct Connection (puerto 5432 con otro host) ni el Transaction Pooler. IPv4 de Render no siempre resuelve el host directo de Supabase.

**CORS error en el navegador**
→ Verificar que `FRONTEND_URL` en Render coincide exactamente con la URL de Netlify (sin barra final, con `https://`).

**"Sesión expirada" al recargar**
→ Normal si `JWT_ACCESS_SECRET` cambió. Los tokens emitidos con el secret anterior quedan inválidos. Los usuarios deben hacer login nuevamente.

**Frontend muestra pantalla en blanco**
→ Abrir la consola del navegador. Si hay un error de `config.js`, verificar que el archivo existe en el repositorio y que Netlify lo publicó correctamente.
