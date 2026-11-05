# Attribution

## Wikipedia content

The demo corpus is text from English Wikipedia articles, licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/)
(CC BY-SA 4.0). The articles are downloaded at build time by `npm run ingest:fetch` and are **not**
stored in this repository (`data/raw` is git-ignored). Text derived from them (chunks in Neo4j,
excerpts in `docs/evidence/` and in answers) carries the same licence; the Sources section of every
answer links the article it came from.

Each article's authors are listed in its revision history. The exact revision used is recorded as
`revid` in `data/raw/<title>.meta.json` and on each `Document` node; open
`https://en.wikipedia.org/w/index.php?oldid=<revid>` to see that revision.

| Article                         | Link                                                                     | Authors (history)                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Association football            | [article](https://en.wikipedia.org/wiki/Association_football)            | [history](https://en.wikipedia.org/w/index.php?title=Association_football&action=history)            |
| FIFA World Cup                  | [article](https://en.wikipedia.org/wiki/FIFA_World_Cup)                  | [history](https://en.wikipedia.org/w/index.php?title=FIFA_World_Cup&action=history)                  |
| UEFA Champions League           | [article](https://en.wikipedia.org/wiki/UEFA_Champions_League)           | [history](https://en.wikipedia.org/w/index.php?title=UEFA_Champions_League&action=history)           |
| Lionel Messi                    | [article](https://en.wikipedia.org/wiki/Lionel_Messi)                    | [history](https://en.wikipedia.org/w/index.php?title=Lionel_Messi&action=history)                    |
| Cristiano Ronaldo               | [article](https://en.wikipedia.org/wiki/Cristiano_Ronaldo)               | [history](https://en.wikipedia.org/w/index.php?title=Cristiano_Ronaldo&action=history)               |
| Pelé                            | [article](https://en.wikipedia.org/wiki/Pel%C3%A9)                       | [history](https://en.wikipedia.org/w/index.php?title=Pel%C3%A9&action=history)                       |
| Real Madrid CF                  | [article](https://en.wikipedia.org/wiki/Real_Madrid_CF)                  | [history](https://en.wikipedia.org/w/index.php?title=Real_Madrid_CF&action=history)                  |
| FC Barcelona                    | [article](https://en.wikipedia.org/wiki/FC_Barcelona)                    | [history](https://en.wikipedia.org/w/index.php?title=FC_Barcelona&action=history)                    |
| Basketball                      | [article](https://en.wikipedia.org/wiki/Basketball)                      | [history](https://en.wikipedia.org/w/index.php?title=Basketball&action=history)                      |
| National Basketball Association | [article](https://en.wikipedia.org/wiki/National_Basketball_Association) | [history](https://en.wikipedia.org/w/index.php?title=National_Basketball_Association&action=history) |
| NBA Finals                      | [article](https://en.wikipedia.org/wiki/NBA_Finals)                      | [history](https://en.wikipedia.org/w/index.php?title=NBA_Finals&action=history)                      |
| Michael Jordan                  | [article](https://en.wikipedia.org/wiki/Michael_Jordan)                  | [history](https://en.wikipedia.org/w/index.php?title=Michael_Jordan&action=history)                  |
| LeBron James                    | [article](https://en.wikipedia.org/wiki/LeBron_James)                    | [history](https://en.wikipedia.org/w/index.php?title=LeBron_James&action=history)                    |
| Kobe Bryant                     | [article](https://en.wikipedia.org/wiki/Kobe_Bryant)                     | [history](https://en.wikipedia.org/w/index.php?title=Kobe_Bryant&action=history)                     |
| Los Angeles Lakers              | [article](https://en.wikipedia.org/wiki/Los_Angeles_Lakers)              | [history](https://en.wikipedia.org/w/index.php?title=Los_Angeles_Lakers&action=history)              |
| Boston Celtics                  | [article](https://en.wikipedia.org/wiki/Boston_Celtics)                  | [history](https://en.wikipedia.org/w/index.php?title=Boston_Celtics&action=history)                  |
| Tennis                          | [article](https://en.wikipedia.org/wiki/Tennis)                          | [history](https://en.wikipedia.org/w/index.php?title=Tennis&action=history)                          |
| Grand Slam (tennis)             | [article](<https://en.wikipedia.org/wiki/Grand_Slam_(tennis)>)           | [history](<https://en.wikipedia.org/w/index.php?title=Grand_Slam_(tennis)&action=history>)           |
| Wimbledon Championships         | [article](https://en.wikipedia.org/wiki/Wimbledon_Championships)         | [history](https://en.wikipedia.org/w/index.php?title=Wimbledon_Championships&action=history)         |
| French Open                     | [article](https://en.wikipedia.org/wiki/French_Open)                     | [history](https://en.wikipedia.org/w/index.php?title=French_Open&action=history)                     |
| Roger Federer                   | [article](https://en.wikipedia.org/wiki/Roger_Federer)                   | [history](https://en.wikipedia.org/w/index.php?title=Roger_Federer&action=history)                   |
| Rafael Nadal                    | [article](https://en.wikipedia.org/wiki/Rafael_Nadal)                    | [history](https://en.wikipedia.org/w/index.php?title=Rafael_Nadal&action=history)                    |
| Novak Djokovic                  | [article](https://en.wikipedia.org/wiki/Novak_Djokovic)                  | [history](https://en.wikipedia.org/w/index.php?title=Novak_Djokovic&action=history)                  |
| Serena Williams                 | [article](https://en.wikipedia.org/wiki/Serena_Williams)                 | [history](https://en.wikipedia.org/w/index.php?title=Serena_Williams&action=history)                 |
| Formula One                     | [article](https://en.wikipedia.org/wiki/Formula_One)                     | [history](https://en.wikipedia.org/w/index.php?title=Formula_One&action=history)                     |
| Monaco Grand Prix               | [article](https://en.wikipedia.org/wiki/Monaco_Grand_Prix)               | [history](https://en.wikipedia.org/w/index.php?title=Monaco_Grand_Prix&action=history)               |
| Scuderia Ferrari                | [article](https://en.wikipedia.org/wiki/Scuderia_Ferrari)                | [history](https://en.wikipedia.org/w/index.php?title=Scuderia_Ferrari&action=history)                |
| Mercedes-Benz in Formula One    | [article](https://en.wikipedia.org/wiki/Mercedes-Benz_in_Formula_One)    | [history](https://en.wikipedia.org/w/index.php?title=Mercedes-Benz_in_Formula_One&action=history)    |
| Lewis Hamilton                  | [article](https://en.wikipedia.org/wiki/Lewis_Hamilton)                  | [history](https://en.wikipedia.org/w/index.php?title=Lewis_Hamilton&action=history)                  |
| Michael Schumacher              | [article](https://en.wikipedia.org/wiki/Michael_Schumacher)              | [history](https://en.wikipedia.org/w/index.php?title=Michael_Schumacher&action=history)              |
| Ayrton Senna                    | [article](https://en.wikipedia.org/wiki/Ayrton_Senna)                    | [history](https://en.wikipedia.org/w/index.php?title=Ayrton_Senna&action=history)                    |
| Max Verstappen                  | [article](https://en.wikipedia.org/wiki/Max_Verstappen)                  | [history](https://en.wikipedia.org/w/index.php?title=Max_Verstappen&action=history)                  |
| Olympic Games                   | [article](https://en.wikipedia.org/wiki/Olympic_Games)                   | [history](https://en.wikipedia.org/w/index.php?title=Olympic_Games&action=history)                   |
| Summer Olympic Games            | [article](https://en.wikipedia.org/wiki/Summer_Olympic_Games)            | [history](https://en.wikipedia.org/w/index.php?title=Summer_Olympic_Games&action=history)            |
| Sport of athletics              | [article](https://en.wikipedia.org/wiki/Sport_of_athletics)              | [history](https://en.wikipedia.org/w/index.php?title=Sport_of_athletics&action=history)              |
| 100 metres                      | [article](https://en.wikipedia.org/wiki/100_metres)                      | [history](https://en.wikipedia.org/w/index.php?title=100_metres&action=history)                      |
| Marathon                        | [article](https://en.wikipedia.org/wiki/Marathon)                        | [history](https://en.wikipedia.org/w/index.php?title=Marathon&action=history)                        |
| Usain Bolt                      | [article](https://en.wikipedia.org/wiki/Usain_Bolt)                      | [history](https://en.wikipedia.org/w/index.php?title=Usain_Bolt&action=history)                      |
| Carl Lewis                      | [article](https://en.wikipedia.org/wiki/Carl_Lewis)                      | [history](https://en.wikipedia.org/w/index.php?title=Carl_Lewis&action=history)                      |
| Jesse Owens                     | [article](https://en.wikipedia.org/wiki/Jesse_Owens)                     | [history](https://en.wikipedia.org/w/index.php?title=Jesse_Owens&action=history)                     |

## Machine-learning models

All models run locally through Transformers.js or tesseract.js. Licences are taken from each model card
(checked on 2026-10-29; see `docs/dependencies.md`).

| Model                                                                                                                                                                                                  | Used for                                  | Licence                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------- |
| [Xenova/bge-small-en-v1.5](https://huggingface.co/Xenova/bge-small-en-v1.5) (from [BAAI/bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5))                                             | Embeddings                                | MIT                    |
| [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)                                                                                                                              | Fallback embeddings (not used by default) | Apache-2.0             |
| [Xenova/bert-base-NER](https://huggingface.co/Xenova/bert-base-NER) (from [dslim/bert-base-NER](https://huggingface.co/dslim/bert-base-NER))                                                           | Named entities for non-Wikipedia formats  | MIT                    |
| [Xenova/whisper-tiny.en](https://huggingface.co/Xenova/whisper-tiny.en) (from [openai/whisper-tiny.en](https://huggingface.co/openai/whisper-tiny.en))                                                 | Speech to text                            | Apache-2.0             |
| [onnx-community/Florence-2-base-ft](https://huggingface.co/onnx-community/Florence-2-base-ft) (from [microsoft/Florence-2-base-ft](https://huggingface.co/microsoft/Florence-2-base-ft))               | Image and video-frame descriptions        | MIT                    |
| [Xenova/vit-gpt2-image-captioning](https://huggingface.co/Xenova/vit-gpt2-image-captioning) (from [nlpconnect/vit-gpt2-image-captioning](https://huggingface.co/nlpconnect/vit-gpt2-image-captioning)) | Fallback captions                         | Apache-2.0             |
| Tesseract English traineddata (tesseract.js)                                                                                                                                                           | OCR                                       | Apache-2.0 (Tesseract) |

The intent classifier and the reranker in `models/` are trained by this repository with TensorFlow.js
(Apache-2.0) and are released with the code under the MIT licence.

## Answers

Answers are generated by free models on [OpenRouter](https://openrouter.ai/); the model id used is
recorded in every evidence report.

## Fonts (chat page)

The chat page (`npm run chat`) serves two typefaces from `web/fonts/` so it loads nothing from
outside the machine. Both are licensed under the SIL Open Font License 1.1; the licence text is in
`web/fonts/OFL.txt`. The `.woff2` files are the Latin and Latin Extended subsets published by Google
Fonts, unmodified.

| Typeface                                                      | Used for                         | Copyright                                         |
| ------------------------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| [Source Serif 4](https://github.com/adobe-fonts/source-serif) | Answer text, questions, passages | 2014-2021 Adobe, with Reserved Font Name 'Source' |
| [Archivo](https://github.com/Omnibus-Type/Archivo)            | Margin marks, labels, controls   | 2020 The Archivo Project Authors                  |
