# Manutenção de veículo a partir da Frota

O botão **Atualizar Frota** consulta os dias por CPF e competência. **Atualizar pelo QuarkRH** também consulta a Frota quando a conexão estiver ativada. A consulta não cadastra agregados: só atualiza CPFs já presentes na base de agregamento.

Os dias automáticos ficam em `benefit_aggregation_fleet_days`. Um ajuste em `benefit_aggregation_monthly_overrides`, inclusive zero, tem prioridade. **Usar Frota** remove esse ajuste; **Fixar manualmente** preserva o valor digitado. Não se somam as duas fontes. A recriação do fechamento pelo QuarkRH preserva ambas.

Conta-se a diferença entre as datas locais da retirada e da devolução, com mínimo de um dia quando ambas acontecem no mesmo dia. O prazo previsto não encerra um empréstimo aberto. Datas sobrepostas do mesmo CPF contam uma vez; cada competência tem limite de 30 dias. Retiradas conflitantes de pessoas diferentes no mesmo veículo são sinalizadas e preservam os valores anteriores no RH. A fórmula financeira existente permanece a mesma.

## Instalação

1. Aplicar `supabase/migrations/20261106195751_frota_manutencao_agregamento.sql` e `20261106203110_proteger_competencia_frota.sql` no banco do RH.
2. Um administrador do banco configura `rh_frota_private.config.publishable_key` com a chave pública do Frota. O token restrito é gerado dentro do banco e nunca deve ser colocado em código, navegador ou repositório.
3. No banco do Frota, aplicar a migration correspondente e configurar em `frota_rh_private.integration_auth` somente o SHA-256 do token do RH. O arquivo de instalação entregue ao responsável já contém esse hash.
4. Validar a consulta entre os bancos e ativar `rh_frota_private.config.enabled`. Fazer a primeira atualização pelo botão do RH, conferindo o resultado antes de fechar o pagamento.

A conexão usa HTTPS com endereço fixo, chave pública no cabeçalho `apikey` e token restrito em `X-Frota-Integration-Key`. O navegador chama RPCs do seu próprio RH autenticado. Somente perfis RH ou administrador ativos podem sincronizar ou trocar a origem dos dias. Falhas de rede ou de validação não apagam dias já salvos.

As gravações no fechamento compartilham uma trava por competência. Isso evita que uma recriação pelo QuarkRH use dias antigos durante uma consulta simultânea da Frota. Uma segunda consulta da Frota informa que já existe atualização em andamento.

## Validação realizada

As migrations foram testadas em PostgreSQL local com casos de datas, sobreposição, vínculo antigo, permissões, ajuste manual zero, recriação pelo QuarkRH e reversão integral em falhas de gravação. O transporte HTTP foi simulado nesses testes e validado separadamente no banco hospedado. TypeScript, os testes do projeto e o build estático também foram executados.
