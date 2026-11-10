# Vale Alimentação

Benefícios → Vale Alimentação substitui o antigo módulo reservado de Vale Transporte. O desconto de vale-transporte que já existe na leitura das folhas continua com sua classificação original.

## Período, valores e dias previstos

O operador escolhe início e fim das ocorrências. Por exemplo, 26/10/2026 a 25/11/2026 corresponde ao benefício de dezembro/2026. O período inicial sugerido vai do dia 26 anterior ao dia 25 de fechamento; ambos os campos são editáveis. O limite técnico por consulta é de 366 dias.

Os valores iniciais informados pelo RH em 10/11/2026 são reconhecidos pela cidade operacional, setor e cargo, ignorando diferenças de acento e caixa. A instalação já preenche esses valores; não é necessário digitá-los novamente:

| Cidade | Grupo | Valor |
| --- | --- | --- |
| Natal, Mossoró, Parnamirim e Fortaleza | Técnica/técnico, auxiliar de instalação e supervisor técnico | R$ 25,00/dia |
| Natal, Mossoró, Parnamirim e Fortaleza | Demais setores/cargos | R$ 20,00/dia |
| Recife | Consultor e supervisor de vendas | R$ 20,00/dia |
| Recife | Estoque e RH | R$ 23,00/dia, com base fixa de 22 dias (R$ 506,00 antes dos descontos) |
| Recife | Técnica, auxiliar de instalação e supervisor técnico | R$ 28,58/dia |
| João Pessoa e Maceió | Consultor e supervisor de vendas | R$ 20,00/dia |

Por orientação do RH, **Recife segue temporariamente o desconto normal de faltas + atestados**, até explicar sua peculiaridade. Na configuração inicial, a fórmula de estoque/RH é `máximo(0, 22 − dias de faltas − dias de atestados) × R$ 23,00`. Por exemplo: 1 falta e 2 dias de atestado resultam em 19 dias a pagar e R$ 437,00. Sobreposições exigem revisão antes de calcular. Após uma alteração, a fórmula usa a diária e a base fixa vigentes para o mês do benefício.

## Editar valores e vigências

**Diárias por cidade → Editar valores** permite que RH/Administrador ativo selecione uma cidade, o mês inicial de vigência e as diárias dos grupos já definidos. Estoque/RH de Recife permite também alterar sua base fixa, entre 1 e 31 dias. Dias dos demais grupos continuam para uma etapa posterior. A observação/referência é opcional. Valores com mais de duas casas decimais, negativos ou inválidos não são salvos.

Cada alteração cria novas versões no banco, sem substituir o histórico. Um reajuste de Natal para janeiro não modifica dezembro, Mossoró ou Fortaleza. No mesmo mês, a revisão mais recente daquele grupo prevalece para novas consultas. A lista mostra quem alterou, quando, a vigência e a observação. Se outro responsável salvar durante a edição, o formulário solicita recarregar em vez de sobrescrever silenciosamente.

A configuração inicial tem vigência desde **11/2026**, mês em que os valores foram informados. Meses anteriores exigem que o RH informe sua tabela; não são presumidos valores históricos. Quando a estrutura ainda não foi instalada, os valores já fornecidos continuam visíveis como configuração inicial, e a gravação compartilhada fica bloqueada até instalar. Falhas de rede não criam configurações locais nem simulam uma gravação bem-sucedida.

Reajustes são informados pelo RH; não há atualização automática por legislação ou convenção. Salvar valores não consulta o QuarkRH. Para aplicar uma nova tabela aos dados de uma apuração, faça uma nova consulta explícita. Consultas já salvas mantêm seus valores e as versões exatas das regras que utilizaram.

**Os dias dos demais grupos ficaram expressamente para depois.** O sistema salva a diária, mas mantém `planned_work_days`, `payable_days` e `amount_due` nulos nesses grupos. Não usa automaticamente dias úteis, calendário, escala ou um padrão de 22 dias. Outros grupos de João Pessoa, Maceió e Recife permanecem com valor a definir. `SUPORTE TECNICO` sozinho não é tratado como setor técnico; o cargo técnico, auxiliar de instalação ou supervisor técnico pode enquadrar o funcionário nessa faixa.

Estoque/RH de Recife só recebe total final com funcionário ativo, período encerrado e ambas as fontes consultadas, sem sobreposição. Falha na API, período aberto ou desligamento mantém o cálculo pendente, sem transformar desconhecido em zero. Férias, admissões e demais regras de elegibilidade não recebem descontos presumidos. Na tela, a tabela **Valores informados pelo RH** mostra as faixas; a lista e os relatórios exibem dias, diária, valor a receber e motivo da pendência. O total considera somente cálculos concluídos e identifica quantos funcionários permanecem pendentes.

## Atualização e qualidade das ocorrências

**Atualizar pelo QuarkRH** consulta as faltas do Espelho de Ponto e os atestados de todas as unidades vinculadas ao cadastro existente. A lista inclui todos os funcionários cadastrados, inclusive desligados e manuais. A atualização cadastral permanece em Documentos RH → Funcionários → Sincronizar QuarkRH; a consulta de ocorrências não repete essa sincronização inteira, evitando consumir a cota da API antes de buscar as faltas. Abrir a tela apenas lê os dados; a consulta externa exige o botão.

As chamadas de todas as unidades e fontes passam por uma fila única, com intervalo entre requisições. HTTP 429 respeita `Retry-After`, com até duas novas tentativas dentro do prazo da função. Erros de autenticação, cota ou servidor não geram novas variantes dos parâmetros de data. Os erros preservam HTTP e endpoint, sem gravar o corpo privado da resposta. O Espelho usa as janelas mensais do Agregamento e filtra as ocorrências pelas datas escolhidas, inclusive quando o período cruza meses; datas fora desse período são descartadas.

As faltas são contadas por datas distintas com `tipoDesconto=FALTA` e duração não zero. Atestados usam datas distintas do intervalo informado, limitadas ao período selecionado, sem duplicar dias de atestados sobrepostos. Quantidade de dias incompatível com as datas é sinalizada para conferência. Um dia com falta e atestado fica pendente de revisão antes de definir os dias para desconto.

Fonte indisponível, resposta inválida, registro inválido ou funcionário sem vínculo produz uma contagem desconhecida, nunca zero artificial. Uma consulta válida sem ocorrências produz zero. No período ainda aberto, a consulta vai somente até a data atual de São Paulo e fica parcial. Avisos de cobertura acompanham a versão e os relatórios. O módulo consulta o QuarkRH diretamente, sem substituir uma falha por uma planilha externa.

## Histórico, acesso e relatórios

Cada atualização cria uma nova versão com período, mês do benefício, data consultada, responsável, cobertura, cadastro dos funcionários e ocorrências. Versões anteriores preservam os nomes, setores e contagens daquele momento, inclusive após edição ou remoção do cadastro atual. Falhas não substituem versões concluídas. A aba Histórico permite abrir cada versão; consultas interrompidas há mais de dez minutos podem ser marcadas como falha na próxima atualização.

A diária e os resultados calculados também ficam congelados em cada nova versão. `calculation_version=1` identifica os valores iniciais; a versão 2 guarda `rate_version_id` em cada funcionário e registra em `rate_version_ids` as regras escolhidas ao iniciar a consulta. Alterar uma diária durante uma consulta não altera seus resultados. Consultas anteriores sem cálculo não são recalculadas. Situação da consulta (`SUCCESS`/`PARTIAL`) descreve a cobertura das ocorrências; `calculation_status` distingue cálculo concluído de pendência financeira.

Em **Apuração**, uma consulta antiga sem diária salva mostra a diária conhecida como **Regra atual**, apenas para referência pela cidade, setor e cargo daquele cadastro. Dias e totais permanecem como estavam; não ocorre gravação nem consulta automática ao QuarkRH. PDF/Excel dessa tela identificam a diária de referência nas observações. No **Histórico**, a diária antiga continua como **Não registrado**, e a exportação mantém o campo vazio. Diárias já salvas nunca são substituídas pela referência atual.

A lista reúne funcionário/CPF/empresa, setor/cargo, ocorrências, dias, diária, total e situação em sete colunas que acompanham a largura disponível, inclusive ao recolher o menu lateral. Em espaços menores, cada funcionário aparece em um cartão, sem arraste horizontal. **Ver detalhes** abre a faixa, o motivo da pendência, os dados do cálculo e as ocorrências completas.

Somente RH/Administrador ativo pode consultar ou atualizar. O navegador tem apenas SELECT sob RLS. A função Edge revalida o perfil e calcula os valores no servidor. `complete_benefit_meal_versioned_run`, exclusiva de `service_role` e `SECURITY INVOKER`, reutiliza a validação de ocorrências e confere as regras registradas para a consulta antes de salvar os campos financeiros na mesma transação. `save_benefit_meal_rates` é exclusiva do servidor; o usuário real vem do JWT, sem aceitar um responsável enviado pelo formulário. A tabela de regras permite somente leitura/inclusão ao servidor e não permite edição/exclusão do histórico. Funções antigas com valores fixos são impedidas de salvar novos cálculos financeiros após instalar a estrutura editável. O token QuarkRH e as chaves privadas ficam no servidor. São guardados somente identificadores, datas e horas das ocorrências, sem CID, diagnóstico ou documentos médicos.

PDF A4 paisagem e Excel XLSX incluem logo, empresas/unidades, período, mês do benefício, responsável, data, versão e filtros. Exportam todos os registros filtrados, independentemente da paginação. CPFs são texto e respeitam a opção de mascaramento. O Excel tem cabeçalho, filtros, congelamento de linhas/colunas, datas e números tipados; campos financeiros desconhecidos ficam vazios. O PDF repete cabeçalho e empresa nas quebras de página.

Os filtros Empresa, Cidade e Situação permitem marcar várias opções. As opções de cada filtro se somam; filtros diferentes se combinam (por exemplo, duas empresas apenas em Natal). **Mostrar todas** remove a restrição daquele campo. Situação inicia em **Ativos**. As exportações usam a mesma lista filtrada e identificam todas as seleções.

## Instalação

Projeto RH exclusivo: **kdbnheeosaptxpwkmjbz**. A migração aditiva é `supabase/migrations/20261109181644_benefit_meal_period_snapshots.sql`. Ela cria apenas `benefit_meal_runs`, `benefit_meal_rows`, `benefit_meal_events`, seus índices, políticas e a função de conclusão. Não atualiza folhas, funcionários ou Agregamento.

Publique também `supabase/functions/sync-benefit-meal/index.ts`, `quark.ts` e `_shared/meal-domain.ts`, preservando a validação JWT e os secrets de servidor já existentes `QUARK_AUTH_TOKEN` e, opcionalmente, `QUARK_API_URL`. Não exponha secrets no frontend. Sem a estrutura, a tela informa a instalação pendente e bloqueia a atualização.

A atualização dos valores é `supabase/migrations/20261110132307_benefit_meal_daily_rates.sql`. A função usa a cidade operacional do mapeamento quando disponível; se o módulo ainda não estiver instalado, mantém a identificação pelo nome original da unidade. O instalador abaixo aplica **somente** a nova migration de valores, em transação, confere o projeto RH nas duas conexões, RLS/grants e preservação das consultas/folhas/cadastros existentes. Sem `--apply`, somente verifica o estado.

```powershell
Set-Location "D:\sistemas\sistemaadm"
node scripts/install-meal-rates.mjs --project=kdbnheeosaptxpwkmjbz --apply
if ($LASTEXITCODE -ne 0) { throw "Instalação interrompida." }
node scripts/install-meal-policy.mjs --project=kdbnheeosaptxpwkmjbz --apply
if ($LASTEXITCODE -ne 0) { throw "Instalação interrompida." }
npx --yes supabase@2.121.0 functions deploy sync-benefit-meal --project-ref kdbnheeosaptxpwkmjbz --use-api
```

Depois publique a interface pelo fluxo normal do projeto. Recarregue a tela e faça uma nova consulta para salvar as diárias. O GET autenticado da função verifica a versão antes de iniciar uma consulta; uma função antiga não inicia a sincronização e a versão salva é preservada.

A migration das regras editáveis é `supabase/migrations/20261110143715_benefit_meal_editable_rates.sql`. `install-meal-policy.mjs` aplica somente essa atualização, verifica RLS/grants e compara os dados existentes antes/depois; sem `--apply`, apenas verifica o estado. Nenhuma folha ou funcionário é modificado pela instalação.

## Verificação

- `npm test`: build e regressões, incluindo domínio, parser, arquivo XLSX e handler Edge com APIs fictícias.
- `npm run test:hostinger`: build estático e verificação das rotas.
- `npm run test:meal-ui`: Chrome/Playwright com APIs interceptadas e funcionários fictícios; período, consulta explícita, versões, erro preservando histórico, filtros, paginação, exportações reais, visual móvel e instalação ausente. Servidor de teste padrão `http://127.0.0.1:5176`; configurar `MEAL_TEST_URL`, `PLAYWRIGHT_PATH` e `PLAYWRIGHT_CHROMIUM` conforme o ambiente.
- `npm run test:meal-db`: PostgreSQL descartável em loopback `127.0.0.1:55439`; valida atomicidade, nulos, RLS, grants e preservação histórica. Não lê `.env`, não acessa produção e reverte a transação inteira. Requer banco vazio dedicado.

Na verificação visual, os relatórios fictícios de 61 funcionários foram abertos como XLSX e renderizados como PDF, incluindo quebras de página. Esses arquivos de teste ficam em `tmp/meal-qa`, fora do Git.
