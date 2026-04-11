#!/usr/bin/env python3
"""Time each call of the real TTSEngine module to see if any specific sentence
takes abnormally long. Also check for weird start-of-audio artifacts by
analyzing the first ~200ms of each sentence.
"""
import asyncio
import os
import sys
import time
import wave
import numpy as np

sys.path.insert(0, os.path.abspath("backend"))
from voice.tts_engine import TTSEngine  # noqa: E402

MODEL_PATH = os.path.abspath("voice-models/orpheus-3b-0.1-ft/orpheus-3b-0.1-ft-q4_k_m.gguf")

SENTENCES = [
    "Hey Alex!",
    "Great to hear from you today.",
    "Three easy miles is a perfect base building run.",
    "Your half marathon in June is very doable.",
    "How many days per week can you train?",
    "Four days sounds ideal.",
]


async def main() -> None:
    engine = TTSEngine()
    await engine.load_model("orpheus-3b-0.1-ft", MODEL_PATH)

    all_pcm = []
    for i, sentence in enumerate(SENTENCES, start=1):
        t0 = time.monotonic()
        chunks = []
        first_chunk_at = None
        async for pcm in engine.synthesize_stream(sentence, speaker="tara"):
            if first_chunk_at is None:
                first_chunk_at = time.monotonic() - t0
            chunks.append(pcm)
        wall = time.monotonic() - t0

        total = b"".join(chunks)
        samples = len(total) // 2
        samples_np = np.frombuffer(total, dtype=np.int16)

        # Analyze first 200ms (4800 samples) for oddities
        head = samples_np[:4800]
        head_rms = float(np.sqrt(np.mean(head.astype(np.float64) ** 2)))
        head_max = int(np.abs(head).max())
        head_first_nonzero = int(np.argmax(np.abs(head) > 100)) if (np.abs(head) > 100).any() else -1

        print(
            f"[{i}] wall={wall*1000:4.0f}ms  first_chunk={(first_chunk_at or 0)*1000:4.0f}ms  "
            f"samples={samples:6d}  audio={samples/24000:.2f}s  "
            f"head_rms={head_rms:5.0f}  head_max={head_max:5d}  first_sound_at={head_first_nonzero}  "
            f"'{sentence[:30]}…'"
        )
        all_pcm.append(total)
        all_pcm.append(b"\x00\x00" * 2400)

    joined = b"".join(all_pcm)
    with wave.open("/tmp/tts_timing.wav", "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000)
        f.writeframes(joined)
    print(f"\nSaved /tmp/tts_timing.wav")


asyncio.run(main())
