import { Capacitor } from '@capacitor/core';

// One BLE central connection to a KMM PMask board, behind a uniform
// handle so useComm never touches the platform APIs directly.
//   Web build  -> Web Bluetooth (Chrome/Edge)
//   Android app -> @capacitor-community/bluetooth-le (native central)
// Both deliver NUS TX notifications as DataView to onData.

export const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

export const isNative = Capacitor.isNativePlatform();

const CMD_BINARY = 0x42; // 'B' — force firmware into binary mode

/*
 * requestAndConnect({ onData, onDisconnect }) -> {
 *   id:        stable device id (per platform),
 *   name:      advertised name,
 *   disconnect(): close the link,
 * }
 * Shows the platform's device picker (one device per call).
 */
export async function requestAndConnect({ onData, onDisconnect }) {
  return isNative
    ? nativeRequestAndConnect({ onData, onDisconnect })
    : webRequestAndConnect({ onData, onDisconnect });
}

/* ------------------------------------------------------------------ */
/*  Web Bluetooth                                                     */
/* ------------------------------------------------------------------ */

async function webRequestAndConnect({ onData, onDisconnect }) {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'KMM' }, { namePrefix: 'CPAP' }],
    optionalServices: [NUS_SERVICE_UUID]
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(NUS_SERVICE_UUID);
  const tx = await service.getCharacteristic(NUS_TX_CHARACTERISTIC_UUID);

  await tx.startNotifications();
  tx.addEventListener('characteristicvaluechanged', (event) => {
    onData(event.target.value); // DataView
  });

  // Ensure the firmware is in binary mode
  try {
    const rx = await service.getCharacteristic(NUS_RX_CHARACTERISTIC_UUID);
    await rx.writeValueWithoutResponse(new Uint8Array([CMD_BINARY]));
  } catch (e) { /* RX optional */ }

  device.addEventListener('gattserverdisconnected', () => onDisconnect());

  return {
    id: device.id || `ble-${Date.now()}`,
    name: device.name || 'KMM board',
    disconnect: () => {
      try {
        if (device.gatt?.connected) device.gatt.disconnect();
      } catch (e) { /* already down */ }
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Native (Capacitor / Android)                                      */
/* ------------------------------------------------------------------ */

let bleClientPromise = null;

async function getBleClient() {
  if (!bleClientPromise) {
    bleClientPromise = import('@capacitor-community/bluetooth-le')
      .then(async ({ BleClient }) => {
        await BleClient.initialize({ androidNeverForLocation: true });
        return BleClient;
      });
  }
  return bleClientPromise;
}

async function nativeRequestAndConnect({ onData, onDisconnect }) {
  const BleClient = await getBleClient();

  // Boards advertise the NUS UUID in the scan response, so filtering
  // on the service shows exactly the KMM PMask boards.
  const device = await BleClient.requestDevice({
    services: [NUS_SERVICE_UUID],
  });

  await BleClient.connect(device.deviceId, () => onDisconnect());

  // The plugin requests MTU 512 on Android during connect; the board
  // grants 247, which fits the 204 B DATA frame in one notification.
  await BleClient.startNotifications(
    device.deviceId,
    NUS_SERVICE_UUID,
    NUS_TX_CHARACTERISTIC_UUID,
    (value) => onData(value) // DataView
  );

  try {
    await BleClient.writeWithoutResponse(
      device.deviceId,
      NUS_SERVICE_UUID,
      NUS_RX_CHARACTERISTIC_UUID,
      new DataView(new Uint8Array([CMD_BINARY]).buffer)
    );
  } catch (e) { /* RX optional */ }

  return {
    id: device.deviceId,
    name: device.name || 'KMM board',
    disconnect: () => {
      BleClient.disconnect(device.deviceId).catch(() => {});
    },
  };
}

/* ------------------------------------------------------------------ */
/*  CSV export                                                        */
/* ------------------------------------------------------------------ */

// Web: anchor download. Native: write to Documents, then share sheet.
export async function saveCsv(filename, content) {
  if (!isNative) {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    return null;
  }

  const [{ Filesystem, Directory, Encoding }] = await Promise.all([
    import('@capacitor/filesystem'),
  ]);
  const result = await Filesystem.writeFile({
    path: filename,
    data: content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  });
  return result.uri;
}

export async function shareFiles(uris) {
  if (!isNative || uris.length === 0) return;
  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({
      title: 'KMM PMask recordings',
      files: uris,
    });
  } catch (e) {
    // Share sheet dismissed or unavailable — files are already in Documents
  }
}
