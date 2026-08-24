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
- `packages/contracts`: DTOs e contratos TypeScript compartilhados
- `docs`: documentação funcional, API e implantação

## Pre requisitos

- Node.js 24+
- npm 11+
- Docker (recomendado) ou PostgreSQL local

## Como inicializar (Getting Started)

Siga estes passos para rodar a aplicação localmente.

1. Instale dependências na raiz do monorepo:

```bash
npm install
```

2. Configure variáveis de ambiente da API em `apps/api/.env` (copie `apps/api/.env.example`):

- `DATABASE_URL` (Postgres)
- `JWT_ACCESS_SECRET` (>=32 chars)
- `JWT_REFRESH_SECRET` (>=32 chars)
- `APP_ORIGIN` (ex: `http://localhost:5173`)
- `COOKIE_SECURE` (`false` em dev)

3. (Opcional) Se não tiver Postgres local, rode um container Docker:

```bash
docker run --name lumas-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=lumasmodels -p 5432:5432 -d postgres:17
```

4. Rode migrações e seed (usa workspace `@lumas/api`):

```bash
npm run prisma:migrate
npm run prisma:seed
```

5. Inicie backend e frontend em terminais separados:

```bash
npm run dev:api   # inicia API em http://localhost:3333
npm run dev:web   # inicia frontend em http://localhost:5173
```

6. Teste rápido de login (exemplo curl, somente desenvolvimento):

```bash
curl -i -X POST http://localhost:3333/api/v1/auth/login \
	-H "Content-Type: application/json" \
	-d '{"username":"julia","password":"Julia@123"}'
```

Credenciais locais/de teste garantidas pelo seed idempotente:

- Gerente: `julia` / `Julia@123`
- Gerente: `diego` / `Diego@123`

Em produção, o seed exige `BOOTSTRAP_MANAGER_USERNAME`, `BOOTSTRAP_MANAGER_DISPLAY_NAME` e `BOOTSTRAP_MANAGER_PASSWORD`, nunca altera usuários existentes e obriga a troca da senha inicial.

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
- `VITE_SOCKET_URL` (por padrão usa a mesma origem da API)

O passo a passo do piloto Netlify + Render + Neon + R2 está em [docs/deployment-pilot.md](docs/deployment-pilot.md).

## Banco de dados com Docker

```bash
docker run --name lumas-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=lumasmodels -p 5432:5432 -d postgres:17
```



## API e compatibilidade

O frontend usa `/api/v1`. As rotas antigas permanecem disponíveis com o mesmo formato durante a janela de depreciação e retornam os headers `Deprecation` e `Link`. A referência completa está em [docs/api-v1.md](docs/api-v1.md).

## Endpoints principais

Auth:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/change-password`

Chatter:

- `POST /api/v1/chatter/shifts/start`
- `POST /api/v1/chatter/shifts/:shiftId/end`
- `GET /api/v1/chatter/shifts/current`
- `GET /api/v1/chatter/shifts/history`
- `GET /api/v1/chatter/payment/summary`
- `GET /api/v1/chatter/payment/history`

Gerente:

- `GET /api/v1/manager/chatters`
- `POST /api/v1/manager/users`
- `POST /api/v1/manager/users/:userId/reset-password`
- `PATCH /api/v1/manager/users/:userId`
- `GET|POST /api/v1/manager/tags`
- `PATCH|DELETE /api/v1/manager/tags/:tagId`
- `PUT /api/v1/manager/chatters/:userId/tags`
- `GET /api/v1/manager/payments/history`
- `POST /api/v1/manager/payments/pay`
- `GET /api/v1/manager/audit-logs`
- `GET /api/v1/manager/reports/{shifts,payments,analytics}.xlsx`

Chat:

- `GET /api/v1/chat/rooms`
- `GET /api/v1/chat/rooms/:modelTagId/messages`
- `POST /api/v1/chat/rooms/:modelTagId/messages`
- Socket event: `chat:send` / `chat:message`

OCR:

- `POST /api/v1/ocr/extract` (multipart, campo `image`)
- `GET /api/v1/evidence/:evidenceId/content` (arquivo privado autenticado)

Infraestrutura:

- `GET /health` e `GET /api/v1/health` — processo ativo
- `GET /ready` e `GET /api/v1/ready` — banco e storage disponíveis

Notificações:

- `GET /api/v1/notifications`
- `PATCH /api/v1/notifications/:notificationId/read`
- `POST /api/v1/notifications/read-all`

## Testes e qualidade

A suíte usa PostgreSQL isolado. Defina `TEST_DATABASE_URL` apontando para um banco cujo nome contenha `test`; sem essa variável, o runner deriva e cria `<banco_atual>_test`. O Playwright deriva um banco separado `<banco_atual>_e2e_test`, aplica as migrations e o seed antes da execução. O banco da aplicação nunca é limpo pelos testes.

```bash
npm run test:api
npm run test:web
npm run coverage
npm run lint
npm run build
npm run test:e2e
```

O E2E usa Chromium em `1440×900`, `1024×768`, `390×844` e `360×800`, percorre todas as rotas de gerente e chatter e verifica console, teclado, acessibilidade com axe e overflow horizontal. A regressão visual possui baselines locais de login, dashboard e equipe separados por viewport. O workflow em `.github/workflows/ci.yml` executa migrations em PostgreSQL 17, coverage, lint, builds e E2E com Node.js 24.

Os limites de cobertura do frontend estão fixados próximos da linha de base atual (70% linhas/statements, 65% funções e 60% branches) para que o CI detecte regressões reais. Eles devem subir gradualmente junto com testes dos fluxos ainda menos cobertos; não reduza os limites para acomodar código novo.

## Segurança de produção

- Use `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS e segredos JWT fortes.
- Configure `APP_ORIGIN`, `VITE_API_URL` e `VITE_SOCKET_URL` com origens exatas.
- Atrás de um proxy confiável, configure `TRUST_PROXY=true`; mantenha `false` quando o processo recebe o tráfego diretamente.
- `LOGIN_RATE_LIMIT_MAX=5` é o padrão de produção; apenas o servidor isolado do Playwright eleva esse limite para evitar que a própria suíte seja bloqueada.
- Para a implantação recomendada no mesmo domínio, encaminhe `/api` para o backend e deixe `VITE_API_URL` vazio no build do frontend.
- `REFRESH_TOKEN_TTL_DAYS=30` mantém a sessão por 30 dias de inatividade; cada renovação válida reinicia esse prazo.
- Helmet mantém CSP ativo; HSTS é habilitado somente em produção.
- Replique HSTS, `X-Frame-Options` e a política de origem do WebSocket no proxy/CDN.
- Comprovantes são privados. Em desenvolvimento ficam em `LOCAL_STORAGE_PATH`; a implantação posterior deve configurar o adaptador S3/R2 e um bucket sem acesso público.

## Observacoes

- Regras de autorizacao sao validadas no backend.
- Confirmacao de honorarios pelo chatter so abre as segundas no fuso `America/Sao_Paulo`.
- Pagamento forcado do gerente gera trilha de auditoria com motivo.
