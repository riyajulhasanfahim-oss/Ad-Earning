import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { AdSessionRecord, Advertisement } from '../types';
import {
  buildPlacementLaunchUrl,
  formatAdTypeLabel,
  formatVerificationMethodLabel,
  getAdNetworkAdapter,
} from '../services/adNetworkPolicy';
import { formatPoints } from '../services/appService';
import {
  cancelPendingAdSession,
  confirmSdkAdSessionReward,
  normalizeAdDurationSeconds,
} from '../services/dashboardService';
import {
  extractMonetagZoneId,
  showMonetagRewardedAd,
} from '../services/monetagSdk';
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
  const adapter = getAdNetworkAdapter(ad.adNetwork);
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

  const monetagZoneId = extractMonetagZoneId(ad.placementOrUrl);
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
    if (sdkVerifyRequestedRef.current === session.sessionId) return;
    sdkVerifyRequestedRef.current = session.sessionId;
    void confirmSdkAdSessionReward({
      sessionId: session.sessionId,
      adId: ad.adId,
      sdkZoneId: monetagZoneId,
      watchedSeconds: elapsedSec,
      sdkVerified: true,
    }).then((res) => {
      if (res.ok) {
        setVerifiedTxId(res.txId || session.sessionId);
      } else {
        setVerifyError(res.error || 'Server verification did not complete.');
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

  const handleLaunchMonetag = async () => {
    if (!monetagZoneId) return;
    setSdkStatus('launching');
    setSdkError('');
    const outcome = await showMonetagRewardedAd(monetagZoneId, session.sessionId);
    if (outcome.verified) {
      setSdkStatus('verified');
    } else {
      setSdkStatus('failed');
      setSdkError(outcome.error || 'Ad closed early or blocked. Zero points credited.');
    }
  };

  const handleBack = async () => {
    if (session.status === 'pending' && !verifiedTxId && !timerDone) {
      await cancelPendingAdSession(session.sessionId, 'CLOSED_BEFORE_30_SECONDS');
    }
    onBackToAds();
  };

  const renderVerificationStatus = () => {
    if (session.status === 'completed' || verifiedTxId) {
      return (
        <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-400/35 flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-extrabold text-emerald-300">
              Verified &amp; Reward Credited (+{formatPoints(session.expectedRewardPoints)} Points)
            </p>
            <p className="text-xs text-slate-200 leading-relaxed">
              Partner callback verified by our server. Transaction ID:{' '}
              <span className="font-mono-num text-white font-semibold">
                {session.transactionId || verifiedTxId || session.sessionId}
              </span>
            </p>
          </div>
        </div>
      );
    }

    if (session.status === 'rejected' || verifyError || sdkError) {
      return (
        <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-400/35 flex items-start gap-3">
          <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-extrabold text-rose-300">Verification Rejected</p>
            <p className="text-xs text-slate-200 leading-relaxed">
              {session.rejectionReason ||
                verifyError ||
                sdkError ||
                'This ad session did not pass server-side verification or policy checks.'}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="p-4 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-start gap-3">
        <Loader2 className="w-6 h-6 text-violet-300 animate-spin shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-bold text-white">
            {timerDone
              ? `Waiting for Server Verification (${formatVerificationMethodLabel(ad.rewardVerificationMethod)})`
              : `30s Viewing Session Active — ${remainingSec}s remaining`}
          </p>
          <p className="text-xs text-slate-300 leading-relaxed">
            Session <span className="font-mono-num text-violet-300">{session.sessionId}</span> is
            active. Points are credited only after {requiredDuration}s completion AND {ad.adNetwork}{' '}
            callback verification.
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 lg:space-y-6 max-w-3xl mx-auto">
      {/* Advertisement Header Card */}
      <GlassCard variant="gradient" className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-violet-200">
              {ad.adNetwork} · {formatAdTypeLabel(ad.adType)}
            </p>
            <h2 className="text-xl sm:text-2xl font-extrabold font-display text-white">
              {ad.adName}
            </h2>
          </div>
          <div className="text-left sm:text-right shrink-0 tabular-nums">
            <p className="text-xs text-violet-100/80">Authorized Reward</p>
            <p className="text-2xl font-extrabold font-display text-amber-300">
              +{formatPoints(ad.rewardPoints)} Points
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5 flex-wrap pt-3 border-t border-white/20 text-xs text-violet-100 tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            Required Duration: {requiredDuration} sec ({remainingSec}s left)
          </span>
          <span>Verification: {formatVerificationMethodLabel(ad.rewardVerificationMethod)}</span>
          <span className="font-mono-num">Date (Dhaka): {session.dhakaDate}</span>
        </div>
      </GlassCard>

      {/* Live Completion & Verification Status */}
      <GlassCard className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold font-display text-white">
            Completion &amp; Verification Status
          </h3>
          <span className="text-xs font-mono-num text-slate-400">ID: {session.sessionId}</span>
        </div>
        {renderVerificationStatus()}
      </GlassCard>

      {/* Provider Content / Placement View */}
      <GlassCard className="p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-5 h-5 text-violet-400 shrink-0" />
          <h3 className="text-base font-bold font-display text-white">
            Sponsored Partner Placement
          </h3>
        </div>

        <div className="p-4 rounded-2xl bg-[#070C24] border border-violet-400/20 space-y-3">
          <p className="text-xs text-slate-300 leading-relaxed">{adapter.callbackSummary}</p>

          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-xs space-y-1">
            <p className="text-slate-400">Placement / Zone Reference:</p>
            <p className="font-mono-num text-white break-all">{ad.placementOrUrl}</p>
          </div>

          {launchUrl && (
            <a
              href={launchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-[46px] px-5 py-3 rounded-xl brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2"
            >
              <span>Open Partner Placement</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          )}

          {monetagZoneId && (
            <button
              type="button"
              onClick={() => void handleLaunchMonetag()}
              disabled={sdkStatus === 'launching'}
              className="w-full min-h-[46px] px-5 py-3 rounded-xl brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>
                {sdkStatus === 'launching' ? 'Showing Monetag Ad...' : 'Launch Monetag Rewarded Ad'}
              </span>
            </button>
          )}
        </div>
      </GlassCard>

      {/* Instructions Card */}
      <GlassCard className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <h3 className="text-sm font-bold font-display text-white">Viewing Instructions</h3>
        </div>
        {ad.description && (
          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">{ad.description}</p>
        )}
        <ol className="space-y-2 text-xs text-slate-300 list-decimal list-inside">
          {adapter.instructions.map((step, idx) => (
            <li key={idx} className="leading-relaxed">
              {step}
            </li>
          ))}
        </ol>
      </GlassCard>

      <button
        type="button"
        onClick={() => void handleBack()}
        className="w-full min-h-[48px] px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Ads</span>
      </button>
    </div>
  );
};

