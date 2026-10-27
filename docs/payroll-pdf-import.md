# Folha de pagamento: PDF e Excel

## Fluxo

Em Dados da Folha → Importações, a mesma seleção aceita `.pdf`, `.xls` e `.xlsx`, inclusive empresas diferentes no mesmo lote/competência. A análise é local no navegador; nenhum serviço externo de OCR ou conversão recebe a folha. A política já configurada de retenção privada do arquivo original continua independente da gravação dos dados financeiros.

1. Escolha competência, arquivos e identificação de cada origem.
2. Clique em **Analisar arquivos**. A prévia mostra CPFs, proventos, descontos, líquido e os dois planos. Totais ausentes no Excel aparecem como “Não informado”, não como zero.
3. Confira os avisos e confirme a importação. Havendo atualização de origem, há uma confirmação adicional. Alterar competência, arquivo, identificação ou ação invalida a prévia.

Se um arquivo falhar na leitura, nenhum dado financeiro do lote é gravado. A gravação usa o RPC transacional existente e preserva as outras origens do mês. Não há nova migration: os detalhes opcionais ficam em `payroll_records.audit_data`, mantendo compatibilidade com dados antigos.

## Modelo PDF suportado

Leitor específico para o **Extrato Mensal / Folha Mensal** digital, em A4 retrato e no layout analisado: cabeçalho com empresa/CNPJ/competência, blocos `Empr.:` ou `Contr:`, CPF, duas colunas de rubricas com marcador P/D, totais por pessoa e totais gerais. Limite de 500 páginas por arquivo. Use o extrato completo, separado por empresa e competência. PDF digitalizado/escaneado, protegido por senha, de outro layout/cálculo ou com blocos que continuem em outra página é recusado; nesses casos use Excel ou um novo extrato compatível.

A leitura reconstrói linhas/colunas por posição dos itens PDF.js, sem assumir que a ordem textual do arquivo seja a ordem de leitura. Referência e pagamento são campos distintos: `21:55` é preservado e convertido em 1.315 minutos; `347,75 P` é um provento de R$ 347,75. O percentual da rubrica (60%, 70%, 100% etc.) também é preservado, quando explícito. Referências não monetárias nunca são somadas ao salário líquido. O tipo P/D do relatório prevalece sobre a classificação pelo nome, inclusive em férias e rescisões.

Por CPF ficam preservados nome, líquido, proventos, descontos, salário contratual, situação histórica, admissão válida, matrícula/código do extrato, cargo, centro de custo/departamento/filial, rubricas, referências, página e observações. Contribuintes ficam identificados separadamente. Datas como `00/00/0000` permanecem apenas no texto original, nunca como datas válidas. Nada atualiza automaticamente o cadastro/situação atual do QuarkRH. Saúde e Odonto utilizam os descontos monetários das rubricas correspondentes, no mesmo consolidado já usado pelo sistema.

### Conferências

- Empresa e competência precisam ser consistentes em todas as páginas. A competência do PDF deve coincidir com a selecionada.
- CPF repetido em blocos, rubrica sem valor/tipo/referência reconhecível ou total individual incoerente bloqueia a leitura.
- Soma dos proventos/descontos por pessoa, proventos menos descontos e totais gerais são conferidos em centavos.
- O resumo por rubrica, quando presente, precisa fechar monetariamente com todos os blocos; quantidades de empregados/contribuintes também são conferidas quando presentes. Resumos nunca são importados como pessoas.
- Diferenças entre referências de horas individuais e o resumo são avisos, sem ajuste silencioso. Resumo por rubrica/quantidade ausente também gera aviso. Totais gerais são obrigatórios.

Na Conferência, o comparativo detalhado exibe as referências anterior/atual separadas dos valores em reais e a origem por página. As referências sobrevivem à recarga e à consolidação de folhas complementares.

## Não somar PDF e Excel da mesma folha

Para migrar de Excel para PDF, escolha **Atualizar somente: [origem existente]**. Essa ação substitui os registros daquela origem, incluindo detalhes exclusivos do formato anterior; não é mesclagem de dois formatos. Importar os dois como novas origens pode duplicar pagamentos. A interface bloqueia conjuntos exatamente iguais de CPFs/líquidos, além da proteção de hash já existente no banco. Conteúdos parcialmente sobrepostos ou com valores diferentes ainda precisam de revisão na Conferência.

## Verificação

`npm test` inclui os testes puros em `tests/payroll-pdf.test.ts`. `npm run test:payroll-ui` exercita o navegador com projeto/respostas fictícios, sem enviar documentos reais. `node --import tsx tests/payroll-sources-db.mjs` verifica o RPC e JSONB no PostgreSQL isolado local, em transação revertida. Fixture inteiramente fictícia em `tests/fixtures/payroll-pdf.ts`.

Também foi validada localmente a leitura das 54 páginas do extrato fornecido, sem importar esse documento no banco: 247 CPFs únicos (246 empregados e 1 contribuinte), 84 rubricas e totais monetários reconciliados. Diferenças nas somas das referências de horas são preservadas como avisos. Esta validação não significa publicação em produção.
