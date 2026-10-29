# Conferência de Horas Extras

Em **Conferência → Horas Extras**, selecione a competência e, opcionalmente,
uma origem/empresa. As horas e os valores pagos vêm dos PDFs já importados em
**Dados da Folha → Importações**. Não é necessário enviar novamente o PDF aqui.

## Referência da equipe

1. Clique em **Adicionar planilha de referência** e envie XLS ou XLSX.
2. Identifique a referência e escolha adicionar ou atualizar explicitamente uma
   referência existente. Analise a prévia antes de salvar.
3. Confira pendências de leitura. Dados inválidos exigem ciência antes de salvar;
   continuam inválidos no comparativo, sem serem transformados em zero.
4. Salve na competência escolhida. RH e Administradores passam a consultar os
   mesmos dados. O arquivo não substitui nem altera a folha de pagamento.

O arquivo é lido localmente; os registros extraídos são compartilhados no banco.
O módulo não armazena uma segunda cópia binária da planilha. A política de
retenção de originais já existente permanece visível no envio de arquivos.

Competência conhecida no nome do arquivo precisa coincidir com a seleção.
É possível manter várias referências por competência. Arquivo idêntico ou
identificação repetida não são acrescentados silenciosamente. Atualizar uma
referência preserva as outras e reinicia apenas suas associações manuais.
Excluir a referência exige Administrador e confirmação; não apaga a folha.
Excluir uma origem da folha também remove referências vinculadas exclusivamente
a essa origem, como informado na confirmação de exclusão.

## Regras do comparativo

- Colunas como `H. EX 50%`, `H. EX 60%`, `H. EX 70%`, `H. EX 100%` e outros
  percentuais são detectadas. Cada percentual é conferido separadamente.
- Texto `HH:MM` e durações do Excel são aceitos, incluindo mais de 24 horas.
  `28:70` é inválido e preservado como foi recebido para correção pelo RH.
- Nas rubricas percentuais de horas extras do PDF, `H,MM` também representa
  horas/minutos: `27,06` vira `27:06` e `6,27` vira `06:27`. O texto original fica
  preservado. A mesma leitura vale para referências de PDF salvas anteriormente
  como quantidade, sem reimportação ou escrita no banco. Isso não converte
  valores monetários, percentuais, DSR nem células numéricas do Excel.
- Minutos inválidos no PDF, como `28,70`, permanecem indisponíveis e são
  sinalizados para o RH, inclusive antes de enviar uma planilha de referência.
  Não se transformam em zero, nem validam o resumo de horas.
- Célula vazia em uma coluna de horas existente representa `00:00`. Coluna
  inexistente, referência ausente ou folha antiga sem horas não provam zero.
- A diferença é **folha menos referência**. A tolerância de tempo começa em zero
  minutos; a monetária usa a configuração financeira do sistema.
- Valores pagos vêm das rubricas da folha. Somente uma coluna explicitamente
  monetária no Excel permite comparar R$. Não se deduz valor esperado por
  salário, percentual ou proporção do pagamento.
- Havendo CPF na referência, ele tem prioridade. Sem CPF, nome normalizado exato
  e único pode ser associado automaticamente. Nome aproximado é apenas sugestão;
  homônimos e duplicidades exigem revisão, sem soma automática.
- **Revisar associação** permite confirmar o CPF da própria folha. A confirmação
  vale para todas as rubricas daquela linha e é compartilhada. Alterar a folha
  invalida confirmações antigas; elas precisam ser reconfirmadas.
- Misturar um registro legado sem detalhe com PDF não confirma a completude das
  horas. O resultado indica **Sem detalhe PDF**, não uma quitação presumida.

A tela oferece filtros de situação, percentual, nome/CPF e origem, além de Excel (.xlsx)
com os dados filtrados, referências originais e identificação da competência.
O cálculo é automático ao carregar os dados compartilhados, sem gravar resultados
por cima da folha. Trocar entre as abas da Conferência mantém a prévia aberta;
trocar competência/origem descarta a prévia daquele contexto.

## Banco e segurança

Migração aditiva:
`supabase/migrations/20261027142948_payroll_overtime_references.sql`.
Foi aplicada em 27/10/2026 no projeto RH **kdbnheeosaptxpwkmjbz**, com autorização,
sem importar referências reais e sem alterar a Hostinger. A instalação conferiu
contagens e resumos de conteúdo das tabelas protegidas antes/depois: funcionários,
folhas, registros financeiros, comparativos e análises permaneceram iguais.

`payroll_overtime_references` tem RLS para RH/Administrador ativos. Anônimos não
leem nem executam as funções; o cliente autenticado não possui escrita direta.
Entradas públicas invoker encaminham a funções privadas com validação de perfil,
competência, origem, revisão e dados. Atualizações concorrentes são recusadas.
O módulo não possui escrita em `payroll_records`.

Em instalação nova, aplique primeiro as migrações anteriores, incluindo
`20261020151457_payroll_multiple_sources.sql`, e depois esta. O agregado histórico
`SQL_EDITOR_ALL.sql` sozinho não inclui a estrutura de múltiplas origens.

Inspeção guardada, sem aplicar novamente:

```powershell
node scripts/payroll-overtime-db.mjs --project=kdbnheeosaptxpwkmjbz
```

## Validação reproduzível

```powershell
npm test
npx tsc --noEmit
npm run test:hostinger
```

O teste SQL `tests/payroll-sources-db.mjs` utiliza exclusivamente o PostgreSQL
isolado de QA e reverte a transação; cobre persistência, duplicidades, revisões,
perfis/RLS, associações e preservação dos registros financeiros existentes.

O roteiro `npm run test:overtime-ui` usa um projeto Supabase fictício interceptado
no navegador, sem acessar produção. Requer servidor Vite local na porta 5174 com
`https://benefits-preview.supabase.co` e chave fictícia, Playwright e Chrome
disponíveis. `PLAYWRIGHT_PATH` e `PLAYWRIGHT_CHROMIUM` permitem informar os caminhos.

Gere as duas planilhas fictícias antes do roteiro:

```powershell
# ARTIFACT_TOOL_MODULE: caminho absoluto do artifact_tool.mjs do runtime bundled.
node tests/fixtures/create-overtime-reference.mjs
npm run test:overtime-ui
```

Os arquivos e capturas ficam em `tmp/overtime-qa` (ignorado no Git). O roteiro
confere prévia, minutos inválidos, persistência compartilhada, associação manual,
troca de competência/abas, atualização/exclusão seletiva, Excel (.xlsx), temas e viewport
mobile. Os testes não enviam a planilha real nem dados de funcionários ao banco.

Validação em 27/10/2026: 119 testes gerais, 2 verificações do build estático,
13 cenários de importação no navegador, 10 cenários da nova aba e 8 cenários SQL
isolados passaram. TypeScript, ESLint nos arquivos alterados e `git diff --check`
também passaram. Os builds mantêm avisos de tamanho de chunks/importações
dinâmicas, sem erro de compilação. Não foi realizado commit, push ou publicação.

Em 28/10/2026, a leitura `H,MM` do PDF foi reproduzida com o extrato e a planilha
fornecidos e com um registro anterior do Supabase RH em transação somente leitura.
Os dois percentuais do exemplo passaram a comparar sem diferença, sem reimportar
ou gravar mudanças no banco. Passaram 126 testes gerais, os 26 testes específicos
de PDF/horas extras, o roteiro do navegador, o build estático e as verificações de
TypeScript/ESLint. Minutos inválidos continuam sinalizados, sem normalização.
