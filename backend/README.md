# LOGICONTROL PRO — Backend API

API REST construida con **NestJS + TypeScript + PostgreSQL + Prisma**.

---

## Requisitos

- Node.js 18 o superior
- npm 9 o superior
- PostgreSQL (para etapas posteriores)

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

2. Editá el archivo `.env` con tus valores:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/logicontrol
FRONTEND_URL=http://localhost:5173
```

> El archivo `.env` nunca se sube a git — está en el `.gitignore`.

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

---

## Verificar que funciona

Una vez iniciado, abrí en el navegador o usá curl:

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

## Comandos de Prisma (próximas etapas)

| Comando | Descripción |
|---------|-------------|
| `npm run prisma:generate` | Genera el cliente Prisma a partir del schema |
| `npm run prisma:migrate:dev` | Crea y aplica una nueva migración (desarrollo) |
| `npm run prisma:migrate:prod` | Aplica migraciones en producción |
| `npm run prisma:studio` | Abre la UI visual de Prisma para explorar la BD |

---

## Estructura del proyecto

```
backend/
├── src/
│   ├── main.ts                  # Punto de entrada — CORS, prefijo, validación
│   ├── app.module.ts            # Módulo raíz
│   ├── app.controller.ts
│   ├── app.service.ts
│   ├── prisma/
│   │   ├── prisma.module.ts     # Módulo global de Prisma
│   │   └── prisma.service.ts    # Cliente Prisma con ciclo de vida
│   └── health/
│       ├── health.module.ts
│       └── health.controller.ts # GET /api/health
├── prisma/
│   └── schema.prisma            # Definición del esquema de BD
├── .env.example                 # Variables de entorno de ejemplo
├── .gitignore
├── nest-cli.json
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

---

## Etapas de desarrollo planificadas

- [x] **Etapa 1** — Estructura base, health endpoint, Prisma configurado
- [ ] **Etapa 2** — Schema de base de datos (empresas, usuarios, vehículos, choferes, vencimientos)
- [ ] **Etapa 3** — Autenticación (JWT + roles)
- [ ] **Etapa 4** — CRUD de vehículos, choferes y vencimientos
- [ ] **Etapa 5** — Conexión con el frontend
- [ ] **Etapa 6** — Migración de datos desde localStorage
