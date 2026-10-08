"""Offline duration-stratified evaluation for speaker verification.

Manifest CSV columns: path,speaker_id,split,device; split is enroll or test.
Audio remains local. This command prints aggregate rates only.
"""
import argparse
import base64
import csv
import json
import math
import mimetypes
import os
from collections import defaultdict
from pathlib import Path

from app import SpeakerEncoder, decode_audio


def cosine_similarity(left, right):
    if len(left) != len(right) or not left:
        return -1.0
    dot = sum(float(a) * float(b) for a, b in zip(left, right))
    left_norm = math.sqrt(sum(float(a) ** 2 for a in left))
    right_norm = math.sqrt(sum(float(b) ** 2 for b in right))
    return dot / (left_norm * right_norm) if left_norm and right_norm else -1.0


def duration_bucket(seconds):
    if seconds < 2:
        return "under_2s"
    if seconds < 5:
        return "2_to_5s"
    return "5s_or_more"


def measure(trials, threshold):
    positives = [trial for trial in trials if trial["same_speaker"]]
    negatives = [trial for trial in trials if not trial["same_speaker"]]
    false_rejects = sum(trial["score"] < threshold for trial in positives)
    false_accepts = sum(trial["score"] >= threshold for trial in negatives)
    return {
        "threshold": threshold,
        "genuineTrials": len(positives),
        "impostorTrials": len(negatives),
        "falseRejects": false_rejects,
        "falseAccepts": false_accepts,
        "falseRejectRate": false_rejects / len(positives) if positives else None,
        "falseAcceptRate": false_accepts / len(negatives) if negatives else None,
    }


def build_trials(enrollment_templates, test_items):
    trials = []
    for item in test_items:
        for speaker_id, template in enrollment_templates.items():
            trials.append({
                "score": cosine_similarity(item["embedding"], template),
                "same_speaker": item["speaker_id"] == speaker_id,
                "duration_bucket": duration_bucket(item["duration_seconds"]),
                "device": item["device"],
            })
    return trials


def evaluate(trials, thresholds):
    buckets = sorted({trial["duration_bucket"] for trial in trials})
    output = {
        "trialCount": len(trials),
        "overall": [measure(trials, threshold) for threshold in thresholds],
        "byDuration": {},
        "byDevice": {},
    }
    for bucket in buckets:
        subset = [trial for trial in trials if trial["duration_bucket"] == bucket]
        output["byDuration"][bucket] = [measure(subset, threshold) for threshold in thresholds]
    for device in sorted({trial["device"] for trial in trials}):
        subset = [trial for trial in trials if trial["device"] == device]
        output["byDevice"][device] = [measure(subset, threshold) for threshold in thresholds]
    return output


def read_manifest(manifest_path, encoder):
    manifest = Path(manifest_path).resolve()
    with manifest.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"path", "speaker_id", "split", "device"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("manifest_requires_path_speaker_id_split_device")
        rows = list(reader)

    records = []
    seen = set()
    seen_paths = set()
    for row in rows:
        split = str(row["split"]).strip().lower()
        speaker_id = str(row["speaker_id"]).strip()
        device = str(row["device"]).strip() or "unspecified"
        audio_path = (manifest.parent / str(row["path"]).strip()).resolve()
        if split not in {"enroll", "test"} or not speaker_id or not audio_path.is_file():
            raise ValueError("manifest_has_invalid_row")
        key = (speaker_id, split, str(audio_path))
        if key in seen or str(audio_path) in seen_paths:
            raise ValueError("manifest_has_duplicate_audio")
        seen.add(key)
        seen_paths.add(str(audio_path))
        mime = mimetypes.guess_type(audio_path.name)[0] or "audio/wav"
        encoded = base64.b64encode(audio_path.read_bytes()).decode("ascii")
        samples = decode_audio(f"data:{mime};base64,{encoded}")
        records.append({
            "speaker_id": speaker_id,
            "split": split,
            "device": device,
            "duration_seconds": len(samples) / 16000,
            "embedding": encoder.encode(samples),
        })
    enroll = [record for record in records if record["split"] == "enroll"]
    tests = [record for record in records if record["split"] == "test"]
    grouped = defaultdict(list)
    for record in enroll:
        grouped[record["speaker_id"]].append(record["embedding"])
    if not grouped or not tests:
        raise ValueError("evaluation_requires_enrollment_and_test_audio")
    templates = {
        speaker: [sum(vector[index] for vector in vectors) / len(vectors) for index in range(len(vectors[0]))]
        for speaker, vectors in grouped.items()
    }
    trials = build_trials(templates, tests)
    if not any(trial["same_speaker"] for trial in trials) or not any(not trial["same_speaker"] for trial in trials):
        raise ValueError("evaluation_requires_genuine_and_impostor_trials")
    return trials


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="CSV manifest stored beside local audio files")
    parser.add_argument("--thresholds", default="0.60,0.65,0.70,0.75,0.80,0.85,0.90")
    parser.add_argument("--threshold", type=float, default=float(os.getenv("BIOMETRIC_VOICE_THRESHOLD", "0.21")))
    args = parser.parse_args()
    thresholds = sorted({float(value.strip()) for value in args.thresholds.split(",") if value.strip()} | {args.threshold})
    if any(value < -1 or value > 1 for value in thresholds):
        parser.error("thresholds must be cosine values from -1 to 1")
    encoder = SpeakerEncoder()
    trials = read_manifest(args.manifest, encoder)
    print(json.dumps({"configuredThreshold": args.threshold, **evaluate(trials, thresholds)}, indent=2))


if __name__ == "__main__":
    main()
