"""Transcribe one bounded microphone turn with the provisioned CPU speech model."""
import io
import json
import os
import sys
import wave


def microphone_samples(wav):
    import numpy as np
    # The input route accepts only mono, 16-bit PCM at the model's native rate.
    with wave.open(io.BytesIO(wav), "rb") as recording:
        if (recording.getnchannels(), recording.getsampwidth(), recording.getframerate()) != (1, 2, 16000):
            raise ValueError("Unsupported microphone format")
        pcm = recording.readframes(192000)
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def vocabulary(language, purpose, has_suggestion):
    if language != "th":
        prompt = ("Web search, websites, places and names." if purpose == "search" else
                  "Panthorium Search. Open search, search the web, open calendar, list controls.")
        return prompt + " Use the suggested spelling." if has_suggestion else prompt
    topics = "โรงแรม ร้านอาหาร นิทรรศการ ศิลปะ กรุงเทพฯ ริมแม่น้ำเจ้าพระยา"
    if purpose == "search":
        prompt = f"ค้นเว็บ {topics} พิพิธภัณฑ์ เว็บไซต์"
    else:
        commands = "คำสั่งเสียง Panthorium เปิดหน้าค้นหา ค้นเว็บ เปิดปฏิทิน เปิดไฟล์ เปิดเบราว์เซอร์ แสดงปุ่ม เลือกช่อง"
        prompt = f"{commands} {topics} เว็บไซต์ พิพิธภัณฑ์"
    return prompt + " ใช้คำที่แนะนำ" if has_suggestion else prompt


def main(result):
    import psutil
    if psutil.virtual_memory().available < 1536 * 1024 ** 2:
        return 75
    if os.name == "nt":
        psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["OMP_NUM_THREADS"] = "2"
    from faster_whisper import WhisperModel
    model = WhisperModel(sys.argv[1], device="cpu", compute_type="int8",
                         cpu_threads=2, num_workers=1, local_files_only=True)
    purpose = sys.argv[3] if len(sys.argv) > 3 else "command"
    prompt = vocabulary(sys.argv[2], purpose, len(sys.argv) > 4 and sys.argv[4] == "1")
    samples = microphone_samples(sys.stdin.buffer.read(384045))
    segments, _ = model.transcribe(samples,
                                   language=sys.argv[2], beam_size=4, vad_filter=True, initial_prompt=prompt,
                                   condition_on_previous_text=False)
    print(json.dumps("".join(s.text for s in segments).strip()[:1000]), file=result)
    return 0


if __name__ == "__main__":
    # Native speech libraries can write diagnostics directly to file descriptor 1.
    # Reserve the original pipe for the single JSON reply expected by Node.
    with os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8") as reply:
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        sys.exit(main(reply))
