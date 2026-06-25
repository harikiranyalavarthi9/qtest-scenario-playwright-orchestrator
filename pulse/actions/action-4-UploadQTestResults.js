/**
 * Pulse Action: UploadQTestResults
 * Upload formatted test results to qTest Manager and monitor queue
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

    var projectId = body.projectId || constants.QTEST_PROJECT_ID;
    var cycleId = body.testcycle || constants.QTEST_TEST_CYCLE_ID;
    var testLogs = body.logs;
    var MAX_RETRIES = 30;

    var headers = {
        'Content-Type': 'application/json',
        'Authorization': 'bearer ' + constants.QTEST_TOKEN
    };

    request.post({
        url: 'https://' + constants.ManagerURL + '/api/v3/projects/' + projectId + '/auto-test-logs?type=automation',
        json: true,
        headers: headers,
        body: { test_cycle: cycleId, test_logs: testLogs }
    }, function (err, response, resBody) {
        if (err) {
            console.log('[ERROR] Upload failed:', err);
            emitEvent('ChatOpsEvent', { message: '[ERROR] qTest upload failed: ' + err });
            return;
        }

        if (resBody.type === 'AUTOMATION_TEST_LOG') {
            queueId = resBody.id;
            console.log('[INFO] Results queued. ID: ' + queueId);
            emitEvent('ChatOpsEvent', { message: '[INFO] Results queued in qTest. ID: ' + queueId });
            pollQueue(queueId, 0);
        } else {
            console.log('[ERROR] Unexpected response (status ' + response.statusCode + '):', JSON.stringify(resBody));
            emitEvent('ChatOpsEvent', { message: '[ERROR] qTest upload failed. Status: ' + response.statusCode + ' Body: ' + JSON.stringify(resBody) });
        }
    });

    function pollQueue(queueId, attempt) {
        if (attempt >= MAX_RETRIES) {
            console.log('[WARN] Queue polling timed out for ID: ' + queueId);
            emitEvent('ChatOpsEvent', { message: '[WARN] Queue processing timed out' });
            return;
        }

        setTimeout(function () {
            request({
                url: 'https://' + constants.ManagerURL + '/api/v3/projects/queue-processing/' + queueId,
                json: true,
                headers: headers
            }, function (err, response, resBody) {
                if (err) {
                    console.log('[ERROR] Queue check failed:', err);
                    return;
                }

                var state = resBody.state;
                console.log('[INFO] Queue ' + queueId + ' state: ' + state);

                if (state === 'FAILED') {
                    console.log('[ERROR] Queue failed:', resBody.content);
                    emitEvent('ChatOpsEvent', { message: '[ERROR] Queue processing failed: ' + resBody.content });
                } else if (state === 'IN_WAITING' || state === 'IN_PROCESSING' || state === 'PENDING') {
                    pollQueue(queueId, attempt + 1);
                } else {
                    console.log('[SUCCESS] Queue processing complete. State: ' + state);
                    emitEvent('ChatOpsEvent', { message: '[SUCCESS] Test results processed in qTest' });
                    emitEvent('LinkRequirements', body);
                }
            });
        }, 2000);
    }
};
