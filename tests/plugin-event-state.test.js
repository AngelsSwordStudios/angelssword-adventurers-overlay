const test = require('node:test');
const assert = require('node:assert/strict');

const { createPluginEventState } = require('../lib/plugin-event-state');

test('replays the latest event for each plugin after an overlay reconnects', () => {
  const state = createPluginEventState();
  state.remember({ type: 'plugin_event', pluginId: 'alpha', event: 'first', data: 1 });
  state.remember({ type: 'plugin_event', pluginId: 'alpha', event: 'latest', data: 2 });
  state.remember({ type: 'plugin_event', pluginId: 'beta', event: 'only', data: 3 });

  const replayed = [];
  state.replay(message => replayed.push(message));

  assert.deepEqual(replayed, [
    { type: 'plugin_event', pluginId: 'alpha', event: 'latest', data: 2 },
    { type: 'plugin_event', pluginId: 'beta', event: 'only', data: 3 }
  ]);
});
