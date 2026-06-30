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

/**
 * Emit and await all async listener promises before returning.
 * Used by the outbox poller so 'delivered' is only marked after handlers complete.
 * Listeners must return a Promise (or be async functions).
 * Errors from individual listeners are logged but do not abort other listeners.
 */
async function emitAsync(eventType, payload) {
  const envelope = {
    version:    1,
    occurredAt: new Date().toISOString(),
    ...payload,
  };
  if (DEBUG) {
    console.log(`[EVENT] ${eventType}`, JSON.stringify({ tenantId: envelope.tenantId, occurredAt: envelope.occurredAt }));
  }
  const listeners = bus.listeners(eventType);
  await Promise.all(listeners.map(fn => {
    try {
      const result = fn(envelope);
      return result instanceof Promise ? result.catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'emitAsync.listener_failed',
          eventType, error: err.message }));
      }) : Promise.resolve();
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'emitAsync.listener_threw',
        eventType, error: err.message }));
      return Promise.resolve();
    }
  }));
}

module.exports = { emit, emitAsync, on };
