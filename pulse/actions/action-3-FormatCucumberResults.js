/**
 * Pulse Action: FormatCucumberResults
 * Parse Cucumber JSON from GitHub Actions and format for qTest
 *
 * This file is a readable copy of the action code embedded in scenario-playwright-github-pulse.json.
 * Edit here, then copy the contents into the JSON action code field.
 */

const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    var projectId = body.projectId || constants.QTEST_PROJECT_ID;
    var cycleId = body.testcycle || constants.QTEST_TEST_CYCLE_ID;
    var testResults = [];

    try {
        if (body.result) {
            var decoded = Buffer.from(body.result, 'base64').toString('utf-8');
            testResults = JSON.parse(decoded);
        }
    } catch (e) {
        console.log('[ERROR] Failed to parse results:', e.message);
        emitEvent('ChatOpsEvent', { message: '[ERROR] Invalid test results: ' + e.message });
        return;
    }

    var testLogs = [];
    var passed = 0;
    var failed = 0;
    var skipped = 0;

    testResults.forEach(function (feature) {
        var featureName = feature.name || 'Unknown Feature';
        var featureUri = feature.uri || '';

        if (!feature.elements) {
            return;
        }

        feature.elements.forEach(function (scenario) {
            if (!scenario.name) scenario.name = 'Unnamed Scenario';

            var scenarioStatus = 'passed';
            var stepLogs = [];
            var stepOrder = 0;
            var stepNames = [];
            var attachments = [];

            if (!scenario.steps) return;

            scenario.steps.forEach(function (step) {
                var name = step.name || 'Unknown Step';
                var keyword = step.keyword || '';
                stepNames.push(keyword + name);

                var status = 'passed';
                var actual = keyword + name;

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

                if (step.embeddings && Array.isArray(step.embeddings)) {
                    step.embeddings.forEach(function (emb, i) {
                        attachments.push({
                            name: name + ' Attachment ' + (i + 1),
                            content_type: emb.mime_type || 'application/octet-stream',
                            data: emb.data
                        });
                    });
                }

                stepLogs.push({
                    order: stepOrder++,
                    description: keyword + name,
                    expected_result: (step.match && step.match.location) ? step.match.location : keyword + name,
                    actual_result: actual,
                    status: status,
                    keyword: keyword
                });
            });

            if (scenarioStatus === 'passed') passed++;
            else if (scenarioStatus === 'failed') failed++;
            else skipped++;

            testLogs.push({
                exe_start_date: new Date().toISOString(),
                exe_end_date: new Date().toISOString(),
                module_names: [featureName],
                name: scenario.name,
                automation_content: featureUri + '#' + scenario.name,
                attachments: attachments,
                description: stepNames.join('<br/>'),
                status: scenarioStatus,
                test_step_logs: stepLogs,
                featureName: featureName
            });
        });
    });

    var total = passed + failed + skipped;
    console.log('[INFO] Formatted: Total=' + total + ' Passed=' + passed + ' Failed=' + failed + ' Skipped=' + skipped);
    emitEvent('ChatOpsEvent', {
        message: 'Test Summary: ' + total + ' total, ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped'
    });

    emitEvent('UploadQTestResults', {
        projectId: projectId,
        testcycle: cycleId,
        logs: testLogs,
        summary: { total: total, passed: passed, failed: failed, skipped: skipped }
    });
};
