export type DeviceHint = 'phone' | 'tablet' | 'unknown';

export interface DeviceHintSnapshot {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentDataMobile?: boolean;
}

export function classifyDeviceHint(snapshot: DeviceHintSnapshot): DeviceHint {
  if (snapshot.userAgentDataMobile === true) return 'phone';
  if (/iPad/i.test(snapshot.userAgent)) return 'tablet';
  if (snapshot.platform === 'MacIntel' && (snapshot.maxTouchPoints ?? 0) > 1) return 'tablet';
  if (/Android/i.test(snapshot.userAgent) && !/Mobile/i.test(snapshot.userAgent)) return 'tablet';
  if (snapshot.userAgentDataMobile === false) return 'unknown';
  if (/iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile|Opera Mini/i.test(snapshot.userAgent)) {
    return 'phone';
  }
  return 'unknown';
}

export function currentDeviceHint(): DeviceHint {
  if (typeof navigator === 'undefined') return 'unknown';
  const browser = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };
  return classifyDeviceHint({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    userAgentDataMobile: browser.userAgentData?.mobile,
  });
}
