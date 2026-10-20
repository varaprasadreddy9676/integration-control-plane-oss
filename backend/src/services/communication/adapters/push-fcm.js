/**
 * Firebase Cloud Messaging (FCM) Push Notification Adapter
 * Uses the FCM HTTP v1 API with service-account OAuth2 authentication.
 *
 * Docs: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send
 *
 * No external dependencies — uses Node.js built-in `crypto` and `https`.
 *
 * Config (communicationConfig.fcm):
 *   projectId    — Firebase project ID (e.g. "my-app-12345")
 *   clientEmail  — Service account client_email
 *   privateKey   — Service account private_key (PEM, with literal \n)
 *
 * Payload (from integration transform output):
 *   token        — Device registration token (send to specific device)
 *   topic        — Topic name without /topics/ prefix (send to topic subscribers)
 *   title        — Notification title
 *   body         — Notification body
 *   imageUrl     — Optional notification image URL
 *   data         — Optional key-value data payload (all values must be strings)
 *   androidPriority — "normal" | "high" (default: "high")
 *   apnsBadge    — iOS badge count (optional, default: 1)
 *   apnsSound    — iOS sound (default: "default")
 *
 * Note: Either `token` OR `topic` must be provided, not both.
 * Note: Free-form text messages require the user has opted-in to notifications.
 *       Outside of a notification permission context, use `data`-only payloads.
 */

'use strict';

const crypto = require('crypto');
const https = require('https');
const { log } = require('../../../logger');

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_API_HOST = 'fcm.googleapis.com';

// ── Token cache ──────────────────────────────────────────────────────────────
// Keyed by clientEmail so multiple service accounts work independently.
// Tokens are valid for 1 hour; we refresh 5 minutes early.
const tokenCache = new Map(); // clientEmail → { accessToken, expiresAt }

class FcmAdapter {
  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Send a push notification via FCM HTTP v1 API.
   */
  async send(payload, config) {
    const {
      token,
      topic,
      title,
      body,
      imageUrl,
      data,
      androidPriority = 'high',
      apnsBadge = 1,
      apnsSound = 'default',
    } = payload;

    const { projectId, clientEmail, privateKey } = config;

    // ── Validate config ──────────────────────────────────────────────────────
    if (!projectId) throw new Error('communicationConfig.fcm.projectId is required');
    if (!clientEmail) throw new Error('communicationConfig.fcm.clientEmail is required');
    if (!privateKey) throw new Error('communicationConfig.fcm.privateKey is required');

    // ── Validate payload ─────────────────────────────────────────────────────
    if (!token && !topic) {
      throw new Error('payload.token (device) or payload.topic (topic name) is required');
    }
    if (token && topic) {
      throw new Error('Provide either payload.token or payload.topic — not both');
    }
    if (!title && !body && (!data || Object.keys(data).length === 0)) {
      throw new Error('At least one of payload.title, payload.body, or payload.data is required');
    }

    // ── Validate data values are all strings ─────────────────────────────────
    if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        if (typeof v !== 'string') {
          throw new Error(`payload.data values must be strings — key "${k}" has type "${typeof v}". Stringify it before sending.`);
        }
      }
    }

    // ── Get OAuth2 access token ──────────────────────────────────────────────
    const accessToken = await this._getAccessToken(clientEmail, privateKey);

    // ── Build FCM message ────────────────────────────────────────────────────
    const message = this._buildMessage({
      token,
      topic,
      title,
      body,
      imageUrl,
      data,
      androidPriority,
      apnsBadge,
      apnsSound,
    });

    log('info', '[FCM] Sending push notification', {
      target: token ? `token:${token.slice(0, 12)}…` : `topic:${topic}`,
      title,
      projectId,
    });

    const result = await this._post(projectId, accessToken, { message, validate_only: false });

    const messageId = result?.name ?? null; // e.g. projects/my-project/messages/0:1234567890
    log('info', '[FCM] Push notification sent', { messageId });

    return {
      success: true,
      messageId,
      provider: 'FCM',
      target: token ? 'device' : 'topic',
      raw: result,
      timestamp: new Date(),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build the FCM v1 message object.
   */
  _buildMessage({ token, topic, title, body, imageUrl, data, androidPriority, apnsBadge, apnsSound }) {
    const message = {};

    // Target: device token or topic
    if (token) message.token = token;
    if (topic) message.topic = topic.startsWith('/topics/') ? topic.slice(8) : topic;

    // Notification block (shown in system tray)
    if (title || body || imageUrl) {
      message.notification = {};
      if (title) message.notification.title = title;
      if (body) message.notification.body = body;
      if (imageUrl) message.notification.image = imageUrl;
    }

    // Custom data payload (always delivered, even in background)
    if (data && Object.keys(data).length > 0) {
      message.data = data;
    }

    // Android-specific overrides
    message.android = {
      priority: androidPriority === 'high' ? 'HIGH' : 'NORMAL',
      ...(title || body
        ? {
            notification: {
              sound: 'default',
              ...(imageUrl ? { image: imageUrl } : {}),
            },
          }
        : {}),
    };

    // APNs (iOS) overrides
    message.apns = {
      headers: {
        'apns-priority': androidPriority === 'high' ? '10' : '5',
      },
      payload: {
        aps: {
          sound: apnsSound,
          badge: apnsBadge,
          'content-available': 1,
        },
      },
    };

    // Web push (FCM also delivers to web browsers via the Web Push Protocol)
    if (title || body) {
      message.webpush = {
        notification: {
          ...(title ? { title } : {}),
          ...(body ? { body } : {}),
          ...(imageUrl ? { image: imageUrl } : {}),
        },
      };
    }

    return message;
  }

  /**
   * Get a cached OAuth2 access token, refreshing if expired or missing.
   * Tokens are valid 1 hour; we refresh 5 minutes before expiry.
   */
  async _getAccessToken(clientEmail, privateKey) {
    const cached = tokenCache.get(clientEmail);
    const now = Date.now();
    const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

    if (cached && cached.expiresAt - REFRESH_BUFFER_MS > now) {
      return cached.accessToken;
    }

    log('info', '[FCM] Refreshing OAuth2 access token', { clientEmail });

    const jwt = this._createJWT(clientEmail, privateKey);
    const tokenData = await this._exchangeJWTForToken(jwt);

    tokenCache.set(clientEmail, {
      accessToken: tokenData.access_token,
      expiresAt: now + tokenData.expires_in * 1000,
    });

    return tokenData.access_token;
  }

  /**
   * Create a signed RS256 JWT for the Google OAuth2 token exchange.
   * Uses Node.js built-in crypto — no external dependencies.
   */
  _createJWT(clientEmail, rawPrivateKey) {
    const now = Math.floor(Date.now() / 1000);

    // Normalize private key: replace literal \n with actual newlines
    const privateKey = rawPrivateKey.replace(/\\n/g, '\n');

    const header = this._base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = this._base64url(
      JSON.stringify({
        iss: clientEmail,
        scope: FCM_SCOPE,
        aud: GOOGLE_TOKEN_URL,
        iat: now,
        exp: now + 3600,
      })
    );

    const signingInput = `${header}.${claims}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signingInput);
    sign.end();
    const signature = sign.sign(privateKey, 'base64url');

    return `${signingInput}.${signature}`;
  }

  /**
   * Exchange a signed JWT for a Google OAuth2 access token.
   */
  _exchangeJWTForToken(jwt) {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString();

    return new Promise((resolve, reject) => {
      const url = new URL(GOOGLE_TOKEN_URL);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch {
            return reject(new Error(`Google token endpoint returned non-JSON: ${data.slice(0, 200)}`));
          }
          if (res.statusCode === 200) {
            resolve(parsed);
          } else {
            reject(new Error(`Google token exchange failed [${res.statusCode}]: ${parsed?.error_description ?? parsed?.error ?? data}`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`Google token endpoint network error: ${err.message}`)));
      req.write(body);
      req.end();
    });
  }

  /**
   * POST the FCM message to the v1 send endpoint.
   */
  _post(projectId, accessToken, body) {
    const bodyStr = JSON.stringify(body);
    const path = `/v1/projects/${projectId}/messages:send`;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: FCM_API_HOST,
        path,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch {
            return reject(new Error(`FCM returned non-JSON response (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            // FCM v1 error shape: { error: { code, message, status, details } }
            const err = parsed?.error;
            const msg = err?.message ?? `FCM API error HTTP ${res.statusCode}`;
            const status = err?.status ?? '';
            reject(new Error(status ? `FCM [${status}]: ${msg}` : msg));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`FCM network error: ${err.message}`)));
      req.write(bodyStr);
      req.end();
    });
  }

  /** Base64url encode a string */
  _base64url(str) {
    return Buffer.from(str).toString('base64url');
  }

  /** Clear token cache (useful for testing / key rotation) */
  clearTokenCache(clientEmail) {
    if (clientEmail) {
      tokenCache.delete(clientEmail);
    } else {
      tokenCache.clear();
    }
    log('info', '[FCM] Token cache cleared', { clientEmail: clientEmail ?? 'all' });
  }
}

module.exports = new FcmAdapter();
