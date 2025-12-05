// SGNL Job Script - Auto-generated bundle
'use strict';

/**
 * SGNL Actions - Authentication Utilities
 *
 * Shared authentication utilities for SGNL actions.
 * Supports: Bearer Token, Basic Auth, OAuth2 Client Credentials, OAuth2 Authorization Code
 */

/**
 * Get OAuth2 access token using client credentials flow
 * @param {Object} config - OAuth2 configuration
 * @param {string} config.tokenUrl - Token endpoint URL
 * @param {string} config.clientId - Client ID
 * @param {string} config.clientSecret - Client secret
 * @param {string} [config.scope] - OAuth2 scope
 * @param {string} [config.audience] - OAuth2 audience
 * @param {string} [config.authStyle] - Auth style: 'InParams' or 'InHeader' (default)
 * @returns {Promise<string>} Access token
 */
async function getClientCredentialsToken(config) {
  const { tokenUrl, clientId, clientSecret, scope, audience, authStyle } = config;

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error('OAuth2 Client Credentials flow requires tokenUrl, clientId, and clientSecret');
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');

  if (scope) {
    params.append('scope', scope);
  }

  if (audience) {
    params.append('audience', audience);
  }

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  };

  if (authStyle === 'InParams') {
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
  } else {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: params.toString()
  });

  if (!response.ok) {
    let errorText;
    try {
      const errorData = await response.json();
      errorText = JSON.stringify(errorData);
    } catch {
      errorText = await response.text();
    }
    throw new Error(
      `OAuth2 token request failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error('No access_token in OAuth2 response');
  }

  return data.access_token;
}

/**
 * Get the Authorization header value from context using available auth method.
 * Supports: Bearer Token, Basic Auth, OAuth2 Authorization Code, OAuth2 Client Credentials
 *
 * @param {Object} context - Execution context with environment and secrets
 * @param {Object} context.environment - Environment variables
 * @param {Object} context.secrets - Secret values
 * @returns {Promise<string>} Authorization header value (e.g., "Bearer xxx" or "Basic xxx")
 */
async function getAuthorizationHeader(context) {
  const env = context.environment || {};
  const secrets = context.secrets || {};

  // Method 1: Simple Bearer Token
  if (secrets.BEARER_AUTH_TOKEN) {
    const token = secrets.BEARER_AUTH_TOKEN;
    return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  // Method 2: Basic Auth (username + password)
  if (secrets.BASIC_PASSWORD && secrets.BASIC_USERNAME) {
    const credentials = Buffer.from(`${secrets.BASIC_USERNAME}:${secrets.BASIC_PASSWORD}`).toString('base64');
    return `Basic ${credentials}`;
  }

  // Method 3: OAuth2 Authorization Code - use pre-existing access token
  if (secrets.OAUTH2_AUTHORIZATION_CODE_ACCESS_TOKEN) {
    const token = secrets.OAUTH2_AUTHORIZATION_CODE_ACCESS_TOKEN;
    return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  // Method 4: OAuth2 Client Credentials - fetch new token
  if (secrets.OAUTH2_CLIENT_CREDENTIALS_CLIENT_SECRET) {
    const tokenUrl = env.OAUTH2_CLIENT_CREDENTIALS_TOKEN_URL;
    const clientId = env.OAUTH2_CLIENT_CREDENTIALS_CLIENT_ID;
    const clientSecret = secrets.OAUTH2_CLIENT_CREDENTIALS_CLIENT_SECRET;

    if (!tokenUrl || !clientId) {
      throw new Error('OAuth2 Client Credentials flow requires TOKEN_URL and CLIENT_ID in env');
    }

    const token = await getClientCredentialsToken({
      tokenUrl,
      clientId,
      clientSecret,
      scope: env.OAUTH2_CLIENT_CREDENTIALS_SCOPE,
      audience: env.OAUTH2_CLIENT_CREDENTIALS_AUDIENCE,
      authStyle: env.OAUTH2_CLIENT_CREDENTIALS_AUTH_STYLE
    });

    return `Bearer ${token}`;
  }

  throw new Error(
    'No authentication configured. Provide one of: ' +
    'BEARER_AUTH_TOKEN, BASIC_USERNAME/BASIC_PASSWORD, ' +
    'OAUTH2_AUTHORIZATION_CODE_ACCESS_TOKEN, or OAUTH2_CLIENT_CREDENTIALS_*'
  );
}

/**
 * Get the base URL/address for API calls
 * @param {Object} params - Request parameters
 * @param {string} [params.address] - Address from params
 * @param {Object} context - Execution context
 * @returns {string} Base URL
 */
function getBaseUrl(params, context) {
  const env = context.environment || {};
  const address = params?.address || env.ADDRESS;

  if (!address) {
    throw new Error('No URL specified. Provide address parameter or ADDRESS environment variable');
  }

  // Remove trailing slash if present
  return address.endsWith('/') ? address.slice(0, -1) : address;
}

/**
 * Slack Send Direct Message Action
 *
 * Sends a direct message to a Slack user by looking up their user ID from email
 * and then sending a message to their DM channel.
 */


function parseDuration(durationStr) {
  if (!durationStr) return 100; // default 100ms

  const match = durationStr.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!match) {
    console.warn(`Invalid duration format: ${durationStr}, using default 100ms`);
    return 100;
  }

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      return value;
  }
}

/**
 * Look up a Slack user by email address
 * @param {string} email - The email address to look up
 * @param {string} baseUrl - The Slack API base URL
 * @param {string} authHeader - The Authorization header value
 * @returns {Promise<Response>} The fetch response
 */
async function lookupUserByEmail(email, baseUrl, authHeader) {
  const encodedEmail = encodeURIComponent(email);
  const url = new URL(`/api/users.lookupByEmail?email=${encodedEmail}`, baseUrl);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json'
    }
  });

  return response;
}

/**
 * Send a direct message to a Slack user
 * @param {string} userId - The Slack user ID
 * @param {string} text - The message text
 * @param {string} baseUrl - The Slack API base URL
 * @param {string} authHeader - The Authorization header value
 * @returns {Promise<Response>} The fetch response
 */
async function sendDirectMessage(userId, text, baseUrl, authHeader) {
  const url = new URL('/api/chat.postMessage', baseUrl);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      channel: userId,
      text: text
    })
  });

  return response;
}

var script = {
  /**
   * Main execution handler - sends a direct message to a Slack user by email
   * @param {Object} params - Job input parameters
   * @param {string} params.text - The message text to send (required)
   * @param {string} params.userEmail - Email address of the Slack user (required)
   * @param {string} params.delay - Optional delay between API calls (e.g., 100ms, 1s)
   * @param {string} params.address - Optional Slack API base URL
   * @param {Object} context - Execution context with secrets and environment
   * @param {string} context.environment.ADDRESS - Default Slack API base URL
   *
   * The configured auth type will determine which of the following environment variables and secrets are available
   * @param {string} context.secrets.BEARER_AUTH_TOKEN
   *
   * @param {string} context.secrets.OAUTH2_AUTHORIZATION_CODE_ACCESS_TOKEN
   *
   * @returns {Promise<Object>} Action result
   */
  invoke: async (params, context) => {
    console.log('Starting Slack direct message send');
    console.log(`Sending message to: ${params.userEmail}`);

    const { userEmail, text, delay } = params;
    const baseUrl = getBaseUrl(params, context);
    const authHeader = await getAuthorizationHeader(context);

    // Parse delay duration
    const delayMs = parseDuration(delay);

    // Step 1: Look up user by email
    console.log(`Looking up user by email: ${userEmail}`);
    const lookupResponse = await lookupUserByEmail(userEmail, baseUrl, authHeader);

    if (!lookupResponse.ok) {
      const errorData = await lookupResponse.json().catch(() => ({}));
      if (lookupResponse.status === 404 || errorData.error === 'users_not_found') {
        throw new Error(`User not found with email: ${userEmail}`);
      }
      throw new Error(`Failed to lookup user ${userEmail}: ${lookupResponse.status} ${lookupResponse.statusText}`);
    }

    const lookupData = await lookupResponse.json();
    if (!lookupData.ok) {
      throw new Error(`Slack API error during user lookup: ${lookupData.error || 'Unknown error'}`);
    }

    const userId = lookupData.user?.id;
    if (!userId) {
      throw new Error(`No user ID found in response for email: ${userEmail}`);
    }

    console.log(`Found user ID: ${userId}`);

    // Add delay between API calls to avoid rate limiting
    console.log(`Waiting ${delayMs}ms before sending message`);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Step 2: Send direct message
    console.log(`Sending direct message to user: ${userId}`);
    const messageResponse = await sendDirectMessage(userId, text, baseUrl, authHeader);

    if (!messageResponse.ok) {
      throw new Error(`Failed to send message: ${messageResponse.status} ${messageResponse.statusText}`);
    }

    const messageData = await messageResponse.json();
    if (!messageData.ok) {
      throw new Error(`Slack API error during message send: ${messageData.error || 'Unknown error'}`);
    }

    console.log(`Successfully sent direct message to ${userEmail}`);

    // Return structured results
    return {
      status: 'success',
      userEmail: userEmail,
      userId: userId,
      text: text,
      ts: messageData.ts,
      ok: messageData.ok
    };
  },

  error: async (params, _context) => {
    const { error } = params;
    throw error;
  },

  /**
   * Graceful shutdown handler - implements cleanup logic
   * @param {Object} params - Original params plus halt reason
   * @param {Object} context - Execution context
   * @returns {Object} Cleanup results
   */
  halt: async (params, _context) => {
    const { reason, userEmail } = params;
    console.log(`Slack message job halted (${reason}) for user: ${userEmail || 'unknown'}`);

    // No specific cleanup needed for this action
    return {
      status: 'halted',
      userEmail: userEmail || 'unknown',
      reason: reason,
      halted_at: new Date().toISOString()
    };
  }
};

module.exports = script;
