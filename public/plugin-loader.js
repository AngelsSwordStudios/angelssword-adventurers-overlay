(() => {
  'use strict';

  const target = document.currentScript?.dataset?.target;
  if (!['control', 'overlay'].includes(target)) return;

  function loadStyle(url) {
    if (!url) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  }

  function loadScript(url) {
    if (!url) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${url}`));
      document.body.appendChild(script);
    });
  }

  async function loadPlugins() {
    try {
      const response = await fetch('/api/plugins');
      if (!response.ok) throw new Error(`Plugin registry returned ${response.status}`);
      const plugins = await response.json();

      for (const plugin of plugins) {
        const style = plugin[`${target}Style`];
        const script = plugin[`${target}Script`];
        loadStyle(style);
        try {
          await loadScript(script);
          if (script) console.log(`[plugin] Loaded ${plugin.name} ${plugin.version} (${target})`);
        } catch (error) {
          console.warn(`[plugin:${plugin.id}]`, error);
        }
      }
    } catch (error) {
      console.warn('[plugin] Could not load installed plugins:', error);
    }
  }

  loadPlugins();
})();
