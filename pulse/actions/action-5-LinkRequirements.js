/**
 * Pulse Action: LinkRequirements
 * Link test cases to matching requirements imported from Jira in qTest
 *
 * This file is a readable copy of the action code embedded in scenario-playwright-github-pulse.json.
 * Edit here, then copy the contents into the JSON action code field.
 */

const request = require('request');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    var projectId = body.projectId;
    var testLogs = body.logs;

    var headers = {
        'Content-Type': 'application/json',
        'Authorization': 'bearer ' + constants.QTEST_TOKEN,
        'x-scenario-project-id': constants.SCENARIO_PROJECT_ID
    };

    request.get({
        url: constants.Scenario_URL + '/api/features',
        headers: headers
    }, function (err, response, resBody) {
        if (err) {
            console.log('[ERROR] Failed to get features:', err);
            emitEvent('ChatOpsEvent', { message: '[ERROR] Could not retrieve features: ' + err });
            return;
        }

        var features;
        try {
            features = JSON.parse(resBody);
        } catch (e) {
            console.log('[ERROR] Failed to parse features:', e.message);
            emitEvent('ChatOpsEvent', { message: '[ERROR] Invalid features response' });
            return;
        }

        console.log('[INFO] Retrieved ' + features.length + ' features from Scenario');
        linkTestCasesToRequirements(features);
    });

    function linkTestCasesToRequirements(features) {
        testLogs.forEach(function (testLog) {
            var matching = features.filter(function (f) {
                return f.name === testLog.featureName;
            });

            if (matching.length === 0) {
                console.log('[INFO] No matching feature for: ' + testLog.name);
                return;
            }

            matching.forEach(function (feature) {
                findAndLinkRequirement(feature.issueKey, testLog.name);
            });
        });

        emitEvent('UpdateScenarioSteps', body);
    }

    function findAndLinkRequirement(issueKey, testCaseName) {
        request.post({
            url: 'https://' + constants.ManagerURL + '/api/v3/projects/' + projectId + '/search',
            json: true,
            headers: headers,
            body: {
                object_type: 'requirements',
                fields: ['*'],
                query: "Name ~ '" + issueKey + "'"
            }
        }, function (err, response, reqResult) {
            if (err || !reqResult.items || reqResult.items.length === 0) {
                console.log('[INFO] No requirement found for: ' + issueKey);
                return;
            }

            var reqId = reqResult.items[0].id;

            request.post({
                url: 'https://' + constants.ManagerURL + '/api/v3/projects/' + projectId + '/search',
                json: true,
                headers: headers,
                body: {
                    object_type: 'test-cases',
                    fields: ['*'],
                    query: "Name = '" + testCaseName + "'"
                }
            }, function (tcErr, tcResponse, tcResult) {
                if (tcErr || !tcResult.items || tcResult.items.length === 0) {
                    console.log('[INFO] Test case not yet in qTest: ' + testCaseName);
                    return;
                }

                var tcId = tcResult.items[0].id;

                request.post({
                    url: 'https://' + constants.ManagerURL + '/api/v3/projects/' + projectId + '/requirements/' + reqId + '/link?type=test-cases',
                    json: true,
                    headers: headers,
                    body: [tcId]
                }, function (linkErr) {
                    if (linkErr) {
                        console.log('[ERROR] Link failed:', linkErr);
                        return;
                    }
                    console.log('[SUCCESS] Linked TC "' + testCaseName + '" to requirement "' + issueKey + '"');
                    emitEvent('ChatOpsEvent', { message: '[SUCCESS] Linked: ' + testCaseName + ' -> ' + issueKey });
                });
            });
        });
    }
};
