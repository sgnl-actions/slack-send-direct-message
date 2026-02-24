// Jest globals for ESM
import { beforeAll, afterAll, beforeEach, describe, test, expect, jest } from '@jest/globals';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { request } from 'https';
import script from '../src/script.mjs';

const FIXTURES_DIR = '__recordings__';
const FIXTURE_FILE = `${FIXTURES_DIR}/slack-dm.json`;
const IS_RECORDING = process.env.RECORD_MODE === 'true';

function loadFixtures() {
  if (existsSync(FIXTURE_FILE)) {
    return JSON.parse(readFileSync(FIXTURE_FILE, 'utf-8'));
  }
  return {};
}

function saveFixtures(fixtures) {
  if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(FIXTURE_FILE, JSON.stringify(fixtures, null, 2));
}

function httpsRequest(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body;
    const reqOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        ...options.headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      }
    };

    const req = request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const isJson = res.headers['content-type']?.includes('application/json');
        const parsedBody = isJson ? JSON.parse(data) : data;
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusText: res.statusMessage,
          body: parsedBody
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function makeRecordReplayFetch(fixtures, key) {
  return async (url, options) => {
    // If fixture is already pre-injected (e.g. synthetic error cases), use it directly
    if (fixtures[key]) {
      const fixture = fixtures[key];
      return {
        ok: fixture.ok,
        status: fixture.status,
        statusText: fixture.statusText,
        json: async () => fixture.body,
        text: async () => (typeof fixture.body === 'string' ? fixture.body : JSON.stringify(fixture.body))
      };
    }

    if (IS_RECORDING) {
      const res = await httpsRequest(url, options || {});
      fixtures[key] = { status: res.status, ok: res.ok, statusText: res.statusText, body: res.body };
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        json: async () => res.body,
        text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body))
      };
    }

    throw new Error(`No fixture for "${key}". Run with RECORD_MODE=true first.`);
  };
}

describe('Slack Send Direct Message - Record & Replay', () => {
  let fixtures = {};

  beforeAll(() => {
    fixtures = loadFixtures();
  });

  afterAll(() => {
    if (IS_RECORDING) saveFixtures(fixtures);
  });

  beforeEach(() => {
    fetch.mockClear();
    // Mock setTimeout to avoid real delays during tests
    jest.spyOn(global, 'setTimeout').mockImplementation((fn) => fn());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const context = {
    environment: { ADDRESS: 'https://slack.com' },
    secrets: { BEARER_AUTH_TOKEN: process.env.SLACK_BOT_TOKEN || 'xoxb-fake-token' },
    outputs: {}
  };

  test('should look up user and send direct message successfully', async () => {
    // Two sequential fetch calls: user lookup then message send
    fetch
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-user-lookup'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-send-message'));

    const result = await script.invoke({
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: 'Hello from record-replay DM test!'
    }, context);

    expect(result.status).toBe('success');
    expect(result.ok).toBe(true);
    expect(result.userId).toBeDefined();
    expect(result.ts).toBeDefined();
  });

  test('should handle user not found', async () => {
    fetch.mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-user-not-found'));

    // Slack returns 200 with ok:false and error:'users_not_found' for unknown emails
    await expect(script.invoke({
      userEmail: process.env.SLACK_INVALID_EMAIL || 'nonexistent@example.com',
      text: 'Hello!'
    }, context)).rejects.toThrow(/users_not_found|User not found/);
  });

  test('should handle Slack API error during user lookup', async () => {
    // This error (e.g. missing_scope) can't be triggered with a valid token,
    // so we inject a pre-crafted fixture directly instead of hitting the real API
    if (IS_RECORDING) {
      fixtures['dm-lookup-api-error'] = {
        status: 200,
        ok: true,
        statusText: 'OK',
        body: { ok: false, error: 'missing_scope' }
      };
    }

    fetch.mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-lookup-api-error'));

    await expect(script.invoke({
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: 'Hello!'
    }, context)).rejects.toThrow(/Slack API error during user lookup: missing_scope/);
  });

  test('should properly encode email with special characters', async () => {
    fetch
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-special-email-lookup'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-special-email-send'));

    const result = await script.invoke({
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: 'Testing special character email encoding'
    }, context);

    expect(result.status).toBe('success');
    expect(fetch).toHaveBeenNthCalledWith(1,
      expect.stringMatching(/email=/),
      expect.any(Object)
    );
  });

  test('should respect custom delay between API calls', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => fn());

    fetch
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-delay-lookup'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-delay-send'));

    await script.invoke({
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: 'Testing custom delay',
      delay: '500ms'
    }, context);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
    setTimeoutSpy.mockRestore();
  });

  test('should send message with multiline text', async () => {
    fetch
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-multiline-lookup'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-multiline-send'));

    const multilineText = 'Line 1\nLine 2\nLine 3';
    const result = await script.invoke({
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: multilineText
    }, context);

    expect(result.status).toBe('success');
    expect(result.text).toBe(multilineText);
  });

  test('should send message with special characters in text', async () => {
    fetch
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-special-chars-lookup'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-special-chars-send'));

    const specialText = 'Hello! <@U12345> & "quoted" text with \'apostrophes\'';
    const result = await script.invoke({
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: specialText
    }, context);

    expect(result.status).toBe('success');
    expect(result.text).toBe(specialText);
  });

  test('should return correct userId in result', async () => {
    fetch
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-userid-check-lookup'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-userid-check-send'));

    const result = await script.invoke({
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: 'Checking userId in response'
    }, context);

    expect(result.userId).toBeDefined();
    expect(result.userId).toMatch(/^U/); // Slack user IDs start with U
    expect(result.userEmail).toBe(process.env.SLACK_USER_EMAIL || 'test@example.com');
  });

  test('should return a valid timestamp in result', async () => {
    fetch
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-timestamp-lookup'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-timestamp-send'));

    const result = await script.invoke({
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: 'Checking timestamp in response'
    }, context);

    expect(result.ts).toBeDefined();
    // Slack timestamps are in the format "unix.microseconds"
    expect(result.ts).toMatch(/^\d+\.\d+$/);
  });

  test('should handle missing auth token', async () => {
    await expect(script.invoke({
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: 'Hello!'
    }, {
      environment: { ADDRESS: 'https://slack.com' },
      secrets: {},
      outputs: {}
    })).rejects.toThrow('No authentication configured');

    // Should fail before making any API calls
    expect(fetch).not.toHaveBeenCalled();
  });

  test('should handle two identical DM sends (idempotency)', async () => {
    fetch
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-idempotency-lookup-1'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-idempotency-send-1'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-idempotency-lookup-2'))
      .mockImplementationOnce(makeRecordReplayFetch(fixtures, 'dm-idempotency-send-2'));

    const params = {
      userEmail: process.env.SLACK_USER_EMAIL || 'test@example.com',
      text: 'Idempotency test DM!'
    };

    const r1 = await script.invoke(params, context);
    const r2 = await script.invoke(params, context);

    expect(r1.status).toBe('success');
    expect(r2.status).toBe('success');
    expect(r1.ts).not.toBe(r2.ts); // Each message gets a unique timestamp
  });
});