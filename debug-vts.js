// Quick script to dump one VTS UDP packet
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');

socket.on('message', (msg, rinfo) => {
  console.log(`From ${rinfo.address}:${rinfo.port} (${msg.length} bytes)`);
  const json = JSON.parse(msg.toString('utf-8'));
  console.log(JSON.stringify(json, null, 2).substring(0, 3000));

  // Show blend shape structure specifically
  if (json.BlendShapes) {
    console.log('\n--- BlendShapes type:', typeof json.BlendShapes, Array.isArray(json.BlendShapes) ? '(array)' : '');
    console.log('First 3 entries:', JSON.stringify(json.BlendShapes.slice(0, 3), null, 2));
  }
  if (json.blendShapes) {
    console.log('\n--- blendShapes type:', typeof json.blendShapes, Array.isArray(json.blendShapes) ? '(array)' : '');
  }

  // Print all top-level keys
  console.log('\nTop-level keys:', Object.keys(json));

  socket.close();
  process.exit(0);
});

socket.bind(21412, '0.0.0.0', () => {
  console.log('Listening on port 21412 for one VTS packet...');

  // Send request
  const request = JSON.stringify({
    messageType: 'iOSTrackingDataRequest',
    time: 5.0,
    sentBy: 'DebugTool',
    ports: [21412]
  });
  const sendSocket = dgram.createSocket('udp4');
  sendSocket.send(request, 21412, '172.16.10.221', () => {
    sendSocket.close();
    console.log('Request sent, waiting for response...');
  });
});

setTimeout(() => { console.log('Timeout'); process.exit(1); }, 10000);
