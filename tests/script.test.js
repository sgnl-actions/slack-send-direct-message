import { jest } from '@jest/globals';
import script from '../src/script.mjs';

describe('Slack Send Direct Message Script', () => {
  // fetch is already mocked globally in setup.js
  const mockFetch = global.fetch;

  beforeEach(() => {
    // Mock setTimeout to avoid delays in tests
    jest.spyOn(global, 'setTimeout').mockImplementation((fn) => fn());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockContext = {
    environment: {
      SLACK_API_URL: 'https://slack.com'
    },
    secrets: {
      SLACK_ACCESS_TOKEN: 'xoxb-test-token-123456'
    }
  };

  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('invoke handler', () => {
    test('should successfully send direct message with two API calls', async () => {
      const params = {
        userEmail: 'test@example.com',
        text: 'Hello, this is a test message!'
      };

      // Mock successful user lookup response
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            user: {
              id: 'U12345678',
              name: 'test.user',
              profile: {
                email: 'test@example.com'
              }
            }
          })
        })
      );

      // Mock successful message send response
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            channel: 'U12345678',
            ts: '1609459200.000200',
            message: {
              text: 'Hello, this is a test message!',
              user: 'U87654321'
            }
          })
        })
      );

      const result = await script.invoke(params, mockContext);

      // Verify both API calls were made
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify user lookup call
      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'https://slack.com/api/users.lookupByEmail?email=test%40example.com',
        {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer xoxb-test-token-123456',
            'Accept': 'application/json'
          }
        }
      );

      // Verify message send call
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'https://slack.com/api/chat.postMessage',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer xoxb-test-token-123456',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: 'U12345678',
            text: 'Hello, this is a test message!'
          })
        }
      );

      // Verify result
      expect(result.status).toBe('success');
      expect(result.userEmail).toBe('test@example.com');
      expect(result.userId).toBe('U12345678');
      expect(result.text).toBe('Hello, this is a test message!');
      expect(result.ts).toBe('1609459200.000200');
      expect(result.ok).toBe(true);
    });

    test('should properly encode email addresses with special characters', async () => {
      const params = {
        userEmail: 'test+user@example.com',
        text: 'Test message'
      };

      // Mock successful responses
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            user: { id: 'U12345678' }
          })
        })
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            ts: '1609459200.000200'
          })
        })
      );

      await script.invoke(params, mockContext);

      // Verify email was URL encoded in the lookup call
      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'https://slack.com/api/users.lookupByEmail?email=test%2Buser%40example.com',
        expect.any(Object)
      );
    });

    test('should handle message text with quotes', async () => {
      const params = {
        userEmail: 'test@example.com',
        text: 'Message with "quotes" and \'single quotes\''
      };

      // Mock successful responses
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            user: { id: 'U12345678' }
          })
        })
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            ts: '1609459200.000200'
          })
        })
      );

      const result = await script.invoke(params, mockContext);

      // Verify message body was properly JSON escaped
      const messageCall = mockFetch.mock.calls[1];
      const body = JSON.parse(messageCall[1].body);
      expect(body.text).toBe('Message with "quotes" and \'single quotes\'');
      expect(result.text).toBe('Message with "quotes" and \'single quotes\'');
    });

    test('should throw error when SLACK_ACCESS_TOKEN is missing', async () => {
      const params = {
        userEmail: 'test@example.com',
        text: 'Test message'
      };

      const contextWithoutToken = {
        ...mockContext,
        secrets: {}
      };

      await expect(script.invoke(params, contextWithoutToken)).rejects.toThrow(
        'SLACK_ACCESS_TOKEN secret is required'
      );
    });

    test('should handle user not found error from lookup', async () => {
      const params = {
        userEmail: 'nonexistent@example.com',
        text: 'Test message'
      };

      // Mock 404 response for user lookup
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({
            ok: false,
            error: 'users_not_found'
          })
        })
      );

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'User not found with email: nonexistent@example.com'
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should handle Slack API error in user lookup response', async () => {
      const params = {
        userEmail: 'test@example.com',
        text: 'Test message'
      };

      // Mock successful HTTP response but API error
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: false,
            error: 'missing_scope'
          })
        })
      );

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'Slack API error during user lookup: missing_scope'
      );
    });

    test('should handle message send failure', async () => {
      const params = {
        userEmail: 'test@example.com',
        text: 'Test message'
      };

      // Mock successful user lookup
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            user: { id: 'U12345678' }
          })
        })
      );

      // Mock failed message send
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden'
        })
      );

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'Failed to send message: 403 Forbidden'
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('should handle Slack API error in message send response', async () => {
      const params = {
        userEmail: 'test@example.com',
        text: 'Test message'
      };

      // Mock successful user lookup
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            user: { id: 'U12345678' }
          })
        })
      );

      // Mock successful HTTP response but API error
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: false,
            error: 'channel_not_found'
          })
        })
      );

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'Slack API error during message send: channel_not_found'
      );
    });

    test('should use default SLACK_API_URL when not provided in environment', async () => {
      const params = {
        userEmail: 'test@example.com',
        text: 'Test message'
      };

      const contextWithoutUrl = {
        ...mockContext,
        environment: {}
      };

      // Mock successful responses
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            user: { id: 'U12345678' }
          })
        })
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            ts: '1609459200.000200'
          })
        })
      );

      await script.invoke(params, contextWithoutUrl);

      // Verify default URL was used
      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'https://slack.com/api/users.lookupByEmail?email=test%40example.com',
        expect.any(Object)
      );
    });
  });

  describe('error handler', () => {
    test('should request retry for rate limit errors (429)', async () => {
      const params = {
        userEmail: 'test@example.com',
        error: new Error('Rate limited: 429')
      };

      const result = await script.error(params, mockContext);

      expect(result.status).toBe('retry_requested');
    });

    test('should request retry for server errors (502, 503, 504)', async () => {
      for (const status of ['502', '503', '504']) {
        const params = {
          userEmail: 'test@example.com',
          error: new Error(`Server error: ${status}`)
        };

        const result = await script.error(params, mockContext);
        expect(result.status).toBe('retry_requested');
      }
    });

    test('should throw fatal error for authentication errors', async () => {
      const params = {
        userEmail: 'test@example.com',
        error: new Error('Authentication failed: 401')
      };

      await expect(script.error(params, mockContext)).rejects.toThrow(
        'Authentication failed: 401'
      );
    });

    test('should throw fatal error for user not found', async () => {
      const params = {
        userEmail: 'test@example.com',
        error: new Error('User not found with email: test@example.com')
      };

      await expect(script.error(params, mockContext)).rejects.toThrow(
        'User not found with email: test@example.com'
      );
    });

    test('should request retry for unknown errors by default', async () => {
      const params = {
        userEmail: 'test@example.com',
        error: new Error('Unknown network error')
      };

      const result = await script.error(params, mockContext);

      expect(result.status).toBe('retry_requested');
    });
  });

  describe('halt handler', () => {
    test('should handle graceful shutdown with user email', async () => {
      const params = {
        userEmail: 'test@example.com',
        reason: 'timeout'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.userEmail).toBe('test@example.com');
      expect(result.reason).toBe('timeout');
      expect(result.halted_at).toBeDefined();
    });

    test('should handle halt without user email', async () => {
      const params = {
        reason: 'system_shutdown'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.userEmail).toBe('unknown');
      expect(result.reason).toBe('system_shutdown');
    });
  });
});