// SGNL Job Script - Auto-generated bundle
'use strict';

/**
 * Slack Send Direct Message Action
 *
 * Sends a direct message to a Slack user by looking up their user ID from email
 * and then sending a message to their DM channel.
 */

/**
 * Look up a Slack user by email address
 * @param {string} email - The email address to look up
 * @param {string} baseUrl - The Slack API base URL
 * @param {string} token - The Slack access token
 * @returns {Promise<Response>} The fetch response
 */
async function lookupUserByEmail(email, baseUrl, token) {
  const encodedEmail = encodeURIComponent(email);
  const url = new URL(`/api/users.lookupByEmail?email=${encodedEmail}`, baseUrl);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
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
 * @param {string} token - The Slack access token
 * @returns {Promise<Response>} The fetch response
 */
async function sendDirectMessage(userId, text, baseUrl, token) {
  const url = new URL('/api/chat.postMessage', baseUrl);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
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
   * @param {string} params.userEmail - Email address of the Slack user
   * @param {string} params.text - The message text to send
   * @param {Object} context - Execution context with env, secrets, outputs
   * @returns {Object} Job results
   */
  invoke: async (params, context) => {
    console.log('Starting Slack direct message send');
    console.log(`Sending message to: ${params.userEmail}`);

    const { userEmail, text } = params;
    const baseUrl = context.environment?.SLACK_API_URL || 'https://slack.com';
    const token = context.secrets?.BEARER_AUTH_TOKEN;

    if (!token) {
      throw new Error('BEARER_AUTH_TOKEN secret is required');
    }

    // Step 1: Look up user by email
    console.log(`Looking up user by email: ${userEmail}`);
    const lookupResponse = await lookupUserByEmail(userEmail, baseUrl, token);

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

    // Step 2: Send direct message
    console.log(`Sending direct message to user: ${userId}`);
    const messageResponse = await sendDirectMessage(userId, text, baseUrl, token);

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

  /**
   * Error recovery handler - implements retry logic for transient failures
   * @param {Object} params - Original params plus error information
   * @param {Object} context - Execution context
   * @returns {Object} Recovery results
   */
  error: async (params, _context) => {
    const { error } = params;
    console.error(`Slack send message error: ${error.message}`);

    // Retryable errors: rate limits and server errors
    if (error.message.includes('429') || error.message.includes('502') ||
        error.message.includes('503') || error.message.includes('504')) {
      console.log('Retryable error detected, waiting before retry');

      // Wait for rate limit reset (basic implementation)
      if (error.message.includes('429')) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Let framework retry
      return { status: 'retry_requested' };
    }

    // Fatal errors: authentication, user not found, etc.
    if (error.message.includes('401') || error.message.includes('403') ||
        error.message.includes('User not found')) {
      console.error('Fatal error - not retrying');
      throw error;
    }

    // Default: allow framework to retry
    return { status: 'retry_requested' };
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
