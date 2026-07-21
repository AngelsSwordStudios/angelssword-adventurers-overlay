function createPluginEventState() {
  const latestByPlugin = new Map();

  return {
    remember(message) {
      latestByPlugin.set(message.pluginId, message);
    },

    replay(send) {
      for (const message of latestByPlugin.values()) send(message);
    }
  };
}

module.exports = { createPluginEventState };
