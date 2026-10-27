# Várias folhas na mesma competência

## Uso

Em **Dados da Folha → Importações**, escolha mês e ano nos menus. Selecione um ou vários arquivos PDF ou XLS/XLSX (até 20 por lote, 50 MB por arquivo) e identifique cada folha pela empresa/unidade, como DMV Natal, VNA ou RDT. Clique em **Analisar arquivos**, confira a prévia e depois em **Importar folhas selecionadas**. Avisos de leitura precisam ser reconhecidos antes de gravar.

- **Adicionar nova folha** é a opção padrão: mantém todos os outros arquivos do mês.
- Para uma correção, escolha **Atualizar somente: [folha]** e confirme a substituição. A identificação da folha existente é reaproveitada, mesmo quando o arquivo novo tem outro nome.
- A visão geral lista arquivo, identificação, quantidade de CPFs, responsável e data de cada origem. Administradores podem remover só uma folha, com confirmação. A remoção de toda a competência continua sendo uma ação separada.
- O mesmo arquivo é identificado pelo SHA-256 e não pode ser importado novamente na mesma competência, mesmo renomeado. Uma identificação já cadastrada exige atualização explícita. Edições concorrentes são recusadas quando a versão exibida está desatualizada.
- PDF e Excel da **mesma folha** são alternativas, não pagamentos complementares. O frontend consulta as origens novamente antes de gravar e bloqueia uma nova origem com exatamente os mesmos CPFs/líquidos de outra ou de outro arquivo do lote. Para trocar o formato, escolha **Atualizar somente**; a substituição troca todos os detalhes daquela origem. Folhas complementares com pagamentos diferentes continuam permitidas. O bloqueio por conteúdo ocorre no cliente; a trava/versão e o bloqueio por hash de bytes continuam no RPC. Não é uma restrição semântica adicional no banco para clientes antigos ou duas novas importações simultâneas em formatos diferentes.

Líquido, descontos de saúde e odontológico são consolidados por CPF em todas as folhas do mês. O CPF conta como um funcionário no consolidado. Se existir em várias origens, seus valores são somados e as ocorrências são preservadas para a revisão de possíveis duplicidades na Conferência. Uma identificação diferente não prova que dois arquivos com conteúdos semelhantes são pagamentos diferentes: confira as origens quando houver folha complementar, transferência ou duplicidade.

As conferências de saúde, odontológico e líquido usam o mesmo consolidado, inclusive no histórico de até três meses. O histórico individual busca todas as origens antes de agrupar por competência, sem limitar o resultado à quantidade de meses. Adicionar, substituir ou remover uma origem recalcula os dados; os comparativos antigos salvos daquele mês são invalidados. Justificativas de conferência permanecem ligadas à revisão anterior dos valores.

## Banco e implantação

A migration `supabase/migrations/20261020151457_payroll_multiple_sources.sql` mantém `payroll_imports` como âncora única do mês e cadastra cada arquivo em `payroll_sources`. Os registros financeiros passam a ser únicos por origem + CPF, sem apagar ou recriar registros existentes no backfill.

As novas tabelas são protegidas por RLS e só podem ser lidas pelo RH/administradores. Escritas diretas continuam bloqueadas. O lote é gravado atomicamente por função, com validação de perfil ativo, limites e trava por competência. As funções privilegiadas ficam no schema não exposto `payroll_private`; os pontos de entrada públicos usam `SECURITY INVOKER`.

O importador antigo é bloqueado no banco para impedir que versões antigas da interface apaguem outras folhas. **Depois da migration, publique também a nova versão do frontend.** Não foi alterada a configuração da Hostinger.

Comandos de inspeção/aplicação, sempre verificando a referência do projeto público e da conexão PostgreSQL:

```powershell
node scripts/payroll-sources-db.mjs --project=REFERENCIA_DO_RH
node scripts/payroll-sources-db.mjs --project=REFERENCIA_DO_RH --apply
```

Sem `--apply`, a inspeção é somente leitura. Na aplicação, a ferramenta compara contagens e hashes dos dados anteriores dentro da transação e reverte tudo se qualquer conteúdo protegido mudar. Uma estrutura já instalada não é reaplicada.

Aplicada em 20/10/2026 no projeto RH confirmado pelo usuário: preservadas 2 competências, 430 registros financeiros, 1 comparativo e suas 219 linhas. O teste transacional de importação, detalhes, justificativas e permissões também passou no banco confirmado, com todos os dados fictícios revertidos. O serviço MCP de advisors não autorizou a consulta; RLS, permissões, vínculos e modo das funções foram verificados diretamente no PostgreSQL.

Folhas apagadas pela lógica anterior não podem ser recuperadas por esta mudança. Reimporte os arquivos faltantes como novas origens; não reimporte como nova origem o arquivo que já foi preservado na competência.

## Validação

- `npm test`: 107 testes aprovados, incluindo leitura espacial do PDF, validações e preservação de referências.
- `npm run test:hostinger`: build estático e dois testes de empacotamento aprovados.
- `node --import tsx tests/payroll-sources-db.mjs`: banco PostgreSQL isolado em localhost:55438, com rollback completo. Cobre backfill, três empresas no mês, substituição individual, identificação/arquivo repetido, lote inválido, atualização desatualizada, CPF compartilhado, RLS, remoção individual e persistência integral de referências/detalhes PDF no JSONB existente.
- `npm run test:payroll-ui`: navegador com projeto fictício, XLSX e PDF sintéticos. Cobre importação de três folhas, substituição individual, seis origens do CPF, histórico, arquivo renomeado, remoção, recarga, competência e lote misto PDF/Excel. A prévia não grava dados financeiros, exige reconhecimento de avisos e é invalidada ao mudar competência/seleção; PDF ilegível interrompe o lote inteiro. Duplicidade entre formatos é recusada e a troca explícita de origem é permitida. Sem erro de página nem tráfego externo inesperado. Layout conferido também em 390 pixels.

As capturas e os bancos locais de QA ficam em `tmp/`, ignorados pelo Git. A interface pode ser testada com Vite na porta 5174, usando a configuração Hostinger e um Supabase fictício `https://benefits-preview.supabase.co`. Informe `PLAYWRIGHT_PATH` e `PLAYWRIGHT_CHROMIUM` quando o Playwright/Chrome estiverem fora do caminho padrão. O teste gera um PDF fictício com ReportLab; informe `PAYROLL_TEST_PYTHON` se necessário. Orientações do formato: [Importação PDF e Excel](payroll-pdf-import.md).
