# Supported formats

Every loader returns the same `ParsedDocument` (`id, title, uri, format, contentHash, sections`),
where each section has a heading path, text, a locator, a modality (`text`, `audio`, `visual`, `ocr`)
and a kind (`prose`, `table`, `transcript`). The chunker, embedder, store and prompt builder never see
file types. Loaders are registered by extension in `src/loaders/index.ts`; adding a format means one
loader file and one line there.

## Formats

| Extension                                | Loader    | Sections                                                                                       | Locator in citations          |
| ---------------------------------------- | --------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| `.md`, `.markdown`                       | markdown  | Heading path; YAML front matter `title` wins; fenced code stays whole when it fits             | `Markdown section`            |
| `.txt`                                   | text      | Blank-line paragraphs grouped to about 300 tokens                                              | `paragraphs a-b`              |
| `.html`, `.htm`                          | html      | cheerio; `script`, `style`, `nav`, `footer`, `aside` dropped; heading path                     | `HTML section`                |
| `.wikipedia.html`                        | wikipedia | Article sections and infobox; references, navboxes and hatnotes dropped; links kept            | `Wikipedia section`           |
| `.csv`, `.tsv`                           | csv       | `column: value; ...` per row, grouped, column list repeated in every chunk                     | `rows a-b` (data rows from 1) |
| `.json`, `.jsonl`                        | json      | Arrays and JSON Lines behave like rows; a single object becomes `key.path: value` lines        | `records a-b`, `keys x to y`  |
| `.pdf`                                   | pdf       | One section per page (unpdf); a page with under 40 characters of text is rendered and OCRed    | `page n`, `page n (OCR)`      |
| `.srt`, `.vtt`                           | subtitle  | Cues merged into windows of about 300 tokens and at most 90 seconds                            | `hh:mm:ss-hh:mm:ss`           |
| `.docx`                                  | office    | Heading path from the officeparser AST; tables row by row; footnotes kept as `[Footnote: ...]` | `Word section`                |
| `.xlsx`                                  | office    | One sheet at a time; rows like CSV with the header repeated; cached formula values             | `Sheet 'name' rows a-b`       |
| `.pptx`                                  | office    | One section per slide: title, body text, `Speaker notes: ...`                                  | `slide n`                     |
| `.png`, `.jpg`, `.jpeg`, `.bmp`, `.webp` | image     | `Text in image` (OCR, words under 60 confidence dropped) and `Image description` (caption)     | `image`                       |
| `.mp3`, `.wav`, `.m4a`, `.flac`          | media     | Sidecar `.srt`/`.vtt` if present, else ffmpeg + Whisper; windowed like subtitles               | `hh:mm:ss-hh:mm:ss`           |
| `.mp4`, `.mkv`, `.webm`, `.mov`          | media     | Transcript as above plus keyframes (OCR + caption), interleaved by time                        | `hh:mm:ss-hh:mm:ss on-screen` |

Captions are model-generated, so their text starts with `[Visual description]`; the answering model
can tell them from source text. People are never identified. Everything runs locally.

## Errors

| Situation                                                      | Error                                          |
| -------------------------------------------------------------- | ---------------------------------------------- |
| Extension not registered                                       | `UnsupportedFormatError` (lists the supported) |
| File above `MAX_FILE_MB` (default 50)                          | `FileTooLargeError`                            |
| Empty file or no extractable text                              | `EmptyDocumentError`                           |
| Encrypted PDF; password-protected Office file (OLE container)  | `EncryptedDocumentError`                       |
| Bytes that do not match the extension (PDF, ZIP), broken files | `CorruptDocumentError`                         |
| Office archive over 200 MB uncompressed or 5,000 entries       | `ArchiveLimitError`                            |
| Audio or video without ffmpeg (and no sidecar subtitles)       | `MediaToolMissingError` (with install hints)   |

Media files are often larger than 50 MB; raise `MAX_FILE_MB` in `.env` for them.

## Media details

- ffmpeg is found on `PATH` or through `FFMPEG_PATH`; it is never installed by this project.
  Install it with `winget install Gyan.FFmpeg` (Windows), `brew install ffmpeg` (macOS) or
  `sudo apt install ffmpeg` (Debian/Ubuntu).
- Audio is decoded to 16 kHz mono float32 and transcribed by `Xenova/whisper-tiny.en` (timestamps
  on, 30 s chunks, 5 s stride). English only. A warning is logged above 30 minutes.
- Video keyframes: ffmpeg's scene filter (threshold 0.3) plus at least one frame every 30 s, scaled
  to at most 1024 px wide, capped at 60 frames; near-duplicates (difference hash, Hamming distance
  5 or less) are dropped. Frames are written to `.cache/frames/<hash>/` and deleted afterwards.
  `--no-visual` (on `npm run docs -- create`) skips this step.

## Measured on the build machine

From `docs/evidence/vision-timing-2026-10-29.md` (Windows 11, 8 CPUs, CPU only):

| Step                                                 | Cold (first run, includes download) | Warm  |
| ---------------------------------------------------- | ----------------------------------- | ----- |
| OCR, one image (tesseract.js, English)               | 2.3 s                               | 0.3 s |
| Caption, Florence-2 base (`<MORE_DETAILED_CAPTION>`) | 214 s                               | 7.9 s |
| Caption, ViT-GPT2 fallback                           | 172 s                               | 1.5 s |

A 10-minute video at the default settings yields at most 60 frames, so keyframe analysis takes about
60 x (7.9 + 0.3) s, about 8 minutes, under the 15-minute budget; `max_frames` stays at 60.

**Not verified on the build machine:** ffmpeg is absent, so real audio decoding, Whisper
transcription and video keyframe extraction were not run (their unit tests are skipped and report as
UNVERIFIED). The sidecar-subtitle path, frame deduplication and the time-ordered interleaving of
audio and visual sections are tested with mocks.

## Out of scope

Password-protected or encrypted files, handwriting, non-English OCR and speech, identifying people,
legacy binary Office formats (`.doc`, `.xls`, `.ppt`) and images embedded inside Office files (only
their text is read).
