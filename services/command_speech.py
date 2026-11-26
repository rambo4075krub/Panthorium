"""Transcribe one bounded microphone turn with the provisioned CPU speech model."""
import io
import json
import os
import sys


def main():
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
    vocabulary = ("คำสั่งเสียง Panthorium เปิดหน้าค้นหา ค้นเว็บ เปิดปฏิทิน เปิดไฟล์ เปิดเบราว์เซอร์ แสดงปุ่ม เลือกช่อง"
                  if sys.argv[2] == "th" else "Panthorium Search. Open search, search the web, open calendar, list controls.")
    segments, _ = model.transcribe(io.BytesIO(sys.stdin.buffer.read(384045)),
                                   language=sys.argv[2], beam_size=4, vad_filter=True, initial_prompt=vocabulary,
                                   condition_on_previous_text=False)
    print(json.dumps("".join(s.text for s in segments).strip()[:1000]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
