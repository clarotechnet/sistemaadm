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
RH_CONTROL_SUPABASE_URL=https://kdbnheeosaptxpwkmjbz.supabase.co
RH_CONTROL_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SEU_VALOR
HOSTINGER_FTP_SERVER=servidor-ftp
HOSTINGER_FTP_USERNAME=usuario-ftp
HOSTINGER_FTP_PASSWORD=senha-ftp
```

O workflow publica somente `dist-hostinger/` em `./administrativo/`. Os secrets `RH_CONTROL_*` têm prioridade; os antigos `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` ou `VITE_SUPABASE_ANON_KEY` continuam como fallback. Antes do FTP, a publicação exige o projeto `kdbnheeosaptxpwkmjbz`, uma chave pública aceita pelo Supabase e todos os secrets FTP presentes. Configuração ausente, projeto incorreto ou chave privada fazem o job falhar sem enviar arquivos. A verificação do Supabase consulta apenas configurações públicas do Auth, sem ler dados de funcionários.

No Supabase Auth, configure a URL principal como `https://administrativo.clarotechnet.com.br` e permita o redirecionamento `https://administrativo.clarotechnet.com.br/auth/callback`. Aplique `supabase/SQL_EDITOR_ALL.sql` em um projeto vazio e publique a função `invite-rh-user` com validação JWT.

No frontend e no build estático, use somente `publishable` ou a chave legada `anon` do mesmo projeto. Chaves `secret` e `service_role` pertencem exclusivamente ao backend e nunca devem entrar no build público.

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

## Benefícios e comparativos de planos

Os módulos de Benefícios aparecem na ordem Agregamento, Vale Transporte, Plano de Saúde e Plano Odontológico. Saúde e Odonto reutilizam a folha importada em **Dados da Folha → Importações**. Ao abrir **Conferência mensal**, os descontos da folha da competência selecionada são comparados automaticamente por CPF com os valores da respectiva **Base de dados**, sem enviar outro arquivo nem clicar para iniciar. Há tolerância, filtros e exportação Excel. Dados da Folha mantém Visão geral e Importações.

Saúde e Odonto têm **Base de dados** e **Conferência mensal**. O cadastro é versionado por CPF, plano e vigência mensal; editar, desativar ou excluir cria uma nova versão. O histórico pode ser consultado pela vigência e pela opção de versões. O cálculo na tela usa o cadastro mais recente de cada CPF na base atual, sem filtrar pela vigência ou pelo mês da folha. Qualquer folha importada pode ser comparada, inclusive uma anterior à base. A vigência permanece disponível para consultar o histórico cadastral, mas não limita a conferência. O cálculo acompanha as alterações da base e não é substituído por um comparativo antigo. O resultado automático usa os dados compartilhados e fica disponível a toda a equipe autorizada sem botão de salvar, inclusive nos indicadores do Dashboard e da folha. Alterações da base são consultadas ao voltar à aba e a cada minuto, sem fechar formulários. Comparativos antigos ficam separados apenas para consulta; abrir a tela não grava nem substitui esses registros. CPFs inativos/excluídos com cobrança na folha são conferidos contra zero; funcionários sem plano e sem cobrança não geram falsas ausências. As leituras e escritas exigem RH/Administrador, e o cliente não possui UPDATE/DELETE nas versões.

Na importação da Hapvida, **DESC FOLHA** é o valor esperado do desconto, sem confundir FATURA ou BASE MENSALIDADE. No Odonto, **VALOR** tem prioridade sobre VALOR UNI. Cabeçalhos repetidos e separadores não são pessoas. CPFs repetidos ficam **Pendentes RH**, sem soma automática nem valor de referência presumido, mantendo os lançamentos de origem para análise. A confirmação de importação não desativa pessoas ausentes do arquivo.

O Agregamento mensal mostra o último sucesso do QuarkRH por competência, responsável e ressalvas. Falhas posteriores não avançam a data do sucesso. A informação vem de `benefit_aggregation_sync_runs`, não do relógio do navegador.

A migração aditiva está em `supabase/migrations/20261016153134_benefit_plan_bases.sql`. A verificação abaixo usa o projeto RH explicitamente confirmado, testa o SQL e RLS em transação revertida e não altera dados reais:

```powershell
node --import tsx scripts/benefit-plans-db.mjs --project=kdbnheeosaptxpwkmjbz
# Acrescente --apply para instalar somente o schema. Sem esta opção, tudo é revertido.
```

O importador administrativo inicial possui `--seed-files --competence=2026-09`, exclusivo dos dois arquivos fornecidos de setembro/2026. Ele recusa uma base preexistente diferente, é idempotente pelo hash do arquivo e preserva o conflito odontológico para o RH. Não publica o site nem modifica os comparativos já salvos.

## Conferência de folha

A rota `/conferencia`, disponível a RH e Administradores, utiliza as mesmas competências de **Dados da Folha → Importações**. Compara **sempre o líquido** atual com cada folha disponível em até **3 meses anteriores**, com período selecionável de 1 a 3 meses (padrão: 3). Não calcula média nem usa competências mais antigas para completar meses faltantes. Totais, novos e ausentes usam a referência mais recente disponível; variações também consideram as outras referências do período. O detalhamento e as exportações identificam cada mês. Os limites de variação exigem percentual **e** diferença absoluta (padrão: 20% e R$ 300).

Salário-base é opcional: a ausência ou coluna vazia não gera achado, inclusive em importações anteriores. Base zero não representa folha/líquido zerado. Bruto, base e eventos permanecem informações de apoio para conferir a composição, sem substituir o líquido no comparativo. Descontos elevados são sinalizados acima de 50% dos proventos brutos, com percentual ajustável de 0 a 100%. O cálculo exige bruto positivo e total de descontos informado; não utiliza o líquido como denominador nem estima dados ausentes. É um critério de revisão, não um limite legal; líquido negativo ou descontos que excedam o bruto continuam críticos.

Os indicadores são botões que filtram os mesmos registros contabilizados, limpando filtros anteriores e voltando à primeira página. Clicar novamente no indicador ativo ou em **Limpar filtros** exibe todos os registros. Os contadores são globais à competência e alguns grupos se sobrepõem. As exportações respeitam a lista filtrada e incluem os achados e a proporção descontos/bruto.

Importações novas preservam detalhes financeiros reconhecidos em `payroll_records.audit_data`. Folhas antigas continuam legíveis, mas precisam ser reimportadas para acrescentar base, bruto, descontos e eventos. Atualizar uma competência recalcula a conferência automática de Saúde/Odonto quando a folha é recarregada; os comparativos antigos permanecem preservados como histórico.

O tratamento de achados fica em `payroll_audit_reviews`, protegido por RLS, com responsável, data e observação. Os campos de justificativa têm fundo/borda destacados, foco visível e contador de caracteres nos temas claro e escuro. Reimportar a folha ou qualquer referência, ampliar o conjunto de referências ou trocar os limites gera uma revisão diferente, sem reutilizar justificativas de valores anteriores. Marcar um achado como corrigido não modifica a folha.

Os CPFs da folha são cruzados com `employees`, usando o status atual sincronizado do QuarkRH e os registros manuais. A tela e as exportações identificam ativo, desligado ou CPF não localizado, com origem e sincronização. Há filtro de situação e contador de ativos atuais com líquido zerado. O botão **Sincronizar QuarkRH** reutiliza a integração existente; não faz uma chamada por funcionário. Datas de admissão/desligamento continuam sendo necessárias para comprovar o vínculo histórico. Alterações cadastrais relevantes também geram uma revisão diferente dos achados.

Ao conferir ausência de pagamento no cadastro, somente unidades identificadas pelos CPFs da folha são consideradas. Funcionários de outras unidades não são tratados como ausentes nesta folha. Dados da Folha e Conferência compartilham a seleção do `Líquido` final, com prioridade ao cabeçalho exato `Líquido`, sem confundir componentes como `Líquido rescisão`. Quando o mesmo cabeçalho de total se repete, usa-se a última ocorrência; colunas vazias depois do líquido não alteram a seleção.

INSS, IRRF, adiantamentos e descontos são classificados antes de proventos, mesmo quando o nome também contém férias, 13º ou rescisão. A leitura de importações já salvas aplica essa correção em memória, preservando os valores originais e sem gravar alterações no banco. Esses descontos não são aceitos como evidência de pagamento de férias, 13º ou verbas rescisórias.

Férias usam os registros disponíveis na base mensal de benefícios. Os eventos de 13º e rescisão são sinalizados quando existem, mas valores de parcelas, proporcionalidade e recibos separados não são atestados sem suas fontes. Campos desconhecidos aparecem como `—`, nunca como zero fabricado.

A extensão aditiva do banco está em `supabase/migrations/20261008150653_payroll_audit_module.sql`. Para aplicar via conexão direta, o comando abaixo exige que as referências da URL pública e do `DATABASE_URL` coincidam com o projeto informado:

```powershell
node scripts/payroll-audit-db.mjs --project=SEU_PROJECT_REF --apply
node scripts/verify-payroll-audit-db.mjs --project=SEU_PROJECT_REF
```

O segundo comando verifica importação, RLS e justificativas com dados fictícios dentro de uma transação que sempre é revertida. Não executá-lo contra outro produto.
