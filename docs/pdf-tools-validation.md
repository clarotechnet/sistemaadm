# Validação da central PDF

Revisão em 20/10/2026. Os testes usam documentos sintéticos, não dados de funcionários.

| Ferramenta | Verificações automatizadas |
| --- | --- |
| Editor de PDF | Inclusão de texto, desfazer/refazer, arquivo exportado legível, remoção da camada de texto nas páginas apagadas e preservação das demais páginas. |
| Compactar PDFs | Arquivo grande reduzido, PDF reaberto com a quantidade correta de páginas e ZIP final válido. O original é mantido se for menor. |
| Juntar PDFs | Ordem escolhida, quantidade final de páginas e rotação original preservada. |
| Separar PDF | Intervalo escolhido, arquivo único, um PDF por página dentro do ZIP e rejeição de intervalos malformados. |
| Organizar páginas | Duplicação, reordenação, remoção e rotação incremental sobre a rotação original. |
| JPG/PNG e PDF | Duas imagens em um PDF e três páginas exportadas como PNGs válidos no ZIP. |
| PDF para Word | DOCX com texto editável reaberto e verificado; PDF digitalizado gera aviso no modo editável e DOCX com imagem no modo visual. |
| Word para PDF | Texto pesquisável, acentuação, tabela, imagem e documento multipágina com o último registro presente. |
| Comparar PDFs | Digitalizações diferentes detectadas sem texto extraível; página em branco adicionada não é confundida com página ausente. |
| Horas Extras PDF x Excel | Correspondência por nome, valores corretos no quadro, quadro somente na primeira página e CSV dentro do ZIP. |

Os testes de serviço também cobrem nomes duplicados no ZIP, nomes de funcionário ambíguos, durações acima de 24 horas, coordenadas em PDF rotacionado/recortado, arquivos inválidos e limites do pacote DOCX. Os testes de navegador bloqueiam domínios externos e verificam que não há erros não tratados na página. Também verificam a posição do texto exportado em página rotacionada e a ausência de rolagem horizontal nos conversores em 390 e 1024 pixels.

Resultado da rodada: 95 testes unitários/integração aprovados, build estático de produção aprovado com dois testes de empacotamento e roteiro de navegador aprovado nas dez ferramentas. TypeScript e ESLint dos arquivos alterados passaram. A auditoria de dependências de produção não apontou vulnerabilidades; a auditoria completa ainda possui alertas de desenvolvimento preexistentes. A revisão visual incluiu as seis páginas do Word multipágina convertido em PDF, além da saída simples e da página editada.

## Limites conhecidos

- PDF para Word não é OCR. No modo editável, texto é reorganizado com layout simplificado; tabelas, colunas e imagens não são reconstruídas com fidelidade. Páginas sem texto em documentos mistos são mantidas como imagens e identificadas nas observações. Um PDF inteiramente digitalizado exige o modo visual ou OCR externo ao módulo.
- No modo visual, o DOCX contém imagens das páginas, não texto editável.
- Word para PDF aceita `.docx`, não `.doc` antigo ou arquivos protegidos. Preserva conteúdo básico e o tamanho da primeira seção. Layouts complexos, fontes específicas, cabeçalhos, rodapés, caixas de texto e seções com tamanhos diferentes exigem revisão.
- Não há LibreOffice/Word nativo disponível no ambiente de QA. A tentativa de renderizar o DOCX pelo renderizador empacotado foi impedida pela ausência de `soffice.exe`. A estrutura do DOCX, o texto e as imagens foram inspecionados, mas não se afirma fidelidade visual em um motor Word nativo.
- Compactação transforma as páginas em imagens e pode eliminar texto selecionável e campos editáveis. A interface avisa antes do uso. Não é uma ferramenta de preservação ou validação de assinatura digital.
- Editar/apagar ou substituir texto original reconstrói as páginas afetadas como imagens, removendo o texto original dessas páginas. Texto inserido sem apagar mantém o PDF vetorial. Isso não é um serviço de higienização completa de metadados ou de validação de assinatura.
- Juntar, separar e reorganizar rejeitam campos interativos ou de assinatura em vez de descartar silenciosamente sua estrutura. Use uma cópia estática adequada, sem substituir o original.
- PDFs protegidos por senha não são desbloqueados. Arquivos vazios, corrompidos ou excessivos são rejeitados com aviso.

## Privacidade e dependências

Os conversores são executados no navegador, sem API de conversão externa. A política já existente de retenção de upload continua aplicável e aparece junto ao seletor. Logs de operações podem salvar metadados no sistema, mas não enviam o conteúdo a um conversor terceiro.

PDF.js usa worker, fontes, mapas de caracteres e decodificadores na mesma origem, preparados por `npm run prepare:pdf` antes do desenvolvimento e dos builds. As bibliotecas novas são fixadas no lockfile. O `argparse` usado somente pelo CLI do Mammoth foi atualizado por override; o conversor usa sua API de navegador, não o CLI.

## Reproduzir

1. Execute `npm test` e `npm run test:hostinger`.
2. Para a integração, gere os arquivos sintéticos com `tests/make-pdf-tools-fixtures.py` usando o Python do runtime de documentos.
3. Inicie Vite com a configuração Hostinger em `127.0.0.1:5174`, `VITE_SUPABASE_URL=https://benefits-preview.supabase.co` e uma chave fictícia. O teste intercepta todas as chamadas desse projeto fictício.
4. Execute `npm run test:pdf-ui`, informando `PLAYWRIGHT_PATH` e `PLAYWRIGHT_CHROMIUM` quando necessário.

As saídas de QA ficam em `tmp/pdf-tools-qa/outputs/`, ignoradas pelo Git. Não são documentos de produção.
