# Browser Plugins

AS Adventurer discovers browser plugins from `public/plugins/` when the server
starts. Each plugin lives in a folder whose name matches its manifest ID:

```text
public/plugins/example-plugin/
  plugin.json
  control.js
  overlay.js
  plugin.css
```

```json
{
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "controlScript": "control.js",
  "overlayScript": "overlay.js",
  "controlStyle": "plugin.css",
  "assetStates": ["neutral_example"]
}
```

`controlScript`, `overlayScript`, and `controlStyle` are optional files in the
plugin folder. `assetStates` is required and may be empty. Declared states are
included when the server scans each model folder for animation assets.

The control page provides `<div id="plugin-panels"></div>` for plugin UI. Both
browser targets expose `window.ASAPluginHost` with these version 1 capabilities:

- `on(name, handler)` subscribes to host events and returns an unsubscribe function.
- `getAudioInput()` returns the selected microphone's `audioContext` and
  `sourceNode`, or `null` before the microphone is enabled.
- `sendPluginEvent(pluginId, event, data)` relays a control-plugin event to overlays.
- `registerDisplayStateResolver(pluginId, resolver)` lets an overlay plugin select
  one of the model assets declared in `assetStates`.
- `requestDisplayUpdate()` asks the overlay to evaluate its display state again.
- `isTransportOpen()` reports whether the control WebSocket is connected.

Relevant events are `audio-input`, `transport-open`, `transport-closed`, and
`plugin-event`. The server keeps the latest event for each installed plugin and
replays it when an overlay reconnects.

Browser plugins are trusted local code with the same page access as AS Adventurer.
Only install plugins from sources you trust. Restart AS Adventurer after installing,
updating, or removing a plugin.
