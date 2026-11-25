# Scholar data

Public, source-dated Google Scholar author citation data. This repository is independent of any homepage hosting provider. It publishes only public scholarly metadata and the narrowly scoped updater; no private homepage source or credentials.

**Read endpoint:** https://raw.githubusercontent.com/mykcs/scholar-data/main/scholar.json

The JSON contains schema version, source, exact author ID/profile URL, citation total and the provider's observation time. It is a dated observation, not a guarantee of the live Google Scholar number. Readers must validate the identity, preserve last known-good data on failure, and mark older samples explicitly. A newer valid decrease or zero is allowed. Fetch the file without credentials; visitors never trigger a SerpApi query.

## Collection and cost

A standard GitHub-hosted runner in this public repository schedules one refresh attempt per UTC day (07:23 UTC), with an explicit manual trigger for verification. A committed reservation precedes the network request and prevents ordinary retries or manual runs from making a second daily attempt. Concurrent workflow runs are serialized. A provider failure keeps the last good snapshot. Updating the data does not build a homepage.

- Current transition mode: when the repository secret is absent, read the existing public SerpApi-backed bridge. Its source cache can delay actual observation refresh; do not interpret a daily collection attempt as daily fresh data.
- Independent direct mode: configure the repository-scoped encrypted `SERPAPI_API_KEY` through GitHub Secrets after owner authorization. The collector checks the free account allowance before one author query, refuses paid/unknown plans, extra credits or depleted quota, and never exposes the key or account response. No fallback to the bridge after a direct-mode failure. Once real direct collection is accepted, the legacy bridge can be retired separately.
- GitHub Actions: standard GitHub-hosted runners are free for public repositories; no paid runners or artifacts. SerpApi's Free plan currently includes 250 searches/month. One scheduled attempt per UTC day is at most 31 author queries/month by this collector. Other consumers and provider terms can change.

References: https://docs.github.com/en/actions/concepts/billing-and-usage ; https://serpapi.com/pricing ; https://serpapi.com/google-scholar-author-api

Official profile: https://scholar.google.com/citations?user=01amzbYAAAAJ

## Credential and free-plan preflight

Run the manual **Verify Scholar free account** workflow on `main` to validate the configured repository secret against the provider's free Account API. It has read-only repository permissions, performs no author search, publishes no account details or credential values, and does not reset or spend the daily collection reservation. Passing this preflight verifies account access and the quota guard, not a fresh author observation. The next eligible daily refresh must still succeed before the legacy bridge can be retired.

## Local checks

`node --test refresh.test.mjs` uses mocked network responses and never contacts the provider.

The daily workflow owns the refresh state and snapshot. Do not manually edit the citation count or use a browser visit as a source refresh timestamp. No credentials, private source links, or internal data belong in the public repository.
