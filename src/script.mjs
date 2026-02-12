/**
 * Slack Send Direct Message Action
 *
 * Sends a direct message to a Slack user by looking up their user ID from email
 * and then sending a message to their DM channel.
 */

import { getBaseURL, createAuthHeaders} from '@sgnl-actions/utils';

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
 * @param {Object} headers - The headers object containing authorization and other headers
 * @returns {Promise<Response>} The fetch response
 */
async function lookupUserByEmail(email, baseUrl, headers) {
  const encodedEmail = encodeURIComponent(email);
  const url = `${baseUrl}/api/users.lookupByEmail?email=${encodedEmail}`;

  const response = await fetch(url, {
    method: 'GET',
    headers
  });

  return response;
}

/**
 * Send a direct message to a Slack user
 * @param {string} userId - The Slack user ID
 * @param {string} text - The message text
 * @param {string} baseUrl - The Slack API base URL
 * @param {Object} headers - The headers object containing authorization and other headers
 * @returns {Promise<Response>} The fetch response
 */
async function sendDirectMessage(userId, text, baseUrl, headers) {
  const url = `${baseUrl}/api/chat.postMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      channel: userId,
      text: text
    })
  });

  return response;
}

export default {
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
    const baseUrl = getBaseURL(params, context);
    const headers = await createAuthHeaders(context);

    // Parse delay duration
    const delayMs = parseDuration(delay);

    // Step 1: Look up user by email
    console.log(`Looking up user by email: ${userEmail}`);
    const lookupResponse = await lookupUserByEmail(userEmail, baseUrl, headers);

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
    const messageResponse = await sendDirectMessage(userId, text, baseUrl, headers);

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