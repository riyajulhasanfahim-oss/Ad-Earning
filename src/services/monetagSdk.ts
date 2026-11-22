const loadedSdkZones = new Map<string, Promise<boolean>>();

/**
 * Extracts a numeric Monetag Zone ID when the Admin configured a zone code
 * (e.g. "8912345", "zone:8912345", or "monetag://8912345").
 * Returns null for http(s):// external URLs.
 */
export function extractMonetagZoneId(placementOrUrl: string): string | null {
  const trimmed = placementOrUrl.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return null;
  }
  const directDigits = trimmed.match(/^(\d{4,15})$/);
  if (directDigits) {
    return directDigits[1];
  }
  const prefixed = trimmed.match(/^(?:monetag:\/\/|monetag:|zone:|zone_id[:=])(\d{4,15})$/i);
  if (prefixed) {
    return prefixed[1];
  }
  return null;
}

function getSdkFunctionName(zoneId: string): string {
  return `show_${zoneId}`;
}

function getGlobalSdkFn(
  zoneId: string,
): ((opts?: Record<string, unknown>) => Promise<unknown> | unknown) | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as Record<string, unknown>)[getSdkFunctionName(zoneId)];
  return typeof candidate === 'function'
    ? (candidate as (opts?: Record<string, unknown>) => Promise<unknown> | unknown)
    : null;
}

/**
 * Preloads Monetag Rewarded SDK script (`https://libtl.com/sdk.js`) for a numeric Zone ID
 * so clicking "Watch Ad" can invoke the ad immediately within the user interaction.
 */
export function preloadMonetagSdk(zoneId: string): Promise<boolean> {
  if (typeof document === 'undefined' || !/^\d{4,15}$/.test(zoneId)) {
    return Promise.resolve(false);
  }
  if (getGlobalSdkFn(zoneId)) {
    return Promise.resolve(true);
  }
  const existing = loadedSdkZones.get(zoneId);
  if (existing) {
    return existing;
  }

  const promise = new Promise<boolean>((resolve) => {
    const fnName = getSdkFunctionName(zoneId);
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[data-zone="${zoneId}"][data-sdk="${fnName}"]`,
    );

    const pollReady = (attemptsLeft: number) => {
      if (getGlobalSdkFn(zoneId)) {
        resolve(true);
        return;
      }
      if (attemptsLeft <= 0) {
        resolve(false);
        return;
      }
      window.setTimeout(() => pollReady(attemptsLeft - 1), 150);
    };

    if (existingScript) {
      pollReady(20);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://libtl.com/sdk.js';
    script.async = true;
    script.setAttribute('data-zone', zoneId);
    script.setAttribute('data-sdk', fnName);

    const timeout = window.setTimeout(() => {
      resolve(Boolean(getGlobalSdkFn(zoneId)));
    }, 8000);

    script.onload = () => {
      window.clearTimeout(timeout);
      pollReady(12);
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      loadedSdkZones.delete(zoneId);
      resolve(false);
    };

    document.head.appendChild(script);
  });

  loadedSdkZones.set(zoneId, promise);
  return promise;
}

export interface MonetagShowOutcome {
  verified: boolean;
  zoneId: string;
  error?: string;
}

/**
 * Triggers the Monetag Rewarded SDK function (`show_<zoneId>`) and waits for
 * its completion Promise. Rejections or early exits yield verified=false (0 points).
 */
export async function showMonetagRewardedAd(
  zoneId: string,
  sessionId: string,
): Promise<MonetagShowOutcome> {
  if (!/^\d{4,15}$/.test(zoneId)) {
    return { verified: false, zoneId, error: 'Invalid Monetag Zone ID configured.' };
  }

  const ready = await preloadMonetagSdk(zoneId);
  const sdkFn = getGlobalSdkFn(zoneId);
  if (!ready || !sdkFn) {
    return {
      verified: false,
      zoneId,
      error:
        'Monetag SDK could not initialize (check AdBlocker or Zone ID configuration). No reward credited.',
    };
  }

  try {
    let maybePromise: unknown;
    try {
      maybePromise = sdkFn({ ymid: sessionId });
    } catch {
      maybePromise = sdkFn();
    }

    if (
      maybePromise &&
      typeof (maybePromise as Promise<unknown>).then === 'function'
    ) {
      await (maybePromise as Promise<unknown>);
    }

    return { verified: true, zoneId };
  } catch (err) {
    return {
      verified: false,
      zoneId,
      error:
        err instanceof Error && err.message
          ? `Ad was closed or failed before completion (${err.message}).`
          : 'Ad was closed or failed before completion. No reward credited.',
    };
  }
}
