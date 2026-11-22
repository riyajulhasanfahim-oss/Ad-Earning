import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { AdSessionRecord, Advertisement } from '../types';
import { buildPlacementLaunchUrl } from '../services/adNetworkPolicy';
import { formatPoints } from '../services/appService';
import {
  cancelPendingAdSession,
  confirmSdkAdSessionReward,
  normalizeAdDurationSeconds,
} from '../services/dashboardService';
import {
  extractMonetagZoneId,
  isTelegramMiniAppContext,
  showMonetagRewardedAd,
} from '../services/monetagSdk';
import {
  extractAppLixirSiteId,
  extractGamRewardedUnitPath,
  showAppLixirRewardedAd,
  showGoogleRewardedAd,
} from '../services/webRewardedSdk';
import { GlassCard } from '../components/ui/GlassCard';

interface AdWatchSessionPageProps {
  ad: Advertisement;
  session: AdSessionRecord;
  onBackToAds: () => void;
}

export const AdWatchSessionPage: React.FC<AdWatchSessionPageProps> = ({
  ad,
  session,
  onBackToAds,
}) => {
  const requiredDuration = normalizeAdDurationSeconds(ad.estimatedDuration);
  const startedAtMs = useMemo(
    () => (session.createdAtMillis > 0 ? session.createdAtMillis : Date.now()),
    [session.createdAtMillis],
  );
  const [elapsedSec, setElapsedSec] = useState<number>(() =>
    Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
  );
  const [sdkStatus, setSdkStatus] = useState<'idle' | 'launching' | 'verified' | 'failed'>('idle');
  const [sdkError, setSdkError] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifiedTxId, setVerifiedTxId] = useState('');
  const sdkVerifyRequestedRef = useRef('');
  const sdkAutoLaunchedRef = useRef('');
  const onBackRef = useRef(onBackToAds);
  onBackRef.current = onBackToAds;

  const isTmaContext = useMemo(() => isTelegramMiniAppContext(), []);
  const monetagZoneId = extractMonetagZoneId(ad.placementOrUrl);
  const gamUnitPath = extractGamRewardedUnitPath(ad.placementOrUrl);
  const applixirSiteId = extractAppLixirSiteId(ad.placementOrUrl, ad.adNetwork);
  const monetagBlockedOutsideTma = Boolean(monetagZoneId && !isTmaContext);
  const launchUrl = buildPlacementLaunchUrl(ad.placementOrUrl, {
    sessionId: session.sessionId,
    userId: session.userId,
    adId: ad.adId,
    adNetwork: ad.adNetwork,
  });

  useEffect(() => {
    const sync = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    sync();
    const timer = window.setInterval(sync, 250);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, [startedAtMs]);

  const remainingSec = Math.max(0, requiredDuration - elapsedSec);
  const timerDone = remainingSec === 0;
  const progressPct = Math.min(100, Math.round((elapsedSec / requiredDuration) * 100));

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
    if (sdkVerifyRequestedRef.current === session.sessionId) return;
    sdkVerifyRequestedRef.current = session.sessionId;
    void confirmSdkAdSessionReward({
      sessionId: session.sessionId,
      adId: ad.adId,
      sdkZoneId: activeSdkRef,
      watchedSeconds: elapsedSec,
      sdkVerified: true,
      platformContext: gamUnitPath ? 'web_gpt' : 'telegram_mini_app',
    }).then((res) => {
      if (res.ok) {
        setVerifiedTxId(res.txId || session.sessionId);
      } else {
        setVerifyError(res.error || 'Verification did not complete.');
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

  const handleLaunchSdkAd = async () => {
    if (gamUnitPath) {
      setSdkStatus('launching');
      setSdkError('');
      const outcome = await showGoogleRewardedAd(gamUnitPath);
      if (outcome.verified) {
        setSdkStatus('verified');
      } else {
        setSdkStatus('failed');
        setSdkError(outcome.error || 'Advertisement could not be completed.');
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
        setSdkError(outcome.error || 'Video advertisement did not complete.');
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
      setSdkError(outcome.error || 'Advertisement closed early. 0 points credited.');
    }
  };

  useEffect(() => {
    if (session.status !== 'pending') return;
    if (!applixirSiteId && !gamUnitPath && !(monetagZoneId && isTmaContext)) return;
    if (sdkAutoLaunchedRef.current === session.sessionId) return;
    sdkAutoLaunchedRef.current = session.sessionId;
    void handleLaunchSdkAd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applixirSiteId, gamUnitPath, monetagZoneId, isTmaContext, session.sessionId, session.status]);

  const isCompleted = session.status === 'completed' || Boolean(verifiedTxId);

  useEffect(() => {
    if (!isCompleted) return;
    const timer = window.setTimeout(() => {
      onBackRef.current();
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [isCompleted]);

  const handleBack = async () => {
    if (session.status === 'pending' && !verifiedTxId && !timerDone) {
      await cancelPendingAdSession(session.sessionId, 'CLOSED_BEFORE_30_SECONDS');
    }
    onBackToAds();
  };

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <GlassCard variant="gradient" className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-cyan-200 truncate">
              {ad.adNetwork}
            </p>
            <h2 className="text-xl sm:text-2xl font-extrabold font-display text-white truncate">
              {ad.adName}
            </h2>
          </div>
          <div className="text-right shrink-0 tabular-nums">
            <p className="text-xs text-violet-100/80">Reward</p>
            <p className="text-2xl font-extrabold font-display text-amber-300">
              +{formatPoints(ad.rewardPoints)} Pts
            </p>
          </div>
        </div>

        <div className="space-y-2 pt-3 border-t border-white/20">
          <div className="flex items-center justify-between text-xs text-violet-100 tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {isCompleted ? 'Completed' : `${remainingSec}s remaining`}
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="relative h-2.5 rounded-full bg-black/35 border border-white/15 overflow-hidden">
            <div
              className="relative h-full rounded-full bg-gradient-to-r from-violet-400 via-cyan-300 to-emerald-400 transition-all duration-300"
              style={{ width: `${isCompleted ? 100 : Math.max(3, progressPct)}%` }}
            />
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5 space-y-4">
        {isCompleted ? (
          <div className="ad-success-pop p-5 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 flex items-center gap-3.5">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
            <div className="space-y-0.5">
              <p className="text-sm sm:text-base font-extrabold text-emerald-300">
                Reward Credited (+{formatPoints(session.expectedRewardPoints)} Points)
              </p>
              <p className="text-xs text-slate-200">
                আপনার Wallet-এ Points যোগ হয়েছে।
              </p>
            </div>
          </div>
        ) : session.status === 'rejected' || verifyError || sdkError ? (
          <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-400/35 flex items-start gap-3">
            <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-extrabold text-rose-300">Verification Incomplete</p>
              <p className="text-xs text-slate-200 leading-relaxed">
                {session.rejectionReason ||
                  verifyError ||
                  sdkError ||
                  'Advertisement was not completed.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-center gap-3">
            {timerDone ? (
              <Loader2 className="w-5 h-5 text-cyan-300 animate-spin shrink-0" />
            ) : (
              <Sparkles className="w-5 h-5 text-violet-300 shrink-0" />
            )}
            <p className="text-xs sm:text-sm font-semibold text-white">
              {timerDone
                ? 'Timer complete! Confirming your reward...'
                : `Keep watching for ${remainingSec}s to earn your reward.`}
            </p>
          </div>
        )}

        {!isCompleted && session.status !== 'rejected' && (
          <div className="space-y-2.5">
            {launchUrl && (
              <a
                href={launchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[46px] px-5 py-3 rounded-full brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2"
              >
                <span>Open Advertisement</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            )}

            {(gamUnitPath || applixirSiteId || (monetagZoneId && !monetagBlockedOutsideTma)) && (
              <button
                type="button"
                onClick={() => void handleLaunchSdkAd()}
                disabled={sdkStatus === 'launching'}
                className="w-full min-h-[46px] px-5 py-3 rounded-full brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>
                  {sdkStatus === 'launching' ? 'Showing Advertisement...' : 'Open Advertisement'}
                </span>
              </button>
            )}
          </div>
        )}
      </GlassCard>

      <button
        type="button"
        onClick={() => void handleBack()}
        className="w-full min-h-[46px] px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Close</span>
      </button>
    </div>
  );
};
