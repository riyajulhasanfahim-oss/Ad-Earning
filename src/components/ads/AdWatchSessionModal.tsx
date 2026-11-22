import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { AdSessionRecord, Advertisement } from '../../types';
import {
  buildPlacementLaunchUrl,
  formatAdTypeLabel,
  formatVerificationMethodLabel,
  getAdNetworkAdapter,
} from '../../services/adNetworkPolicy';
import { formatPoints } from '../../services/appService';
import {
  cancelPendingAdSession,
  confirmSdkAdSessionReward,
  normalizeAdDurationSeconds,
} from '../../services/dashboardService';
import {
  extractMonetagZoneId,
  showMonetagRewardedAd,
} from '../../services/monetagSdk';

interface AdWatchSessionModalProps {
  ad: Advertisement;
  session: AdSessionRecord;
  startedAtMs: number;
  popupBlocked?: boolean;
  onClose: () => void;
  onSuccessToast?: (message: string) => void;
  onInfoToast?: (message: string) => void;
}

export const AdWatchSessionModal: React.FC<AdWatchSessionModalProps> = ({
  ad,
  session,
  startedAtMs,
  popupBlocked = false,
  onClose,
  onSuccessToast,
  onInfoToast,
}) => {
  const requiredDuration = normalizeAdDurationSeconds(ad.estimatedDuration);

  const [elapsedSec, setElapsedSec] = useState<number>(() =>
    Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
  );
  const [sdkStatus, setSdkStatus] = useState<
    'idle' | 'launching' | 'verified' | 'failed'
  >('idle');
  const [sdkError, setSdkError] = useState<string>('');
  const [verifyingServer, setVerifyingServer] = useState(false);
  const [verifyError, setVerifyError] = useState<string>('');
  const [verifiedTxId, setVerifiedTxId] = useState<string>('');
  const [confirmEarlyClose, setConfirmEarlyClose] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const sdkLaunchedForSessionRef = useRef<string>('');
  const sdkVerifyRequestedRef = useRef<string>('');
  const successToastedRef = useRef<string>('');

  const monetagZoneId = useMemo(
    () => extractMonetagZoneId(ad.placementOrUrl),
    [ad.placementOrUrl],
  );
  const launchUrl = useMemo(
    () =>
      buildPlacementLaunchUrl(ad.placementOrUrl, {
        sessionId: session.sessionId,
        userId: session.userId,
        adId: ad.adId,
        adNetwork: ad.adNetwork,
      }),
    [ad.placementOrUrl, session.sessionId, session.userId, ad.adId, ad.adNetwork],
  );
  const adapter = useMemo(() => getAdNetworkAdapter(ad.adNetwork), [ad.adNetwork]);

  // Accurate wall-clock 30s session timer (survives mobile background tab throttling)
  useEffect(() => {
    const syncElapsed = () => {
      const next = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      setElapsedSec(next);
    };
    syncElapsed();

    const interval = window.setInterval(syncElapsed, 250);
    const onVisOrFocus = () => syncElapsed();
    document.addEventListener('visibilitychange', onVisOrFocus);
    window.addEventListener('focus', onVisOrFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisOrFocus);
      window.removeEventListener('focus', onVisOrFocus);
    };
  }, [startedAtMs, session.sessionId]);

  const remainingSec = Math.max(0, requiredDuration - elapsedSec);
  const timerDone = remainingSec === 0;
  const progressPct = Math.min(100, Math.round((elapsedSec / requiredDuration) * 100));

  const launchMonetagZone = async () => {
    if (!monetagZoneId) return;
    setSdkStatus('launching');
    setSdkError('');
    const outcome = await showMonetagRewardedAd(monetagZoneId, session.sessionId);
    if (outcome.verified) {
      setSdkStatus('verified');
    } else {
      setSdkStatus('failed');
      setSdkError(
        outcome.error || 'Ad was closed before completion. Zero points credited.',
      );
    }
  };

  // Auto-launch Monetag SDK immediately when a numeric Zone ID is configured
  useEffect(() => {
    if (!monetagZoneId) return;
    if (sdkLaunchedForSessionRef.current === session.sessionId) return;
    sdkLaunchedForSessionRef.current = session.sessionId;
    void launchMonetagZone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monetagZoneId, session.sessionId]);

  // Trigger backend SDK completion check ONLY after BOTH 30s elapsed AND Monetag SDK confirmed
  useEffect(() => {
    if (
      !timerDone ||
      !monetagZoneId ||
      sdkStatus !== 'verified' ||
      ad.rewardVerificationMethod !== 'sdk_callback' ||
      ad.adType === 'direct_link' ||
      session.status !== 'pending' ||
      verifiedTxId
    ) {
      return;
    }
    if (sdkVerifyRequestedRef.current === session.sessionId) {
      return;
    }
    sdkVerifyRequestedRef.current = session.sessionId;

    setVerifyingServer(true);
    setVerifyError('');

    void confirmSdkAdSessionReward({
      sessionId: session.sessionId,
      adId: ad.adId,
      sdkZoneId: monetagZoneId,
      watchedSeconds: elapsedSec,
      sdkVerified: true,
    }).then((res) => {
      setVerifyingServer(false);
      if (res.ok) {
        setVerifiedTxId(res.txId || session.sessionId);
      } else {
        setVerifyError(
          res.error || 'Server verification did not complete. Zero points credited.',
        );
      }
    });
  }, [
    timerDone,
    monetagZoneId,
    sdkStatus,
    ad.rewardVerificationMethod,
    ad.adType,
    ad.adId,
    session.status,
    session.sessionId,
    elapsedSec,
    verifiedTxId,
  ]);

  const isCompleted = session.status === 'completed' || Boolean(verifiedTxId);
  const isRejected = session.status === 'rejected';

  useEffect(() => {
    if (!isCompleted) return;
    if (successToastedRef.current === session.sessionId) return;
    successToastedRef.current = session.sessionId;
    onSuccessToast?.(
      `Ad verified! +${formatPoints(session.expectedRewardPoints)} Points credited.`,
    );
  }, [isCompleted, session.sessionId, session.expectedRewardPoints, onSuccessToast]);

  const handleCloseClick = () => {
    if (isCompleted || isRejected) {
      onClose();
      return;
    }
    if (!timerDone || sdkStatus === 'failed' || Boolean(verifyError)) {
      setConfirmEarlyClose(true);
      return;
    }
    onClose();
  };

  const handleConfirmAbort = async () => {
    setCancelling(true);
    const reason =
      sdkStatus === 'failed'
        ? 'SDK_CLOSED_OR_BLOCKED'
        : timerDone
          ? 'SESSION_ABORTED'
          : 'CLOSED_BEFORE_30_SECONDS';
    await cancelPendingAdSession(session.sessionId, reason);
    setCancelling(false);
    onInfoToast?.('Ad session closed before verification. 0 points credited.');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#030716]/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="active-ad-session-title"
    >
      <div className="w-full max-w-lg rounded-3xl bg-gradient-to-b from-[#0E163D] to-[#070B22] border border-cyan-400/25 shadow-[0_24px_70px_rgba(2,6,23,0.9)] overflow-hidden max-h-[92dvh] flex flex-col">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
              {ad.adNetwork} · {formatAdTypeLabel(ad.adType)}
            </p>
            <h2
              id="active-ad-session-title"
              className="text-base sm:text-lg font-extrabold font-display text-white truncate"
            >
              {ad.adName}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCloseClick}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white shrink-0"
            aria-label="Close ad session"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Reward & 30s Countdown Banner */}
          <div className="p-4 rounded-2xl bg-[#0B1233] border border-violet-400/25 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center font-extrabold text-sm tabular-nums border ${
                    isCompleted
                      ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-300'
                      : timerDone
                        ? 'bg-cyan-500/20 border-cyan-400/45 text-cyan-200'
                        : 'bg-violet-500/20 border-violet-400/45 text-white'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    `${remainingSec}s`
                  )}
                </div>
                <div>
                  <p className="text-xs font-bold text-white">
                    {isCompleted
                      ? 'Session Completed'
                      : timerDone
                        ? '30-Second Session Complete'
                        : `Viewing Session: ${remainingSec}s Remaining`}
                  </p>
                  <p className="text-[11px] text-slate-300 tabular-nums">
                    {Math.min(elapsedSec, requiredDuration)} / {requiredDuration}s required ·{' '}
                    {formatVerificationMethodLabel(ad.rewardVerificationMethod)}
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0 tabular-nums">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Reward</p>
                <p className="text-base font-extrabold text-amber-300">
                  +{formatPoints(ad.rewardPoints)} Pts
                </p>
              </div>
            </div>

            <div className="h-2 rounded-full bg-black/40 border border-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isCompleted
                    ? 'bg-emerald-400'
                    : 'bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400'
                }`}
                style={{ width: `${isCompleted ? 100 : progressPct}%` }}
              />
            </div>
          </div>

          {/* Early Close Warning Prompt */}
          {confirmEarlyClose && !isCompleted && !isRejected && (
            <div className="p-4 rounded-2xl bg-amber-500/15 border border-amber-400/40 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-extrabold text-amber-200">
                    Incomplete Session — 0 Points Will Be Credited
                  </p>
                  <p className="text-[11px] text-amber-100/85 leading-relaxed">
                    {timerDone
                      ? 'Network verification is not completed yet. Ending this session now cancels the session with 0 points.'
                      : `You must complete the full ${requiredDuration}-second viewing session before earning points. Closing early awards 0 points.`}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmEarlyClose(false)}
                  className="min-h-[36px] px-3.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white"
                >
                  Continue Watching
                </button>
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => void handleConfirmAbort()}
                  className="min-h-[36px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {cancelling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>End Session (0 Pts)</span>
                </button>
              </div>
            </div>
          )}

          {/* Verification Status Box */}
          {isCompleted ? (
            <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-extrabold text-emerald-300">
                  Verified &amp; Reward Credited (+{formatPoints(session.expectedRewardPoints)} Points)
                </p>
                <p className="text-xs text-slate-200 leading-relaxed break-all">
                  Transaction ID:{' '}
                  <span className="font-mono-num text-white font-semibold">
                    {session.transactionId || verifiedTxId || session.sessionId}
                  </span>
                </p>
              </div>
            </div>
          ) : isRejected ? (
            <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-400/40 flex items-start gap-3">
              <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-extrabold text-rose-300">
                  Session Rejected — 0 Points Credited
                </p>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {session.rejectionReason ||
                    'This ad session did not pass server-side verification.'}
                </p>
              </div>
            </div>
          ) : verifyError || sdkStatus === 'failed' ? (
            <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-400/40 flex items-start gap-3">
              <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-sm font-extrabold text-rose-300">
                  Ad Verification Incomplete — 0 Points Credited
                </p>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {verifyError || sdkError}
                </p>
              </div>
            </div>
          ) : verifyingServer ? (
            <div className="p-4 rounded-2xl bg-cyan-500/15 border border-cyan-400/35 flex items-start gap-3">
              <Loader2 className="w-6 h-6 text-cyan-300 animate-spin shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-white">
                  Verifying Completion with Backend...
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Confirming 30-second duration, single-use session ID, daily limit, and{' '}
                  {ad.adNetwork} SDK verification.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-start gap-3">
              <Clock className="w-5 h-5 text-violet-300 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs sm:text-sm font-bold text-white">
                  {!timerDone
                    ? `Keep Watching (${remainingSec}s left before verification)`
                    : ad.rewardVerificationMethod === 's2s_postback'
                      ? `30s Complete — Waiting for ${ad.adNetwork} S2S Postback`
                      : 'Waiting for Monetag Rewarded SDK Confirmation'}
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {ad.adType === 'direct_link'
                    ? 'Direct Link rewards are credited ONLY after your Ad Network confirms an incentivized S2S postback to our backend. Timer completion alone never grants points.'
                    : adapter.callbackSummary}
                </p>
              </div>
            </div>
          )}

          {/* Ad Launch Controls (HTTPS Link or Monetag SDK Retry) */}
          {!isCompleted && !isRejected && (
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  <span>Session ID:</span>
                </span>
                <span className="font-mono-num text-slate-200 truncate">{session.sessionId}</span>
              </div>

              {launchUrl && (
                <div className="space-y-1.5">
                  {popupBlocked && (
                    <p className="text-[11px] text-amber-300 font-semibold">
                      Your browser blocked auto-opening the ad tab. Tap the button below to open it
                      now:
                    </p>
                  )}
                  <a
                    href={launchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl brand-button text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2"
                  >
                    <span>Open {ad.adNetwork} Advertisement</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              )}

              {monetagZoneId && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-slate-300">
                    Monetag Zone <span className="font-mono-num text-white">{monetagZoneId}</span>:{' '}
                    <span className="font-semibold text-cyan-300">
                      {sdkStatus === 'launching'
                        ? 'Showing Ad...'
                        : sdkStatus === 'verified'
                          ? 'SDK Verified'
                          : sdkStatus === 'failed'
                            ? 'Not Completed'
                            : 'Ready'}
                    </span>
                  </span>
                  {sdkStatus === 'failed' && (
                    <button
                      type="button"
                      onClick={() => void launchMonetagZone()}
                      className="min-h-[34px] px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>Retry Ad</span>
                    </button>
                  )}
                </div>
              )}

              {!launchUrl && !monetagZoneId && (
                <p className="text-xs text-amber-300">
                  This ad placement is missing a valid HTTPS URL or Monetag Zone ID in Admin Panel.
                </p>
              )}
            </div>
          )}

          {/* Security Notice */}
          <div className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Single-use backend session · Minimum {requiredDuration}s required · Duplicate claims
              blocked.
            </span>
          </div>
        </div>

        {/* Footer Button */}
        <div className="px-5 py-3.5 border-t border-white/10 bg-[#06091B]/70">
          {isCompleted || isRejected ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[44px] rounded-full brand-button text-white text-sm font-bold"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCloseClick}
              className="w-full min-h-[42px] rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 text-xs sm:text-sm font-bold"
            >
              {timerDone ? 'Close Session Window' : `Cancel Ad (${remainingSec}s remaining)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
