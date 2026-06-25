const { Given, When, Then, Before, After } = require('@cucumber/cucumber');
const { request } = require('playwright');
const assert = require('assert');

let ctx = {};

Before(async function () {
    const baseURL = process.env.API_BASE_URL || 'http://localhost:3000';
    ctx = {
        baseURL: baseURL,
        api: await request.newContext({ baseURL: baseURL }),
        response: null,
        token: null
    };
});

After(async function () {
    if (ctx.api) {
        await ctx.api.dispose();
        ctx.api = null;
    }
});

// --- Background ---

Given('the authentication service is available', async function () {
    const res = await ctx.api.get('/health');
    assert.strictEqual(res.status(), 200, 'Auth service should be reachable');
});

Given('the API is accessible', async function () {
    const res = await ctx.api.get('/health');
    assert.strictEqual(res.status(), 200, 'API should be accessible');
});

Given('I set the base URL to the API gateway', function () {
    // baseURL is already configured on the Playwright request context (see Before hook)
    assert.ok(ctx.baseURL, 'Base URL should be set');
});

// --- Login page ---

Given('I am on the login page', async function () {
    const res = await ctx.api.get('/login');
    assert.strictEqual(res.status(), 200, 'Login page should load');
});

When('I enter username {string}', function (username) {
    ctx.username = username;
    assert.ok(username.length > 0, 'Username should not be empty');
});

When('I enter password {string}', function (password) {
    ctx.password = password;
    assert.ok(password.length > 0, 'Password should not be empty');
});

When('I click the login button', async function () {
    assert.ok(ctx.username, 'Username must be set before login');
    assert.ok(ctx.password, 'Password must be set before login');

    ctx.response = await ctx.api.post('/api/auth/login', {
        data: { username: ctx.username, password: ctx.password }
    });
});

// --- Login success assertions ---

Then('I should be authenticated successfully', async function () {
    assert.strictEqual(ctx.response.status(), 200);
    const data = await ctx.response.json();
    assert.ok(data.token, 'Response should contain auth token');
    ctx.token = data.token;
});

Then('I should be redirected to the dashboard', async function () {
    const data = await ctx.response.json();
    assert.ok(data.redirectUrl, 'Should have redirect URL');
    assert.ok(data.redirectUrl.includes('/dashboard'));
});

// --- Login failure assertions ---

Then('I should see an error message {string}', async function (expected) {
    assert.strictEqual(ctx.response.status(), 401);
    const data = await ctx.response.json();
    assert.ok(data.message);
    assert.ok(data.message.includes(expected),
        'Expected "' + expected + '", got "' + data.message + '"');
});

Then('I should remain on the login page', async function () {
    const data = await ctx.response.json();
    assert.ok(!data.token, 'No token should be returned');
    assert.ok(!data.redirectUrl, 'Should not redirect on failure');
});

// --- Session timeout ---

Given('I am authenticated and logged in', async function () {
    const res = await ctx.api.post('/api/auth/login', {
        data: { username: 'testuser@example.com', password: 'SecurePassword123' }
    });
    assert.strictEqual(res.status(), 200);
    const data = await res.json();
    ctx.token = data.token;
});

Given('my session has expired', async function () {
    await ctx.api.post('/api/auth/logout', {
        headers: { Authorization: 'Bearer ' + ctx.token }
    });
    ctx.token = null;
});

When('I attempt to access a protected resource', async function () {
    ctx.response = await ctx.api.get('/api/dashboard', {
        headers: ctx.token ? { Authorization: 'Bearer ' + ctx.token } : {}
    });
});

Then('I should be redirected to the login page', async function () {
    assert.strictEqual(ctx.response.status(), 401);
    const data = await ctx.response.json();
    assert.ok(data.redirectUrl);
    assert.ok(data.redirectUrl.includes('/login'));
});

Then('I should see a message {string}', async function (expected) {
    const data = await ctx.response.json();
    assert.ok(data.message);
    assert.ok(data.message.includes(expected));
});

// --- API Auth (from APIAuthFeature) ---

Given('I have valid user credentials', function () {
    ctx.credentials = { email: 'user@example.com', password: 'SecurePass123' };
});

When('I send a login request with email {string} and password {string}', async function (email, password) {
    ctx.response = await ctx.api.post('/api/auth/login', {
        data: { email: email, password: password }
    });
});

Then('the response status should be {int}', function (status) {
    assert.strictEqual(ctx.response.status(), status);
});

Then('the response should contain an auth token', async function () {
    const data = await ctx.response.json();
    assert.ok(data.token);
    ctx.token = data.token;
});

Then('the token should be valid JWT format', function () {
    assert.ok(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*$/.test(ctx.token));
});

Given('I have user credentials with email {string}', function (email) {
    ctx.email = email;
});

When('I send a login request with invalid password {string}', async function (password) {
    ctx.response = await ctx.api.post('/api/auth/login', {
        data: { email: ctx.email, password: password }
    });
});

Then('the response should contain error message {string}', async function (expected) {
    const data = await ctx.response.json();
    assert.ok(data.message);
    assert.ok(data.message.includes(expected));
});

Then('no auth token should be returned', async function () {
    const data = await ctx.response.json();
    assert.ok(!data || !data.token);
});

Given('I have a valid auth token', async function () {
    const res = await ctx.api.post('/api/auth/login', {
        data: { email: 'user@example.com', password: 'SecurePass123' }
    });
    const data = await res.json();
    ctx.token = data.token;
});

When('I send a refresh token request', async function () {
    ctx.response = await ctx.api.post('/api/auth/refresh', {
        headers: { Authorization: 'Bearer ' + ctx.token }
    });
});

Then('a new auth token should be returned', async function () {
    const data = await ctx.response.json();
    assert.ok(data.token);
    ctx.newToken = data.token;
});

Then('the new token should be different from the old one', function () {
    assert.notStrictEqual(ctx.newToken, ctx.token);
});

Given('I have an expired auth token', function () {
    ctx.token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxNTE2MjM5MDIzfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
});

When('I use the expired token to access a protected resource', async function () {
    ctx.response = await ctx.api.get('/api/user/profile', {
        headers: { Authorization: 'Bearer ' + ctx.token }
    });
});
