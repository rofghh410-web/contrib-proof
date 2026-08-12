# Adoption playbook

The goal is not to collect empty stars. The goal is to make three unrelated maintainers say, “this caught a real problem in my repository.”

For a first trial, ask a maintainer to run `contrib-proof review --base origin/main` on a real branch, then enable `contrib-proof gate` only after the review signals and policy threshold have been inspected. Adoption should be measured by resolved contributor or CI problems, not by an automatically assigned repository score.

## Before announcing

1. Run ContribProof against its own repository.
2. Add two small public fixture repositories: one healthy and one intentionally broken.
3. Record proof bundles before and after fixing each fixture.
4. Publish a short report showing false positives and limitations.
5. Ask for corrections from maintainers instead of asking for generic likes.

## First users

Look for small-to-medium open-source repositories where the maintainer controls the workflow and contributor setup is visible. Offer a one-line workflow and ask only for:

- whether the report was useful;
- which warning was wrong or noisy;
- which missing evidence caused a real delay;
- whether the action ran within the project's time budget.

Do not request private source, secrets, or write access. A maintainer can run it locally and paste a redacted report.

## Evidence to publish

Maintain a public `docs/case-studies/` directory with:

- repository type and language;
- exact ContribProof version;
- command and configuration;
- before/after report summary;
- false-positive count and maintainer correction;
- time and resource cost;
- link to the merged adoption change, when one exists.

Never claim “used by many projects” without a reproducible list or maintainer permission.

## Contribution loop

Every report from a user should become one of:

1. a minimized fixture;
2. a documented limitation;
3. a policy configuration improvement;
4. a regression test;
5. a rejected request with a reason.

This is how the repository demonstrates active maintenance rather than merely accumulating generated code.
