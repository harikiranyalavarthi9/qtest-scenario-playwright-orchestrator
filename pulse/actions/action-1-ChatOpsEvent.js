/**
 * Pulse Action: ChatOpsEvent
 * Send notifications to Slack
 *
 * This file is a readable copy of the action code embedded in
 * scenario-playwright-github-pulse.json and scenario-playwright-github-manager.json.
 * Edit here, then copy the contents into the JSON action code field.
 */

const request = require('request');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    const message = body.message || JSON.stringify(body);
    const webhook = constants.ChatOpsWebhook;

    if (!webhook) {
        console.log('[WARN] ChatOpsWebhook not configured, skipping notification');
        return;
    }

    request({
        uri: webhook,
        method: 'POST',
        json: { text: message, mrkdwn: true }
    }, function (err) {
        if (err) {
            console.log('[ERROR] Slack send failed:', err);
        } else {
            console.log('[INFO] Slack message sent');
        }
    });
};
