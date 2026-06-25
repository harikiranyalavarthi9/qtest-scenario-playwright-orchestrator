/**
 * post-to-qtest.js — Pulse-free qTest results upload
 *
 * Reads reports/cucumber-report.json, formats the results, uploads them to
 * qTest Manager, optionally links test cases to requirements, and optionally
 * updates qTest Scenario step colors — all in a single Node.js process.
 *
 * This replicates the full qTest Pulse action chain (actions 3-6) with no
 * dependency on qTest Pulse. Run it from GitHub Actions (or locally) after
 * `npm test` writes the Cucumber JSON report.
 *
 * Required environment variables:
 *   QTEST_TOKEN          qTest API bearer token
 *   QTEST_MANAGER_URL    qTest Manager host only, e.g. myorg.qtestnet.com
 *   QTEST_PROJECT_ID     Numeric qTest project ID
 *   QTEST_TEST_CYCLE_ID  Target test cycle ID
 *
 * Optional environment variables:
 *   QTEST_SCENARIO_URL   Scenario base URL, e.g. https://scenario-v2-0-us-east-1.qtestnet.com
 *                        When set, enables requirement linking AND step colour updates.
 *   SCENARIO_PROJECT_ID  Scenario project UUID (required when QTEST_SCENARIO_URL is set)
 *   SLACK_WEBHOOK_URL    Slack incoming-webhook URL for notifications
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');
const { URL } = require('url');

// ── Configuration ─────────────────────────────────────────────────────────────

const QTEST_TOKEN         = process.env.QTEST_TOKEN;
const QTEST_MANAGER_URL   = (process.env.QTEST_MANAGER_URL   || '').replace(/\/+$/, '');
const QTEST_PROJECT_ID    = process.env.QTEST_PROJECT_ID;
const QTEST_TEST_CYCLE_ID = process.env.QTEST_TEST_CYCLE_ID;
const SCENARIO_URL        = (process.env.QTEST_SCENARIO_URL  || '').replace(/\/+$/, '');
const SCENARIO_PROJECT_ID = process.env.SCENARIO_PROJECT_ID  || '';
const SLACK_WEBHOOK       = process.env.SLACK_WEBHOOK_URL    || '';
const REPORT_FILE         = path.join(__dirname, '..', 'reports', 'cucumber-report.json');
const MAX_RETRIES         = 30;

// ── Validation ────────────────────────────────────────────────────────────────

const missing = [];
if (!QTEST_TOKEN)         missing.push('QTEST_TOKEN');
if (!QTEST_MANAGER_URL)   missing.push('QTEST_MANAGER_URL');
if (!QTEST_PROJECT_ID)    missing.push('QTEST_PROJECT_ID');
if (!QTEST_TEST_CYCLE_ID) missing.push('QTEST_TEST_CYCLE_ID');
if (missing.length) {
    console.error('[ERROR] Missing required env vars: ' + missing.join(', '));
    process.exit(1);
}
if (!fs.existsSync(REPORT_FILE)) {
    console.error('[ERROR] Report not found: ' + REPORT_FILE);
    process.exit(1);
}
if (SCENARIO_URL && !SCENARIO_PROJECT_ID) {
    console.warn('[WARN] QTEST_SCENARIO_URL is set but SCENARIO_PROJECT_ID is missing — skipping Scenario features');
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function apiRequest(method, urlStr, body, extraHeaders) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const lib = u.protocol === 'http:' ? http : https;
        const payload = body != null ? JSON.stringify(body) : null;
        const options = {
            method,
            hostname: u.hostname,
            port: u.port || (u.protocol === 'http:' ? 80 : 443),
            path: u.pathname + u.search,
            headers: Object.assign({
                'Content-Type':  'application/json',
                'Authorization': 'bearer ' + QTEST_TOKEN
            }, extraHeaders || {})
        };
        if (payload) {
            options.headers['Content-Length'] = Buffer.byteLength(payload);
        }
        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => {
                let json = null;
                try { if (data) json = JSON.parse(data); } catch {}
                resolve({ status: res.statusCode, json, raw: data });
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => req.destroy(new Error('Request timed out: ' + urlStr)));
        if (payload) req.write(payload);
        req.end();
    });
}

// ── Step 1: Parse Cucumber report → qTest log format (mirrors action-3) ───────

function formatResults(rawJson) {
    const features = JSON.parse(rawJson);
    const testLogs = [];
    let passed = 0, failed = 0, skipped = 0;

    features.forEach(feature => {
        const featureName = feature.name || 'Unknown Feature';
        const featureUri  = feature.uri  || '';
        if (!feature.elements) return;

        feature.elements.forEach(scenario => {
            if (!scenario.name) scenario.name = 'Unnamed Scenario';
            if (!scenario.steps) return;

            let scenarioStatus = 'passed';
            let stepOrder = 0;
            const stepLogs    = [];
            const stepNames   = [];
            const attachments = [];

            scenario.steps.forEach(step => {
                const keyword = step.keyword || '';
                const name    = step.name    || 'Unknown Step';
                stepNames.push(keyword + name);

                let status = 'passed';
                let actual = keyword + name;

                if (!step.result) {
                    status = 'skipped';
                    if (scenarioStatus !== 'failed') scenarioStatus = 'skipped';
                } else {
                    status = step.result.status || 'passed';
                    if (status === 'failed') {
                        scenarioStatus = 'failed';
                        actual = step.result.error_message || 'Step failed';
                    } else if (status === 'skipped' || status === 'pending') {
                        status = 'skipped';
                        if (scenarioStatus !== 'failed') scenarioStatus = 'skipped';
                    } else if (status === 'undefined') {
                        scenarioStatus = 'failed';
                        status = 'failed';
                        actual = 'Step definition not found';
                    }
                }

                if (Array.isArray(step.embeddings)) {
                    step.embeddings.forEach((emb, i) => {
                        attachments.push({
                            name:         name + ' Attachment ' + (i + 1),
                            content_type: emb.mime_type || 'application/octet-stream',
                            data:         emb.data
                        });
                    });
                }

                stepLogs.push({
                    order:           stepOrder++,
                    description:     keyword + name,
                    expected_result: (step.match && step.match.location) || keyword + name,
                    actual_result:   actual,
                    status,
                    keyword
                });
            });

            if      (scenarioStatus === 'passed') passed++;
            else if (scenarioStatus === 'failed') failed++;
            else                                   skipped++;

            testLogs.push({
                exe_start_date:     new Date().toISOString(),
                exe_end_date:       new Date().toISOString(),
                module_names:       [featureName],
                name:               scenario.name,
                automation_content: featureUri + '#' + scenario.name,
                attachments,
                description:        stepNames.join('<br/>'),
                status:             scenarioStatus,
                test_step_logs:     stepLogs,
                featureName
            });
        });
    });

    const total = passed + failed + skipped;
    console.log('[INFO] Parsed: total=' + total + ' passed=' + passed + ' failed=' + failed + ' skipped=' + skipped);
    return { testLogs, summary: { total, passed, failed, skipped } };
}

// ── Step 2: Upload to qTest Manager and poll queue (mirrors action-4) ─────────

async function uploadToQTest(testLogs) {
    const url = 'https://' + QTEST_MANAGER_URL +
        '/api/v3/projects/' + QTEST_PROJECT_ID + '/auto-test-logs?type=automation';

    console.log('[INFO] Uploading ' + testLogs.length + ' test log(s) to qTest Manager');
    const res = await apiRequest('POST', url, {
        test_cycle: QTEST_TEST_CYCLE_ID,
        test_logs:  testLogs
    });

    if (!res.json || res.json.type !== 'AUTOMATION_TEST_LOG') {
        throw new Error('Upload failed (HTTP ' + res.status + '): ' + res.raw.slice(0, 300));
    }

    const queueId = res.json.id;
    console.log('[INFO] Results queued. Queue ID: ' + queueId);
    await pollQueue(queueId, 0);
}

async function pollQueue(queueId, attempt) {
    if (attempt >= MAX_RETRIES) {
        throw new Error('Queue timed out after ' + MAX_RETRIES + ' polls (queue ID: ' + queueId + ')');
    }
    await sleep(2000);
    const url = 'https://' + QTEST_MANAGER_URL + '/api/v3/projects/queue-processing/' + queueId;
    const res = await apiRequest('GET', url);
    const state = (res.json && res.json.state) || 'UNKNOWN';
    console.log('[INFO] Queue ' + queueId + ' state: ' + state + ' (attempt ' + (attempt + 1) + '/' + MAX_RETRIES + ')');

    if (state === 'FAILED') {
        throw new Error('Queue processing failed: ' + (res.json && res.json.content));
    }
    if (state === 'IN_WAITING' || state === 'IN_PROCESSING' || state === 'PENDING') {
        return pollQueue(queueId, attempt + 1);
    }
    console.log('[SUCCESS] Results processed by qTest (state: ' + state + ')');
}

// ── Step 3 (optional): Link test cases to requirements (mirrors action-5) ─────

async function linkRequirements(testLogs) {
    if (!SCENARIO_URL || !SCENARIO_PROJECT_ID) return;
    const scenarioHeaders = { 'x-scenario-project-id': SCENARIO_PROJECT_ID };

    let features;
    try {
        const res = await apiRequest('GET', SCENARIO_URL + '/api/features', null, scenarioHeaders);
        if (res.status >= 400) throw new Error('HTTP ' + res.status);
        features = Array.isArray(res.json) ? res.json : [];
    } catch (e) {
        console.warn('[WARN] Could not fetch Scenario features — skipping requirement linking: ' + e.message);
        return;
    }
    console.log('[INFO] Linking requirements — ' + features.length + ' feature(s) in Scenario');

    for (const log of testLogs) {
        const matching = features.filter(f => f.name === log.featureName);
        for (const feature of matching) {
            await linkOne(feature.issueKey, log.name, scenarioHeaders).catch(e => {
                console.warn('[WARN] Link failed for "' + log.name + '": ' + e.message);
            });
        }
    }
}

async function linkOne(issueKey, testCaseName, scenarioHeaders) {
    const searchUrl = 'https://' + QTEST_MANAGER_URL +
        '/api/v3/projects/' + QTEST_PROJECT_ID + '/search';
    const escKey  = issueKey.replace(/'/g, "\\'");
    const escName = testCaseName.replace(/'/g, "\\'");

    const reqRes = await apiRequest('POST', searchUrl, {
        object_type: 'requirements', fields: ['*'],
        query: "Name ~ '" + escKey + "'"
    }, scenarioHeaders);
    if (!reqRes.json || !reqRes.json.items || reqRes.json.items.length === 0) {
        console.log('[INFO] No requirement found for key: ' + issueKey);
        return;
    }
    const reqId = reqRes.json.items[0].id;

    const tcRes = await apiRequest('POST', searchUrl, {
        object_type: 'test-cases', fields: ['*'],
        query: "Name = '" + escName + "'"
    }, scenarioHeaders);
    if (!tcRes.json || !tcRes.json.items || tcRes.json.items.length === 0) {
        console.log('[INFO] Test case not yet in qTest: ' + testCaseName);
        return;
    }
    const tcId = tcRes.json.items[0].id;

    const linkUrl = 'https://' + QTEST_MANAGER_URL +
        '/api/v3/projects/' + QTEST_PROJECT_ID +
        '/requirements/' + reqId + '/link?type=test-cases';
    await apiRequest('POST', linkUrl, [tcId], scenarioHeaders);
    console.log('[SUCCESS] Linked "' + testCaseName + '" → "' + issueKey + '"');
}

// ── Step 4 (optional): Update Scenario step colors (mirrors action-6) ─────────

async function updateScenarioSteps(testLogs) {
    if (!SCENARIO_URL || !SCENARIO_PROJECT_ID) return;
    const scenarioHeaders = { 'x-scenario-project-id': SCENARIO_PROJECT_ID };

    let allSteps;
    try {
        const res = await apiRequest('GET', SCENARIO_URL + '/api/steps', null, scenarioHeaders);
        if (res.status >= 400) throw new Error('HTTP ' + res.status);
        allSteps = Array.isArray(res.json) ? res.json : [];
    } catch (e) {
        console.warn('[WARN] Could not fetch Scenario steps — skipping step color update: ' + e.message);
        return;
    }
    console.log('[INFO] Updating step colors — ' + allSteps.length + ' step(s) in Scenario');

    const updates = [];
    for (const log of testLogs) {
        if (!Array.isArray(log.test_step_logs)) continue;
        for (const step of log.test_step_logs) {
            const desc = (step.description || '').trim();
            if (!desc) continue;
            const kw = (step.keyword || '').trim();
            if (kw === 'Before' || kw === 'After') continue;

            const searchText = kw && desc.startsWith(kw + ' ')
                ? desc.slice(kw.length + 1)
                : desc;

            let status = (step.status || 'failed').toUpperCase();
            if (status === 'UNDEFINED') status = 'FAILED';

            const matched = allSteps.filter(s => {
                if (!s.text || s.text.trim() !== searchText.trim()) return false;
                return !kw || !s.keyword || s.keyword.trim() === kw;
            });

            if (matched.length === 0) {
                console.log('[WARN] No matching Scenario step for: "' + desc + '"');
                continue;
            }

            for (const s of matched) {
                updates.push(
                    apiRequest('PUT', SCENARIO_URL + '/api/steps/' + s.id,
                        Object.assign({}, s, { status }),
                        scenarioHeaders)
                    .then(() => console.log('[OK] Step "' + desc + '" → ' + status))
                    .catch(e => console.warn('[WARN] Step update failed "' + desc + '": ' + e.message))
                );
            }
        }
    }
    await Promise.all(updates);
}

// ── Step 5 (optional): Slack notification (mirrors action-1) ──────────────────

async function notifySlack(message) {
    if (!SLACK_WEBHOOK) return;
    try {
        const u = new URL(SLACK_WEBHOOK);
        const lib = u.protocol === 'http:' ? http : https;
        const payload = JSON.stringify({ text: message, mrkdwn: true });
        await new Promise((resolve, reject) => {
            const req = lib.request({
                method: 'POST',
                hostname: u.hostname,
                port: u.port || 443,
                path: u.pathname + u.search,
                headers: {
                    'Content-Type':   'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            }, res => { res.resume(); res.on('end', resolve); });
            req.on('error', reject);
            req.setTimeout(10000, () => req.destroy());
            req.write(payload);
            req.end();
        });
        console.log('[INFO] Slack notified');
    } catch (e) {
        console.warn('[WARN] Slack notification failed: ' + e.message);
    }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('[INFO] Reading report: ' + REPORT_FILE);
    const rawJson = fs.readFileSync(REPORT_FILE, 'utf-8');

    const { testLogs, summary } = formatResults(rawJson);
    const summaryLine = 'Results: ' + summary.total + ' total | ' +
        summary.passed + ' passed | ' + summary.failed + ' failed | ' + summary.skipped + ' skipped';

    await notifySlack(':hourglass: *qTest upload starting*\n' + summaryLine);

    try {
        await uploadToQTest(testLogs);
        await linkRequirements(testLogs);
        await updateScenarioSteps(testLogs);

        const icon = summary.failed > 0 ? ':warning:' : ':white_check_mark:';
        console.log('[SUCCESS] ' + summaryLine);
        await notifySlack(icon + ' *qTest upload complete*\n' + summaryLine);
        process.exit(0);
    } catch (e) {
        console.error('[ERROR] ' + e.message);
        await notifySlack(':x: *qTest upload failed*\n' + e.message);
        process.exit(1);
    }
}

main();
