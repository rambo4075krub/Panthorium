-- Run only against the restored database. Emit aggregate counts.
WITH reviews AS (
  SELECT p.data->'briefBaselines' AS baselines, review
  FROM panthorium_work_projects p CROSS JOIN LATERAL jsonb_array_elements(p.data->'briefReviews') review
), linked AS (
  SELECT review, (SELECT baseline FROM jsonb_array_elements(baselines) baseline
    WHERE baseline->>'id' = review->>'baselineId') AS baseline
  FROM reviews
), quotes AS (
  SELECT review->'quote' AS quote FROM linked WHERE review ? 'quote'
)
SELECT json_build_object(
  'reviewCount', (SELECT count(*) FROM linked),
  'missingBaselines', (SELECT count(*) FROM linked WHERE baseline IS NULL),
  'invalidEvidence', (SELECT count(*) FROM linked CROSS JOIN LATERAL jsonb_array_elements(review->'rows') r
    WHERE (r->>'category' = 'included' AND r->>'evidence' IS NULL)
       OR ((r->>'evidence')::integer < 0 OR (r->>'evidence')::integer >=
         (SELECT count(*) FROM regexp_split_to_table(baseline->>'text', E'\\r\\n?|\\n') AS line WHERE line !~ '^[[:space:]]*$'))),
  'quoteCount', (SELECT count(*) FROM quotes),
  'invalidQuoteTotals', (SELECT count(*) FROM quotes WHERE (quote->>'totalSatang')::bigint IS DISTINCT FROM
    (SELECT sum((item->>'quantity')::bigint * (item->>'unitSatang')::bigint) FROM jsonb_array_elements(quote->'items') item))
);
