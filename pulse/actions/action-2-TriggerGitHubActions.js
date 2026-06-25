/**
 * Pulse Action: TriggerGitHubActions
 * Trigger the GitHub Actions workflow via the repository_dispatch API.
 *
 * Equivalent of:
 *   curl -X POST \
 *     -H "Authorization: Bearer <GITHUB_PAT>" \
 *     -H "Accept: application/vnd.github+json" \
 *     https://api.github.com/repos/<owner>/<repo>/dispatches \
 *     -d '{"event_type":"run-tests"}'
 *
 * Pulse constants:
 *   GitHubToken      - GitHub PAT with 'repo' (classic) or 'actions: write' (fine-grained) scope
 *   GitHubRepo       - "owner/repo" (e.g. harikiranyalavarthi9/qtest-scenario-playwright-orchestrator)
 *   GitHubEventType  - repository_dispatch event type (default: run-tests)
 *   GitHubAPIURL     - GitHub REST API base URL (default: https://api.github.com).
 *                      Set to https://<hostname>/api/v3 for GitHub Enterprise Server.
 *
 * This file is a readable copy of the action code embedded in
 * scenario-playwright-github-pulse.json and scenario-playwright-github-manager.json.
 * Edit here, then copy into the JSON action code field in both files.
 */

const request = require('request');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    const token = constants.GitHubToken;
    const repo = constants.GitHubRepo;
    const eventType = constants.GitHubEventType || 'run-tests';
    const apiBase = (constants.GitHubAPIURL || 'https://api.github.com').replace(/\/+$/, '');

    if (!token || !repo) {
        console.log('[ERROR] Missing GitHub configuration (GitHubToken / GitHubRepo)');
        emitEvent('ChatOpsEvent', { message: '[ERROR] GitHub Actions trigger config incomplete' });
        return;
    }

    const url = apiBase + '/repos/' + repo + '/dispatches';
    console.log('[INFO] Dispatching GitHub Actions for ' + repo + ' via ' + apiBase + ' (event_type: ' + eventType + ')');

    request({
        url: url,
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            // GitHub's API rejects requests without a User-Agent header.
            'User-Agent': 'qTest-Pulse',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            event_type: eventType,
            client_payload: {
                source: 'qTest Scenario',
                scenarioId: body && body.id,
                triggeredAt: new Date().toISOString()
            }
        })
    }, function (err, res, responseBody) {
        if (err) {
            console.log('[ERROR] GitHub dispatch failed:', err);
            emitEvent('ChatOpsEvent', { message: '[ERROR] GitHub Actions trigger failed: ' + err });
            return;
        }

        // The dispatches API returns 204 No Content on success.
        if (res.statusCode === 204) {
            console.log('[SUCCESS] GitHub Actions workflow dispatched');
            emitEvent('ChatOpsEvent', { message: '[SUCCESS] GitHub Actions triggered (event_type: ' + eventType + ')' });
        } else {
            console.log('[ERROR] GitHub returned status: ' + res.statusCode + ' body: ' + responseBody);
            emitEvent('ChatOpsEvent', { message: '[ERROR] GitHub Actions trigger failed. Status: ' + res.statusCode + ' ' + responseBody });
        }
    });
};
