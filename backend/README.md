# LOGICONTROL PRO — Backend API

API REST construida con **NestJS 10 + TypeScript + PostgreSQL (Supabase) + Prisma 5**.

---

## Requisitos

- Node.js 18 o superior
- npm 9 o superior
- PostgreSQL (Supabase u otro proveedor)

---

## Instalación

```bash
cd backend
npm install
```

---

## Configuración del entorno

1. Copiá el archivo de ejemplo:

```bash
cp .env.example .env
```

2. Editá `.env` con tus valores reales:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://usuario:contraseña@host:puerto/nombre_bd
FRONTEND_URL=http://localhost:5173
```

> **Importante:** El archivo `.env` está en `.gitignore` y nunca se sube a git.

### Obtener la DATABASE_URL en Supabase

Supabase → proyecto → Settings → Database → Connection string → **URI** (modo pooled recomendado para producción).

---

## Comandos de Prisma

| Comando | Descripción |
|---------|-------------|
| `npm run prisma:format` | Formatea `schema.prisma` automáticamente |
| `npm run prisma:validate` | Valida que el schema no tenga errores |
| `npm run prisma:generate` | Genera el cliente Prisma a partir del schema |
| `npm run prisma:migrate` | Crea y aplica una nueva migración en desarrollo |
| `npm run prisma:migrate:prod` | Aplica migraciones pendientes en producción (sin interacción) |
| `npm run prisma:status` | Muestra el estado de las migraciones aplicadas |
| `npm run prisma:studio` | Abre la UI visual de Prisma para explorar la BD |
| `npm run prisma:seed` | Inserta datos de demostración (idempotente) |

> ⚠️ **NUNCA ejecutar `prisma migrate reset`** sin entender que elimina todos los datos y la estructura de la base de datos. Solo se usa en desarrollo para empezar desde cero.

---

## Primer setup — aplicar la migración inicial

Después de configurar `DATABASE_URL`, ejecutar en orden:

```bash
# 1. Validar que el schema es correcto
npm run prisma:validate

# 2. Generar el cliente (tipos TypeScript para la BD)
npm run prisma:generate

# 3. Aplicar la migración inicial (crea las tablas en PostgreSQL)
npm run prisma:migrate

# 4. Verificar que la migración fue aplicada
npm run prisma:status

# 5. Insertar datos de demostración
npm run prisma:seed
```

---

## Iniciar el servidor

### Modo desarrollo (con hot-reload)

```bash
npm run start:dev
```

### Modo producción

```bash
npm run build
npm run start:prod
```

### Verificar que funciona

```bash
curl http://localhost:3000/api/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "control-documentacion-api"
}
```

---

## Crear una nueva migración (cuando se modifique el schema)

```bash
# Después de editar prisma/schema.prisma:
npm run prisma:migrate
# Prisma preguntará el nombre de la migración (ej: add_user_model)
```

## Aplicar migraciones en producción

```bash
# NO ejecutar migrate dev en producción
npm run prisma:migrate:prod
```

---

## Abrir Prisma Studio (UI visual de la BD)

```bash
npm run prisma:studio
# Se abre en http://localhost:5555
```

---

## Ver estado de las migraciones

```bash
npm run prisma:status
# Muestra qué migraciones fueron aplicadas y cuáles están pendientes
```

---

## Autenticación (Etapa 3)

### Variables de entorno necesarias

```env
JWT_ACCESS_SECRET=<secreto aleatorio largo>
JWT_REFRESH_SECRET=<secreto aleatorio largo>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

Generar secretos seguros:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/auth/register` | Pública | Solo disponible si no hay ningún usuario en la BD. Crea empresa + SUPER_ADMIN |
| POST | `/api/auth/login` | Pública | Retorna `accessToken` (15 min) + `refreshToken` (7 días) |
| POST | `/api/auth/refresh` | Pública | Rota el refresh token y retorna nuevos tokens |
| POST | `/api/auth/logout` | Privada | Revoca el refresh token |
| GET | `/api/auth/me` | Privada | Datos del usuario autenticado desde el JWT |

### Seguridad

- Todas las rutas son **privadas por defecto** vía `APP_GUARD` global (`JwtAuthGuard`)
- Las rutas públicas llevan el decorador `@Public()`
- Los refresh tokens se almacenan **solo como hash** (argon2) — nunca en texto plano
- El formato del refresh token es `{recordId}.{rawSecret}`: permite búsqueda O(1) por UUID + verificación del secreto
- `passwordHash` **nunca** se incluye en respuestas de la API
- El mensaje de error para credenciales inválidas es siempre genérico: `"Credenciales inválidas"`
- El `role` del usuario proviene de la BD, nunca del body de la request

### Ejecutar tests

```bash
npm test
# o con cobertura:
npm run test:cov
```

---

## Estructura de entidades (Etapa 2)

```
companies          → Empresas (multiempresa)
├── drivers        → Choferes de la empresa
├── vehicles       → Vehículos de la flota
│   └── (driver)   → Chofer asignado (opcional)
├── expirations    → Vencimientos / documentos
│   ├── (vehicle)  → Vehículo asociado (opcional)
│   └── (driver)   → Chofer asociado (opcional)
├── hazardous_documents → Documentación de residuos peligrosos
└── audit_logs     → Historial inmutable de acciones
```

### Campos clave por entidad

**companies:** id, name, taxId?, active, createdAt, updatedAt

**drivers:** id, companyId, name, lastName, dni (único por empresa), licenseCategory?, licenseNumber?, notes?, active

**vehicles:** id, companyId, patent (único por empresa), brand, model, year?, driverId?, notes?, active

**expirations:** id, companyId, type, category (VEHICLE/DRIVER/COMPANY/WASTE), vehicleId?, driverId?, issueDate?, expiryDate, description?, observations?

**hazardous_documents:** id, companyId, type, entityName, permitNumber?, issuingAuthority?, issueDate?, expiryDate, observations?

**audit_logs:** id, companyId, action (CREATE/UPDATE/DELETE/RENEW), entityType, entityId?, entityName?, description, metadata (JSON)?, createdAt

---

## Reglas de integridad referencial

| Situación | Comportamiento |
|---|---|
| Se intenta eliminar una Company con datos | ❌ Error (RESTRICT) |
| Se elimina un Driver | Vehicles y Expirations con ese driverId quedan con driverId = NULL (SET NULL) |
| Se elimina un Vehicle | Expirations con ese vehicleId quedan con vehicleId = NULL (SET NULL) |
| Vencimiento sin vehículo ni chofer | ✅ Válido — pertenece a la empresa |

### Validaciones que DEBEN hacerse en los servicios NestJS (no en Prisma)

1. Que `vehicleId` y `driverId` en un Expiration pertenezcan a la **misma empresa** que `companyId`
2. Que el `driverId` en un Vehicle pertenezca a la misma empresa que el vehículo
3. Control de acceso por empresa (que un usuario solo pueda operar su propia `companyId`)

---

## Etapas de desarrollo

- [x] **Etapa 1** — Estructura NestJS base, health endpoint, Prisma configurado
- [x] **Etapa 2** — Schema de base de datos inicial (6 entidades, enums, índices, relaciones)
- [x] **Etapa 3** — Autenticación JWT + usuarios + guards globales
- [ ] **Etapa 4** — CRUD de vehículos, choferes, vencimientos y residuos
- [ ] **Etapa 5** — Conexión con el frontend
- [ ] **Etapa 6** — Migración de datos desde localStorage
