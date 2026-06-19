# Archivos Adjuntos — Arquitectura y Operación

## Descripción general

LOGICONTROL PRO permite adjuntar archivos (PDF, imágenes) a cuatro tipos de entidades:
- **Vehículos** (`VEHICLE`)
- **Choferes** (`DRIVER`)
- **Vencimientos** (`EXPIRATION`)
- **Documentos peligrosos** (`HAZARDOUS_DOCUMENT`)

Los binarios se almacenan en **Supabase Storage** (bucket privado). El backend actúa como intermediario exclusivo: el frontend nunca accede al storage directamente ni conoce la `service_role key`.

---

## Arquitectura de seguridad

```
Frontend → Backend (NestJS) → Supabase Storage (bucket privado)
```

- El bucket es **privado**: ninguna URL pública funciona sin autenticación.
- El backend genera **Signed URLs** con expiración de 300 segundos (5 minutos) para descarga.
- La `SUPABASE_SERVICE_ROLE_KEY` vive exclusivamente en el servidor (nunca en el frontend).
- El `companyId` se extrae del JWT, no del body de la petición.
- Los metadatos se guardan en PostgreSQL; los binarios en Supabase Storage.

---

## Variables de entorno requeridas

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase (ej. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — **NUNCA exponer al frontend** |
| `SUPABASE_STORAGE_BUCKET` | Nombre del bucket privado (ej. `documents`) |

---

## Crear el bucket en Supabase

1. Ir a **Storage → New bucket**
2. Nombre: `documents` (o el valor de `SUPABASE_STORAGE_BUCKET`)
3. **Public: OFF** (bucket privado)
4. No configurar políticas RLS de Storage — el backend usa la `service_role key` que las bypasea.

---

## Límites y tipos permitidos

| Parámetro | Valor |
|---|---|
| Tamaño máximo | 10 MB |
| Archivos por entidad | 10 |
| Tipos de archivo | PDF, JPG, JPEG, PNG, WEBP |

---

## Rutas de la API

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| `POST` | `/api/attachments` | USER, COMPANY_ADMIN, SUPER_ADMIN | Subir archivo (multipart/form-data) |
| `GET` | `/api/attachments?entityType=X&entityId=Y` | USER, COMPANY_ADMIN, SUPER_ADMIN | Listar archivos de una entidad |
| `GET` | `/api/attachments/:id/url` | USER, COMPANY_ADMIN, SUPER_ADMIN | Obtener Signed URL (5 min) |
| `DELETE` | `/api/attachments/:id` | COMPANY_ADMIN, SUPER_ADMIN | Eliminar archivo |
| `POST` | `/api/attachments/:id/replace` | COMPANY_ADMIN, SUPER_ADMIN | Reemplazar archivo |

### Body de subida (multipart/form-data)

```
file        — archivo binario (campo "file")
entityType  — VEHICLE | DRIVER | EXPIRATION | HAZARDOUS_DOCUMENT
entityId    — UUID de la entidad
```

---

## Ruta en Storage

```
companies/{companyId}/{entityType_lowercase}/{entityId}/{uuid}-{safeFilename}
```

Ejemplo:
```
companies/abc-123/vehicle/def-456/550e8400-e29b-41d4-a716-446655440000-seguro_rc.pdf
```

El nombre de archivo se sanitiza: sin path traversal, sin caracteres especiales, máx 100 chars, lowercase.

---

## Consistencia DB ↔ Storage

**Upload:**
1. Subir binario a Storage
2. Crear registro en DB (dentro de `$transaction`)
3. Si DB falla → eliminar el binario de Storage (compensating action)

**Delete:**
1. Eliminar registro de DB (dentro de `$transaction`)
2. Eliminar binario de Storage (best-effort; si falla, se loggea y la metadata ya no existe)

**Replace:**
1. Subir nuevo binario a Storage
2. Actualizar registro en DB (dentro de `$transaction`)
3. Si DB falla → eliminar nuevo binario (compensating action)
4. Si DB OK → eliminar binario anterior (best-effort)

---

## Archivos huérfanos

Si el binario en Storage pierde su referencia en DB (fallo de red entre pasos), el archivo queda "huérfano". El backend loggea estas situaciones con `logger.error`. Para limpiarlos manualmente, listar el bucket y comparar con la tabla `attachments` en DB.

---

## Protección de eliminación de entidades

Los **vencimientos** y **documentos peligrosos** verifican antes de eliminarse que no tengan archivos adjuntos. Si los tienen, devuelven `409 Conflict`. El usuario debe eliminar primero los adjuntos.

Los **vehículos** y **choferes** usan soft delete (`active: false`) por lo que no aplica esta restricción.

---

## Errores comunes

| Error | Causa | Solución |
|---|---|---|
| `400 Extensión no permitida` | Tipo de archivo no soportado | Usar PDF, JPG, PNG o WEBP |
| `400 El archivo supera el límite` | Archivo > 10 MB | Comprimir o reducir el archivo |
| `409 Límite de 10 archivos` | La entidad ya tiene 10 archivos | Eliminar alguno antes de subir |
| `403 No tenés permiso` | `companyId` del token no coincide | Verificar tenant del usuario |
| `404 Entidad no encontrada` | El `entityId` no existe | Verificar el ID de la entidad |
| `Storage unavailable` | Fallo de Supabase | Ver logs del servidor; reintentar |

---

## Rollback de migración

Para deshacer la migración (solo en desarrollo):

```sql
DROP TABLE IF EXISTS "attachments";
DROP TYPE IF EXISTS "AttachmentEntityType";
-- Los valores UPLOAD y REPLACE en AuditAction NO se pueden eliminar en Postgres
-- sin recrear el enum. En dev, reiniciar la DB es más simple.
```
