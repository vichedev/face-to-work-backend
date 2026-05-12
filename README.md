# Face to Work — Backend (API)

API NestJS del sistema de control de asistencia con reconocimiento facial por IA (Groq).

- NestJS 10 + TypeORM + PostgreSQL + JWT
- IA de visión: Groq Cloud (API compatible con OpenAI)
- Sirve también la SPA del frontend desde `public/` (despliegue de un solo origen)

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run start:dev` | API en modo watch (`http://localhost:3000/api`) |
| `npm run seed` | Crea el usuario administrador (`ADMIN_EMAIL` / `ADMIN_PASSWORD` del `.env`) |
| `npm run build` | Compila a `dist/` |
| `npm run start:prod` | Ejecuta `dist/main.js` |
| `npm run deploy:full` | Build del frontend + copia a `public/` + build del backend |

Configura `.env` (ver `.env.example`): conexión a PostgreSQL, `JWT_SECRET`, `ADMIN_*`, `GROQ_API_KEY`.
El esquema de la base de datos se crea solo (TypeORM `synchronize`).

## Endpoints principales

- `POST /api/auth/login` — inicio de sesión (admin o trabajador)
- `GET  /api/auth/me` — usuario actual
- `GET/POST/PATCH/DELETE /api/workers` — gestión de trabajadores (solo admin)
- `POST /api/attendance/mark` — marcaje del trabajador autenticado (foto + GPS → verifica el rostro y devuelve un saludo)
- `GET  /api/attendance/me/today` · `GET /api/attendance/me?month=YYYY-MM` — marcajes del propio trabajador (sólo lectura)
- `GET  /api/attendance` · `/api/attendance/today` · `/api/attendance/summary/dashboard` — administración
- `PATCH /api/attendance/:id` · `DELETE /api/attendance/:id` — corregir / eliminar un marcaje (sólo admin)

Consulta el `README.md` y el `DEPLOY.md` de la raíz del proyecto para la guía completa.
