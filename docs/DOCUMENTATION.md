# qTest Scenario + GitHub Actions + Playwright — Full Documentation

Two end-to-end delivery approaches are supported. Both share the same test code
(`features/`, `tests/step-definitions/`, `src/mock-server/`). Pick the one that fits your setup,
or run both in parallel.

---

## Approach A — Via qTest Pulse

### Flow

```
1. Save scenario in qTest Scenario
       │
   Pulse ScenarioSaved trigger
   → TriggerGitHubActions (action-2)
   → POST repository_dispatch {"event_type":"run-tests"}
       │                                    OR
       │                         manual workflow_dispatch
       │                         from GitHub Actions UI
       ▼
2. GitHub Actions: .github/workflows/playwright-cucumber-qtest-pulse.yml
   a. checkout  — test code lives in this repo
   b. test      — npm ci + Playwright/Cucumber → reports/cucumber-report.json
   c. report    — scripts/post-to-pulse.js base64-encodes the report
                  and POSTs it to the Pulse PulseWebhookReceived trigger
       │
4. FormatCucumberResults (Pulse action-3)
   Decodes base64, converts Cucumber JSON to qTest format
       │
5. UploadQTestResults (Pulse action-4)
   Uploads to qTest Manager auto-test-logs API, polls queue until done
       │
6. LinkRequirements (Pulse action-5)
   Gets features from Scenario API (which carry Jira issue keys)
   Searches qTest for matching requirements and test cases, links them
       │
7. UpdateScenarioSteps (Pulse action-6)
   Fetches all steps from Scenario API, matches test results client-side,
   updates step colors: PASSED (green) / FAILED (red) / SKIPPED (white)
       │
8. ChatOpsEvent (Pulse action-1)
   Sends Slack notifications at each stage
```

### GitHub Actions Secrets (Approach A)

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Description |
|---|---|
| `PULSE_WEBHOOK_URL` | URL of the Pulse **PulseWebhookReceived** trigger |
| `QTEST_PROJECT_ID` | Numeric qTest project ID (included in the POST payload) |
| `QTEST_TEST_CYCLE_ID` | Target test cycle ID (included in the POST payload) |

The qTest API token and Scenario IDs live in Pulse constants, not GitHub secrets.

### Pulse Setup (Approach A)

Import **`pulse/scenario-playwright-github-pulse.json`** into Pulse.

This file contains all six actions (trigger + upload + link + step colors + Slack) and all constants.

Set these **constants** in the Pulse UI:

| Constant | Used by actions | Description | Hidden |
|---|---|---|---|
| `GitHubToken` | action-2 | GitHub PAT with `Actions: Read and Write` permission | Yes |
| `GitHubRepo` | action-2 | `owner/repo` | No |
| `GitHubEventType` | action-2 | Must match the workflow trigger — use `run-tests` | No |
| `GitHubAPIURL` | action-2 | GitHub REST API base URL (default: `https://api.github.com`). Set to `https://<hostname>/api/v3` for GitHub Enterprise Server | No |
| `QTEST_TOKEN` | action-4, 5, 6 | qTest Manager API bearer token | Yes |
| `ManagerURL` | action-4, 5 | e.g. `yourorg.qtestnet.com` — hostname only, no `https://` | No |
| `Scenario_URL` | action-5, 6 | e.g. `https://scenario-v2-0-us-east-1.qtestnet.com` | No |
| `SCENARIO_PROJECT_ID` | action-5, 6 | Scenario project UUID, e.g. `3600c0b2-d245-…` | No |
| `QTEST_PROJECT_ID` | action-4 | Numeric qTest project ID (fallback when not in POST payload) | No |
| `QTEST_TEST_CYCLE_ID` | action-4 | Target test cycle ID (fallback when not in POST payload) | No |
| `ChatOpsWebhook` | action-1 | Slack incoming webhook URL (optional) | Yes |

Copy the **PulseWebhookReceived** trigger's webhook URL into the `PULSE_WEBHOOK_URL` GitHub secret.

#### Triggering the workflow

qTest Scenario adds `[skip ci]` to its commits, which suppresses all push-triggered
GitHub Actions workflows. The `ScenarioSaved` → `TriggerGitHubActions` path is therefore
required for automatic runs — it sends a `repository_dispatch` event that is immune to
`[skip ci]`. Point the Scenario webhook at the **ScenarioSaved** Pulse trigger to activate it.

The workflow can also be run on demand via **Actions → Run workflow** in the GitHub UI.

---

## Approach B — Direct upload (Pulse for trigger only)

The full upload chain (format → upload → link → step colors → Slack) runs inside
GitHub Actions via `scripts/post-to-qtest.js`. Pulse is used **only** to fire the
workflow when a Scenario is saved — none of the Pulse upload actions (3–6) are needed.

### Flow

```
1. Save scenario in qTest Scenario
       │
   Pulse ScenarioSaved trigger
   → TriggerGitHubActions (action-2)
   → POST repository_dispatch {"event_type":"run-tests"}
       │                                    OR
       │                         manual workflow_dispatch
       │                         from GitHub Actions UI
       ▼
2. GitHub Actions: .github/workflows/playwright-cucumber-qtest-direct.yml
   a. checkout  — test code lives in this repo
   b. test      — npm ci + Playwright/Cucumber → reports/cucumber-report.json
   c. upload    — scripts/post-to-qtest.js does the full chain:
                  parse → upload → link requirements → update step colors → Slack
       │
3. qTest Manager receives the results directly from the GitHub Actions runner
```

> **Why Pulse is still needed for the trigger:** qTest Scenario adds `[skip ci]`
> to its commits, which suppresses all `push`-triggered GitHub Actions workflows.
> Pulse's `TriggerGitHubActions` action sends a `repository_dispatch` event — which
> is immune to `[skip ci]` — with the proper auth headers that Scenario's webhook
> cannot supply on its own.

### GitHub Actions Secrets (Approach B)

| Secret | Required | Description |
|---|---|---|
| `QTEST_TOKEN` | Yes | qTest API bearer token |
| `QTEST_MANAGER_URL` | Yes | qTest Manager host only, e.g. `yourorg.qtestnet.com` |
| `QTEST_PROJECT_ID` | Yes | Numeric qTest project ID |
| `QTEST_TEST_CYCLE_ID` | Yes | Target test cycle ID |
| `QTEST_SCENARIO_URL` | No | Enables requirement linking + step color updates, e.g. `https://scenario-v2-0-us-east-1.qtestnet.com` |
| `SCENARIO_PROJECT_ID` | No (needed with `QTEST_SCENARIO_URL`) | Scenario project UUID |
| `SLACK_WEBHOOK_URL` | No | Slack incoming webhook URL for notifications |

### What `post-to-qtest.js` does

| Step | Equivalent Pulse action | Active when |
|---|---|---|
| Parse Cucumber report → qTest format | action-3 FormatCucumberResults | Always |
| Upload to qTest Manager, poll queue | action-4 UploadQTestResults | Always |
| Link test cases to requirements | action-5 LinkRequirements | `QTEST_SCENARIO_URL` is set |
| Update Scenario step colors | action-6 UpdateScenarioSteps | `QTEST_SCENARIO_URL` is set |
| Slack notifications | action-1 ChatOpsEvent | `SLACK_WEBHOOK_URL` is set |

### Triggering

**Option 1 — Pulse ScenarioSaved trigger (recommended, automatic)**

Import **`pulse/scenario-playwright-github-manager.json`** into Pulse.

This file contains only action-1 (ChatOpsEvent) and action-2 (TriggerGitHubActions).
Actions 3–6 are not included — that work is done by `post-to-qtest.js` in GitHub Actions.

Set these **constants** in the Pulse UI:

| Constant | Used by actions | Description | Hidden |
|---|---|---|---|
| `GitHubToken` | action-2 | GitHub PAT with `Actions: Read and Write` permission | Yes |
| `GitHubRepo` | action-2 | `owner/repo` | No |
| `GitHubEventType` | action-2 | Must match the workflow trigger — use `run-tests` | No |
| `GitHubAPIURL` | action-2 | GitHub REST API base URL (default: `https://api.github.com`). Set to `https://<hostname>/api/v3` for GitHub Enterprise Server | No |
| `ChatOpsWebhook` | action-1 | Slack incoming webhook URL (optional) | Yes |

When a scenario is saved, Pulse fires a `repository_dispatch` event to GitHub —
bypassing `[skip ci]` — and the workflow runs automatically.

**Option 2 — Manual run**
GitHub Actions UI → `playwright-cucumber-qtest-direct.yml` → **Run workflow**.
Use this any time you want to push results on demand without a Scenario save.

---

## Repository Structure

### Shared by both approaches

```
features/                          .feature files (synced from qTest Scenario)
tests/
  step-definitions/                Playwright (APIRequestContext) steps + hooks
src/
  mock-server/                     Mock API the tests run against
config/
  cucumber.js                      Cucumber configuration
package.json / package-lock.json   Dependencies (@cucumber/cucumber, playwright)
```

### Approach A — Full Pulse

```
.github/workflows/
  playwright-cucumber-qtest-pulse.yml    GitHub Actions workflow (tests → POST to Pulse)

scripts/
  post-to-pulse.js                       base64 report → POST to Pulse webhook

pulse/
  scenario-playwright-github-pulse.json  Import this into Pulse (all 6 actions)
  actions/                               Readable source — edit here, paste into Pulse UI
    action-1-ChatOpsEvent.js             Slack notifications
    action-2-TriggerGitHubActions.js     Fires GitHub repository_dispatch on ScenarioSaved
    action-3-FormatCucumberResults.js    Parse Cucumber JSON → qTest format
    action-4-UploadQTestResults.js       Upload to qTest Manager + poll queue
    action-5-LinkRequirements.js         Link test cases to Jira requirements
    action-6-UpdateScenarioSteps.js      Update Scenario step colors pass/fail/skip
```

Pulse constants: `GitHubToken`, `GitHubRepo`, `GitHubEventType`, `GitHubAPIURL`, `QTEST_TOKEN`,
`ManagerURL`, `Scenario_URL`, `SCENARIO_PROJECT_ID`, `QTEST_PROJECT_ID`,
`QTEST_TEST_CYCLE_ID`, `ChatOpsWebhook`

GitHub Actions secrets: `PULSE_WEBHOOK_URL`, `QTEST_PROJECT_ID`, `QTEST_TEST_CYCLE_ID`

### Approach B — Direct upload (Pulse trigger only)

```
.github/workflows/
  playwright-cucumber-qtest-direct.yml   GitHub Actions workflow (tests → post-to-qtest.js)

scripts/
  post-to-qtest.js                       Full upload chain: format → upload → link → step colors → Slack

pulse/
  scenario-playwright-github-manager.json  Import this into Pulse (actions 1+2 only)
  actions/
    action-1-ChatOpsEvent.js               Slack notifications
    action-2-TriggerGitHubActions.js       Fires GitHub repository_dispatch on ScenarioSaved
```

Pulse constants: `GitHubToken`, `GitHubRepo`, `GitHubEventType`, `GitHubAPIURL`, `ChatOpsWebhook`

GitHub Actions secrets: `QTEST_TOKEN`, `QTEST_MANAGER_URL`, `QTEST_PROJECT_ID`,
`QTEST_TEST_CYCLE_ID`, and optionally `QTEST_SCENARIO_URL`, `SCENARIO_PROJECT_ID`,
`SLACK_WEBHOOK_URL`

---

## Setup

### 1. GitHub Repository

Push this repo to GitHub. The test project lives at the repo root and is self-contained
(`package-lock.json` is committed so `npm ci` works in CI with no network calls beyond
the registry).

### 2. Choose an approach and set secrets

See the secrets tables above for Approach A or Approach B.

Only one workflow needs to be active. To disable the one you're not using, either:
- Delete the unused workflow file, or
- Add `if: false` to its job, or
- Remove the trigger paths it listens to

### 3. qTest Scenario → GitHub Sync

Point qTest Scenario's Git integration at this repository so that saving a scenario commits
the `.feature` file into `features/`. That push triggers whichever workflow is active.
You can also trigger either workflow manually via **Actions → Run workflow**.

### 4. qTest Requirements (optional)

Import your Jira issues as requirements in qTest Manager. Both approaches will link test cases
to requirements automatically when the Scenario API is reachable.

---

## Key Implementation Details

- **Playwright APIRequestContext, no browser**: Step definitions use Playwright's HTTP API
  against the bundled mock server — CI needs no browser binaries.
- **Report on failure too**: The test step uses `continue-on-error: true` and the results step
  runs with `if: always()`, so failing scenarios are still reported and colored red.
- **ManagerURL format**: Hostname only, e.g. `yourorg.qtestnet.com`. The code prepends `https://`.
- **Scenario API headers**: Uses `x-scenario-project-id` header with the UUID-format project ID.
- **Client-side step matching**: Steps are fetched in bulk (`GET /api/steps`) and matched locally
  to avoid Cloudflare WAF issues with query strings containing email addresses.
- **Step keyword stripping**: Test results store `"Given the API is accessible"` but Scenario
  stores `text: "the API is accessible"` with `keyword: "Given"` separately. Both scripts strip
  the keyword prefix before matching.
- **No Scenario SDK**: Direct HTTP calls instead of `@qasymphony/scenario-sdk` — the SDK
  hardcodes an outdated Scenario URL.

---

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Workflow doesn't run on save | Push didn't touch `features/**` | Confirm Scenario syncs into the repo-root `features/` folder; or run manually via `workflow_dispatch` |
| `npm ci` fails | `package-lock.json` missing | It's committed at the repo root; re-run `npm install --package-lock-only` if it drifts |
| **Approach A** — Results never reach qTest | `PULSE_WEBHOOK_URL` points at wrong trigger | Must be the **PulseWebhookReceived** trigger URL, not `ScenarioSaved` |
| **Approach B** — Upload fails with 401 | `QTEST_TOKEN` expired or missing | Regenerate the token in qTest Manager → User Management |
| `getaddrinfo ENOTFOUND https` | `QTEST_MANAGER_URL` / `ManagerURL` includes `https://` | Remove the protocol prefix (just `yourorg.qtestnet.com`) |
| `Scenario project ID is not in UUID format` | Numeric project ID used | Use the UUID format, e.g. `3600c0b2-d245-4b79-bf4c-e09eb857633b` |
| Cloudflare 403 on step search | Email address in query string | Already handled — bulk fetch + client-side matching |
| `[WARN] No matching step` | Feature not tracked in Scenario | Only features that exist in qTest Scenario will have matching steps |
| `@skip` scenarios not run | Tagged `@skip` in the feature | Expected — remove the tag once step definitions exist |
| `repository_dispatch` doesn't trigger | Wrong `event_type` | Must match the workflow's `types: [run-tests]`; check the JSON body |
