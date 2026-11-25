# Scholar data

Public, source-dated Google Scholar author citation data. This repository is independent of any homepage hosting provider. It publishes only public scholarly metadata and the narrowly scoped updater; no private homepage source or credentials.

**Read endpoint:** https://raw.githubusercontent.com/mykcs/scholar-data/main/scholar.json

The JSON contains schema version, source, exact author ID/profile URL, citation total and the provider's observation time. It is a dated observation, not a guarantee of the live Google Scholar number. Readers must validate the identity, preserve last known-good data on failure, and mark older samples explicitly. A newer valid decrease or zero is allowed. Fetch the file without credentials; visitors never trigger a SerpApi query.

## Collection and cost

The owner-selected schedule is once a week on Monday at 09:00 America/Los_Angeles (Tuesday 01:00 SGT in Pacific standard time, Tuesday 00:00 SGT in Pacific daylight time). GitHub's native IANA timezone schedule handles DST. A committed local-calendar-week reservation precedes any provider author search. Manual recovery is allowed only after that week's scheduled time and only if the week has not already been reserved. Retries cannot repeat a reserved week; concurrent workflow runs are serialized. The previous daily reservation remains valid for the week in which it occurred. The initial one-time migration acceptance is completed and its special dispatch input has been removed. The historical bridge and direct reservations are retained in refresh-state.json. On failure the last verified data is retained.

- This deliberately public repository contains only public author citation metadata, collection code, tests, documentation and reservation metadata. The actual homepage source stays separate. A repository-scoped encrypted Actions secret is never stored in Git or shared JSON. Forks do not receive that secret; the workflow runs only on the default branch and has no pull-request trigger.
- Direct independent collection: the configured `SERPAPI_API_KEY` is verified using the free Account API before exactly one author query. The guard rejects paid/unknown plans, extra credits and depleted allowance. Missing credentials or provider failure fail closed without falling back to a homepage host. The free-account preflight and first direct author observation both passed. The collector now has no bridge fallback or migration override.
- GitHub Actions: standard hosted runners are free in public repositories. No paid runners or artifacts. At most one direct author search attempt per Los Angeles calendar week, normally four or five per month (depending on the dates and any delayed manual recovery). Updates do not build either homepage.

References: https://docs.github.com/en/actions/concepts/billing-and-usage ; https://serpapi.com/pricing ; https://serpapi.com/google-scholar-author-api

Official profile: https://scholar.google.com/citations?user=01amzbYAAAAJ

## Credential and free-plan preflight

Run the manual **Verify Scholar free account** workflow on `main` to validate the configured repository secret against the provider's free Account API. It has read-only repository permissions, performs no author search, publishes no account details or credential values, and does not reset or spend the weekly collection reservation. Passing this preflight verifies account access and the quota guard, not a fresh author observation. The independent collector no longer uses the legacy bridge.

## Verified initial direct acquisition

- [Account-only preflight](https://github.com/mykcs/scholar-data/actions/runs/45608904338): active Free plan, $0 monthly price, no extra credits, allowance guard passed.
- [Direct migration acceptance](https://github.com/mykcs/scholar-data/actions/runs/45609922684): 9 citations, provider observation 2026-11-25T12:02:26.000Z, committed snapshot at `9ea66874b0e5642fed429b6b42f340befe1a069f`. The one-time migration path is now retired. No further manual author search is required for migration.
- [Weekly schedule verification](https://github.com/mykcs/scholar-data/actions/runs/45609510662): ordinary same-week dispatch correctly skipped collection. The next regular slot is 2026-11-30 09:00 PT / 2026-12-01 01:00 SGT.

Readers can see an earlier valid sample during GitHub's public CDN cache propagation; preserve the actual displayed source timestamp rather than claiming instant synchronization.

## Local checks

`node --test refresh.test.mjs` uses mocked network responses and never contacts the provider.

The weekly workflow owns the refresh state and snapshot. Do not manually edit the citation count or use a browser visit as a source refresh timestamp. No credentials, private source links, or internal data belong in the public repository.
