# Recuperação de senha

O link **Esqueci minha senha** no login abre `/recuperar-senha`. O Supabase envia
um link de uso único para `/redefinir-senha` no **mesmo domínio e subdomínio** em
que a solicitação foi feita. Não altera a senha até que o usuário confirme a nova.

As duas rotas são públicas tanto no Vinext quanto no build estático. Na SPA, elas
são renderizadas antes de carregar usuário/perfil e antes do callback automático.
Não é necessário alterar tabelas, permissões ou migrar o banco.

## Configuração para produção

Em **30/10/2026**, com autorização do usuário, foram salvos no projeto RH correto:
Site URL `https://administrativo.clarotechnet.com.br` e os quatro retornos exatos
`/auth/callback` e `/redefinir-senha` em produção e em `http://localhost:3000`.
Não havia URLs de retorno previamente cadastradas. Nenhuma conta/senha foi alterada.
O SMTP próprio estava desativado: sua configuração e a validação de entrega real
continuam pendentes. O código do frontend ainda precisa ser publicado.

No projeto RH **kdbnheeosaptxpwkmjbz**, em Authentication → URL Configuration,
preserve as URLs existentes e adicione:

- `https://administrativo.clarotechnet.com.br/redefinir-senha`
- `http://localhost:3000/redefinir-senha` para desenvolvimento local

Preserve também os callbacks de cadastro/convite em `/auth/callback` nos dois hosts.

Se testar por outro host/porta local, adicione sua URL exata também. Não permita
curingas em todos os subdomínios da empresa: outros sistemas têm credenciais
distintas. A Site URL deve continuar apontando ao sistema administrativo.

O template de recuperação precisa usar `{{ .ConfirmationURL }}` (padrão Supabase)
ou preservar o `RedirectTo` solicitado. Templates personalizados que forçam outra
rota precisam ser revisados antes de publicar.

Configure **SMTP próprio** para entrega aos usuários em produção. O SMTP padrão
Supabase tem restrições de destinatário e limites baixos; uma resposta aceita do
formulário não é comprovação de recebimento do e-mail. Não coloque credenciais SMTP
nem chaves privadas no frontend.

Documentação oficial: [recuperação](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail),
[redirecionamentos](https://supabase.com/docs/guides/auth/redirect-urls),
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Segurança e comportamento

- Fluxo PKCE: abrir o e-mail no mesmo navegador/dispositivo que fez o pedido.
- Troca explícita do código uma única vez, inclusive em React StrictMode.
- Código válido precisa ser do fluxo recovery e a identidade é validada em `getUser`.
- Código e erros do provedor são removidos da URL após a validação.
- Links inválidos, expirados, reutilizados ou sem verificador oferecem novo pedido.
- Atualizar a página pode retomar por até 20 minutos na mesma aba. O marcador em
  sessionStorage contém somente ID e validade; não contém senha/token e não
  substitui a validação da sessão no Supabase.
- Antes de gravar, a identidade é verificada novamente; outra conta aberta em outra
  aba não pode receber a alteração por engano.
- Nova senha com no mínimo 8 caracteres, confirmação obrigatória e requisitos
  adicionais do Supabase respeitados. Senhas não são aparadas nem registradas.
- Sucesso encerra a sessão local da recuperação; falha ao encerrar não é apresentada
  como falha da troca de senha já concluída.
- Mensagem de solicitação neutra para contas existentes/inexistentes, reenvio com
  espera de 60 segundos e tratamento dos limites do provedor.
- Nenhuma mudança em permissões, aprovação, folha ou documentos.

## Validação

`tests/password-recovery.test.ts` cobre regras e integração das rotas.
`npm run test:auth-ui` exercita o SDK real no navegador com endpoints interceptados
e usuários fictícios: solicitação, PKCE, nova senha, confirmação, expiração,
reutilização, sessão trocada, retomada e erros do provedor. Não envia e-mails reais
nem modifica contas. Os builds Vinext e estático precisam passar antes de publicar.

Depois da publicação/configuração, faça um teste autorizado com uma conta de teste
e sua caixa postal para confirmar entrega real. Os testes automatizados não
comprovam a configuração de SMTP ou a allowlist do projeto hospedado.
