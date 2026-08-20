# API v1

A API está disponível em `/api/v1`. As rotas sem esse prefixo continuam compatíveis durante a janela de migração e respondem com `Deprecation: true` e um `Link` para a versão sucessora.

## Convenções

- Autenticação: access token Bearer e refresh token em cookie `httpOnly`.
- Paginação: `page=1`, `pageSize=20`, máximo de 100 itens.
- Resposta paginada: `{ items, pagination: { page, pageSize, total, totalPages } }`.
- Datas: ISO 8601. Filtros de período usam `from` inclusivo e `to` exclusivo.
- Busca: parâmetro `search`, sem diferenciação entre maiúsculas e minúsculas.
- Erro v1: `{ error: { code, message, issues?, requestId } }`. Conflitos de estado/referência usam HTTP 409. As rotas legadas preservam `{ message, issues? }`.

## Rotas principais

### Autenticação

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/change-password`

O login aceita no máximo cinco tentativas por minuto por IP. A quinta senha inválida bloqueia a conta por 15 minutos.

### Gerência

- `GET /api/v1/manager/chatters`
- `GET /api/v1/manager/chatters/:userId`
- `GET /api/v1/manager/chatters/:userId/shifts`
- `GET /api/v1/manager/chatters/:userId/payments`
- `POST /api/v1/manager/users`
- `PATCH /api/v1/manager/users/:userId`
- `POST /api/v1/manager/users/:userId/reset-password`
- `GET|POST /api/v1/manager/tags`
- `PATCH|DELETE /api/v1/manager/tags/:tagId`
- `PUT /api/v1/manager/chatters/:userId/tags`
- `GET /api/v1/manager/payments/balances`
- `GET /api/v1/manager/payments/history`
- `POST /api/v1/manager/payments/pay`
- `GET /api/v1/manager/audit-logs`

Chatters aceitam `search`, `status` e `modelTagId`. Turnos aceitam `search`, `status`, `modelTagId`, `from` e `to`. Pagamentos aceitam `search`, `chatterId`, `from` e `to`. Auditoria aceita `action`, `actorId`, `from` e `to`.

O pagamento aceita `Idempotency-Key` (até 100 caracteres). Ganhos são associados ao pagamento na mesma transação e somente os comprovantes dos turnos quitados entram na fila de limpeza.

### Turnos, pagamentos e chat do chatter

- `GET /api/v1/chatter/shifts/current`
- `GET /api/v1/chatter/shifts/history`
- `POST /api/v1/chatter/shifts/start`
- `POST /api/v1/chatter/shifts/:shiftId/end`
- `PATCH|DELETE /api/v1/chatter/shifts/:shiftId`
- `GET /api/v1/chatter/payment/summary`
- `GET /api/v1/chatter/payment/history`
- `GET /api/v1/chat/rooms`
- `GET|POST /api/v1/chat/rooms/:modelTagId/messages`

### Notificações

- `GET /api/v1/notifications`
- `PATCH /api/v1/notifications/:notificationId/read`
- `POST /api/v1/notifications/read-all`

OCR abaixo do limiar de confiança notifica quem enviou a imagem. Turnos negativos notificam o chatter e todos os gerentes ativos. A deduplicação usa destinatário, tipo e origem.

### Relatórios XLSX

- `GET /api/v1/manager/reports/shifts.xlsx`
- `GET /api/v1/manager/reports/payments.xlsx`
- `GET /api/v1/manager/reports/analytics.xlsx`

Os relatórios usam o conjunto completo dos filtros, e não só a página visível. Analytics contém abas por modelo e por chatter.

### OCR e câmbio

- `POST /api/v1/ocr/extract` — multipart, campo `image`; persiste e retorna `evidence` com ID, hash, tipo, tamanho, confiança e valor detectado.
- `GET /api/v1/evidence/:evidenceId/content` — conteúdo privado para uploader/proprietário e gerente; retorna 410 após limpeza ou para legado indisponível.
- `GET /api/v1/fx/usd-brl`.

Turnos v1 recebem `startEvidenceId`/`endEvidenceId`. O comprovante só pode ser anexado uma vez pelo uploader. Rotas legadas continuam aceitando seus payloads antigos durante a depreciação.

### Saúde

- `GET /api/v1/health` — processo ativo.
- `GET /api/v1/ready` — verifica PostgreSQL e storage privado.

## Segurança de implantação

A API aplica Helmet com CSP, `X-Frame-Options` e demais cabeçalhos. HSTS só é habilitado quando `NODE_ENV=production`, pois exige HTTPS real. O Vite gera CSP com as origens HTTP e WebSocket derivadas de `VITE_API_URL`.

No host final:

1. servir frontend e API exclusivamente por HTTPS;
2. configurar `APP_ORIGIN` e `VITE_API_URL` com os hosts exatos, sem curingas;
3. definir `COOKIE_SECURE=true` e `NODE_ENV=production`;
4. manter HSTS e `X-Frame-Options` também no proxy/CDN;
5. restringir WebSocket à origem configurada.
6. definir `TRUST_PROXY=true` apenas quando houver proxy/CDN confiável na frente da API;
7. configurar bucket S3/R2 privado, credenciais mínimas e política de retenção/backup apropriada.
