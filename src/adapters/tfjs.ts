import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs';
import type { IntentClassifier, IntentPrediction, Reranker } from '../core/ports.js';
import { INTENTS, type Intent } from '../core/types.js';

let backendReady: Promise<boolean> | null = null;
/** Pure-JS CPU backend (no native build). */
export function tfReady(): Promise<boolean> {
  backendReady ??= tf.setBackend('cpu');
  return backendReady;
}

// ---------- custom IO: model.json + weights.bin (file:// saving needs tfjs-node) ----------

/** Saves a layers model as <dir>/model.json plus <dir>/weights.bin. */
export async function saveModel(model: tf.LayersModel, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await model.save(
    tf.io.withSaveHandler(async (artifacts) => {
      const weights = new Uint8Array(
        tf.io.CompositeArrayBuffer.join(artifacts.weightData ?? new ArrayBuffer(0)),
      );
      writeFileSync(path.join(dir, 'weights.bin'), weights);
      writeFileSync(
        path.join(dir, 'model.json'),
        JSON.stringify({
          format: artifacts.format,
          generatedBy: artifacts.generatedBy,
          convertedBy: artifacts.convertedBy ?? null,
          modelTopology: artifacts.modelTopology,
          weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }],
        }),
      );
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
    }),
  );
}

export async function loadModel(dir: string): Promise<tf.LayersModel> {
  await tfReady();
  const json = JSON.parse(readFileSync(path.join(dir, 'model.json'), 'utf8')) as {
    modelTopology: object;
    weightsManifest: { weights: tf.io.WeightsManifestEntry[] }[];
  };
  const bytes = readFileSync(path.join(dir, 'weights.bin'));
  const weightData = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return tf.loadLayersModel(
    tf.io.fromMemory({
      modelTopology: json.modelTopology,
      weightSpecs: json.weightsManifest.flatMap((m) => m.weights),
      weightData,
    }),
  );
}

/** models/<name>/current.json points at the active version directory (vN). */
export function currentVersion(root: string): number | null {
  const pointer = path.join(root, 'current.json');
  return existsSync(pointer)
    ? (JSON.parse(readFileSync(pointer, 'utf8')) as { version: number }).version
    : null;
}

export function setCurrentVersion(root: string, version: number): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'current.json'), `${JSON.stringify({ version }, null, 2)}\n`);
}

export function nextVersion(root: string): number {
  if (!existsSync(root)) return 1;
  let n = 1;
  while (existsSync(path.join(root, `v${n}`))) n++;
  return n;
}

// ---------- deterministic helpers ----------

/** Mulberry32: seeded PRNG so splits and shuffles are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: T[], seed: number): T[] {
  const rand = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const dense = (
  units: number,
  activation: 'relu' | 'softmax' | 'sigmoid',
  seed: number,
  inputShape?: number[],
) =>
  tf.layers.dense({
    units,
    activation,
    kernelInitializer: tf.initializers.glorotUniform({ seed }),
    ...(inputShape ? { inputShape } : {}),
  });

// ---------- intent classifier: 384 -> dense 32 relu -> dense 4 softmax ----------

export interface IntentExample {
  embedding: number[];
  intent: Intent;
  query?: string;
}

/** Stratified split per class (seeded): the first valShare of each shuffled class is validation. */
export function splitExamples<T extends { intent: Intent }>(
  examples: T[],
  seed: number,
  valShare = 0.2,
) {
  const train: T[] = [];
  const val: T[] = [];
  for (const intent of INTENTS) {
    const group = shuffled(
      examples.filter((e) => e.intent === intent),
      seed,
    );
    const cut = Math.round(group.length * valShare);
    val.push(...group.slice(0, cut));
    train.push(...group.slice(cut));
  }
  return { train, val };
}

export interface TrainReport {
  trainSize: number;
  valSize: number;
  trainAccuracy: number;
  valAccuracy: number;
  epochs: number;
}

export function buildIntentModel(dimensions: number, seed = 7): tf.LayersModel {
  const model = tf.sequential();
  model.add(dense(32, 'relu', seed, [dimensions]));
  model.add(dense(INTENTS.length, 'softmax', seed + 1));
  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  return model;
}

function accuracy(model: tf.LayersModel, xs: number[][], ys: number[]): number {
  if (xs.length === 0) return 0;
  return tf.tidy(() => {
    const pred = (model.predict(tf.tensor2d(xs)) as tf.Tensor).argMax(-1).dataSync();
    let ok = 0;
    pred.forEach((p, i) => (ok += p === ys[i] ? 1 : 0));
    return ok / xs.length;
  });
}

/** Stratified 80/20 split per class (seeded), then training on the 80%. */
export async function trainIntentModel(
  examples: IntentExample[],
  options: { epochs?: number; seed?: number; valShare?: number } = {},
): Promise<{ model: tf.LayersModel; report: TrainReport }> {
  await tfReady();
  const seed = options.seed ?? 7;
  const { train, val } = splitExamples(examples, seed, options.valShare ?? 0.2);
  const order = shuffled(train, seed + 1);
  const model = buildIntentModel(order[0]!.embedding.length, seed);
  const label = (e: IntentExample) => INTENTS.indexOf(e.intent);
  const epochs = options.epochs ?? 60;
  const xs = tf.tensor2d(order.map((e) => e.embedding));
  const ys = tf.oneHot(tf.tensor1d(order.map(label), 'int32'), INTENTS.length);
  await model.fit(xs, ys, { epochs, batchSize: 16, shuffle: false, verbose: 0 });
  xs.dispose();
  ys.dispose();
  return {
    model,
    report: {
      trainSize: train.length,
      valSize: val.length,
      trainAccuracy: accuracy(
        model,
        order.map((e) => e.embedding),
        order.map(label),
      ),
      valAccuracy: accuracy(
        model,
        val.map((e) => e.embedding),
        val.map(label),
      ),
      epochs,
    },
  };
}

export class TfjsIntentClassifier implements IntentClassifier {
  readonly name = 'tfjs-intent';
  constructor(private readonly model: tf.LayersModel) {}

  static async load(dir: string): Promise<TfjsIntentClassifier> {
    return new TfjsIntentClassifier(await loadModel(dir));
  }

  probabilities(embeddings: number[][]): number[][] {
    return tf.tidy(
      () => (this.model.predict(tf.tensor2d(embeddings)) as tf.Tensor).arraySync() as number[][],
    );
  }

  async classify(_question: string, embedding: number[]): Promise<IntentPrediction> {
    const probs = this.probabilities([embedding])[0]!;
    const best = probs.indexOf(Math.max(...probs));
    return { intent: INTENTS[best]!, confidence: probs[best]!, source: this.name };
  }
}

// ---------- reranker: features -> dense 16 relu -> dense 8 relu -> dense 1 sigmoid ----------

export function buildRerankerModel(featureCount: number, seed = 11): tf.LayersModel {
  const model = tf.sequential();
  model.add(dense(16, 'relu', seed, [featureCount]));
  model.add(dense(8, 'relu', seed + 1));
  model.add(dense(1, 'sigmoid', seed + 2));
  model.compile({
    optimizer: tf.train.adam(0.005),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy'],
  });
  return model;
}

export async function trainRerankerModel(
  rows: number[][],
  labels: number[],
  options: { epochs?: number; seed?: number } = {},
): Promise<tf.LayersModel> {
  await tfReady();
  const seed = options.seed ?? 11;
  const order = shuffled(
    rows.map((r, i) => ({ r, y: labels[i]! })),
    seed,
  );
  const model = buildRerankerModel(rows[0]!.length, seed);
  const xs = tf.tensor2d(order.map((o) => o.r));
  const ys = tf.tensor2d(order.map((o) => [o.y]));
  await model.fit(xs, ys, {
    epochs: options.epochs ?? 40,
    batchSize: 64,
    shuffle: false,
    verbose: 0,
  });
  xs.dispose();
  ys.dispose();
  return model;
}

/** Learning-to-rank: a small MLP over retrieval features. It scores; it never generates text. */
export class TfjsReranker implements Reranker {
  readonly name = 'tfjs-reranker';
  constructor(readonly model: tf.LayersModel) {}

  static async load(dir: string): Promise<TfjsReranker> {
    return new TfjsReranker(await loadModel(dir));
  }

  async score(features: number[][]): Promise<number[]> {
    if (features.length === 0) return [];
    return tf.tidy(() =>
      Array.from((this.model.predict(tf.tensor2d(features)) as tf.Tensor).dataSync()),
    );
  }
}
