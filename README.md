# Slack Send Direct Message

Send a direct message to a Slack user by looking up their user ID from an email address.

## Overview

This action performs a two-step process to send direct messages in Slack:

1. **User Lookup**: Uses the `users.lookupByEmail` API to find the Slack user ID for a given email address
2. **Message Send**: Uses the `chat.postMessage` API to send a direct message to the user's DM channel

## Prerequisites

### Slack App Setup

1. Create a Slack app in your workspace
2. Configure the following **OAuth Scopes**:
   - `users:read.email` - Required to lookup users by email address
   - `chat:write` - Required to send messages
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### SGNL Configuration

Add the Slack token as a secret in your SGNL environment:

```json
{
  "BEARER_AUTH_TOKEN": "xoxb-your-slack-bot-token"
}
```

## Configuration

### Inputs

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | The text message to send (max 4000 characters) |
| `userEmail` | string | Yes | Email address of the Slack user to send the message to |
| `delay` | Duration | No | Delay between API calls (e.g., 100ms, 1s). Default: 100ms |
| `address` | string | No | Slack API base URL (e.g., https://slack.com) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_API_URL` | `https://slack.com` | Base URL for Slack API |

### Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `BEARER_AUTH_TOKEN` | Yes | Slack Bot User OAuth Token with required scopes |

### Outputs

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Operation result (success, failed, etc.) |
| `userEmail` | string | Email address of the target user |
| `userId` | string | Slack user ID that was resolved |
| `text` | string | Message text that was sent |
| `ts` | string | Message timestamp from Slack API |
| `ok` | boolean | Whether the Slack API call succeeded |

## Usage Examples

### Basic Usage

```json
{
  "text": "Hello John! This is an automated message from SGNL.",
  "userEmail": "john.doe@company.com"
}
```

### With Delay and Custom Address

```json
{
  "text": "Your request has been approved!",
  "userEmail": "john.doe@company.com",
  "delay": "200ms",
  "address": "https://slack.com"
}
```

### With Quotes and Special Characters

```json
{
  "text": "Your request has been \"approved\" and you're all set!",
  "userEmail": "user+test@example.com"
}
```

## API Process Details

### Step 1: User Lookup

**Endpoint**: `GET /api/users.lookupByEmail`

The action first looks up the user by their email address:

```http
GET https://slack.com/api/users.lookupByEmail?email=user%40example.com
Authorization: Bearer xoxb-your-token
Accept: application/json
```

**Response**:
```json
{
  "ok": true,
  "user": {
    "id": "U12345678",
    "name": "john.doe",
    "profile": {
      "email": "john.doe@company.com"
    }
  }
}
```

### Step 2: Send Message

**Endpoint**: `POST /api/chat.postMessage`

Using the retrieved user ID, sends a direct message:

```http
POST https://slack.com/api/chat.postMessage
Authorization: Bearer xoxb-your-token
Content-Type: application/json

{
  "channel": "U12345678",
  "text": "Hello John! This is an automated message."
}
```

**Response**:
```json
{
  "ok": true,
  "channel": "U12345678",
  "ts": "1609459200.000200",
  "message": {
    "text": "Hello John! This is an automated message.",
    "user": "U87654321"
  }
}
```

## Error Handling

### Retryable Errors

The action will automatically retry for these conditions:
- **Rate Limits (429)**: Waits 5 seconds before retry
- **Server Errors (502, 503, 504)**: Waits 1 second before retry

### Fatal Errors

These errors will not be retried:
- **Authentication errors (401, 403)**: Invalid or insufficient token permissions
- **User not found**: Email address not found in workspace
- **Invalid input**: Malformed email or empty message

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `User not found with email: user@example.com` | Email not in workspace | Verify email belongs to workspace member |
| `Slack API error: missing_scope` | Insufficient OAuth scopes | Add `users:read.email` and `chat:write` scopes |
| `BEARER_AUTH_TOKEN secret is required` | Missing token | Configure the secret in SGNL |

## Security Considerations

- **Email Encoding**: Email addresses are properly URL-encoded to prevent injection
- **Token Security**: Slack token is securely accessed via SGNL secrets
- **Message Escaping**: Message text is properly JSON-escaped
- **HTTPS Only**: All API calls use secure HTTPS connections

## Troubleshooting

### User Lookup Fails

1. Verify the email address belongs to a workspace member
2. Check that the bot token has `users:read.email` scope
3. Ensure the email is exact match (case-sensitive)

### Message Send Fails

1. Verify the bot token has `chat:write` scope
2. Check that the user allows DMs from bots
3. Ensure message text is within 4000 character limit

### Rate Limiting

Slack has rate limits per workspace:
- **Tier 1**: 1 request per minute per method
- **Tier 2**: 20 requests per minute per method
- **Tier 3**: 50 requests per minute per method

The action handles rate limits automatically with exponential backoff.

## Development

### Local Testing

```bash
# Install dependencies
npm install

# Run tests
npm test

# Test with coverage
npm run test:coverage

# Run locally with sample data
npm run dev -- --params '{"userEmail":"test@example.com","text":"Test message"}'

# Lint code
npm run lint

# Build for deployment
npm run build
```

### Test Coverage

The action includes comprehensive tests covering:
- ✅ Two-step API process (lookup + send)
- ✅ Email URL encoding (special characters like `+`)
- ✅ Message JSON escaping (quotes and special characters)
- ✅ Error scenarios (user not found, API errors, etc.)
- ✅ Retry logic for transient failures
- ✅ Input validation and edge cases

Current test coverage: **95%+**

## Deployment

1. **Run tests**: `npm test`
2. **Check coverage**: `npm run test:coverage`
3. **Lint code**: `npm run lint`
4. **Build**: `npm run build`
5. **Commit changes**: `git add . && git commit -m "Release v1.0.0"`
6. **Tag release**: `git tag -a v1.0.0 -m "Initial release"`
7. **Push**: `git push origin main --tags`

## Support

- [Slack Web API Documentation](https://api.slack.com/web)
- [SGNL Job Development Guide](https://docs.sgnl.ai)