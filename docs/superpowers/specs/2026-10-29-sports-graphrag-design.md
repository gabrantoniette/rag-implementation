# Sports GraphRAG — design do sistema e do prompt JSON

Data: 2026-10-29 · Status: rascunho para aprovação

## 1. Intenção e porquê

O usuário quer um **repositório de exemplo de RAG** que depois sirva de **base replicável** para outros projetos (primeiro caso: o projeto "linkedin agents"). O repositório começa privado no GitHub e será público depois, então precisa estar limpo desde o primeiro commit.

O que importa acima de tudo é a **qualidade da resposta**: o sistema deve entender perguntas que **não repetem as palavras exatas** do texto, correlacionar assuntos e devolver uma resposta **estruturada, coerente e ancorada nos documentos**.

**Entregável desta sessão:** um **prompt em formato JSON** que um agente de código (Claude Code) executará para construir, testar e documentar o sistema. Nada do sistema é construído agora. As seções 4 a 6 são a especificação que o prompt JSON vai conter; este documento só precisa da aprovação do usuário para que o JSON seja gerado.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Responder por significado (busca semântica), não só por palavra exata, e seguir relações entre assuntos (grafo).
- Custo zero de LLM: só modelos gratuitos do OpenRouter; embeddings e treino rodam local.
- Replicável: trocar o domínio (esportes → posts do LinkedIn) mexendo só numa pasta de domínio.
- Evidência: testes automatizados mais cinco perguntas reais ao final, com relatório salvo no repositório.
- Seguro para tornar público depois: sem segredos, licenças e atribuição corretas.

**Não-objetivos**
- Interface web ou servidor HTTP em produção (há CLI e API de biblioteca).
- Treinar um modelo generativo próprio.
- Escalar para milhões de documentos.

**Anti-objetivos (seria falha mesmo que "funcione")**
- Resposta com afirmação que parece citada mas não está nos trechos recuperados.
- README que apresenta o TensorFlow.js como "IA generativa" ou promete "aprende sozinho" sem mostrar como.
- Qualquer chamada a modelo pago, mesmo por fallback silencioso.
- Chave de API ou dado sensível no Git.

## 3. Decisões do usuário (como foram decididas)

- OpenRouter para chamadas de LLM; **chave fica em branco** e o usuário preenche quando o código estiver pronto.
- Neo4j como banco vetorial; Transformers.js para embeddings; TensorFlow.js para treino.
- O usuário esperava que o TensorFlow.js fosse uma IA generativa que aprende sozinha. Foi proposto e **aceito** usá-lo para **melhorar a busca**: reranker treinável e classificador de intenção, que aprendem com o uso (feedback). A geração da resposta fica com o LLM gratuito.
- Corpus: documentos de esportes buscados na internet. **Documentos e perguntas em inglês.**
- Parâmetros (chunk, embeddings, temperature, topK, chainState): decisão do desenho, conforme o tamanho do corpus.
- Linguagem (TS e/ou JS): decisão do desenho.
- Usar sempre o MCP context7 para documentação atualizada.
- Testes ao final e cinco perguntas ao modelo como evidência.

## 4. Decisões do desenho (minhas, para o usuário conferir)

### 4.1 Linguagem
**TypeScript para todo o código** (ESM, `strict`, executado com `tsx`). JavaScript só onde uma ferramenta exige (ex.: arquivo de config). Motivo: tudo roda em Node; duas linguagens no mesmo pipeline só somariam atrito. Tipos fortes nas fronteiras (interfaces) ajudam na replicação.

### 4.2 Corpus
- **Fonte:** Wikipedia (API REST, grátis, sem chave, licença CC BY-SA 4.0). Baixar o HTML do artigo para manter os **hyperlinks** (viram entidades canônicas, sem LLM e sem NER).
- **Tamanho:** ~40 artigos, ~8 por esporte (futebol, basquete, tênis, Fórmula 1, atletismo/Olimpíadas). Estimativa: 200–300 mil palavras, 1.000 a 2.500 chunks.
- **Reprodutível:** script `ingest:fetch` baixa o corpus; `data/raw` fica no `.gitignore`. Guardar URL, revisão (`revid`), título e licença em cada documento. Arquivo `ATTRIBUTION.md`. Enviar `User-Agent` identificável conforme a política da Wikimedia.

### 4.3 Chunking
- Dividir por **seção** do artigo (descartar References, External links, See also, Notes); dentro da seção, janelas de **~300 tokens, máx. 400, sobreposição de 50**; chunk com menos de 60 tokens funde com o vizinho.
- Contar tokens com o tokenizer do modelo de embedding.
- Cada chunk guarda um cabeçalho de contexto "Artigo › Seção" que entra no texto embutido (melhora a recuperação e a coerência).

### 4.4 Embeddings
- `Xenova/bge-small-en-v1.5`, 384 dimensões, quantizado q8, cosseno. O modelo BGE usa **pooling CLS** com normalização (o builder confere no model card). Consultas usam o prefixo de instrução recomendado pelo BGE; documentos, não.
- Alternativa se o modelo não carregar: `Xenova/all-MiniLM-L6-v2`.
- Inglês-only, então não precisa de modelo multilíngue.

### 4.5 Neo4j
- Rodar em **Docker** (`docker-compose.yml`, Neo4j 5.x com índice vetorial, versão fixada). A URI vem do `.env`, então AuraDB Free também funciona sem mudar código.
- **Modelo de grafo:** `(:Document)-[:HAS_CHUNK]->(:Chunk)`, `(:Chunk)-[:NEXT]->(:Chunk)`, `(:Chunk)-[:MENTIONS]->(:Entity)`, `(:Document)-[:LINKS_TO]->(:Document)`, `(:Entity)-[:CO_OCCURS {weight}]-(:Entity)`.
- **Índices:** vetorial em `Chunk.embedding` (384, cosseno) e **fulltext** em `Chunk.text`.
- Entidades "hub" (grau muito alto, ex.: "United States") não entram na expansão do grafo.

### 4.6 Extração de entidades (reutilizável)
Interface `EntityExtractor` com duas implementações: `WikiLinkExtractor` (padrão para o corpus de esportes) e `NerExtractor` (`Xenova/bert-base-NER`, para domínios sem hyperlinks, como LinkedIn). As duas são implementadas e testadas; só a primeira é usada na demo.

### 4.7 Pipeline de consulta e `chainState`
O `chainState` é o **objeto de estado tipado que atravessa as etapas** do pipeline (minha interpretação do termo; o usuário confere). Campos: pergunta, histórico, intenção, embedding da consulta, candidatos, expansão do grafo, ranking, contexto, resposta, citações, métricas e tempos. Cada etapa só lê/escreve no `chainState`, o que torna as etapas trocáveis e auditáveis.

Etapas:
1. **Intenção** (TF.js): `lookup | explain | compare | timeline`.
2. **Recuperação híbrida:** top-30 vetorial + top-30 fulltext → fusão **RRF** (k=60) → 20 candidatos.
3. **Expansão no grafo:** chunks vizinhos (`NEXT` ±1), chunks que compartilham entidades com os 5 melhores, artigos ligados.
4. **Rerank** (TF.js).
5. **Seleção de contexto** por intenção: `lookup` 4 chunks, `explain` 6, `compare` 8, `timeline` 8; teto de ~2.500 tokens.
6. **Portão de evidência:** se a melhor pontuação do rerank ficar abaixo do limiar, responde "não há contexto suficiente" **sem chamar o LLM** (poupa cota e evita invenção).
7. **Geração:** prompt com chunks numerados `[1]..[n]`, instrução de só usar o contexto e citar.
8. **Pós-verificação local (sem LLM):** todas as citações existem; cada frase da resposta é comparada por similaridade de embedding com os chunks citados; frases sem suporte são sinalizadas. Resultado vai no relatório.

**Memória de conversa:** últimas 3 trocas, cortadas em ~800 tokens. Perguntas curtas ou com pronome ("and his rival?") recebem as entidades da última resposta na consulta de recuperação (heurística local, sem uma segunda chamada ao LLM).

### 4.8 TensorFlow.js — o que treina
Pacote preferido: `@tensorflow/tfjs` (CPU, JS puro) para não depender de build nativo no Windows; salvar/carregar com handler próprio (`model.json` + pesos). Se `@tensorflow/tfjs-node` instalar limpo em Windows e Linux, pode ser usado.

- **Reranker (MLP pequeno):** entradas = features por par consulta–chunk (cosseno, pontuação e posição fulltext, posição no vetorial, sobreposição de entidades, veio da expansão do grafo?, mesmo artigo do top-1?, comprimento normalizado, título bate?). Saída = relevância.
- **Dados iniciais sem rótulo humano:** pares sintéticos — títulos de seção/artigo como pseudo-consultas, positivos = o chunk da seção, negativos difíceis = vizinhos do top-k que não são da seção.
- **Classificador de intenção:** MLP sobre o embedding da consulta (384→32→4), treinado em ~150 consultas semente escritas no repositório.
- **Aprender com o uso:** comando `feedback` grava 👍/👎 e os chunks citados em `data/feedback.jsonl`; `train:reranker` retreina com sintético + feedback. O novo modelo só **substitui** o atual se não piorar MRR/nDCG@6 num conjunto de validação separado (versionado).
- **Honestidade:** o README descreve isso como *learning-to-rank* e mostra a tabela de ablação (vetorial → híbrido → +grafo → +reranker).

### 4.9 LLM (OpenRouter) e parâmetros
- Endpoint `chat/completions`. O modelo é **descoberto em tempo de execução** pela listagem de modelos, filtrando `pricing.prompt == 0` e `pricing.completion == 0` e contexto ≥ 32k; fallback `openrouter/free`. **Trava de custo zero:** recusa qualquer modelo que não seja gratuito.
- Limites gratuitos (docs OpenRouter): 20 req/min e 50 req/dia (1.000/dia com ≥ 10 créditos comprados). Portanto: **uma chamada de LLM por pergunta**, nenhuma na ingestão, retry com backoff em 429, **contador diário** persistido que bloqueia perto do limite, e **cache** de respostas em desenvolvimento.
- Parâmetros: `temperature 0.2`, `top_p 0.9`, `max_tokens 700`, timeout 60 s, 2 retries.
- Formato da resposta: Markdown com *Answer*, *Key points*, *Sources* `[n]`. (JSON mode não é confiável em modelos gratuitos, então a estrutura é validada em código.)

### 4.10 Replicabilidade
Arquitetura de portas e adaptadores: interfaces `Embedder`, `VectorGraphStore`, `LlmClient`, `Reranker`, `IntentClassifier`, `EntityExtractor`, `SourceLoader`. Tudo específico de esportes mora em `domains/sports/` (fontes, prompts, consultas semente de intenção, perguntas de avaliação). Config validada (zod) + `.env`. Exporta `createRag(config)`. Um guia `docs/REUSE.md` explica como criar `domains/linkedin/`.

### 4.11 Decisões adicionais (minhas)
- **GitHub:** o agente constrói um **repositório Git local próprio (`git init` em `rag-implementation`), limpo e pronto para push**, com varredura de segredos passando. Ele **não** cria o repositório remoto nem faz push; entrega as instruções (`gh repo create --private`) para o usuário executar.
- **Duas etapas:** (A) *build* sem chave, com LLM simulado, aceito quando tudo passa; (B) *evidência ao vivo*, rodada pelo usuário depois de preencher `OPENROUTER_API_KEY` (`npm run evidence`). Os limiares de evidência e fundamentação são calibrados na etapa A com dados de recuperação e mocks, e o README documenta como recalibrar após a primeira execução ao vivo.
- **Frases sem suporte:** a resposta mostrada ao usuário **marca** cada frase não suportada (ex.: "⚠ not directly supported by the sources") e exibe uma confiança reduzida. Não há regeneração (limite de uma chamada por pergunta).
- **Docker:** a primeira fase do prompt é uma verificação (Docker instalado e Neo4j sobe). Se faltar, o agente para e instrui: instalar Docker Desktop (WSL2 no Windows 11 Home) ou apontar para um AuraDB Free pela URI no `.env`.
- **Avaliação honesta:** além das ~30 pseudo-consultas sintéticas (que também treinam o reranker), o builder escreve **~15 consultas à mão com trechos-alvo rotulados** depois de ver o corpus, e a tabela de ablação reporta os dois conjuntos separadamente. A claim de melhoria só vale para o conjunto escrito à mão.

### 4.12 Local de trabalho e registro final (pedido do usuário)
- **Tudo dentro de uma única pasta:** `C:\Users\gabra\Documents\professional\repositories\git-gabrantoniette\rag-implementation`. Código, dados, modelos treinados, relatórios de evidência, este design e o próprio prompt JSON (`prompts/rag-build.prompt.json`) ficam ali. Nada é criado fora dela, nem em pastas temporárias persistentes (cache de modelos do Transformers.js e volume do Neo4j apontam para dentro da pasta, ignorados pelo Git).
- **Repositório próprio (decidido pelo usuário):** `rag-implementation` é um repositório Git independente. `git-gabrantoniette` é apenas a pasta local onde o usuário guarda todos os seus repositórios e **não tem relação** com o repositório de mesmo nome no GitHub. A pasta está vazia; o primeiro passo do agente é `git init` **dentro** de `rag-implementation`, e todo comando Git dali em diante precisa confirmar com `git rev-parse --show-toplevel` que está operando nesse repositório e não no de uma pasta acima. Nenhum arquivo é adicionado ao Git de fora da pasta.
- **Artefato final de registro:** quando o projeto ficar pronto, o agente publica um **Artifact** (página HTML privada) que registra o projeto naquele momento: objetivo, arquitetura, parâmetros escolhidos, versões das dependências (do `docs/dependencies.md`), resultados dos testes, tabela de ablação, as cinco perguntas com respostas, citações e notas de fundamentação, modelo gratuito usado, data e commit. Só usa **números e saídas reais** dos relatórios, nada inventado. Uma cópia do HTML fica em `docs/project-record/index.html` dentro da pasta. Como a evidência ao vivo depende da chave (etapa B), o artefato é publicado ao fim da etapa A marcado "evidência ao vivo pendente" e **atualizado no mesmo link** quando a etapa B termina.

### 4.13 Revisão após comparar com o exemplo-13 (pedidos do usuário; prevalece sobre seções anteriores em caso de conflito)
- **Sem LangChain.** Mantemos adaptadores próprios (portas e adaptadores) e `tsx`. O LangChain tem integração com Neo4j (inclusive busca híbrida e `retrievalQuery`), mas a fusão RRF, a expansão no grafo, as features do reranker e o CRUD por diff de chunks ficariam fora dele de qualquer forma; usá-lo só trocaria algumas dezenas de linhas por três pacotes com versões independentes, e a integração mudou de pacote (`@langchain/community` → `@langchain/neo4j` na documentação atual).
- **Formatos de entrada.** Essenciais (nível 1): `.md`, `.txt`, `.html`, `.csv`/`.tsv`, `.json`/`.jsonl`, `.pdf` (com camada de texto) e legendas `.srt`/`.vtt`. Vídeo e áudio (nível 2): `mp4, mkv, webm, mov, mp3, wav, m4a, flac` por transcrição local com Whisper (Transformers.js), exigindo `ffmpeg` instalado no sistema. Fora do escopo: `.docx`, `.xlsx`, `.pptx`, OCR de imagem/PDF escaneado, análise visual de vídeo. Cada formato registra um **localizador** para citação: página (PDF), faixa de linhas (CSV/JSON), caminho de títulos (MD/HTML), intervalo de tempo (vídeo/legenda).
- **Extração de entidades por formato:** Wikipedia usa `WikiLinkExtractor`; todos os outros formatos usam `NerExtractor`, que deixa de ser opcional e passa a ser testado.
- **CRUD de documentos** (API de biblioteca e CLI, sem servidor HTTP): criar, ler/listar, atualizar (por diff de chunks: só re-embute o que mudou) e apagar (remove chunks, entidades órfãs e recalcula coocorrências). Apagar exige `--yes`; sem ele é simulação. A ingestão do corpus usa `upsert`, então é idempotente.
- **Coleções:** todo documento pertence a uma `collection` (ex.: `sports`, `fixtures`), o que permite misturar domínios e testar formatos sem poluir o corpus.
- **Cabeçalhos do OpenRouter:** constantes não sensíveis em `src/config/app-info.ts` (título do app e URL do repositório), enviadas como `HTTP-Referer` e `X-OpenRouter-Title` (a documentação atual aceita `X-Title` como legado). Não vão para o `.env`. O título sozinho não cria página do app: precisa vir com o `HTTP-Referer`.
- **Prompts como dados:** `domains/sports/prompts/answer.json` e `template.txt`, já escritos nesta sessão e somente leitura para o builder. A seção **Sources** da resposta é montada pelo código a partir das citações validadas; o modelo escreve apenas *Answer* e *Key points*. O prompt vai em **uma única mensagem de usuário**, porque alguns modelos gratuitos rejeitam o papel `system`.
- **Guia passo a passo:** `docs/WALKTHROUGH.md`, com a escada vetorial → híbrido → grafo → reranker → portão e verificação, usando `ask --mode` e saídas reais.
- **Dependências novas permitidas:** `unpdf` (PDF por página) e `csv-parse`. Whisper vem do Transformers.js; `ffmpeg` é um programa externo, não uma dependência npm.

### 4.14 Segunda revisão (pedidos do usuário; prevalece sobre 4.13 em caso de conflito)
- **Repositório próprio:** `rag-implementation` é um repositório Git independente (já inicializado, sem commits) e todas as mudanças acontecem dentro dele. A URL usada nos cabeçalhos do OpenRouter é `https://github.com/gabrantoniette/rag-implementation`.
- **Formatos adicionados:** `.docx`, `.xlsx` e `.pptx` (via `officeparser`, com `mammoth` e `read-excel-file` só como reserva se algum teste de aceite falhar); imagens `.png/.jpg/.jpeg/.bmp/.webp` e PDFs escaneados por **OCR** local (`tesseract.js`, inglês); **análise visual de vídeo** por quadros-chave (`ffmpeg`), com OCR e descrição de cada quadro (Florence-2 no Transformers.js, com captioner reserva).
- **Como a análise visual funciona:** quadros por mudança de cena mais um mínimo a cada 30 s, até 60 quadros, descartando quadros quase iguais; cada quadro vira uma seção de tipo "visual" com horário, intercalada com a transcrição do áudio. Descrições são geradas por modelo, então levam o prefixo `[Visual description]` e nunca identificam pessoas.
- **Limites honestos:** sem `ffmpeg` o áudio e o vídeo ficam "não verificados"; legendas `.srt/.vtt` continuam funcionando sem ele. Imagens dentro de `.docx/.xlsx/.pptx`, OCR em outros idiomas, manuscrito e formatos Office antigos continuam fora.
- **Privacidade:** tudo é processado localmente; só os trechos recuperados para uma pergunta vão ao OpenRouter.
- **Fases:** agora são 15 (P0 a P14): P2 loaders básicos, P3 Office, P4 OCR e imagens, P5 áudio e vídeo, e as demais renumeradas.

## 5. Testes e evidência

- **Unitários** (vitest): chunker, RRF, extração de features, validador de citações, contador de cota, trava de modelo gratuito.
- **Integração:** contra o Neo4j real em Docker (ingestão pequena, índices, consulta).
- **Avaliação de recuperação:** ~30 pseudo-consultas com recall@k, MRR e nDCG; tabela de ablação no README.
- **Cinco perguntas finais** (em inglês), cada uma cobrindo uma capacidade. O builder escreve as perguntas finais depois de ver o corpus; exemplos do tipo:
  1. Fato direto ("When did a given tournament start…").
  2. **Paráfrase sem palavras em comum** com o texto (ex.: "Who was the Swiss player that won the most grass-court majors?" quando o texto diz "Roger Federer … Wimbledon titles"). O builder confere no corpus que a resposta existe.
  3. **Multi-salto entre artigos** (exige o grafo).
  4. **Comparação** entre dois atletas/times.
  5. **Fora do corpus** — o sistema deve recusar com clareza (evidência de que não inventa).
- Para cada pergunta o relatório mostra: intenção, chunks recuperados com pontuações, caminho no grafo, resposta, citações, nota de fundamentação, modelo usado, tempo.
- **Critério de aprovação:** perguntas 1–4 com ≥ 1 citação válida, 100% das citações existentes no contexto e nota de fundamentação acima do limiar; pergunta 5 recusada.
- **Chave ausente:** tudo é testado com um `LlmClient` simulado. Sem chave, `npm run evidence` roda só a recuperação e para com instrução clara. Com a chave preenchida, roda ao vivo e grava `docs/evidence/`.

## 6. Higiene para virar público
`.env` ignorado e `.env.example` com `OPENROUTER_API_KEY=` vazio; varredura de segredos (gitleaks) antes de qualquer push; LICENSE MIT; `ATTRIBUTION.md`; README em inglês; CI simples (lint, tipos, testes unitários); checklist "antes de tornar público".

## 7. Formato do prompt JSON (a ser gerado depois da aprovação)

Arquivo único, em inglês, com chaves de topo: `meta`, `role`, `objective`, `non_goals`, `rules` (inclui "consultar o context7 antes de escrever código com cada biblioteca e registrar versões em `docs/dependencies.md`"), `tech_stack`, `architecture`, `parameters`, `corpus`, `phases` (cada fase com passos e critérios de aceitação verificáveis), `testing`, `evidence`, `deliverables`, `user_inputs_pending` (a chave do OpenRouter), `definition_of_done`. Também inclui a instrução de verificar nome/versão dos modelos e das imagens Docker em vez de confiar na memória.

## 8. Deixado ao builder
Nomes de pastas e arquivos, escolha final dos 40 artigos, redação das ~150 consultas semente, forma exata das features do reranker, limiares (evidência e fundamentação) calibrados nos dados, versões exatas das dependências.
