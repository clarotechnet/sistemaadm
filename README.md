# RH Control

Sistema administrativo de RH em TypeScript, React 19 e Vinext, com autenticação, banco PostgreSQL e armazenamento privado no Supabase.

## Requisitos

- Node.js `>=22.13.0`
- Um projeto Supabase com o SQL de `supabase/SQL_EDITOR_ALL.sql` aplicado

## Desenvolvimento local

1. Copie `.env.example` para `.env.local` e preencha as chaves.
2. Instale as dependências com `npm ci`.
3. Inicie com `npm run dev`.

Nunca envie `.env.local`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ou `DATABASE_URL` ao Git.

## Publicação na Hostinger

O projeto mantém dois destinos: o build dinâmico Vinext (`npm run build`) e uma SPA estática exclusiva para a hospedagem compartilhada (`npm run build:hostinger`). O segundo gera `dist-hostinger/index.html`, `assets/` e `.htaccess`, podendo ser enviado por FTP sem configurar uma aplicação Node.js no hPanel.

Secrets exclusivos usados pelo GitHub Actions:

```dotenv
RH_CONTROL_SUPABASE_URL=https://SEU-PROJETO-EXCLUSIVO.supabase.co
RH_CONTROL_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SEU_VALOR
HOSTINGER_FTP_SERVER=servidor-ftp
HOSTINGER_FTP_USERNAME=usuario-ftp
HOSTINGER_FTP_PASSWORD=senha-ftp
```

O workflow publica somente `dist-hostinger/` em `./administrativo/`. Se os secrets `RH_CONTROL_*` ainda não existirem, a publicação é ignorada para impedir que o sistema use por engano o banco de outro produto.

No Supabase Auth, configure a URL principal como `https://administrativo.clarotechnet.com.br` e permita o redirecionamento `https://administrativo.clarotechnet.com.br/auth/callback`. Aplique `supabase/SQL_EDITOR_ALL.sql` em um projeto vazio e publique a função `invite-rh-user` com validação JWT.

Chaves legadas `anon` e `service_role` ainda são aceitas como fallback, mas instalações novas devem usar `publishable` e `secret`.

## Comandos úteis

- `npm run dev`: servidor local
- `npm run build`: build padrão
- `npm run build:hostinger`: SPA estática para FTP
- `npm start`: servidor de produção após o build
- `npm test`: build e testes automatizados
- `npm run test:hostinger`: valida a saída estática e o `index.html`
- `npm run lint`: análise estática
- `npm run db:generate`: gerar migrations do Drizzle
- `npm run db:migrate`: aplicar migrations via `DATABASE_URL`

As migrations SQL versionadas ficam em `supabase/migrations`. Para um projeto vazio, use `supabase/SQL_EDITOR_ALL.sql` no SQL Editor do Supabase.
