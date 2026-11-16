import { type AccountNeedsReconnectWarning } from '@/lib/account-needs-reconnect';
import { VOICE_FALLBACK_WARNING_CODE } from '@/lib/voice-fallback';

export type VoiceFallbackWarning = {
  code: typeof VOICE_FALLBACK_WARNING_CODE;
  fromVoice: string;
  toVoice: string;
};

export type ScheduleWarning = VoiceFallbackWarning | AccountNeedsReconnectWarning;

export function scheduleWarnings(
  voiceFallback: { fromVoice: string; toVoice: string } | null | undefined,
  reconnectWarning: AccountNeedsReconnectWarning | null,
): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  if (voiceFallback !== null && voiceFallback !== undefined) {
    warnings.push({
      code: VOICE_FALLBACK_WARNING_CODE,
      fromVoice: voiceFallback.fromVoice,
      toVoice: voiceFallback.toVoice,
    });
  }
  if (reconnectWarning !== null) warnings.push(reconnectWarning);
  return warnings;
}
