(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createPluginHost: factory };
  }
  if (root) root.ASAPluginHost = factory();
})(typeof window !== 'undefined' ? window : null, function createPluginHost() {
  'use strict';

  const events = new EventTarget();
  const displayResolvers = new Map();
  const latestPluginEvents = new Map();
  let audioInput = null;
  let displayUpdater = null;
  let pluginSender = null;
  let transportOpen = false;

  function emit(name, detail) {
    events.dispatchEvent(new CustomEvent(name, { detail }));
  }

  return Object.freeze({
    version: 1,

    on(name, handler) {
      const listener = event => handler(event.detail);
      events.addEventListener(name, listener);
      if (name === 'plugin-event') {
        for (const message of latestPluginEvents.values()) {
          try {
            handler(message);
          } catch (error) {
            console.warn('[plugin] Replayed event handler failed:', error);
          }
        }
      }
      return () => events.removeEventListener(name, listener);
    },

    setAudioInput(input) {
      audioInput = input;
      emit('audio-input', input);
    },

    clearAudioInput() {
      audioInput = null;
      emit('audio-input', null);
    },

    getAudioInput() {
      return audioInput;
    },

    registerDisplayStateResolver(pluginId, resolver) {
      if (typeof pluginId !== 'string' || typeof resolver !== 'function') return;
      displayResolvers.set(pluginId, resolver);
    },

    resolveDisplayState(context) {
      let stateKey = context.baseStateKey;
      for (const [pluginId, resolver] of displayResolvers) {
        try {
          const candidate = resolver({ ...context, baseStateKey: stateKey });
          if (typeof candidate === 'string' && context.assets[candidate]) stateKey = candidate;
        } catch (error) {
          console.warn(`[plugin:${pluginId}] State resolver failed:`, error);
        }
      }
      return stateKey;
    },

    setDisplayUpdater(updater) {
      displayUpdater = typeof updater === 'function' ? updater : null;
    },

    requestDisplayUpdate() {
      if (displayUpdater) displayUpdater();
    },

    setPluginSender(sender) {
      pluginSender = typeof sender === 'function' ? sender : null;
    },

    notifyTransportOpen() {
      transportOpen = true;
      emit('transport-open');
    },

    notifyTransportClosed() {
      transportOpen = false;
      emit('transport-closed');
    },

    isTransportOpen() {
      return transportOpen;
    },

    sendPluginEvent(pluginId, event, data) {
      if (!pluginSender) return false;
      return pluginSender({ type: 'plugin_event', pluginId, event, data });
    },

    emitPluginEvent(message) {
      if (typeof message?.pluginId === 'string') {
        latestPluginEvents.set(message.pluginId, message);
      }
      emit('plugin-event', message);
    }
  });
});
