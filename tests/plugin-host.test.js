const test = require('node:test');
const assert = require('node:assert/strict');

const { createPluginHost } = require('../public/plugin-host');

test('retains transport readiness for plugins loaded after the connection opens', () => {
  const host = createPluginHost();
  host.notifyTransportOpen();
  assert.equal(host.isTransportOpen(), true);

  host.notifyTransportClosed();
  assert.equal(host.isTransportOpen(), false);
});

test('accepts only display states present in the current model assets', () => {
  const host = createPluginHost();
  host.registerDisplayStateResolver('example-plugin', () => 'neutral_example');

  assert.equal(host.resolveDisplayState({
    baseStateKey: 'neutral_idle',
    assets: { neutral_idle: '/idle.webm', neutral_example: '/example.webm' }
  }), 'neutral_example');

  assert.equal(host.resolveDisplayState({
    baseStateKey: 'neutral_idle',
    assets: { neutral_idle: '/idle.webm' }
  }), 'neutral_idle');
});

test('formats control-to-overlay events without exposing the WebSocket', () => {
  const host = createPluginHost();
  let sent;
  host.setPluginSender(message => {
    sent = message;
    return true;
  });

  assert.equal(host.sendPluginEvent('example-plugin', 'changed', { value: 2 }), true);
  assert.deepEqual(sent, {
    type: 'plugin_event',
    pluginId: 'example-plugin',
    event: 'changed',
    data: { value: 2 }
  });
});

test('replays an overlay event received before the plugin subscribes', () => {
  const host = createPluginHost();
  const message = {
    type: 'plugin_event',
    pluginId: 'example-plugin',
    event: 'restored',
    data: { value: 3 }
  };

  host.emitPluginEvent(message);
  const received = [];
  host.on('plugin-event', event => received.push(event));

  assert.deepEqual(received, [message]);
});
