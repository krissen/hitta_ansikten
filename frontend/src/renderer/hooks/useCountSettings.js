/**
 * useCountSettings - React binding for the shared counting-settings store.
 *
 * Returns `[settings, setCountSettings]`: `settings` is the current
 * { gapMinutes, baseline, minImages } (kept in sync via a subscription), and
 * `setCountSettings` shallow-merges a patch into the shared store, which notifies
 * every subscriber (so Räkna spelare and the culling stats panel stay in sync).
 */

import { useState, useEffect } from 'react';
import { getCountSettings, setCountSettings, subscribeCountSettings } from '../shared/countSettings.js';

export function useCountSettings() {
  const [settings, setSettings] = useState(getCountSettings);
  useEffect(() => subscribeCountSettings(setSettings), []);
  return [settings, setCountSettings];
}

export default useCountSettings;
