# qtest-scenario-playwright-orchestrator

Automated BDD pipeline: **qTest Scenario → GitHub Actions → Playwright + Cucumber → qTest Manager**.

Saving a scenario in qTest Scenario syncs the `.feature` file into this repo. The push triggers a
GitHub Actions workflow that runs Playwright + Cucumber tests and delivers results to qTest Manager.

Two delivery paths are available — choose the one that fits your setup:

---

## Approach A — Via qTest Pulse (default)

Results are handed off to Pulse, which handles upload, requirement linking, and Scenario step coloring.

```
qTest Scenario saves
        │
  Pulse ScenarioSaved
  → TriggerGitHubActions          ── OR ── manual workflow_dispatch
  → repository_dispatch
        │
        ▼
GitHub Actions: playwright-cucumber-qtest-pulse.yml
  (Playwright + Cucumber tests)
        │  POST report to Pulse
        ▼
    qTest Pulse
    FormatResults ▶ Upload ▶ LinkRequirements ▶ UpdateScenarioSteps ▶ Slack
        │
        ▼
  qTest Manager
```

**Requires:** qTest Pulse licence, Pulse workflow imported, `PULSE_WEBHOOK_URL` GitHub secret.

---

## Approach B — Direct upload (Pulse for trigger only)

Pulse fires the workflow when a Scenario is saved. Everything after that — upload,
requirement linking, step colors, Slack — runs inside GitHub Actions via a single
script. Pulse upload actions (3–6) are not used.

```
qTest Scenario saves
        │
  Pulse ScenarioSaved
  → TriggerGitHubActions          ── OR ── manual workflow_dispatch
  → repository_dispatch
        │
        ▼
GitHub Actions: playwright-cucumber-qtest-direct.yml
  (Playwright + Cucumber tests)
        │
  scripts/post-to-qtest.js
  Format ▶ Upload ▶ LinkRequirements ▶ UpdateScenarioSteps ▶ Slack
        │
        ▼
  qTest Manager
```

**Requires:** Pulse with `ScenarioSaved` trigger + `TriggerGitHubActions` action only,
plus `QTEST_TOKEN` / `QTEST_MANAGER_URL` / `QTEST_PROJECT_ID` / `QTEST_TEST_CYCLE_ID` GitHub secrets.

---

## Choosing an approach

| | Approach A (Full Pulse) | Approach B (Pulse trigger only) |
|---|---|---|
| Pulse licence needed | Yes | Yes (trigger only) |
| Pulse actions used | 1, 2, 3, 4, 5, 6 | 2 only (`TriggerGitHubActions`) |
| GitHub secrets needed | `PULSE_WEBHOOK_URL` + project/cycle IDs | qTest token + URL + project/cycle IDs |
| Upload lives in | Pulse (visual pipeline) | GitHub Actions log |
| Requirement linking | Pulse action-5 | `post-to-qtest.js` (optional) |
| Step color updates | Pulse action-6 | `post-to-qtest.js` (optional) |
| Slack notifications | Pulse action-1 | `post-to-qtest.js` (optional) |
| Automatic trigger on Scenario save | Yes (via Pulse) | Yes (via Pulse action-2) |
| Manual trigger | `workflow_dispatch` | `workflow_dispatch` |

Both approaches share the same test code (`features/`, `tests/step-definitions/`, `src/mock-server/`).
You can run both workflows in the same repo or pick one and disable the other.

---

## Repository layout

**Shared**

| Path | What it is |
|---|---|
| [features/](features/) | `.feature` files (synced from qTest Scenario) |
| [tests/step-definitions/](tests/step-definitions/) | Playwright (`APIRequestContext`) steps + hooks |
| [src/mock-server/](src/mock-server/) | Mock API the tests run against |
| [config/cucumber.js](config/cucumber.js) | Cucumber configuration |

**Approach A — Full Pulse**

| Path | What it is |
|---|---|
| [.github/workflows/playwright-cucumber-qtest-pulse.yml](.github/workflows/playwright-cucumber-qtest-pulse.yml) | GitHub Actions workflow — runs tests, POSTs report to Pulse |
| [scripts/post-to-pulse.js](scripts/post-to-pulse.js) | base64 report → POST to Pulse webhook |
| [pulse/scenario-playwright-github-pulse.json](pulse/scenario-playwright-github-pulse.json) | Import into Pulse — all 6 actions (trigger + full upload chain) |
| [pulse/actions/](pulse/actions/) | Readable source of actions 1–6; edit here, paste into Pulse UI |

**Approach B — Direct upload (Pulse trigger only)**

| Path | What it is |
|---|---|
| [.github/workflows/playwright-cucumber-qtest-direct.yml](.github/workflows/playwright-cucumber-qtest-direct.yml) | GitHub Actions workflow — runs tests, calls post-to-qtest.js |
| [scripts/post-to-qtest.js](scripts/post-to-qtest.js) | Full upload chain: format → upload → link → step colors → Slack |
| [pulse/scenario-playwright-github-manager.json](pulse/scenario-playwright-github-manager.json) | Import into Pulse — actions 1+2 only (trigger + Slack) |

**Reference**

| Path | What it is |
|---|---|
| [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) | Full setup, architecture, and troubleshooting |

---

## Quick start (local)

```bash
npm ci
npm test                 # runs tests, prints progress bar
npm run test:report      # also writes reports/cucumber-report.json
```

The hooks start the bundled mock server on port 3000. Steps use Playwright's `APIRequestContext`
(HTTP only) — **no browser binaries needed**.

Then follow [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) to configure the approach of your choice.

---

## Notes

- `features/Account_Profile_Management.feature` needs step definitions before it can run.
- `features/UserAuthentication.feature` scenarios that use `@username`/`@password` require
  those placeholders to be replaced with real quoted values (e.g. `"testuser@example.com"`).

## License

MIT — see [LICENSE](LICENSE).
