export interface ErrorGuidance {
  reason: string
  actions: string[]
}

// Map a raw error string (from an API route or plugin failure) to a plain-language
// reason plus concrete next steps. Pattern-matched on the message so BOTH the server
// (embedding it in an API response) and the client (as a fallback) can use it. It
// always returns something actionable - even the default branch tells the user what
// to try - so no error ever reaches the user as a bare stack trace.
export function explainError(raw: string, ctx: { platform?: string } = {}): ErrorGuidance {
  const msg = (raw || '').toLowerCase()
  const { platform } = ctx

  // YouTube: the connected account has no channel.
  if (msg.includes('youtubesignuprequired') || (msg.includes('channel') && msg.includes('no '))) {
    return {
      reason: 'The connected Google account has no YouTube channel to upload to.',
      actions: [
        'Sign in to youtube.com as the connected account and create a channel (a Brand Account for a company).',
        'If Hopcharge already has a channel, add the connected account as a manager, then re-mint the refresh token and select that channel at consent.',
      ],
    }
  }

  // Google / YouTube auth problems.
  if (msg.includes('invalid_grant') || msg.includes('expired or revoked') || msg.includes('google oauth failed')) {
    return {
      reason: 'The YouTube (Google) refresh token is missing, expired, or revoked.',
      actions: [
        'Re-mint a refresh token in the OAuth Playground with the youtube.upload, youtube, and youtube.readonly scopes.',
        'Set it as YOUTUBE_REFRESH_TOKEN in .env.local and restart the server.',
      ],
    }
  }

  // Meta token problems.
  if (msg.includes('oauthexception') || msg.includes('"code":190') || (platform === 'meta' && msg.includes('access token'))) {
    return {
      reason: 'The Meta access token is invalid or expired.',
      actions: [
        'Generate a fresh long-lived token in the Meta Graph API tool.',
        'Update META_ACCESS_TOKEN in .env.local and restart the server.',
      ],
    }
  }

  // Missing media file for the creative.
  if (msg.includes('has no file path') || msg.includes('no file available') || msg.includes('not found in storage')) {
    return {
      reason: 'The creative has no uploaded media file to publish.',
      actions: [
        'Open the creative in Review and upload the image/video.',
        'For manual generation, run the prompt on Higgsfield and upload the result there.',
      ],
    }
  }

  // Permission / scope problems.
  if (msg.includes('forbidden') || msg.includes('permission') || msg.includes('insufficient') || msg.includes(' 403')) {
    return {
      reason: 'The platform rejected the request due to insufficient permissions or scopes.',
      actions: [
        'Confirm the account/token has the permissions needed for this action.',
        'For YouTube, re-mint the token including the youtube.force-ssl scope.',
      ],
    }
  }

  // Missing environment configuration.
  if (msg.includes('must be set') || msg.includes('is required') || msg.includes('not configured')) {
    return {
      reason: 'A required credential or setting is missing from the environment.',
      actions: [
        'Compare .env.local with .env.example for the key named in the details below.',
        'Add the missing value and restart the server.',
      ],
    }
  }

  // Fallback - still actionable.
  return {
    reason: 'The action failed unexpectedly.',
    actions: [
      'Retry - it may be a transient network or API hiccup.',
      'If it keeps failing, check the server logs for the detailed error shown below.',
    ],
  }
}
