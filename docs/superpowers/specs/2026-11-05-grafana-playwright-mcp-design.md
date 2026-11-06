# Observabilidade com Grafana MCP e Playwright MCP — design

Data: 2026-11-05 · Status: rascunho para aprovação

## 1. Intenção e porquê

O agente GraphRAG já tem CLI e uma página de chat local (`npm run chat`, PR #2). Falta ver o que ele faz enquanto roda e guardar isso. O usuário quer **monitorar ao vivo e armazenar logs**, e quer que dois MCPs façam esse trabalho:

- o **MCP do Grafana**, para que um agente (Claude Code ou o harness de testes) consulte os logs armazenados e os painéis;
- o **MCP do Playwright**, para que um agente abra a página de chat num navegador real, use-a e capture o que o console e a rede mostram.

O retorno esperado, nas palavras do usuário: **validação do comportamento da interface e captura de possíveis erros, para que a aplicação rode sem riscos de segurança, sem erros de funcionamento em live e com monitoramento em live**.

Em seguida, **testes que validem a eficiência dos dois MCPs**: o MCP do Grafana acha no Loki um log específico gerado por uma pergunta ao agente, com o tempo medido; o MCP do Playwright abre o chat, faz uma pergunta e captura console e rede, com tempo e número de chamadas medidos (confirmado pelo usuário).

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**

- Logs do CLI e do servidor de chat armazenados num banco de logs local e consultáveis.
- Um painel no Grafana com logs ao vivo, taxa de erro e latência das perguntas.
- Os dois MCPs configurados no projeto e funcionando para qualquer agente que abra o repositório.
- Um harness de avaliação que aciona os dois MCPs, mede eficiência e valida a interface (erros de console, falhas de rede, cabeçalhos de segurança), com relatório salvo no repositório.

**Não-objetivos**

- Implantação em produção, nuvem ou Grafana Cloud. Tudo roda local.
- Alertas enviados para fora da máquina (e-mail, Slack).
- Métricas (Prometheus) e traces (Tempo). Só logs nesta etapa.

**Anti-objetivos (seria falha mesmo que "funcione")**

- Token, senha ou chave de API no Git ou dentro de um log.
- MCP do Grafana com permissão de escrita.
- Neo4j, Grafana, Loki ou o servidor de chat acessíveis fora de `127.0.0.1`.
- A aplicação quebrar ou travar quando o Loki estiver desligado.
- Testes que gastem a cota diária gratuita do OpenRouter.
- Esgotar a memória da máquina (já aconteceu: o Windows encerrou o servidor de chat por pouca memória em 2026-11-04).

## 3. Restrições

- Windows 11 Home com Docker Desktop (WSL2); Node ≥ 22.12; o repositório será público.
- Neo4j já roda pelo `docker-compose.yml` do projeto (`npm run db:up`).
- Cota gratuita do OpenRouter: bloqueio em 45 pedidos por dia (`data/usage.json`).
- Documentação consultada no Context7 em 2026-11-05: `/grafana/mcp-grafana`, `/microsoft/playwright-mcp`, `/websites/grafana_loki`, `/modelcontextprotocol/typescript-sdk`. Versões exatas são fixadas no build e registradas em `docs/dependencies.md`, como nas fases anteriores.

## 4. Decisões do usuário

- Grafana **local no Docker, no mesmo `docker-compose.yml` do Neo4j**.
- A **estrutura dos logs fica a cargo do desenho**, seguindo as convenções das ferramentas.
- O Loki guarda **metadados e também o texto das perguntas e das respostas**.
- Os testes de eficiência medem o que está na seção 1.
- Trabalho numa **branch nova a partir da `main` atualizada**, depois do merge do PR #2 (interface de chat).
- O **Neo4j passa a escutar só em `127.0.0.1`**. Hoje o compose publica as portas 7474 e 7687 em todas as interfaces. O usuário aceita perder o acesso ao banco a partir de outras máquinas da rede.
- O plano da seção 5 foi aprovado em conversa ("pode seguir com o seu plano"). Os detalhes adicionados depois da revisão (wrappers dos MCPs, LLM simulado no harness, rótulo `env=eval`) são escolhas minhas e vão para aprovação junto com este documento.

## 5. Desenho (escolhas minhas, para o usuário conferir)

### 5.1 Serviços no Docker

- `loki` e `grafana` entram no `docker-compose.yml` sob o perfil `observability`. `npm run db:up` continua subindo só o Neo4j; `npm run obs:up` sobe Neo4j, Loki e Grafana; `npm run obs:down` para.
- Imagens com versão fixada. Todas as portas publicadas só em `127.0.0.1`: Neo4j 7474 e 7687 (mudança do mapeamento atual), Loki 3100 e Grafana 3000. Limite de memória em cada contêiner.
- Loki em modo monolítico com armazenamento em disco local (bind mount `.loki-data/`, ignorado pelo Git) e retenção de 7 dias pelo compactor.
- Grafana com dados em `.grafana-data/` (ignorado), login anônimo desligado, senha do admin vinda do `.env` (`GRAFANA_ADMIN_PASSWORD`, vazia no `.env.example`).
- Provisionamento versionado em `ops/grafana/provisioning/`: datasource Loki (`http://loki:3100`) e o painel do item 5.4.

### 5.2 Logs no Loki

- O logger atual (`src/core/logger.ts`) escreve no terminal linhas `[nível] mensagem {json}` e já mascara segredos. O terminal continua com esse formato. O logger ganha um destino Loki opcional, ligado quando `LOKI_URL` estiver definido no `.env`, que envia cada evento como uma linha JSON completa.
- O logger ganha um `close()` opcional, para fazer o flush. Quem passa um logger próprio à biblioteca (`createRag({ logger })`) continua funcionando sem implementá-lo.
- O servidor de chat hoje não usa o logger; passa a usá-lo.
- Envio pela API `POST /loki/api/v1/push` em lotes (por tempo e por tamanho), com flush no `close()`. Se o Loki estiver fora, o envio falha em silêncio controlado: a aplicação segue, os eventos descartados são contados e um aviso único vai para o stderr. Nunca bloqueia uma pergunta.
- Rótulos (poucos, de baixa cardinalidade): `service` (`rag-cli`, `rag-chat`, `rag-browser`), `level`, `domain`. Todo o resto vai como campos do JSON da linha.
- Eventos principais:
  - `http.request`: rota, método, status, duração.
  - `ask.completed`: modo, coleção, intenção, status (`answered`, `refused`, `held`, `retrieval`), portão, grounding, frases sustentadas e questionadas, modelo, tokens, tempos por etapa, **texto da pergunta e texto da resposta**.
  - `ask.failed`, `feedback.saved`, `quota.warning`, `browser.error`.
- A máscara de segredos existente é aplicada antes de qualquer envio, inclusive no texto das perguntas e respostas.
- Erros do navegador: a página de chat ganha um coletor pequeno (`window.onerror` e `unhandledrejection`) que envia para `POST /api/client-log`. O servidor valida com zod, limita tamanho e frequência e grava como `browser.error`. Com isso, um erro de interface em uso real também aparece no Grafana, não só nos testes.

### 5.3 Os dois MCPs (`.mcp.json` na raiz, versionado, sem segredos)

- `grafana`: `docker run --rm -i` com a imagem `grafana/mcp-grafana` em modo `-t stdio`.
  - `GRAFANA_URL=http://host.docker.internal:3000`, com token por expansão de variável de ambiente.
  - Somente leitura (`--disable-write`), com as categorias que não usamos desligadas (Prometheus, incidentes, OnCall, SQL e outras) para reduzir o número de ferramentas expostas.
- `playwright`: `npx @playwright/mcp@<versão fixa>` com `--headless`, `--isolated` e `--output-dir .playwright-mcp/` (ignorado).
  - Navegação restrita a `http://localhost:*` e `http://127.0.0.1:*`.
- `npm run obs:token` cria no Grafana, pela API e com a senha do admin, uma conta de serviço com papel **Viewer** e grava o token em `GRAFANA_SERVICE_ACCOUNT_TOKEN` no `.env`.
- O Claude Code só expande `${VAR}` do `.mcp.json` a partir do ambiente do shell, não do `.env`. Por isso cada MCP é iniciado por um wrapper Node pequeno (`scripts/mcp-grafana.mjs`, `scripts/mcp-playwright.mjs`).
  - O wrapper do Grafana lê do `.env` **apenas** `GRAFANA_SERVICE_ACCOUNT_TOKEN` e repassa ao contêiner por variável de ambiente, nunca por argumento visível.
  - Os wrappers também evitam a forma `cmd /c npx`, que só funciona no Windows, e mantêm o `.mcp.json` válido em macOS e Linux, já que o repositório será público.
- Um agente só carrega servidores novos do `.mcp.json` ao reiniciar a sessão. O harness do item 5.5 não depende disso.

### 5.4 Painel ao vivo no Grafana

Um painel provisionado com atualização automática, mostrando:

- logs ao vivo filtráveis por serviço e nível;
- erros por minuto;
- perguntas por status;
- latência das perguntas;
- grounding médio;
- erros do navegador.

Tudo vem de consultas LogQL sobre os eventos do item 5.2.

### 5.5 Testes de eficiência (`npm run mcp:eval`)

- Um script em TypeScript usa o SDK oficial do MCP como cliente e sobe os dois servidores com os mesmos comandos do `.mcp.json`. Assim o teste mede os MCPs reais, não uma imitação.
- O servidor de chat sobe dentro do harness, sobre o grafo real do Neo4j.
  - Ele usa o LLM simulado (`MockLlmClient`) por padrão, para existir uma resposta escrita de verdade (evento `answered`, com texto) sem gastar a cota.
  - Com `--live`, usa o OpenRouter em no máximo 1 pergunta.
- O tráfego dos testes leva o rótulo `env=eval`. O painel o exclui por padrão. O harness não grava avaliações em `data/feedback.jsonl`.
- O harness lista as ferramentas do MCP do Grafana e falha se alguma ferramenta de escrita estiver exposta, para provar o modo somente leitura.
- **Cenário Grafana:** o harness faz uma pergunta pela API do chat com um marcador único, depois chama `query_loki_logs` até achar o evento com o marcador. Mede o tempo até o evento aparecer e a latência das chamadas (p50 e p95 em 10 consultas). Confere se pergunta, resposta e metadados vieram íntegros e se nenhum segredo aparece.
- **Cenário Playwright:** pelo MCP, abre o chat, faz uma pergunta, espera o resultado e lê `browser_console_messages` e `browser_network_requests`. Mede tempo de partida, tempo por chamada e número de chamadas para concluir. Falha se houver erro de console ou chamada `/api/*` com status de erro.
- **Verificações de segurança** feitas pelo próprio harness:
  - presença e valor dos cabeçalhos (CSP, `nosniff`, `frame-ancestors`);
  - bloqueio de path traversal;
  - servidor de chat escutando só em loopback;
  - as portas publicadas de Neo4j, Loki e Grafana presas a `127.0.0.1`, lidas de `docker compose ps`.
- Se não houver como verificar algum item, o relatório diz que ele ficou sem cobertura e não o conta como aprovado.
- **Cota:** o padrão é o LLM simulado, que não gasta cota. `--live` permite no máximo 1 pergunta ao OpenRouter por execução.
- **Relatório:** `docs/evidence/mcp-<data>.json` e `.md`, com cada medida, os limites usados e aprovado ou reprovado por cenário. Os limites começam conservadores (por exemplo, evento visível no Loki em até 10 s) e são recalibrados na primeira execução, ficando registrados no relatório.

### 5.6 Testes automatizados

- **Unitários:** destino Loki (lotes, flush, Loki fora do ar, máscara de segredos), formato dos eventos e validação de `/api/client-log`, usando um servidor HTTP falso.
- **Integração:** com Loki e Grafana no Docker, um evento enviado é lido de volta pela API do Loki.

## 6. Deixado ao builder

- Versões exatas das imagens e pacotes (fixadas e registradas em `docs/dependencies.md`).
- Nomes finais de campos e consultas LogQL do painel.
- Tamanho dos lotes e intervalo de flush.
- Valores dos limites de memória.
- Limites de aprovação dos cenários, recalibrados com dados reais.
