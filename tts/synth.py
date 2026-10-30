"""Kokoro TTS: a text file in, an OGG/Vorbis file out (24 kHz mono).

    tts/.venv/Scripts/python.exe -I tts/synth.py IN.txt OUT.ogg [--voice af_heart] [--speed 1.0]

Paragraphs are split into sentences and sentences grouped into chunks of a
few hundred characters (Kokoro's sweet spot), each synthesized and appended
to the output as it finishes, with a short pause between sentences and a
longer one between paragraphs. Progress goes to stderr as `progress i/n`
lines so the caller can surface it. Writes OUT.part and renames on success,
so a crash never leaves a truncated OUT behind.

Set up with scripts/setup-tts.ps1 (venv + model files under tts/models/).
"""

import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, "models")
SAMPLE_RATE = 24000
CHUNK_CHARS = 400
SENTENCE_GAP = 0.12  # seconds
PARAGRAPH_GAP = 0.45

# Split after . ! ? (optionally followed by a closing quote/bracket) + space,
# but not after common abbreviations or single initials.
_SENTENCE_END = re.compile(r"(?<=[.!?])[\"'”’)\]]*\s+")
_ABBREV = re.compile(r"(?:\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Prof|Fig|Eq|approx|cf)\.|\b[A-Z]\.)$")


def sentences(paragraph):
    out = []
    buf = ""
    pos = 0
    for m in _SENTENCE_END.finditer(paragraph):
        piece = paragraph[pos:m.start()] + paragraph[m.start():m.end()].rstrip()
        pos = m.end()
        buf = f"{buf} {piece}".strip() if buf else piece.strip()
        if not _ABBREV.search(buf):
            out.append(buf)
            buf = ""
    rest = paragraph[pos:].strip()
    if rest:
        buf = f"{buf} {rest}".strip() if buf else rest
    if buf:
        out.append(buf)
    return out


def chunks(text):
    """[(chunk_text, gap_after_seconds)] — sentences packed up to CHUNK_CHARS,
    never across a paragraph break."""
    out = []
    for para in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        para = " ".join(para.split())
        if not para:
            continue
        cur = ""
        for s in sentences(para):
            if cur and len(cur) + 1 + len(s) > CHUNK_CHARS:
                out.append((cur, SENTENCE_GAP))
                cur = s
            else:
                cur = f"{cur} {s}" if cur else s
        if cur:
            out.append((cur, PARAGRAPH_GAP))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--lang", default="en-us")
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        parts = chunks(f.read())
    if not parts:
        sys.exit("synth: input text is empty")

    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"), os.path.join(MODELS, "voices-v1.0.bin"))
    part_path = args.output + ".part"
    total = len(parts)
    print(f"progress 0/{total}", file=sys.stderr, flush=True)
    with sf.SoundFile(part_path, "w", samplerate=SAMPLE_RATE, channels=1, format="OGG", subtype="VORBIS") as out:
        for i, (chunk, gap) in enumerate(parts, 1):
            samples, sr = kokoro.create(chunk, voice=args.voice, speed=args.speed, lang=args.lang)
            if sr != SAMPLE_RATE:
                sys.exit(f"synth: model returned {sr} Hz, expected {SAMPLE_RATE}")
            out.write(np.asarray(samples, dtype=np.float32))
            out.write(np.zeros(int(gap * SAMPLE_RATE), dtype=np.float32))
            print(f"progress {i}/{total}", file=sys.stderr, flush=True)
    os.replace(part_path, args.output)


if __name__ == "__main__":
    main()
