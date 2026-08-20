# LumasModels Hub — Relatório de Testes e Lista de Melhorias

## 1. Resultado dos testes

Suíte automatizada cobrindo **54 cenários** em todos os módulos da API. **54/54 passaram** após 2 correções.

### Bugs encontrados e corrigidos durante os testes

| # | Bug | Causa | Correção |
|---|-----|-------|----------|
| 1 | **Erros de validação retornavam 500 em vez de 400** | As rotas usam `schema.parse()` do zod; o handler de erro padrão do Fastify devolve 500 para `ZodError`. Afetava login com senha curta, campos inválidos, mensagem vazia, PATCH vazio etc. | `setErrorHandler` global em `apps/api/src/app.ts` que converte `ZodError` → 400 com lista de `issues` (campo + mensagem). |
| 2 | **OCR sem arquivo retornava 406 em vez de 400** | `request.file()` do `@fastify/multipart` lança `FST_INVALID_MULTIPART_CONTENT_TYPE` (406) quando a requisição não é multipart, antes de chegar ao `if (!file)`. | Checagem de `content-type` em `apps/api/src/modules/ocr/ocr.routes.ts` antes de chamar `request.file()` → 400 "Envie uma imagem no campo 'image'." |

### Cobertura validada (54 testes)

- **Auth**: login ok / senha errada 401 / usuário inexistente 401 / senha curta 400 / `/me` / sem token 401 / refresh com cookie 200 / refresh sem cookie 401.
- **Segurança de roles**: chatter em rota de manager → 403; manager em rota de chatter → 403.
- **Manager · Chatters**: listar, criar 201, duplicado 409, campos inválidos 400, desativar, auto-desativação bloqueada 400, PATCH vazio no-op.
- **Manager · Tags**: listar, criar 201, duplicado 409, atribuir tag 200, tag inexistente 400, atribuir a não-chatter 404, histórico 200/404.
- **Shifts**: iniciar sem imagem 400, tag não vinculada 403, iniciar 201, iniciar com turno aberto 409, atual 200, encerrar sem imagem 400, negativo sem justificativa 400, encerrar 200, histórico, PATCH fechado 200, datas inválidas 400, PATCH vazio 400.
- **Pagamentos**: resumo, histórico, saldos, pagar 200, pagar sem pendente 400, chatter inexistente 404.
- **Chat**: salas, mensagens, enviar 201, vazio 400, >2000 chars 400, sem acesso à sala 403.
- **OCR**: sem arquivo 400.
- **FX**: USD→BRL 200 (ou 502 se a fonte externa estiver fora).

## 2. Lista de melhorias / adições sugeridas

### Segurança (prioridade alta)
- **Rate limiting no `/auth/login`** — proteção contra força bruta (ex.: 5 tentativas/min por IP/usuário). Hoje não há limite.
- **Bloqueio após tentativas falhas** — travar a conta por N minutos após X falhas consecutivas.
- **Security headers** — adicionar `@fastify/helmet` (CSP, X-Frame-Options, HSTS, etc.).
- **Auditoria completa** — a tabela `auditLog` existe; registrar ações sensíveis (login, mudança de senha, pagamento, exclusão de turno) de forma consistente.
- **Frontend: interceptador de 401** — redirecionar para login automaticamente quando o token expirar (hoje depende de cada página).

### Funcionalidades (prioridade média)
- **Paginação + busca/filtro** nas listas de chatters, histórico de turnos e histórico de pagamentos (hoje só há `limit`).
- **Exportar CSV/Excel** de pagamentos e turnos (relatório mensal para o cliente).
- **KPIs no dashboard** — produção de hoje, por modelo, comparativo com dias anteriores.
- **Notificações** para OCR de baixa confiança e saldos negativos (hoje só aparecem no fluxo).
- **Comentários/observações no turno** — campo livre para anotar contexto.
- **Confirmação para ações destrutivas** — modal de confirmação ao excluir turno.

### UX / Frontend (prioridade média)
- **Estados de carregamento (skeletons)** e **empty states** com orientação em todas as listas.
- **Toasts consistentes** de sucesso/erro em todas as ações.
- **Dark mode**.
- **Error boundary** no React para evitar tela branca em erro inesperado.

### Técnica / Manutenção (prioridade baixa)
- **Manter a suíte de testes como teste automatizado** (transformar `test-suite.js` em runner com `vitest`/`node:test` e rodar no CI) — hoje foi um script descartável.
- **Cliente de API tipado compartilhado** entre web e api (evitar duplicação de tipos).
- **Versionamento de API** (`/api/v1/...`) para evolução sem quebrar o app.
- **WebSocket já presente** (socket.io) — garantir reconexão e indicador de "online/offline" no chat.

## 3. Recomendação de commit

Agrupar em um commit de entrega:
1. Fix do chat + gestão de tags/histórico do gerente.
2. Fix CORS (métodos PUT/PATCH/DELETE).
3. Fix zod → 400 (handler global).
4. Fix OCR sem arquivo → 400.
5. Redesign da UI (design system em `index.css`).
6. Limpeza de código morto e dependências não usadas.
7. (Opcional) suíte de testes.