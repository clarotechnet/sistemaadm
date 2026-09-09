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

Este projeto é uma aplicação Node.js dinâmica. Não publique somente a pasta `dist` por FTP: ela não contém um `index.html` de site estático e esse fluxo resulta em erro 403.

Na Hostinger, use **Sites → Adicionar site → Implantar aplicação web → Importar repositório Git** e selecione este repositório. Configure:

- Node.js: 22 ou superior
- Comando de instalação: `npm ci`
- Comando de build: `npm run build`
- Comando de início: `npm start`
- Diretório de saída, se solicitado: `dist`

Variáveis de produção:

```dotenv
DEPLOY_TARGET=hostinger
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SEU_VALOR
SUPABASE_SECRET_KEY=sb_secret_SEU_VALOR
NEXT_PUBLIC_APP_URL=https://administrativo.clarotechnet.com.br
SITE_URL=https://administrativo.clarotechnet.com.br
```

No Supabase Auth, configure a URL principal como `https://administrativo.clarotechnet.com.br` e permita o redirecionamento `https://administrativo.clarotechnet.com.br/auth/callback`.

Chaves legadas `anon` e `service_role` ainda são aceitas como fallback, mas instalações novas devem usar `publishable` e `secret`.

## Comandos úteis

- `npm run dev`: servidor local
- `npm run build`: build padrão
- `npm start`: servidor de produção após o build
- `npm test`: build e testes automatizados
- `npm run lint`: análise estática
- `npm run db:generate`: gerar migrations do Drizzle
- `npm run db:migrate`: aplicar migrations via `DATABASE_URL`

As migrations SQL versionadas ficam em `supabase/migrations`. Para um projeto vazio, use `supabase/SQL_EDITOR_ALL.sql` no SQL Editor do Supabase.
