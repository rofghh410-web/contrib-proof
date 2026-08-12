# Publish checklist

This repository is published under the `rofghh410-web` GitHub account.

## Before the first public push

1. Choose the public repository name and license.
2. Confirm that `rofghh410-web` is still the intended maintainer in `package.json`, `CITATION.cff`, README examples, and the sample workflow.
3. Run:

```bash
npm test
npm run lint
npm run verify
npm run release:check
```

4. Review the proof report for unexpected paths or command output.
5. Confirm the repository is public and that the visible profile accurately identifies the primary maintainer.

## Create and push from a normal local checkout

Run these commands in a copy of the project on a machine where Git is writable and the GitHub account is already authenticated:

```bash
git init -b main
git add .
git commit -m "feat: initial ContribProof release"
git remote add origin https://github.com/rofghh410-web/contrib-proof.git
git push -u origin main
```

Do not paste access tokens into the remote URL or commit them into the repository.

## After publishing

- enable the CI and Contributor proof workflows;
- create a tagged release matching `package.json`;
- publish the README demo and proof-bundle examples;
- invite maintainers to report false positives with minimized fixtures;
- record real adoption and merged fixes in `docs/case-studies/` only with permission;
- replace every placeholder before sharing the Codex for Open Source application.
