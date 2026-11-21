import React from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
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
  const launchUrl = buildPlacementLaunchUrl(ad.placementOrUrl, {
    sessionId: session.sessionId,
    userId: session.userId,
    adId: ad.adId,
  });

  const renderVerificationStatus = () => {
    if (session.status === 'completed') {
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
                {session.transactionId || session.sessionId}
              </span>
            </p>
          </div>
        </div>
      );
    }

    if (session.status === 'rejected') {
      return (
        <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-400/35 flex items-start gap-3">
          <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-extrabold text-rose-300">Verification Rejected</p>
            <p className="text-xs text-slate-200 leading-relaxed">
              {session.rejectionReason ||
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
            Waiting for Server Verification ({formatVerificationMethodLabel(ad.rewardVerificationMethod)})
          </p>
          <p className="text-xs text-slate-300 leading-relaxed">
            Session <span className="font-mono-num text-violet-300">{session.sessionId}</span> is
            active. Points will be credited automatically as soon as {ad.adNetwork} confirms
            completion via backend callback.
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
            Est. Duration: ~{ad.estimatedDuration} sec
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
        onClick={onBackToAds}
        className="w-full min-h-[48px] px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Ads</span>
      </button>
    </div>
  );
};
