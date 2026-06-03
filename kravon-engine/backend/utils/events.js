'use strict';

/**
 * events.js — Platform event bus.
 *
 * Routes emit events. Listeners (notification, analytics, whatsapp, etc.) react.
 * Business modules never import notification.service.js directly — they only call emit().
 *
 * Every payload must carry the standard envelope:
 *   { version, tenantId, occurredAt, ...domain fields }
 *
 * Future channels (email, SMS, WhatsApp, automation) register via events.on()
 * in their own listener files — zero route changes required.
 *
 * EVENT_DEBUG=true → logs every emission to console (dev/staging only).
 */

const EventEmitter = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

const DEBUG = process.env.EVENT_DEBUG === 'true';

/**
 * Emit a platform event.
 * @param {string} eventType  - e.g. 'order.created'
 * @param {object} payload    - must include tenantId; version + occurredAt added automatically
 */
function emit(eventType, payload) {
  const envelope = {
    version:    1,
    occurredAt: new Date().toISOString(),
    ...payload,
  };
  if (DEBUG) {
    console.log(`[EVENT] ${eventType}`, JSON.stringify({ tenantId: envelope.tenantId, occurredAt: envelope.occurredAt }));
  }
  bus.emit(eventType, envelope);
}

/**
 * Subscribe to a platform event.
 * @param {string}   eventType
 * @param {Function} handler   - receives the full envelope object
 */
function on(eventType, handler) {
  bus.on(eventType, handler);
}

module.exports = { emit, on };
