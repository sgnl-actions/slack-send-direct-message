import { jest } from '@jest/globals';
import script from '../src/script.mjs';
import { SGNL_USER_AGENT } from '@sgnl-actions/utils';

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
      ADDRESS: 'https://slack.com'
    },
    secrets: {
      BEARER_AUTH_TOKEN: 'xoxb-test-token-123456'
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
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': SGNL_USER_AGENT
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
            'Content-Type': 'application/json',
            'User-Agent': SGNL_USER_AGENT
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

    test('should throw error when BEARER_AUTH_TOKEN is missing', async () => {
      const params = {
        userEmail: 'test@example.com',
        text: 'Test message'
      };

      const contextWithoutToken = {
        ...mockContext,
        secrets: {}
      };

      await expect(script.invoke(params, contextWithoutToken)).rejects.toThrow(
        'No authentication configured'
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

  });

  describe('error handler', () => {
    test('should re-throw error for framework to handle', async () => {
      const error = new Error('Network timeout');
      error.statusCode = 500;

      const params = {
        userEmail: 'test@example.com',
        error: error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Network timeout');
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

  describe('input validation', () => {
    test('should throw error when userEmail is missing', async () => {
      await expect(script.invoke({ text: 'Hello!' }, mockContext))
        .rejects.toThrow('userEmail parameter is required and cannot be empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should throw error when userEmail is empty string', async () => {
      await expect(script.invoke({ userEmail: '', text: 'Hello!' }, mockContext))
        .rejects.toThrow('userEmail parameter is required and cannot be empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should throw error when text is missing', async () => {
      await expect(script.invoke({ userEmail: 'test@example.com' }, mockContext))
        .rejects.toThrow('text parameter is required and cannot be empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should throw error when text is empty string', async () => {
      await expect(script.invoke({ userEmail: 'test@example.com', text: '' }, mockContext))
        .rejects.toThrow('text parameter is required and cannot be empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should throw error when both userEmail and text are missing', async () => {
      await expect(script.invoke({}, mockContext))
        .rejects.toThrow('userEmail parameter is required and cannot be empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });


  describe('delay / parseDuration', () => {
    const successLookup = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, user: { id: 'U12345678' } })
    });
    const successSend = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, ts: '1609459200.000200' })
    });

    test('should use default 100ms delay when delay param is not provided', async () => {
      mockFetch.mockImplementationOnce(successLookup).mockImplementationOnce(successSend);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => fn());

      await script.invoke({ userEmail: 'test@example.com', text: 'Hi' }, mockContext);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    });

    test('should parse delay in milliseconds', async () => {
      mockFetch.mockImplementationOnce(successLookup).mockImplementationOnce(successSend);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => fn());

      await script.invoke({ userEmail: 'test@example.com', text: 'Hi', delay: '250ms' }, mockContext);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 250);
    });

    test('should parse delay in seconds', async () => {
      mockFetch.mockImplementationOnce(successLookup).mockImplementationOnce(successSend);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => fn());

      await script.invoke({ userEmail: 'test@example.com', text: 'Hi', delay: '2s' }, mockContext);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    });

    test('should parse delay in minutes', async () => {
      mockFetch.mockImplementationOnce(successLookup).mockImplementationOnce(successSend);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => fn());

      await script.invoke({ userEmail: 'test@example.com', text: 'Hi', delay: '1m' }, mockContext);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    });

    test('should parse delay in hours', async () => {
      mockFetch.mockImplementationOnce(successLookup).mockImplementationOnce(successSend);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => fn());

      await script.invoke({ userEmail: 'test@example.com', text: 'Hi', delay: '1h' }, mockContext);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3600000);
    });

    test('should fall back to 100ms for invalid delay format', async () => {
      mockFetch.mockImplementationOnce(successLookup).mockImplementationOnce(successSend);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => fn());

      await script.invoke({ userEmail: 'test@example.com', text: 'Hi', delay: 'invalid' }, mockContext);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    });
  });

  describe('network failures', () => {
    test('should throw when fetch rejects during user lookup', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(script.invoke({
        userEmail: 'test@example.com',
        text: 'Hello!'
      }, mockContext)).rejects.toThrow('Network timeout');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should throw when fetch rejects during message send', async () => {
      mockFetch
        .mockImplementationOnce(() => Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, user: { id: 'U12345678' } })
        }))
        .mockRejectedValueOnce(new Error('Connection refused'));

      await expect(script.invoke({
        userEmail: 'test@example.com',
        text: 'Hello!'
      }, mockContext)).rejects.toThrow('Connection refused');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('edge cases in response handling', () => {
    test('should throw when user lookup returns ok:true but no user ID', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, user: {} }) // user exists but no id
      }));

      await expect(script.invoke({
        userEmail: 'test@example.com',
        text: 'Hello!'
      }, mockContext)).rejects.toThrow(/No user ID found/);
    });

    test('should throw when user lookup returns ok:true but user is null', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, user: null })
      }));

      await expect(script.invoke({
        userEmail: 'test@example.com',
        text: 'Hello!'
      }, mockContext)).rejects.toThrow(/No user ID found/);
    });

    test('should handle non-404 HTTP error from user lookup', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({})
      }));

      await expect(script.invoke({
        userEmail: 'test@example.com',
        text: 'Hello!'
      }, mockContext)).rejects.toThrow('Failed to lookup user test@example.com: 500 Internal Server Error');
    });

    test('should handle Slack API error in message send with unknown error', async () => {
      mockFetch
        .mockImplementationOnce(() => Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, user: { id: 'U12345678' } })
        }))
        .mockImplementationOnce(() => Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: false }) // no error field
        }));

      await expect(script.invoke({
        userEmail: 'test@example.com',
        text: 'Hello!'
      }, mockContext)).rejects.toThrow('Slack API error during message send: Unknown error');
    });

    test('should use custom address from params over environment ADDRESS', async () => {
      mockFetch
        .mockImplementationOnce(() => Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, user: { id: 'U12345678' } })
        }))
        .mockImplementationOnce(() => Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: '1609459200.000200' })
        }));

      await script.invoke({
        userEmail: 'test@example.com',
        text: 'Hello!',
        address: 'https://custom-slack-proxy.example.com'
      }, mockContext);

      expect(mockFetch).toHaveBeenNthCalledWith(1,
        expect.stringContaining('https://custom-slack-proxy.example.com'),
        expect.any(Object)
      );
    });
  });
});