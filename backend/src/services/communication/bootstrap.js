/**
 * Communication Adapter Bootstrap
 * Registers all available communication adapters on startup
 */

const adapterRegistry = require('./adapter-registry');
const smtpAdapter = require('./adapters/email-smtp');
const whatsappMetaAdapter = require('./adapters/whatsapp-meta');
const fcmAdapter = require('./adapters/push-fcm');
const msg91Adapter = require('./adapters/sms-msg91');

/**
 * Initialize all communication adapters
 * Called on application startup
 */
function initializeCommunicationAdapters() {
  console.log('[Communication] Initializing adapters...');

  // ============================================
  // Email Adapters
  // ============================================
  adapterRegistry.register('EMAIL', 'SMTP', smtpAdapter);

  // Future: Gmail OAuth adapter
  // const gmailAdapter = require('./adapters/email-gmail');
  // adapterRegistry.register('EMAIL', 'GMAIL_OAUTH', gmailAdapter);

  // Future: Outlook OAuth adapter
  // const outlookAdapter = require('./adapters/email-outlook');
  // adapterRegistry.register('EMAIL', 'OUTLOOK_OAUTH', outlookAdapter);

  // ============================================
  // SMS Adapters
  // ============================================
  adapterRegistry.register('SMS', 'MSG91', msg91Adapter);

  // Future SMS providers — just add the adapter file and register here:
  // const twilioSmsAdapter = require('./adapters/sms-twilio');
  // adapterRegistry.register('SMS', 'TWILIO', twilioSmsAdapter);
  // const exotelAdapter = require('./adapters/sms-exotel');
  // adapterRegistry.register('SMS', 'EXOTEL', exotelAdapter);

  // ============================================
  // WhatsApp Adapters
  // ============================================
  adapterRegistry.register('WHATSAPP', 'META', whatsappMetaAdapter);

  // ============================================
  // Push Notification Adapters
  // ============================================
  adapterRegistry.register('PUSH', 'FCM', fcmAdapter);

  // ============================================
  // Future: Slack Adapters
  // ============================================
  // const slackAdapter = require('./adapters/slack-webhook');
  // adapterRegistry.register('SLACK', 'WEBHOOK', slackAdapter);

  // List all registered adapters
  const adapters = adapterRegistry.listAdapters();
  console.log('[Communication] Registered adapters:', adapters);
  console.log('[Communication] Initialization complete');
}

module.exports = {
  initializeCommunicationAdapters,
};
