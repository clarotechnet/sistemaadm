# Vale Alimentação

Benefícios → Vale Alimentação substitui o antigo módulo reservado de Vale Transporte. O desconto de vale-transporte que já existe na leitura das folhas continua com sua classificação original.

## Período e cálculo pendente

O operador escolhe início e fim das ocorrências. Por exemplo, 26/10/2026 a 25/11/2026 corresponde ao benefício de dezembro/2026. O período inicial sugerido vai do dia 26 anterior ao dia 25 de fechamento; ambos os campos são editáveis. O limite técnico por consulta é de 366 dias.

O valor futuro deverá considerar os dias previstos de trabalho no mês do benefício menos os dias de faltas e atestados do período selecionado. A origem dos dias previstos e os valores diários ainda serão informados pelo RH. Nenhum calendário, escala, valor ou pagamento foi estimado. `planned_work_days`, `payable_days`, `daily_value` e `amount_due` ficam nulos, inclusive no banco. As colunas correspondentes do Excel ficam vazias; a tela e o PDF indicam a pendência.

Natal, Mossoró e Fortaleza possuem os grupos Técnico/Técnica e demais setores. O grupo técnico reconhece o início do setor normalizado `TECNICO` ou `TECNICA`. Recife permanece com quatro faixas a definir; o sistema não atribui uma faixa sem a regra. Férias, admissões, desligamentos e elegibilidade não recebem regras financeiras presumidas.

## Atualização e qualidade das ocorrências

**Atualizar pelo QuarkRH** consulta as faltas do Espelho de Ponto e os atestados de todas as unidades vinculadas ao cadastro existente. A lista inclui todos os funcionários cadastrados, inclusive desligados e manuais. A atualização cadastral permanece em Documentos RH → Funcionários → Sincronizar QuarkRH; a consulta de ocorrências não repete essa sincronização inteira, evitando consumir a cota da API antes de buscar as faltas. Abrir a tela apenas lê os dados; a consulta externa exige o botão.

As chamadas de todas as unidades e fontes passam por uma fila única, com intervalo entre requisições. HTTP 429 respeita `Retry-After`, com até duas novas tentativas dentro do prazo da função. Erros de autenticação, cota ou servidor não geram novas variantes dos parâmetros de data. Os erros preservam HTTP e endpoint, sem gravar o corpo privado da resposta. O Espelho usa as janelas mensais do Agregamento e filtra as ocorrências pelas datas escolhidas, inclusive quando o período cruza meses; datas fora desse período são descartadas.

As faltas são contadas por datas distintas com `tipoDesconto=FALTA` e duração não zero. Atestados usam datas distintas do intervalo informado, limitadas ao período selecionado, sem duplicar dias de atestados sobrepostos. Quantidade de dias incompatível com as datas é sinalizada para conferência. Um dia com falta e atestado fica pendente de revisão antes de definir os dias para desconto.

Fonte indisponível, resposta inválida, registro inválido ou funcionário sem vínculo produz uma contagem desconhecida, nunca zero artificial. Uma consulta válida sem ocorrências produz zero. No período ainda aberto, a consulta vai somente até a data atual de São Paulo e fica parcial. Avisos de cobertura acompanham a versão e os relatórios. O módulo consulta o QuarkRH diretamente, sem substituir uma falha por uma planilha externa.

## Histórico, acesso e relatórios

Cada atualização cria uma nova versão com período, mês do benefício, data consultada, responsável, cobertura, cadastro dos funcionários e ocorrências. Versões anteriores preservam os nomes, setores e contagens daquele momento, inclusive após edição ou remoção do cadastro atual. Falhas não substituem versões concluídas. A aba Histórico permite abrir cada versão; consultas interrompidas há mais de dez minutos podem ser marcadas como falha na próxima atualização.

Somente RH/Administrador ativo pode consultar ou atualizar. O navegador tem apenas SELECT sob RLS. A gravação é feita pela nova função Edge autenticada, com revalidação do perfil, e finalizada em uma transação com `complete_benefit_meal_run`, exclusiva de `service_role` e `SECURITY INVOKER`. O token QuarkRH e as chaves privadas ficam no servidor. São guardados somente identificadores, datas e horas das ocorrências, sem CID, diagnóstico ou documentos médicos.

PDF A4 paisagem e Excel XLSX incluem logo, empresas/unidades, período, mês do benefício, responsável, data, versão e filtros. Exportam todos os registros filtrados, independentemente da paginação. CPFs são texto e respeitam a opção de mascaramento. O Excel tem cabeçalho, filtros, congelamento de linhas/colunas, datas e números tipados; campos financeiros desconhecidos ficam vazios. O PDF repete cabeçalho e empresa nas quebras de página.

Os filtros Empresa, Cidade e Situação permitem marcar várias opções. As opções de cada filtro se somam; filtros diferentes se combinam (por exemplo, duas empresas apenas em Natal). **Mostrar todas** remove a restrição daquele campo. Situação inicia em **Ativos**. As exportações usam a mesma lista filtrada e identificam todas as seleções.

## Instalação

Projeto RH exclusivo: **kdbnheeosaptxpwkmjbz**. A migração aditiva é `supabase/migrations/20261109181644_benefit_meal_period_snapshots.sql`. Ela cria apenas `benefit_meal_runs`, `benefit_meal_rows`, `benefit_meal_events`, seus índices, políticas e a função de conclusão. Não atualiza folhas, funcionários ou Agregamento.

Publique também `supabase/functions/sync-benefit-meal/index.ts`, `quark.ts` e `_shared/meal-domain.ts`, preservando a validação JWT e os secrets de servidor já existentes `QUARK_AUTH_TOKEN` e, opcionalmente, `QUARK_API_URL`. Não exponha secrets no frontend. Sem a estrutura, a tela informa a instalação pendente e bloqueia a atualização.

A verificação somente de leitura `node scripts/verify-benefit-meal-db.mjs --project=kdbnheeosaptxpwkmjbz` confere a referência nas URLs pública e de banco antes de conectar. Verifica RLS, grants, o corpo da RPC e campos financeiros pendentes, sem exibir dados de funcionários.

## Verificação

- `npm test`: build e regressões, incluindo domínio, parser, arquivo XLSX e handler Edge com APIs fictícias.
- `npm run test:hostinger`: build estático e verificação das rotas.
- `npm run test:meal-ui`: Chrome/Playwright com APIs interceptadas e funcionários fictícios; período, consulta explícita, versões, erro preservando histórico, filtros, paginação, exportações reais, visual móvel e instalação ausente. Servidor de teste padrão `http://127.0.0.1:5176`; configurar `MEAL_TEST_URL`, `PLAYWRIGHT_PATH` e `PLAYWRIGHT_CHROMIUM` conforme o ambiente.
- `npm run test:meal-db`: PostgreSQL descartável em loopback `127.0.0.1:55439`; valida atomicidade, nulos, RLS, grants e preservação histórica. Não lê `.env`, não acessa produção e reverte a transação inteira. Requer banco vazio dedicado.

Na verificação visual, os relatórios fictícios de 61 funcionários foram abertos como XLSX e renderizados como PDF, incluindo quebras de página. Esses arquivos de teste ficam em `tmp/meal-qa`, fora do Git.
