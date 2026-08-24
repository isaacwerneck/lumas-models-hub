# Implantação do piloto gratuito

Arquitetura recomendada para a semana de teste:

- **Frontend:** Netlify Free
- **API e Socket.IO:** Render Free Web Service
- **PostgreSQL:** Neon Free
- **Comprovantes privados:** Cloudflare R2

O Firebase/Firestore não é uma troca direta para este projeto. A API usa Prisma com PostgreSQL, relações, transações, agregações, `Decimal` e `Json`; migrar para Firestore exigiria reescrever e revalidar a camada de dados. O Firebase Data Connect também não elimina essa migração e o período gratuito de Cloud SQL é temporário.

## Antes de começar

1. Resolva e faça commit apenas das alterações locais que devem ir ao ar.
2. Confirme que nenhum arquivo `.env`, senha ou chave foi versionado.
3. Use Node.js 24 e npm 11, iguais ao CI e às plataformas de deploy.
4. Crie uma senha inicial exclusiva para o manager; o sistema exigirá troca no primeiro login.

## 1. Neon

1. Crie um projeto PostgreSQL e mantenha a região o mais próxima possível da API do Render.
2. Copie a URL **pooled** para `DATABASE_URL`.
3. Copie a URL **direct/unpooled** para `DIRECT_URL`.
4. Nunca exponha essas URLs no Netlify nem em variáveis `VITE_*`.

O Prisma usa a conexão pooled durante a execução e a conexão direta para migrations.

## 2. Cloudflare R2

1. Crie um bucket privado, por exemplo `lumas-evidence`.
2. Crie um API token restrito a leitura e escrita nesse bucket.
3. Anote o endpoint S3, bucket, Access Key ID e Secret Access Key.
4. Não habilite acesso público nem domínio público no bucket.

Variáveis correspondentes no Render:

```text
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=lumas-evidence
S3_ACCESS_KEY_ID=<segredo>
S3_SECRET_ACCESS_KEY=<segredo>
```

## 3. Render

O arquivo `render.yaml` provisiona a API como Web Service, aplica migrations e executa um seed idempotente e seguro. Conecte o repositório como Blueprint e preencha:

```text
DATABASE_URL=<Neon pooled URL>
DIRECT_URL=<Neon direct URL>
APP_ORIGIN=https://<site>.netlify.app
S3_ENDPOINT=<endpoint R2>
S3_BUCKET=<bucket R2>
S3_ACCESS_KEY_ID=<segredo R2>
S3_SECRET_ACCESS_KEY=<segredo R2>
BOOTSTRAP_MANAGER_USERNAME=<login inicial>
BOOTSTRAP_MANAGER_DISPLAY_NAME=<nome exibido>
BOOTSTRAP_MANAGER_PASSWORD=<senha aleatória, mínimo 12 caracteres>
```

Os segredos JWT são gerados pelo próprio Blueprint. Não execute o seed de produção sem as três variáveis `BOOTSTRAP_MANAGER_*`. Usuários já existentes nunca têm papel, status ou senha alterados pelo seed.

Depois do deploy, valide:

```text
https://<api>.onrender.com/api/v1/health
https://<api>.onrender.com/api/v1/ready
```

`health` confirma o processo; `ready` também testa PostgreSQL e R2. O plano gratuito do Render adormece por inatividade e pode demorar aproximadamente um minuto no primeiro acesso. Isso é aceitável para o piloto, mas não para produção permanente.

## 4. Netlify

Importe o mesmo repositório. O `netlify.toml` já define comando, diretório de publicação e Node 24. Configure somente:

```text
API_PROXY_TARGET=https://<api>.onrender.com
VITE_SOCKET_URL=https://<api>.onrender.com
```

Não configure `VITE_API_URL` no Netlify. O build falhará de propósito se ela estiver preenchida, pois o HTTP deve passar pelo proxy `/api` para que o refresh cookie permaneça same-origin. Socket.IO usa `VITE_SOCKET_URL` diretamente porque o proxy do Netlify não aceita WebSocket.

O build gera `_redirects` e `_headers` dentro de `dist` com:

- proxy `/api/*` para o Render;
- fallback de SPA;
- CSP compatível com HTTP e WebSocket;
- headers de segurança e política de cache.

Quando o domínio final do Netlify mudar, atualize `APP_ORIGIN` no Render e faça novo deploy da API.

## 5. Smoke test obrigatório

Execute em janela anônima e também em celular:

1. abra `/login` diretamente e recarregue a página;
2. faça login com o manager inicial e troque a senha;
3. crie um chatter e associe uma tag/modelo;
4. entre como chatter, abra e encerre um turno com comprovante;
5. confirme OCR e abertura do comprovante;
6. teste chat em duas sessões simultâneas;
7. confira dashboard, pagamento, notificações e auditoria;
8. faça logout, recarregue e confirme que a sessão não retorna;
9. deixe a API inativa, acesse novamente e confirme a recuperação após o cold start;
10. confira os logs do Render e o uso do Neon/R2 sem erros.

## Passagem para produção paga

Para uso contínuo do cliente, o primeiro upgrade deve ser a API do Render para eliminar o sleep. Depois, aumente o Neon conforme armazenamento/compute e mantenha backups externos periódicos. Netlify e R2 podem continuar nos planos gratuitos enquanto o consumo real permanecer dentro das franquias.
