# Mapeamentos QuarkRH no RH

**Documentos RH → Funcionários → Mapear setores e unidades** permite descobrir empresas no QuarkRH, habilitar as que devem ser consultadas e definir seus destinos no RH. O Financeiro foi consultado como referência de funcionamento, sem alteração de seus arquivos ou banco. Os cadastros e vínculos desta implementação pertencem exclusivamente ao RH.

## Uso

1. **Atualizar lista do QuarkRH** consulta somente o catálogo de unidades. Não importa nem modifica funcionários.
2. Em **Unidades**, marque **Incluir na sincronização**, escolha uma **Unidade do RH** e salve a linha. Desmarcar preserva os funcionários e interrompe as próximas importações cadastrais daquela unidade.
3. O catálogo do RH começa com Natal, Mossoró, Fortaleza, Recife, João Pessoa e Maceió. **Cadastrar unidade do RH** permite outro nome e cidade operacional. Não são copiados códigos do Financeiro nem usado o endereço fiscal da API como cidade operacional.
4. Em **Setores / Equipes**, escolha ou digite o setor e salve. A regra afeta apenas a equipe e unidade correspondentes, aplica-se aos cadastros atuais e continua na próxima sincronização. Deixar em branco restaura o nome original e sinaliza o vínculo pendente.
5. **Sincronizar QuarkRH** busca funcionários das unidades habilitadas. Suas equipes aparecem no mapeamento após a sincronização.

São habilitadas as seis unidades anteriores (`9417839`, `9417838`, `9417837`, `9417836`, `9417834`, `9338112`) e as quatro novas autorizadas: `13852936` (DMV Fortaleza), `13852937` (RDT João Pessoa), `13852938` (RDT Maceió) e `14180910` (VNA Maceió). O primeiro **Atualizar lista** ou a primeira sincronização cadastral descobre as demais empresas; elas permanecem desmarcadas. Uma unidade válida sem funcionários não apaga cadastros.

## Consistência e acesso

Os nomes originais ficam em `external_unit_name` e `external_team_name`. `mapped_unit_name` e `mapped_city` identificam o destino operacional; `department` usa o setor escolhido. O Vale Alimentação utiliza a cidade operacional nas próximas consultas. Resultados antigos, folhas, documentos e valores de benefícios permanecem preservados. João Pessoa e Maceió não recebem valores financeiros presumidos.

Descobrir ou renomear uma empresa na API não modifica sua seleção, destino ou setor. `QUARK_UNIT_IDS` deixa de definir a lista. Chamadas são sequenciais, paginadas e com espera/repetição limitada para HTTP 429. Páginas repetidas ou respostas inesperadas interrompem a importação. Funcionários só são gravados após concluir as consultas e validar a seleção novamente.

CPFs repetidos com um único vínculo ativo usam esse vínculo. Cadastros ativos divergentes, ou desligados divergentes sem vínculo ativo, ficam como conflito e preservam o cadastro anterior. A sincronização informa conflitos, ignorados e vínculos pendentes. Não cria funcionários duplicados para resolver ambiguidades.

Somente RH/Administrador ativo pode ler ou alterar os mapeamentos. O navegador tem SELECT sob RLS e nenhuma escrita direta nas tabelas ou execução das novas RPCs. A função Edge revalida usuário e perfil e usa RPCs `SECURITY INVOKER` exclusivas do servidor. Um GET autenticado verifica a versão da função antes de habilitar a tela; uma função antiga não recebe acidentalmente um POST de sincronização ao tentar descobrir unidades.

## Instalação

O instalador exige a referência RH tanto na URL pública quanto na conexão PostgreSQL. Aplica somente `20261110112827_quark_unit_team_mapping.sql`, em transação, verifica RLS/grants e compara os dados de origem dos funcionários e tabelas de folha/benefícios/documentos antes e depois. Sem `--apply`, somente informa o estado. Não atualiza as demais migrations nem outros sistemas.

```powershell
Set-Location "D:\sistemas\sistemaadm"
node scripts/install-quark-mapping.mjs --project=kdbnheeosaptxpwkmjbz --apply
# Execute os próximos comandos somente se o anterior concluir sem erro.
npx --yes supabase@2.121.0 functions deploy sync-quark-employees --project-ref kdbnheeosaptxpwkmjbz --use-api
npx --yes supabase@2.121.0 functions deploy sync-benefit-meal --project-ref kdbnheeosaptxpwkmjbz --use-api
```

Publique a interface pelo fluxo normal do projeto. No ambiente local, recarregue a página após instalar o banco e as funções. Descubra o catálogo na tela e execute **Sincronizar QuarkRH** para trazer os funcionários novos. A instalação isolada não consulta nem importa pessoas.

## Verificação

- `npm test`: build e regressões, incluindo catálogo, paginação, conflitos de CPF, cidades operacionais, limite da API e o handler real com endpoints fictícios.
- `npm run test:quark-mapping-db`: banco descartável `127.0.0.1:55439`, transação revertida; inclusão inicial, descoberta sem habilitação automática, isolamento por unidade, setores preservados em sincronizações repetidas, corrida de desmarcação e RLS/grants.
- `npm run test:quark-mapping-ui`: Chrome/Playwright com APIs interceptadas; descoberta, seleção, destinos personalizados, setor por unidade, nomes originais preservados, tela móvel/escura e detecção de função legada. Usa `MEAL_TEST_URL`, `PLAYWRIGHT_PATH` e `PLAYWRIGHT_CHROMIUM`, como o teste do Vale Alimentação.
- `npm run test:hostinger`: build estático e rotas.

Capturas com pessoas fictícias ficam em `tmp/quark-mapping-qa`. Os testes de banco e navegador não usam o QuarkRH ou o Supabase de produção.
