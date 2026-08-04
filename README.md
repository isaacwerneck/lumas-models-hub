# LumasModels Hub

Aplicacao interna para controle de ponto, comissao e pagamento de chatters, com fluxo baseado em saldo inicial/final por turno, revisao semanal e chat por modelo.

## Stack

- Frontend: React + Vite + TypeScript + React Router
- Backend: Fastify + TypeScript
- Banco: PostgreSQL + Prisma
- Auth: JWT curto + refresh token em cookie httpOnly
- Realtime: Socket.io
- OCR: Tesseract.js (server-side, endpoint multipart)

## Estrutura

- `apps/api`: backend
- `apps/web`: frontend
- `documents`: documentos de requisitos e dotart

## Pre requisitos

- Node.js 24+
- npm 11+
- Docker (recomendado) ou PostgreSQL local

## Variaveis de ambiente

### API

Copie `apps/api/.env.example` para `apps/api/.env` e ajuste:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `APP_ORIGIN`
- `COOKIE_SECURE`

### Web

Copie `apps/web/.env.example` para `apps/web/.env`:

- `VITE_API_URL` (por padrao `http://localhost:3333`)

## Banco de dados com Docker

```bash
docker run --name lumas-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=lumasmodels -p 5432:5432 -d postgres:17
```

## Setup local

```bash
npm install
npm run prisma:migrate
npm run prisma:seed
```

## Executar em desenvolvimento

Backend:

```bash
npm run dev:api
```

Frontend:

```bash
npm run dev:web
```

## Build

```bash
npm run build:api
npm run build:web
```

## Credenciais seed

Gerente:

- usuario: `gerente.julia`
- senha: `Manager@123`

Chatters:

- `chatter.ana`
- `chatter.bruno`
- `chatter.clara`
- senha: `Chatter@123`

## Endpoints principais

Auth:

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/change-password`

Chatter:

- `POST /chatter/shifts/start`
- `POST /chatter/shifts/:shiftId/end`
- `GET /chatter/shifts/current`
- `GET /chatter/payment/summary`
- `GET /chatter/payment/review`
- `POST /chatter/payment/confirm`

Gerente:

- `GET /manager/chatters`
- `POST /manager/users`
- `PATCH /manager/users/:userId`
- `GET /manager/tags`
- `POST /manager/tags`
- `PATCH /manager/tags/:tagId`
- `PUT /manager/chatters/:userId/tags`
- `GET /manager/payments/confirmed`
- `POST /manager/payments/:payoutId/mark-paid`
- `POST /manager/payments/:payoutId/force-pay`

Chat:

- `GET /chat/rooms`
- `GET /chat/rooms/:modelTagId/messages`
- `POST /chat/rooms/:modelTagId/messages`
- Socket event: `chat:send` / `chat:message`

OCR:

- `POST /ocr/extract` (multipart, campo `image`)

## Observacoes

- Regras de autorizacao sao validadas no backend.
- Confirmacao de honorarios pelo chatter so abre as segundas no fuso `America/Sao_Paulo`.
- Pagamento forcado do gerente gera trilha de auditoria com motivo.
