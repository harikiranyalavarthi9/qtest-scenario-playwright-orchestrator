/**
 * Pulse Action: UpdateScenarioSteps
 * Update Scenario step status colors based on test results
 * Uses direct HTTP calls instead of SDK (SDK hardcodes an outdated Scenario URL)
 *
 * Fetches ALL steps once upfront and matches client-side to avoid
 * Cloudflare WAF blocking on query strings containing email addresses.
 *
 * This file is a readable copy of the action code embedded in scenario-playwright-github-pulse.json.
 * Edit here, then copy the contents into the JSON action code field.
 */

const request = require('request');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        var t = triggers.find(function (tr) { return tr.name === name; });
        return t && new Webhooks().invoke(t, payload);
    }

    var testLogs = body.logs;
    if (!testLogs || !Array.isArray(testLogs) || testLogs.length === 0) {
        console.log('[WARN] No test logs provided');
        emitEvent('ChatOpsEvent', { message: ':warning: *Scenario Steps Update*\nNo test logs to process.' });
        return;
    }

    var scenarioURL = constants.Scenario_URL;
    var projectId = constants.SCENARIO_PROJECT_ID;
    var token = constants.QTEST_TOKEN;

    if (!scenarioURL || !projectId || !token) {
        var missing = [];
        if (!scenarioURL) missing.push('Scenario_URL');
        if (!projectId) missing.push('SCENARIO_PROJECT_ID');
        if (!token) missing.push('QTEST_TOKEN');
        console.log('[ERROR] Missing constants: ' + missing.join(', '));
        emitEvent('ChatOpsEvent', {
            message: ':x: *Scenario Steps Update Failed*\nMissing configuration: `' + missing.join('`, `') + '`'
        });
        return;
    }

    scenarioURL = scenarioURL.replace(/\/+$/, '');

    var headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'x-scenario-project-id': projectId
    };

    // Track results for the summary
    var results = { updated: [], failed: [], notFound: [] };

    getAllSteps(scenarioURL, headers).then(function (allSteps) {
        console.log('[INFO] Fetched ' + allSteps.length + ' steps from Scenario');

        if (allSteps.length === 0) {
            console.log('[WARN] No steps found in Scenario project');
            emitEvent('ChatOpsEvent', {
                message: ':warning: *Scenario Steps Update*\nNo steps found in the Scenario project. Verify the project ID.'
            });
            return;
        }

        var promises = [];

        testLogs.forEach(function (log) {
            if (!log.test_step_logs || !Array.isArray(log.test_step_logs)) return;

            log.test_step_logs.forEach(function (step) {
                var name = step.description ? step.description.trim() : '';
                if (!name) return;

                var keyword = step.keyword || '';
                if (keyword === 'Before' || keyword === 'After') return;

                var searchText = name;
                var kwTrimmed = keyword.trim();
                if (kwTrimmed && searchText.startsWith(kwTrimmed + ' ')) {
                    searchText = searchText.slice(kwTrimmed.length + 1);
                }

                var status = step.status ? step.status.toUpperCase() : 'FAILED';
                if (status === 'UNDEFINED') status = 'FAILED';

                var matched = allSteps.filter(function (s) {
                    var textMatch = s.text && s.text.trim() === searchText.trim();
                    if (!textMatch) return false;
                    if (kwTrimmed && s.keyword) {
                        return s.keyword.trim() === kwTrimmed;
                    }
                    return true;
                });

                if (matched.length === 0) {
                    console.log('[WARN] No matching step found for: "' + name + '"');
                    results.notFound.push(name);
                    return;
                }

                matched.forEach(function (s) {
                    var p = updateStep(scenarioURL, headers, s.id, Object.assign({}, s, { status: status }))
                        .then(function () {
                            console.log('[OK] Updated step "' + name + '" -> ' + status);
                            results.updated.push({ name: name, status: status });
                        })
                        .catch(function (err) {
                            var errMsg = err.message || String(err);
                            console.log('[ERROR] Failed to update step "' + name + '":', errMsg);
                            results.failed.push({ name: name, error: errMsg });
                        });
                    promises.push(p);
                });
            });
        });

        return Promise.all(promises);
    })
    .then(function () {
        console.log('[SUCCESS] All scenario steps processed');
        emitEvent('ChatOpsEvent', { message: buildSummary(results) });
    })
    .catch(function (err) {
        var errMsg = err.message || String(err);
        console.log('[ERROR] Step update error:', errMsg);
        emitEvent('ChatOpsEvent', {
            message: ':x: *Scenario Steps Update Failed*\n' + errMsg
        });
    });
};

function buildSummary(results) {
    var icon = results.failed.length > 0 ? ':warning:' : ':white_check_mark:';
    var lines = [];

    lines.push(icon + ' *Scenario Steps Update Summary*');
    lines.push('');

    // Updated steps grouped by status
    if (results.updated.length > 0) {
        var byStatus = {};
        results.updated.forEach(function (u) {
            if (!byStatus[u.status]) byStatus[u.status] = [];
            byStatus[u.status].push(u.name);
        });

        Object.keys(byStatus).forEach(function (status) {
            var statusIcon = status === 'PASSED' ? ':large_green_circle:'
                : status === 'FAILED' ? ':red_circle:'
                : ':white_circle:';
            lines.push(statusIcon + ' *' + status + '* (' + byStatus[status].length + ' steps)');
            byStatus[status].forEach(function (name) {
                lines.push('    ' + name);
            });
        });
    }

    // Failed updates
    if (results.failed.length > 0) {
        lines.push('');
        lines.push(':x: *Update Errors* (' + results.failed.length + ')');
        results.failed.forEach(function (f) {
            lines.push('    ' + f.name + ' — `' + f.error + '`');
        });
    }

    // Not found (only show count to keep it clean)
    if (results.notFound.length > 0) {
        lines.push('');
        lines.push(':mag: *Not Found in Scenario* (' + results.notFound.length + ' steps skipped)');
    }

    // Totals
    lines.push('');
    lines.push('*Totals:* ' + results.updated.length + ' updated | '
        + results.failed.length + ' errors | '
        + results.notFound.length + ' not found');

    return lines.join('\n');
}

function getAllSteps(scenarioURL, headers) {
    return new Promise(function (resolve, reject) {
        request({
            url: scenarioURL + '/api/steps',
            method: 'GET',
            headers: headers,
            json: true,
            timeout: 30000
        }, function (err, response, resBody) {
            if (err) {
                if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
                    return reject(new Error('Scenario API timed out fetching steps'));
                }
                return reject(new Error('Scenario API request failed: ' + (err.message || err)));
            }
            if (!response) {
                return reject(new Error('No response received from Scenario API'));
            }
            if (response.statusCode >= 400) {
                var detail = typeof resBody === 'string' ? resBody.substring(0, 200) : JSON.stringify(resBody);
                return reject(new Error('GET /api/steps failed (' + response.statusCode + '): ' + detail));
            }
            resolve(Array.isArray(resBody) ? resBody : []);
        });
    });
}

function updateStep(scenarioURL, headers, stepId, stepData) {
    return new Promise(function (resolve, reject) {
        request({
            url: scenarioURL + '/api/steps/' + stepId,
            method: 'PUT',
            headers: headers,
            json: true,
            body: stepData,
            timeout: 15000
        }, function (err, response, resBody) {
            if (err) {
                if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
                    return reject(new Error('Timeout updating step ' + stepId));
                }
                return reject(new Error('Request failed: ' + (err.message || err)));
            }
            if (!response) {
                return reject(new Error('No response for step ' + stepId));
            }
            if (response.statusCode >= 400) {
                var detail = typeof resBody === 'string' ? resBody.substring(0, 200) : JSON.stringify(resBody);
                return reject(new Error('PUT step ' + stepId + ' failed (' + response.statusCode + '): ' + detail));
            }
            resolve(resBody);
        });
    });
}
