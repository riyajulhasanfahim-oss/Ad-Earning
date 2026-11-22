import { AdType, Advertisement, RewardVerificationMethod } from '../types';

export interface AdNetworkAdapter {
  key: string;
  displayName: string;
  supportedTypes: AdType[];
  defaultVerificationMethod: RewardVerificationMethod;
  supportsIncentivizedDefault: boolean;
  callbackSummary: string;
  instructions: string[];
}

const AD_NETWORK_REGISTRY: AdNetworkAdapter[] = [
  {
    key: 'monetag',
    displayName: 'Monetag',
    supportedTypes: ['rewarded', 'direct_link', 'other'],
    defaultVerificationMethod: 's2s_postback',
    supportsIncentivizedDefault: true,
    callbackSummary:
      'Supports Monetag Rewarded SDK & Server-to-Server (S2S) postback verification with unique transaction IDs.',
    instructions: [
      'Launch the authorized Monetag rewarded placement below.',
      'Complete the sponsored video or interactive step without closing early.',
      'Wait for the Monetag S2S postback to notify our backend before returning.',
    ],
  },
  {
    key: 'adsterra',
    displayName: 'Adsterra',
    supportedTypes: ['rewarded', 'direct_link', 'other'],
    defaultVerificationMethod: 's2s_postback',
    supportsIncentivizedDefault: false,
    callbackSummary:
      'Requires explicit Adsterra incentivized traffic approval and S2S postback callback before awarding points.',
    instructions: [
      'Open only placements explicitly approved for incentivized traffic.',
      'Complete the required partner action so Adsterra triggers a verified S2S postback.',
      'Points appear in your wallet automatically once the backend validates the callback.',
    ],
  },
  {
    key: 'rewarded_partner',
    displayName: 'Authorized Rewarded Partner',
    supportedTypes: ['rewarded', 'other'],
    defaultVerificationMethod: 'sdk_callback',
    supportsIncentivizedDefault: true,
    callbackSummary:
      'Verified via signed SDK completion callback or S2S webhook with anti-duplicate transaction tracking.',
    instructions: [
      'View the sponsored rewarded placement in full.',
      'Wait for the partner network callback confirmation.',
      'Check verification status below or in your Ad History.',
    ],
  },
];

export function getAdNetworkAdapter(networkName: string): AdNetworkAdapter {
  const lower = networkName.toLowerCase();
  if (lower.includes('monetag')) return AD_NETWORK_REGISTRY[0];
  if (lower.includes('adsterra')) return AD_NETWORK_REGISTRY[1];
  return {
    ...AD_NETWORK_REGISTRY[2],
    displayName: networkName || 'Authorized Ad Network',
  };
}

export function getSupportedNetworks(): AdNetworkAdapter[] {
  return AD_NETWORK_REGISTRY;
}

export interface PolicyCheckResult {
  compliant: boolean;
  reason?: string;
}

/**
 * Enforces Rewarded Advertising Policy:
 * 1. Direct Links without explicit incentivized traffic approval CANNOT be reward-eligible.
 * 2. Ads without server-side verification ('none') CANNOT be activated for rewards.
 */
export function checkAdPolicyCompliance(ad: {
  adType: AdType;
  rewardVerificationMethod: RewardVerificationMethod;
  incentivizedTrafficAllowed: boolean;
}): PolicyCheckResult {
  if (ad.rewardVerificationMethod === 'none') {
    return {
      compliant: false,
      reason:
        'Ads without server-side verification (S2S Postback or SDK Callback) cannot be activated for rewards.',
    };
  }
  if (ad.adType === 'direct_link' && !ad.incentivizedTrafficAllowed) {
    return {
      compliant: false,
      reason:
        'Direct Link ads cannot be activated for rewards unless Incentivized Traffic is explicitly approved by the Ad Network.',
    };
  }
  return { compliant: true };
}

export function isAdWithinSchedule(ad: Advertisement, dhakaDate: string): boolean {
  if (ad.startDate && dhakaDate < ad.startDate) return false;
  if (ad.endDate && dhakaDate > ad.endDate) return false;
  return true;
}

export function formatAdTypeLabel(adType: AdType): string {
  switch (adType) {
    case 'rewarded':
      return 'Rewarded Ad';
    case 'direct_link':
      return 'Direct Link Ad';
    case 'other':
    default:
      return 'Other Ad';
  }
}

export function formatVerificationMethodLabel(method: RewardVerificationMethod): string {
  switch (method) {
    case 's2s_postback':
      return 'S2S Postback';
    case 'sdk_callback':
      return 'SDK Callback';
    case 'none':
    default:
      return 'Unverified (Disabled)';
  }
}

export function buildPlacementLaunchUrl(
  placementOrUrl: string,
  params: { sessionId: string; userId: string; adId: string; adNetwork?: string },
): string | null {
  const trimmed = placementOrUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  try {
    const resolved = trimmed
      .replace(/\{sessionId\}|\{session_id\}|\{ymid\}/gi, encodeURIComponent(params.sessionId))
      .replace(/\{userId\}|\{user_id\}|\{subid\}/gi, encodeURIComponent(params.userId))
      .replace(/\{adId\}|\{ad_id\}/gi, encodeURIComponent(params.adId));

    const url = new URL(resolved);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    if (!url.searchParams.has('session_id') && !trimmed.toLowerCase().includes('session')) {
      url.searchParams.set('session_id', params.sessionId);
    }
    if (!url.searchParams.has('subid') && !trimmed.toLowerCase().includes('user')) {
      url.searchParams.set('subid', params.userId);
    }
    if (
      params.adNetwork?.toLowerCase().includes('monetag') &&
      !url.searchParams.has('ymid')
    ) {
      url.searchParams.set('ymid', params.sessionId);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export type AdLaunchKind = 'monetag_sdk' | 'external_url' | 'unconfigured';

export function resolveAdLaunchKind(placementOrUrl: string): AdLaunchKind {
  const trimmed = placementOrUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return 'external_url';
  }
  if (/^(\d{4,15})$/.test(trimmed) || /^(?:monetag:\/\/|monetag:|zone:|zone_id[:=])(\d{4,15})$/i.test(trimmed)) {
    return 'monetag_sdk';
  }
  return 'unconfigured';
}

