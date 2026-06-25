/**
 * Post Cucumber results to qTest Pulse.
 *
 * Reads reports/cucumber-report.json, base64-encodes it, and POSTs a payload to the
 * Pulse webhook (the "PulseWebhookReceived" trigger that feeds FormatCucumberResults).
 * This mirrors the GitLab CI "report" stage in the reference project.
 *
 * Required env vars (set as GitHub Actions secrets):
 *   PULSE_WEBHOOK_URL    - Pulse webhook endpoint URL (PulseWebhookReceived trigger)
 *   QTEST_PROJECT_ID     - qTest project ID
 *   QTEST_TEST_CYCLE_ID  - Target qTest test cycle ID
 *
 * Payload shape matches what the Pulse FormatCucumberResults action expects:
 *   { projectId, testcycle, result }   // result = base64(cucumber JSON)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const webhook = process.env.PULSE_WEBHOOK_URL;
const projectId = process.env.QTEST_PROJECT_ID || '';
const testcycle = process.env.QTEST_TEST_CYCLE_ID || '';
const reportPath = path.join(__dirname, '..', 'reports', 'cucumber-report.json');

if (!webhook) {
    console.error('[ERROR] PULSE_WEBHOOK_URL is not set — cannot post results to Pulse');
    process.exit(1);
}

if (!fs.existsSync(reportPath)) {
    console.error('[ERROR] Cucumber report not found at: ' + reportPath);
    process.exit(1);
}

const raw = fs.readFileSync(reportPath, 'utf-8');
const result = Buffer.from(raw, 'utf-8').toString('base64');
const payload = JSON.stringify({ projectId: projectId, testcycle: testcycle, result: result });

const u = new URL(webhook);
const lib = u.protocol === 'http:' ? http : https;

const options = {
    method: 'POST',
    hostname: u.hostname,
    port: u.port || (u.protocol === 'http:' ? 80 : 443),
    path: u.pathname + u.search,
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
};

console.log('[INFO] Posting ' + Buffer.byteLength(payload) + ' bytes to Pulse webhook: ' + u.hostname + u.pathname);

const req = lib.request(options, function (res) {
    let body = '';
    res.on('data', function (chunk) { body += chunk; });
    res.on('end', function () {
        console.log('[INFO] Pulse responded ' + res.statusCode + ': ' + body.substring(0, 300));
        if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[SUCCESS] Results delivered to Pulse');
            process.exit(0);
        } else {
            console.error('[ERROR] Pulse returned a non-2xx status');
            process.exit(1);
        }
    });
});

req.on('error', function (e) {
    console.error('[ERROR] POST to Pulse failed: ' + e.message);
    process.exit(1);
});

// Never let a stuck connection hang the CI job.
req.setTimeout(30000, function () {
    console.error('[ERROR] POST to Pulse timed out after 30s');
    req.destroy();
    process.exit(1);
});

req.write(payload);
req.end();
