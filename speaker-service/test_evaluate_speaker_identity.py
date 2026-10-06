import unittest

from evaluate_speaker_identity import cosine_similarity, duration_bucket, evaluate


class SpeakerEvaluationTests(unittest.TestCase):
    def test_cosine_similarity_handles_bad_vectors(self):
        self.assertAlmostEqual(cosine_similarity([1, 0], [1, 0]), 1.0)
        self.assertAlmostEqual(cosine_similarity([1, 0], [0, 1]), 0.0)
        self.assertEqual(cosine_similarity([1], [1, 2]), -1.0)

    def test_duration_buckets_keep_short_utterances_separate(self):
        self.assertEqual(duration_bucket(1.4), "under_2s")
        self.assertEqual(duration_bucket(3.2), "2_to_5s")
        self.assertEqual(duration_bucket(5.0), "5s_or_more")

    def test_far_and_frr_are_reported_by_duration_and_device(self):
        trials = [
            {"score": 0.82, "same_speaker": True, "duration_bucket": "under_2s", "device": "phone"},
            {"score": 0.70, "same_speaker": True, "duration_bucket": "under_2s", "device": "phone"},
            {"score": 0.77, "same_speaker": False, "duration_bucket": "2_to_5s", "device": "tablet"},
            {"score": 0.42, "same_speaker": False, "duration_bucket": "2_to_5s", "device": "tablet"},
        ]
        result = evaluate(trials, [0.75])
        self.assertEqual(result["trialCount"], 4)
        short = result["byDuration"]["under_2s"][0]
        self.assertEqual(short["falseRejects"], 1)
        self.assertEqual(short["falseRejectRate"], 0.5)
        self.assertEqual(result["byDuration"]["2_to_5s"][0]["falseAcceptRate"], 0.5)
        self.assertIn("phone", result["byDevice"])


if __name__ == "__main__":
    unittest.main()
