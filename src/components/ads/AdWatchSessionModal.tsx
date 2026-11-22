import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Gift,
  Loader2,
  Play,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { AdSessionRecord, Advertisement } from '../../types';
import { buildPlacementLaunchUrl } from '../../services/adNetworkPolicy';
import { formatPoints } from '../../services/appService';
import {
  cancelPendingAdSession,
  confirmSdkAdSessionReward,
  DAILY_CHECKIN_BONUS_AD_ID,
  normalizeAdDurationSeconds,
} from '../../services/dashboardService';
import {
  extractMonetagZoneId,
  isTelegramMiniAppContext,
  showMonetagRewardedAd,
} from '../../services/monetagSdk';
import {
  extractAppLixirSiteId,
  extractGamRewardedUnitPath,
  showAppLixirRewardedAd,
  showGoogleRewardedAd,
} from '../../services/webRewardedSdk';

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
  const [isAutoClosing, setIsAutoClosing] = useState(false);

  const sdkLaunchedForSessionRef = useRef<string>('');
  const sdkVerifyRequestedRef = useRef<string>('');
  const successToastedRef = useRef<string>('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const isTmaContext = useMemo(() => isTelegramMiniAppContext(), []);
  const monetagZoneId = useMemo(
    () => extractMonetagZoneId(ad.placementOrUrl),
    [ad.placementOrUrl],
  );
  const gamUnitPath = useMemo(
    () => extractGamRewardedUnitPath(ad.placementOrUrl),
    [ad.placementOrUrl],
  );
  const applixirSiteId = useMemo(
    () => extractAppLixirSiteId(ad.placementOrUrl, ad.adNetwork),
    [ad.placementOrUrl, ad.adNetwork],
  );
  const monetagBlockedOutsideTma = Boolean(monetagZoneId && !isTmaContext);
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

  const launchSdkOrWebAd = async () => {
    if (gamUnitPath) {
      setSdkStatus('launching');
      setSdkError('');
      const outcome = await showGoogleRewardedAd(gamUnitPath);
      if (outcome.verified) {
        setSdkStatus('verified');
      } else {
        setSdkStatus('failed');
        setSdkError(outcome.error || 'Advertisement could not be completed. 0 points credited.');
      }
      return;
    }

    if (applixirSiteId) {
      setSdkStatus('launching');
      setSdkError('');
      const outcome = await showAppLixirRewardedAd(
        applixirSiteId,
        session.userId,
        session.sessionId,
        ad.adId,
      );
      if (outcome.verified) {
        setSdkStatus('verified');
      } else {
        setSdkStatus('failed');
        setSdkError(outcome.error || 'Video advertisement was not completed. 0 points credited.');
      }
      return;
    }

    if (!monetagZoneId) return;
    if (!isTmaContext) {
      setSdkStatus('failed');
      setSdkError('This advertisement requires an authorized web link placement.');
      return;
    }

    setSdkStatus('launching');
    setSdkError('');
    const outcome = await showMonetagRewardedAd(monetagZoneId, session.sessionId);
    if (outcome.verified) {
      setSdkStatus('verified');
    } else {
      setSdkStatus('failed');
      setSdkError(
        outcome.error || 'Advertisement was closed before completion. 0 points credited.',
      );
    }
  };

  useEffect(() => {
    if (!monetagZoneId && !gamUnitPath && !applixirSiteId) return;
    if (sdkLaunchedForSessionRef.current === session.sessionId) return;
    sdkLaunchedForSessionRef.current = session.sessionId;
    void launchSdkOrWebAd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monetagZoneId, gamUnitPath, applixirSiteId, session.sessionId]);

  // Confirm authorized SDK reward ONLY after >=30s elapsed AND network callback verified
  useEffect(() => {
    const activeSdkRef = gamUnitPath || (isTmaContext ? monetagZoneId : null);
    if (
      !timerDone ||
      !activeSdkRef ||
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
      sdkZoneId: activeSdkRef,
      watchedSeconds: elapsedSec,
      sdkVerified: true,
      platformContext: gamUnitPath ? 'web_gpt' : 'telegram_mini_app',
    }).then((res) => {
      setVerifyingServer(false);
      if (res.ok) {
        setVerifiedTxId(res.txId || session.sessionId);
      } else {
        setVerifyError(res.error || 'Verification did not complete. 0 points credited.');
      }
    });
  }, [
    timerDone,
    monetagZoneId,
    gamUnitPath,
    isTmaContext,
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
  const isMonetag = ad.adNetwork.toLowerCase().includes('monetag');
  const isDailyBonus = ad.adId === DAILY_CHECKIN_BONUS_AD_ID;

  // Show celebratory toast and smoothly auto-close popup once verified & credited
  useEffect(() => {
    if (!isCompleted) return;
    if (successToastedRef.current !== session.sessionId) {
      successToastedRef.current = session.sessionId;
      onSuccessToast?.(
        `+${formatPoints(session.expectedRewardPoints)} Points আপনার Wallet-এ যোগ হয়েছে!`,
      );
    }

    let exitTimer: number | undefined;
    const celebrationTimer = window.setTimeout(() => {
      setIsAutoClosing(true);
      exitTimer = window.setTimeout(() => {
        onCloseRef.current();
      }, 260);
    }, 1450);

    return () => {
      window.clearTimeout(celebrationTimer);
      if (exitTimer !== undefined) {
        window.clearTimeout(exitTimer);
      }
    };
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
    onInfoToast?.('Advertisement closed before verification. 0 points credited.');
    onClose();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#030716]/85 backdrop-blur-md transition-opacity duration-300 ${
        isAutoClosing ? 'opacity-0' : 'opacity-100'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="active-ad-session-title"
    >
      <div
        className={`w-full max-w-md rounded-3xl bg-gradient-to-b from-[#0E163D] to-[#070B22] border border-cyan-400/30 shadow-[0_24px_70px_rgba(2,6,23,0.92)] overflow-hidden max-h-[90dvh] flex flex-col transition-transform duration-300 ${
          isAutoClosing ? 'scale-95' : 'scale-100'
        }`}
      >
        {/* Clean Header: Network Logo + Ad Name + Close Button */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center font-extrabold text-base text-white shrink-0 border ${
                isMonetag
                  ? 'bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-600 border-cyan-200/50 shadow-[0_0_18px_rgba(34,211,238,0.5)]'
                  : 'bg-gradient-to-br from-violet-500 to-indigo-600 border-violet-300/50 shadow-[0_0_16px_rgba(139,92,246,0.45)]'
              }`}
            >
              {isDailyBonus ? (
                <Gift className="w-5 h-5" />
              ) : isMonetag ? (
                'm'
              ) : (
                ad.adNetwork.slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-300 truncate">
                {ad.adNetwork}
              </p>
              <h2
                id="active-ad-session-title"
                className="text-base sm:text-lg font-extrabold font-display text-white truncate"
              >
                {ad.adName}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCloseClick}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white shrink-0 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {isCompleted ? (
            /* Animated Success Celebration State (Auto-Closes Shortly) */
            <div className="ad-success-pop p-5 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-cyan-500/15 to-violet-500/15 border border-emerald-400/50 text-center space-y-3 shadow-[0_12px_36px_-10px_rgba(16,185,129,0.55)]">
              <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-emerald-400/25 animate-ping" />
                <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-[#04141A] shadow-[0_0_24px_rgba(52,211,153,0.75)]">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-300/40 text-xs font-extrabold text-emerald-200">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Reward Credited!</span>
                </div>
                <p className="text-2xl font-extrabold font-display text-amber-300 tabular-nums">
                  +{formatPoints(session.expectedRewardPoints)} Points
                </p>
                <p className="text-xs text-slate-200">
                  আপনার Wallet ব্যালেন্স আপডেট হয়েছে।
                </p>
              </div>
              <div className="h-2 rounded-full bg-black/40 border border-emerald-400/30 overflow-hidden">
                <div className="h-full w-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400" />
              </div>
            </div>
          ) : (
            <>
              {/* 30s Countdown Timer + Animated Progress Bar + Reward Points */}
              <div className="p-4 rounded-2xl bg-[#0B1233] border border-violet-400/25 space-y-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center font-extrabold text-base tabular-nums border transition-colors ${
                        timerDone
                          ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                          : 'bg-violet-500/20 border-violet-400/50 text-white'
                      }`}
                    >
                      {remainingSec}s
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-bold text-white">
                        {timerDone ? 'Timer Complete!' : `${remainingSec}s Remaining`}
                      </p>
                      <p className="text-[11px] text-slate-300 tabular-nums">
                        {Math.min(elapsedSec, requiredDuration)} / {requiredDuration}s
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 tabular-nums">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">Reward</p>
                    <p className="text-lg font-extrabold font-display text-amber-300">
                      +{formatPoints(ad.rewardPoints)} Pts
                    </p>
                  </div>
                </div>

                {/* Smooth Animated Progress Bar */}
                <div className="relative h-2.5 rounded-full bg-black/45 border border-white/10 overflow-hidden">
                  <div
                    className="relative h-full rounded-full bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400 transition-all duration-300 overflow-hidden"
                    style={{ width: `${Math.max(3, progressPct)}%` }}
                  >
                    <span
                      aria-hidden="true"
                      className="ad-progress-shimmer absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Clean Status Message (Rejected / Failed / Verifying / Countdown) */}
              {isRejected ? (
                <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-400/40 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs sm:text-sm font-extrabold text-rose-300">
                      Session Cancelled — 0 Points Credited
                    </p>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {session.rejectionReason || 'Verification was not completed.'}
                    </p>
                  </div>
                </div>
              ) : verifyError || sdkStatus === 'failed' ? (
                <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-400/40 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs sm:text-sm font-extrabold text-rose-300">
                      Verification Incomplete
                    </p>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {verifyError || sdkError}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-center gap-3">
                  {timerDone || verifyingServer ? (
                    <Loader2 className="w-5 h-5 text-cyan-300 animate-spin shrink-0" />
                  ) : (
                    <Sparkles className="w-5 h-5 text-violet-300 shrink-0" />
                  )}
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {!timerDone
                      ? 'Keep the advertisement open until the countdown reaches 0s.'
                      : 'Confirming your reward automatically...'}
                  </p>
                </div>
              )}

              {/* Early Close Confirmation Prompt */}
              {confirmEarlyClose && !isRejected && (
                <div className="p-4 rounded-2xl bg-amber-500/15 border border-amber-400/40 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-100 leading-relaxed">
                      Closing before verification finishes awards 0 points. Continue watching?
                    </p>
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
                      <span>Close (0 Pts)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Advertisement Open / Retry Action Button */}
              {!isRejected && (
                <div className="space-y-2">
                  {launchUrl && (
                    <div className="space-y-1.5">
                      {popupBlocked && (
                        <p className="text-[11px] text-amber-300 font-semibold text-center">
                          Tap the button below to open the advertisement:
                        </p>
                      )}
                      <a
                        href={launchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full min-h-[46px] px-4 py-2.5 rounded-full brand-button text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2"
                      >
                        <span>Open Advertisement</span>
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  )}

                  {(monetagZoneId || gamUnitPath || applixirSiteId) &&
                    sdkStatus === 'failed' &&
                    !monetagBlockedOutsideTma && (
                      <button
                        type="button"
                        onClick={() => void launchSdkOrWebAd()}
                        className="w-full min-h-[44px] px-4 rounded-full brand-button text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        <span>Open Advertisement</span>
                      </button>
                    )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Clean Close Footer */}
        <div className="px-5 py-3.5 border-t border-white/10 bg-[#06091B]/75">
          {isCompleted || isRejected ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[44px] rounded-full brand-button text-white text-sm font-bold"
            >
              Close
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCloseClick}
              className="w-full min-h-[42px] rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 text-xs sm:text-sm font-bold"
            >
              {timerDone ? 'Close' : `Close (${remainingSec}s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
