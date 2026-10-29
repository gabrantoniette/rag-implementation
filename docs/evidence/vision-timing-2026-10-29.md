# Vision timing on the build machine (2026-10-29)

Command: `node scripts/tsx.mjs .cache/tmp/probe-vision.ts` (scratch probe: one OCR image of two drawn text
lines, then each captioner on a generated 640x480 scene). Machine: Windows 11, 8 CPUs, CPU only.

Raw output:

```
OCR 2307 ms "Usain Bolt set the 100 metres world record\nof 9.58 seconds in Berlin in 2009." conf 95.6
OCR warm 302 ms
onnx-community/Florence-2-base-ft cold 214134 ms "A simple simple image of a white circle in the middle of a green line. The background is a solid blue. The green line is flat and the circle is in the center. The circle is round."
onnx-community/Florence-2-base-ft warm 7920 ms
Xenova/vit-gpt2-image-captioning cold 171519 ms "a green and white clock on a blue wall"
Xenova/vit-gpt2-image-captioning warm 1473 ms
```

"cold" includes the first model download into `.cache/transformers`.

Budget check for video keyframes: at most 60 frames x (7.9 s caption + about 0.3 s OCR) is about 8.2 minutes
for a 10-minute video, under the 15-minute limit in the build prompt, so `max_frames` stays at 60.
