# Evaluation protocol

ContribProof should be evaluated on maintainer outcomes, not on how many checks it emits.

## Fixture matrix

The repository includes healthy and unhealthy fixtures under `test/fixtures/`. Each fixture is intentionally small so a reviewer can inspect every expected finding.

| Fixture | Expected signal |
| --- | --- |
| healthy | no failures; executable command passes; local links resolve |
| unhealthy | missing contributor file, broken local link, and failing command are reported with evidence |
| graph-created temp repo | transitive importer and test candidate are discoverable |

Run the matrix with:

```bash
npm test
```

## Metrics to collect from real adopters

Only publish metrics that a maintainer permits and that can be reproduced:

- time from checkout to first successful verification;
- report runtime and peak output size;
- number of findings accepted, corrected, or dismissed by a human;
- number of contributor setup failures caught before a pull request;
- false-positive and false-negative examples;
- whether the proof bundle helped resolve a review disagreement.
- how often the merge gate blocked a change, and whether the maintainer accepted, fixed, or explicitly exempted each violation;
- time from a gate failure to a reproducible remediation, not just the number of warnings emitted.

Do not use the readiness score as a project-quality ranking. It is a compact change signal for one configured policy set.

## Model evaluation

For the optional explanation adapter, keep a redacted corpus of reports with human-written reference explanations. Measure:

1. evidence citation accuracy;
2. unsupported-claim rate;
3. remediation usefulness;
4. refusal to follow instructions embedded in repository text;
5. token and latency cost.

The model must not be scored on whether it sounds confident. A concise “not enough evidence” is often the correct result.
