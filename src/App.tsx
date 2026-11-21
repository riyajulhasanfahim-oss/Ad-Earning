/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, LogOut, ShieldAlert, Wrench } from 'lucide-react';
import {
  AdCompletionRecord,
  AdminLogRecord,
  AdminRole,
  AdSessionRecord,
  Advertisement,
  AppPage,
  DailyAdLimitRecord,
  DailyBonusState,
  EconomyConfig,
  FraudLogRecord,
  NotificationItem,
  PaymentMethodConfig,
  PaymentMethodId,
  ReferralLeaderboardEntry,
  ReferralLogRecord,
  ReferralSettingsConfig,
  ReferredUser,
  SiteSettingsConfig,
  TransactionRecord,
  UserProfile,
  WalletDocRecord,
  WalletLedgerEntry,
  WithdrawalRequestRecord,
  WithdrawalSettingsConfig,
} from './types';
import { auth } from './lib/firebase';
import {
  logoutUser,
  mapAuthError,
  subscribeToUserProfile,
  subscribeToUserReferrals,
} from './services/authService';
import {
  appRepository,
  computeDashboardMetrics,
  DEFAULT_DAILY_AD_LIMIT,
  getDefaultDailyBonusState,
  getDefaultReferralSettings,
  getDefaultWithdrawalSettings,
  isAdminUser,
} from './services/appService';
import {
  resolveUserAdminRole,
  initiateAdSession,
  markFirestoreNotificationRead,
  subscribeToActiveAdvertisements,
  subscribeToAdCompletions,
  subscribeToAdminLogs,
  subscribeToAdSessions,
  subscribeToAllAdvertisements,
  subscribeToAllReferrals,
  subscribeToAllWithdrawalRequests,
  subscribeToDailyAdLimit,
  subscribeToDailyBonusState,
  subscribeToFraudLogs,
  subscribeToPaymentMethods,
  subscribeToReferralLeaderboard,
  subscribeToReferralLogs,
  subscribeToReferralSettings,
  subscribeToUserNotifications,
  subscribeToUserTransactions,
  subscribeToUserWallet,
  subscribeToUserWalletLedger,
  subscribeToUserWithdrawalRequests,
  subscribeToWalletAndEconomySettings,
  subscribeToWithdrawalSettings,
} from './services/dashboardService';
import { AppShell } from './components/layout/AppShell';
import type { AuthModalMode } from './components/auth/AuthModal';
import { getDefaultSiteSettings, subscribeToSiteSettings } from './services/adminService';
import { GlassCard } from './components/ui/GlassCard';
import { useToast } from './components/ui/ToastProvider';
import { HomePage } from './pages/HomePage';
import { InstallAppBanner } from './components/pwa/InstallAppBanner';

const AuthModal = lazy(() =>
  import('./components/auth/AuthModal').then((m) => ({ default: m.AuthModal })),
);
const VerifyEmailPage = lazy(() =>
  import('./pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })),
);
const WatchAdsPage = lazy(() =>
  import('./pages/WatchAdsPage').then((m) => ({ default: m.WatchAdsPage })),
);
const AdWatchSessionPage = lazy(() =>
  import('./pages/AdWatchSessionPage').then((m) => ({ default: m.AdWatchSessionPage })),
);
const AdHistoryPage = lazy(() =>
  import('./pages/AdHistoryPage').then((m) => ({ default: m.AdHistoryPage })),
);
const WalletPage = lazy(() =>
  import('./pages/WalletPage').then((m) => ({ default: m.WalletPage })),
);
const WithdrawPage = lazy(() =>
  import('./pages/WithdrawPage').then((m) => ({ default: m.WithdrawPage })),
);
const WithdrawalHistoryPage = lazy(() =>
  import('./pages/WithdrawalHistoryPage').then((m) => ({ default: m.WithdrawalHistoryPage })),
);
const ReferralPage = lazy(() =>
  import('./pages/ReferralPage').then((m) => ({ default: m.ReferralPage })),
);
const TransactionsPage = lazy(() =>
  import('./pages/TransactionsPage').then((m) => ({ default: m.TransactionsPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const AdminApp = lazy(() =>
  import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })),
);
const AdminAdManagerModal = lazy(() =>
  import('./components/ads/AdminAdManagerModal').then((m) => ({ default: m.AdminAdManagerModal })),
);
const AdminWalletSettingsModal = lazy(() =>
  import('./components/wallet/AdminWalletSettingsModal').then((m) => ({
    default: m.AdminWalletSettingsModal,
  })),
);
const AdminWithdrawalManagerModal = lazy(() =>
  import('./components/wallet/AdminWithdrawalManagerModal').then((m) => ({
    default: m.AdminWithdrawalManagerModal,
  })),
);
const AdminReferralSettingsModal = lazy(() =>
  import('./components/referral/AdminReferralSettingsModal').then((m) => ({
    default: m.AdminReferralSettingsModal,
  })),
);

const RouteLoadingFallback: React.FC<{ fullScreen?: boolean }> = ({ fullScreen = false }) => (
  <div
    className={`${
      fullScreen ? 'min-h-dvh bg-[#06091B]' : 'min-h-[45dvh]'
    } flex flex-col items-center justify-center p-6 text-slate-300 gap-3`}
  >
    <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
    <span className="text-xs font-medium text-slate-400">Loading view...</span>
  </div>
);

const PUBLIC_BROWSE_PAGES: AppPage[] = ['home', 'earn'];

type PendingAuthAction =
  | { type: 'navigate'; page: AppPage }
  | { type: 'watch_ad'; ad: Advertisement }
  | { type: 'daily_bonus' }
  | { type: 'withdraw_method'; methodId: PaymentMethodId };

const ACTION_AUTH_REASONS: Partial<Record<AppPage, string>> = {
  wallet: 'Sign in to view your Wallet balance & earnings.',
  withdraw: 'Sign in to submit a withdrawal request.',
  'withdrawal-history': 'Sign in to view your withdrawal history.',
  referral: 'Sign in to access your Referral code & invite friends.',
  transactions: 'Sign in to view your transaction history.',
  profile: 'Sign in to manage your profile & settings.',
  'ad-history': 'Sign in to view your ad completion history.',
  'watch-ad': 'Sign in to watch verified ads and earn points.',
};

const INITIAL_ECONOMY: EconomyConfig = {
  pointsPerBdt: null,
  dailyBonusPoints: null,
  minimumWithdrawPoints: null,
  maximumWithdrawAmountBdt: null,
  dailyAdLimit: DEFAULT_DAILY_AD_LIMIT,
  walletEnabled: true,
  earningEnabled: true,
};

export default function App() {
  const { showToast } = useToast();

  const initialRefFromUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return (params.get('ref') ?? '').trim().toUpperCase();
  }, []);

  const isRegisterPath = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.location.pathname.toLowerCase().startsWith('/register');
  }, []);

  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.location.pathname.toLowerCase().startsWith('/admin');
  });
  const [siteSettings, setSiteSettings] = useState<SiteSettingsConfig>(() =>
    getDefaultSiteSettings(),
  );

  const [currentPage, setCurrentPage] = useState<AppPage>('home');
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(() =>
    Boolean(initialRefFromUrl || isRegisterPath),
  );
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>(() =>
    initialRefFromUrl || isRegisterPath ? 'register' : 'login',
  );
  const [authModalReason, setAuthModalReason] = useState<string>(() =>
    initialRefFromUrl ? `Invited with code ${initialRefFromUrl} — create your account to join!` : '',
  );
  const [pendingAction, setPendingAction] = useState<PendingAuthAction | null>(null);
  const [autoOpenBonusModal, setAutoOpenBonusModal] = useState(false);

  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [hasAdminMarker, setHasAdminMarker] = useState(false);
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);

  // Real-time Firestore dashboard, ads, wallet, withdrawals & referral streams
  const [economy, setEconomy] = useState<EconomyConfig>(INITIAL_ECONOMY);
  const [firestoreMethods, setFirestoreMethods] = useState<PaymentMethodConfig[]>([]);
  const [withdrawalSettings, setWithdrawalSettings] = useState<WithdrawalSettingsConfig>(() =>
    getDefaultWithdrawalSettings(INITIAL_ECONOMY),
  );
  const [userWithdrawals, setUserWithdrawals] = useState<WithdrawalRequestRecord[]>([]);
  const [adminAllWithdrawals, setAdminAllWithdrawals] = useState<WithdrawalRequestRecord[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminLogRecord[]>([]);

  const [walletDoc, setWalletDoc] = useState<WalletDocRecord | null>(null);
  const [walletLedger, setWalletLedger] = useState<WalletLedgerEntry[]>([]);
  const [activeAds, setActiveAds] = useState<Advertisement[]>([]);
  const [adminAllAds, setAdminAllAds] = useState<Advertisement[]>([]);
  const [adSessions, setAdSessions] = useState<AdSessionRecord[]>([]);
  const [adCompletions, setAdCompletions] = useState<AdCompletionRecord[]>([]);
  const [dailyAdLimit, setDailyAdLimit] = useState<DailyAdLimitRecord | null>(null);
  const [fraudLogs, setFraudLogs] = useState<FraudLogRecord[]>([]);

  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [referredUsers, setReferredUsers] = useState<ReferredUser[]>([]);
  const [referralSettings, setReferralSettings] = useState<ReferralSettingsConfig>(() =>
    getDefaultReferralSettings(),
  );
  const [referralLeaderboard, setReferralLeaderboard] = useState<ReferralLeaderboardEntry[]>([]);
  const [adminAllReferrals, setAdminAllReferrals] = useState<ReferredUser[]>([]);
  const [referralLogs, setReferralLogs] = useState<ReferralLogRecord[]>([]);

  const [dailyBonus, setDailyBonus] = useState<DailyBonusState>(() =>
    getDefaultDailyBonusState(),
  );
  const [firestoreNotifications, setFirestoreNotifications] = useState<NotificationItem[]>([]);
  const [dashboardDataLoaded, setDashboardDataLoaded] = useState(false);

  const [readSysNotifIds, setReadSysNotifIds] = useState<string[]>([]);
  const [preferredWithdrawMethod, setPreferredWithdrawMethod] =
    useState<PaymentMethodId>('bkash');

  // Active ad watching & admin modals state
  const [activeWatchAd, setActiveWatchAd] = useState<Advertisement | null>(null);
  const [activeWatchSessionId, setActiveWatchSessionId] = useState<string | null>(null);
  const [initiatingAdId, setInitiatingAdId] = useState<string | null>(null);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminWalletModalOpen, setAdminWalletModalOpen] = useState(false);
  const [adminWithdrawModalOpen, setAdminWithdrawModalOpen] = useState(false);
  const [adminReferralModalOpen, setAdminReferralModalOpen] = useState(false);

  const isAdmin = useMemo(() => {
    if (!firebaseUser) return false;
    return isAdminUser(
      {
        email: firebaseUser.email ?? '',
        verified: Boolean(firebaseUser.emailVerified),
      },
      hasAdminMarker,
      adminRole,
    );
  }, [firebaseUser, hasAdminMarker, adminRole]);

  // Sync /admin route changes and live appSettings/site
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePop = () => {
      setIsAdminRoute(window.location.pathname.toLowerCase().startsWith('/admin'));
    };
    window.addEventListener('popstate', handlePop);
    const unsubSite = subscribeToSiteSettings(
      (cfg) => setSiteSettings(cfg),
      () => {},
    );
    return () => {
      window.removeEventListener('popstate', handlePop);
      unsubSite();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [currentPage, isAdminRoute]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (siteSettings.websiteName) {
      document.title = isAdminRoute
        ? `${siteSettings.websiteName} — Admin Console`
        : `${siteSettings.websiteName} — Watch Ads & Earn Rewards`;
    }
    if (siteSettings.websiteFaviconUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = siteSettings.websiteFaviconUrl;
    }
  }, [siteSettings.websiteName, siteSettings.websiteFaviconUrl, isAdminRoute]);

  // Subscribe to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (!user) {
        setUserProfile(null);
        setHasAdminMarker(false);
        setAdminRole(null);
        setFirestoreMethods([]);
        setUserWithdrawals([]);
        setAdminAllWithdrawals([]);
        setAdminLogs([]);
        setWalletDoc(null);
        setWalletLedger([]);
        setReferredUsers([]);
        setReferralSettings(getDefaultReferralSettings());
        setReferralLeaderboard([]);
        setAdminAllReferrals([]);
        setReferralLogs([]);
        setTransactions([]);
        setActiveAds([]);
        setAdminAllAds([]);
        setAdSessions([]);
        setAdCompletions([]);
        setDailyAdLimit(null);
        setFraudLogs([]);
        setFirestoreNotifications([]);
        setDailyBonus(getDefaultDailyBonusState());
        setProfileLoading(false);
        setDashboardDataLoaded(false);
        setActiveWatchAd(null);
        setActiveWatchSessionId(null);
        setAdminModalOpen(false);
        setAdminWalletModalOpen(false);
        setAdminWithdrawModalOpen(false);
        setAdminReferralModalOpen(false);
        setCurrentPage((prev) => (PUBLIC_BROWSE_PAGES.includes(prev) ? prev : 'home'));
      } else {
        setAuthModalOpen(false);
        setProfileLoading(true);
        void resolveUserAdminRole(user.uid).then((resolved) => {
          setHasAdminMarker(resolved.hasAdminMarker);
          setAdminRole(resolved.role);
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to Firestore collections ONLY when authenticated
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    let initialSettled = 0;
    const markSettled = () => {
      initialSettled += 1;
      if (initialSettled >= 2) {
        setDashboardDataLoaded(true);
      }
    };

    const unsubProfile = subscribeToUserProfile(
      firebaseUser.uid,
      (profile) => {
        setUserProfile(profile);
        setProfileLoading(false);
        markSettled();
      },
      (err) => {
        setProfileLoading(false);
        setDashboardDataLoaded(true);
        showToast(err.message || 'Unable to load profile.', 'error');
      },
    );

    const unsubSettings = subscribeToWalletAndEconomySettings(
      (cfg) => {
        setEconomy(cfg);
      },
      () => {},
    );

    const unsubWallet = subscribeToUserWallet(
      firebaseUser.uid,
      (docRec) => {
        setWalletDoc(docRec);
      },
      () => {},
    );

    const unsubLedger = subscribeToUserWalletLedger(
      firebaseUser.uid,
      (entries) => {
        setWalletLedger(entries);
      },
      () => {},
    );

    const unsubReferrals = subscribeToUserReferrals(
      firebaseUser.uid,
      (refs) => {
        setReferredUsers(refs);
      },
      () => {},
    );

    const unsubTransactions = subscribeToUserTransactions(
      firebaseUser.uid,
      (txs) => {
        setTransactions(txs);
        markSettled();
      },
      () => {
        markSettled();
      },
    );

    const unsubDailyBonus = subscribeToDailyBonusState(
      firebaseUser.uid,
      (state) => {
        setDailyBonus(state);
      },
      () => {},
    );

    const unsubNotifications = subscribeToUserNotifications(
      firebaseUser.uid,
      (items) => {
        setFirestoreNotifications(items);
      },
      () => {},
    );

    const unsubActiveAds = firebaseUser.emailVerified
      ? subscribeToActiveAdvertisements(
          (adsList) => {
            setActiveAds(adsList);
          },
          () => {},
        )
      : () => {};

    const unsubDailyAdLimit = subscribeToDailyAdLimit(
      firebaseUser.uid,
      (limitDoc) => {
        setDailyAdLimit(limitDoc);
      },
      () => {},
    );

    const unsubAdSessions = subscribeToAdSessions(
      firebaseUser.uid,
      (sessions) => {
        setAdSessions(sessions);
      },
      () => {},
    );

    const unsubAdCompletions = subscribeToAdCompletions(
      firebaseUser.uid,
      (completions) => {
        setAdCompletions(completions);
      },
      () => {},
    );

    const unsubPaymentMethods = subscribeToPaymentMethods(
      (methods) => {
        setFirestoreMethods(methods);
      },
      () => {},
    );

    const unsubWithdrawSettings = subscribeToWithdrawalSettings(
      INITIAL_ECONOMY,
      (settings) => {
        setWithdrawalSettings(settings);
      },
      () => {},
    );

    const unsubUserWithdrawals = subscribeToUserWithdrawalRequests(
      firebaseUser.uid,
      (reqs) => {
        setUserWithdrawals(reqs);
      },
      () => {},
    );

    const unsubAdminAds = isAdmin
      ? subscribeToAllAdvertisements(
          (allAds) => {
            setAdminAllAds(allAds);
          },
          () => {},
        )
      : () => {};

    const unsubAdminWithdrawals = isAdmin
      ? subscribeToAllWithdrawalRequests(
          (allReqs) => {
            setAdminAllWithdrawals(allReqs);
          },
          () => {},
        )
      : () => {};

    const unsubAdminLogs = isAdmin
      ? subscribeToAdminLogs(
          (logs) => {
            setAdminLogs(logs);
          },
          () => {},
        )
      : () => {};

    const unsubFraudLogs = isAdmin
      ? subscribeToFraudLogs(
          (logs) => {
            setFraudLogs(logs);
          },
          () => {},
        )
      : () => {};

    const unsubReferralSettings = subscribeToReferralSettings(
      (cfg) => {
        setReferralSettings(cfg);
      },
      () => {},
    );

    const unsubLeaderboard = subscribeToReferralLeaderboard(
      (entries) => {
        setReferralLeaderboard(entries);
      },
      () => {},
    );

    const unsubAdminReferrals = isAdmin
      ? subscribeToAllReferrals(
          (refs) => {
            setAdminAllReferrals(refs);
          },
          () => {},
        )
      : () => {};

    const unsubReferralLogs = isAdmin
      ? subscribeToReferralLogs(
          (logs) => {
            setReferralLogs(logs);
          },
          () => {},
        )
      : () => {};

    return () => {
      unsubProfile();
      unsubSettings();
      unsubWallet();
      unsubLedger();
      unsubReferrals();
      unsubTransactions();
      unsubDailyBonus();
      unsubNotifications();
      unsubActiveAds();
      unsubDailyAdLimit();
      unsubAdSessions();
      unsubAdCompletions();
      unsubPaymentMethods();
      unsubWithdrawSettings();
      unsubUserWithdrawals();
      unsubAdminAds();
      unsubAdminWithdrawals();
      unsubAdminLogs();
      unsubFraudLogs();
      unsubReferralSettings();
      unsubLeaderboard();
      unsubAdminReferrals();
      unsubReferralLogs();
    };
  }, [authReady, firebaseUser, firebaseUser?.emailVerified, isAdmin, showToast]);

  const openAuthModal = (
    mode: AuthModalMode = 'login',
    reason = '',
    action: PendingAuthAction | null = null,
  ) => {
    setAuthModalMode(mode);
    setAuthModalReason(reason);
    if (action !== undefined) {
      setPendingAction(action);
    }
    setAuthModalOpen(true);
  };

  // Enforce Protected Routes & Authenticated Redirects
  useEffect(() => {
    if (!authReady) return;

    if (!firebaseUser) {
      if (!PUBLIC_BROWSE_PAGES.includes(currentPage)) {
        setCurrentPage('home');
      }
      return;
    }

    setAuthModalOpen(false);

    if (!firebaseUser.emailVerified) {
      if (currentPage !== 'verify-email') {
        setCurrentPage('verify-email');
      }
      return;
    }

    if (currentPage === 'verify-email' || currentPage === 'splash' || currentPage === 'login' || currentPage === 'register') {
      setCurrentPage('home');
    }
  }, [authReady, firebaseUser, firebaseUser?.emailVerified, currentPage]);

  const handleNavigate = (target: AppPage) => {
    if (!firebaseUser && !PUBLIC_BROWSE_PAGES.includes(target)) {
      const reason =
        ACTION_AUTH_REASONS[target] || 'Sign in or create an account to continue.';
      openAuthModal('login', reason, { type: 'navigate', page: target });
      return;
    }
    if (firebaseUser && !firebaseUser.emailVerified && target !== 'verify-email') {
      setCurrentPage('verify-email');
      return;
    }
    setCurrentPage(target);
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      setPendingAction(null);
      setAutoOpenBonusModal(false);
      setCurrentPage('home');
      showToast('Signed out successfully.', 'info');
    } catch (err) {
      showToast(mapAuthError(err), 'error');
    }
  };

  const paymentMethods = appRepository.getPaymentMethods(economy, firestoreMethods);

  const activeUser: UserProfile = userProfile ?? {
    uid: firebaseUser?.uid ?? '',
    fullName: firebaseUser?.displayName || 'AdView Member',
    username: 'member',
    email: firebaseUser?.email || '',
    phoneNumber: '',
    profileImage: '',
    referralCode: 'MEMBER',
    referredBy: '',
    points: 0,
    totalEarnings: 0,
    totalAdViews: 0,
    accountStatus: 'active',
    emailVerified: Boolean(firebaseUser?.emailVerified),
    level: 'Bronze Member',
    verified: Boolean(firebaseUser?.emailVerified),
    referralLink: typeof window !== 'undefined' ? window.location.origin : 'https://adviewearn.com',
    joinedAt: 'Just now',
  };

  const wallet = computeDashboardMetrics(
    activeUser,
    transactions,
    referredUsers,
    economy,
    dailyAdLimit,
    walletDoc,
  );

  const systemNotifications = appRepository
    .getSystemNotifications(Boolean(firebaseUser?.emailVerified))
    .map((n) => ({
      ...n,
      read: n.read || readSysNotifIds.includes(n.id),
    }));

  const notifications: NotificationItem[] = [...firestoreNotifications, ...systemNotifications];

  const handleMarkNotificationsRead = () => {
    setReadSysNotifIds((prev) =>
      Array.from(new Set([...prev, ...systemNotifications.map((n) => n.id)])),
    );
    firestoreNotifications
      .filter((n) => !n.read && n.fromFirestore)
      .forEach((n) => {
        void markFirestoreNotificationRead(n.id).catch(() => {});
      });
  };

  const handleSelectWithdrawMethod = (methodId: PaymentMethodId) => {
    if (!firebaseUser) {
      openAuthModal('login', 'Sign in to submit a withdrawal request.', {
        type: 'withdraw_method',
        methodId,
      });
      return;
    }
    setPreferredWithdrawMethod(methodId);
    handleNavigate('withdraw');
  };

  const handleRequireDailyBonus = () => {
    openAuthModal('login', 'Sign in to claim your Daily Check-in Bonus.', {
      type: 'daily_bonus',
    });
  };

  const handleStartWatchAd = async (ad: Advertisement) => {
    if (!firebaseUser) {
      openAuthModal(
        'login',
        'Sign in to watch verified ads and earn real points.',
        ad.adId.startsWith('demo-')
          ? { type: 'navigate', page: 'earn' }
          : { type: 'watch_ad', ad },
      );
      return;
    }
    if (initiatingAdId) return;
    setInitiatingAdId(ad.adId);
    try {
      const session = await initiateAdSession(
        activeUser,
        ad,
        adCompletions,
        dailyAdLimit,
        economy.dailyAdLimit || DEFAULT_DAILY_AD_LIMIT,
        economy.earningEnabled,
      );
      setActiveWatchAd(ad);
      setActiveWatchSessionId(session.sessionId);
      setCurrentPage('watch-ad');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start ad session.', 'error');
    } finally {
      setInitiatingAdId(null);
    }
  };

  // Automatically continue pending action right after login/signup/verification completes
  useEffect(() => {
    if (
      !authReady ||
      !firebaseUser ||
      !firebaseUser.emailVerified ||
      profileLoading ||
      !pendingAction ||
      activeUser.accountStatus !== 'active'
    ) {
      return;
    }

    const action = pendingAction;
    setPendingAction(null);
    setAuthModalOpen(false);
    setAuthModalReason('');

    if (action.type === 'navigate') {
      setCurrentPage(action.page);
    } else if (action.type === 'withdraw_method') {
      setPreferredWithdrawMethod(action.methodId);
      setCurrentPage('withdraw');
    } else if (action.type === 'daily_bonus') {
      setCurrentPage('home');
      setAutoOpenBonusModal(true);
    } else if (action.type === 'watch_ad') {
      void handleStartWatchAd(action.ad);
    }
  }, [
    authReady,
    firebaseUser,
    firebaseUser?.emailVerified,
    profileLoading,
    pendingAction,
    activeUser.accountStatus,
  ]);

  const currentWatchSession: AdSessionRecord | null = useMemo(() => {
    if (!activeWatchSessionId || !activeWatchAd) return null;
    const live = adSessions.find((s) => s.sessionId === activeWatchSessionId);
    if (live) return live;
    return {
      id: activeWatchSessionId,
      sessionId: activeWatchSessionId,
      userId: activeUser.uid,
      adId: activeWatchAd.adId,
      adName: activeWatchAd.adName,
      adNetwork: activeWatchAd.adNetwork,
      expectedRewardPoints: activeWatchAd.rewardPoints,
      dhakaDate: dailyAdLimit?.dhakaDate || '',
      status: 'pending',
      transactionId: '',
      rejectionReason: '',
      createdAtLabel: 'Just now',
      createdAtMillis: Date.now(),
    };
  }, [activeWatchSessionId, activeWatchAd, adSessions, activeUser.uid, dailyAdLimit?.dhakaDate]);

  // Dedicated, strictly separated Admin Panel at /admin
  if (isAdminRoute) {
    return (
      <Suspense fallback={<RouteLoadingFallback fullScreen />}>
        <AdminApp
          onExitToUserSite={() => {
            if (typeof window !== 'undefined') {
              window.history.pushState(null, '', '/');
            }
            setIsAdminRoute(false);
          }}
        />
      </Suspense>
    );
  }

  // Maintenance Mode Gate for User Portal (Admin Panel remains active at /admin)
  if (siteSettings.maintenanceMode) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[#06091B] text-slate-100">
        <GlassCard className="max-w-md w-full p-6 sm:p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-300 mx-auto">
            <Wrench className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold font-display text-white">
            {siteSettings.websiteName} is Under Maintenance
          </h1>
          <p className="text-xs text-slate-300 leading-relaxed">
            We are performing scheduled platform upgrades to keep rewards and payouts fast and
            secure. Please check back shortly.
          </p>
          {(siteSettings.supportEmail || siteSettings.supportContact) && (
            <p className="text-xs text-violet-300">
              Support: {siteSettings.supportEmail}
              {siteSettings.supportContact ? ` · ${siteSettings.supportContact}` : ''}
            </p>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.history.pushState(null, '', '/admin');
                }
                setIsAdminRoute(true);
              }}
              className="w-full min-h-[42px] rounded-xl brand-button text-white text-xs font-bold"
            >
              Open Admin Console (/admin)
            </button>
          )}
        </GlassCard>
      </div>
    );
  }

  // Email Verification Gate (only when signed in with unverified email/password)
  if (firebaseUser && !firebaseUser.emailVerified) {
    return (
      <Suspense fallback={<RouteLoadingFallback fullScreen />}>
        <VerifyEmailPage
          email={firebaseUser.email ?? activeUser.email}
          onVerified={async () => {
            await firebaseUser.reload();
            setFirebaseUser(auth.currentUser);
            setCurrentPage('home');
          }}
          onLogout={handleLogout}
        />
      </Suspense>
    );
  }

  // Restricted / Suspended / Banned Account Guard (authenticated active check)
  if (firebaseUser && activeUser.accountStatus !== 'active') {
    const isRestricted = activeUser.accountStatus === 'restricted';
    const isBanned = activeUser.accountStatus === 'banned';
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[#06091B]">
        <GlassCard className="max-w-md w-full p-6 text-center space-y-4">
          <div
            className={`w-12 h-12 rounded-2xl border flex items-center justify-center mx-auto ${
              isRestricted
                ? 'bg-amber-500/15 border-amber-400/30 text-amber-400'
                : 'bg-rose-500/15 border-rose-400/30 text-rose-400'
            }`}
          >
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold font-display text-white">
            Account{' '}
            {isBanned ? 'Banned' : isRestricted ? 'Temporarily Restricted' : 'Suspended'}
          </h1>
          <p className="text-xs text-slate-300 leading-relaxed">
            {isRestricted ? (
              <>
                Your account has been placed under temporary security review. Please contact{' '}
                <span className="text-violet-300">
                  {siteSettings.supportEmail || 'support@adviewearn.com'}
                </span>{' '}
                to verify your account and restore full access.
              </>
            ) : (
              <>
                Your account status is currently marked as{' '}
                <span className="font-semibold text-rose-300">{activeUser.accountStatus}</span>.
                Please contact{' '}
                <span className="text-violet-300">
                  {siteSettings.supportEmail || 'support@adviewearn.com'}
                </span>{' '}
                for assistance.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </GlassCard>
      </div>
    );
  }

  const renderProtectedPage = () => {
    switch (currentPage) {
      case 'watch-ad':
        if (activeWatchAd && currentWatchSession) {
          return (
            <AdWatchSessionPage
              ad={activeWatchAd}
              session={currentWatchSession}
              onBackToAds={() => setCurrentPage('earn')}
            />
          );
        }
        return (
          <WatchAdsPage
            ads={activeAds}
            economy={economy}
            dailyAdLimit={dailyAdLimit}
            adCompletions={adCompletions}
            isAdmin={isAdmin}
            initiatingAdId={initiatingAdId}
            onStartWatchAd={handleStartWatchAd}
            onNavigate={handleNavigate}
            onOpenAdminManager={() => setAdminModalOpen(true)}
          />
        );
      case 'ad-history':
        return (
          <AdHistoryPage
            adCompletions={adCompletions}
            adSessions={adSessions}
            onNavigate={handleNavigate}
          />
        );
      case 'earn':
        return (
          <WatchAdsPage
            ads={activeAds}
            economy={economy}
            dailyAdLimit={dailyAdLimit}
            adCompletions={adCompletions}
            isAdmin={isAdmin}
            isAuthenticated={Boolean(firebaseUser)}
            initiatingAdId={initiatingAdId}
            onStartWatchAd={handleStartWatchAd}
            onNavigate={handleNavigate}
            onOpenAuth={(mode) => openAuthModal(mode ?? 'login')}
            onOpenAdminManager={() => setAdminModalOpen(true)}
          />
        );
      case 'wallet':
        return (
          <WalletPage
            user={activeUser}
            wallet={wallet}
            economy={economy}
            paymentMethods={paymentMethods}
            transactions={transactions}
            walletLedger={walletLedger}
            loading={!dashboardDataLoaded && profileLoading}
            isAdmin={isAdmin}
            onNavigate={handleNavigate}
            onSelectWithdrawMethod={handleSelectWithdrawMethod}
            onOpenAdminSettings={() => setAdminWalletModalOpen(true)}
            onOpenAdminWithdrawManager={() => setAdminWithdrawModalOpen(true)}
          />
        );
      case 'withdraw':
        return (
          <WithdrawPage
            accountStatus={activeUser.accountStatus}
            wallet={wallet}
            economy={economy}
            withdrawalSettings={withdrawalSettings}
            defaultPhone={activeUser.phoneNumber}
            paymentMethods={paymentMethods}
            initialMethod={preferredWithdrawMethod}
            userWithdrawals={userWithdrawals}
            isAdmin={isAdmin}
            onNavigate={handleNavigate}
            onOpenAdminWithdrawManager={() => setAdminWithdrawModalOpen(true)}
          />
        );
      case 'withdrawal-history':
        return (
          <WithdrawalHistoryPage
            requests={userWithdrawals}
            loading={!dashboardDataLoaded && profileLoading}
            isAdmin={isAdmin}
            onNavigate={handleNavigate}
            onOpenAdminWithdrawManager={() => setAdminWithdrawModalOpen(true)}
          />
        );
      case 'referral':
        return (
          <ReferralPage
            user={activeUser}
            referralSettings={referralSettings}
            referredUsers={referredUsers}
            leaderboard={referralLeaderboard}
            isAdmin={isAdmin}
            onOpenAdminReferralSettings={() => setAdminReferralModalOpen(true)}
          />
        );
      case 'transactions':
        return (
          <TransactionsPage
            transactions={transactions}
            walletLedger={walletLedger}
            loading={!dashboardDataLoaded && profileLoading}
          />
        );
      case 'profile':
        return (
          <ProfilePage
            user={activeUser}
            paymentMethods={paymentMethods}
            supportEmail={siteSettings.supportEmail}
            onNavigate={handleNavigate}
            onLogout={handleLogout}
          />
        );
      case 'home':
      default:
        return (
          <HomePage
            user={activeUser}
            wallet={wallet}
            economy={economy}
            dailyBonus={dailyBonus}
            ads={activeAds}
            transactions={transactions}
            loading={Boolean(firebaseUser) && !dashboardDataLoaded && profileLoading}
            isAuthenticated={Boolean(firebaseUser)}
            autoOpenBonusModal={autoOpenBonusModal}
            onAutoBonusHandled={() => setAutoOpenBonusModal(false)}
            onOpenAuth={(mode) => openAuthModal(mode ?? 'login')}
            onRequireDailyBonus={handleRequireDailyBonus}
            onNavigate={handleNavigate}
            onStartWatchAd={handleStartWatchAd}
          />
        );
    }
  };

  return (
    <>
      <AppShell
        currentPage={currentPage}
        user={activeUser}
        wallet={wallet}
        notifications={notifications}
        isAuthenticated={Boolean(firebaseUser)}
        onNavigate={handleNavigate}
        onMarkNotificationsRead={handleMarkNotificationsRead}
        onOpenAuth={(mode) => openAuthModal(mode ?? 'login')}
        onLogout={handleLogout}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <Suspense fallback={<RouteLoadingFallback />}>{renderProtectedPage()}</Suspense>
          </motion.div>
        </AnimatePresence>
      </AppShell>

      {!firebaseUser && authModalOpen && (
        <Suspense fallback={null}>
          <AuthModal
            open={authModalOpen}
            mode={authModalMode}
            reasonPrompt={authModalReason}
            initialReferralCode={initialRefFromUrl}
            registrationEnabled={siteSettings.registrationEnabled}
            siteName={siteSettings.websiteName}
            onModeChange={(nextMode) => setAuthModalMode(nextMode)}
            onClose={() => {
              setAuthModalOpen(false);
              setAuthModalReason('');
              setPendingAction(null);
            }}
            onAuthSuccess={() => {
              setAuthModalOpen(false);
            }}
          />
        </Suspense>
      )}

      {isAdmin && (
        <Suspense fallback={null}>
          <AdminAdManagerModal
            open={adminModalOpen}
            onClose={() => setAdminModalOpen(false)}
            ads={adminAllAds}
            economy={economy}
            fraudLogs={fraudLogs}
          />
          <AdminWalletSettingsModal
            open={adminWalletModalOpen}
            onClose={() => setAdminWalletModalOpen(false)}
            economy={economy}
          />
          <AdminWithdrawalManagerModal
            open={adminWithdrawModalOpen}
            onClose={() => setAdminWithdrawModalOpen(false)}
            requests={adminAllWithdrawals}
            paymentMethods={paymentMethods}
            withdrawalSettings={withdrawalSettings}
            adminLogs={adminLogs}
            adminUser={{
              uid: activeUser.uid,
              email: activeUser.email,
            }}
          />
          <AdminReferralSettingsModal
            open={adminReferralModalOpen}
            onClose={() => setAdminReferralModalOpen(false)}
            settings={referralSettings}
            allReferrals={adminAllReferrals}
            referralLogs={referralLogs}
            adminUser={{
              uid: activeUser.uid,
              email: activeUser.email,
            }}
          />
        </Suspense>
      )}
      {!authModalOpen && currentPage !== 'watch-ad' && (
        <InstallAppBanner siteName={siteSettings.websiteName} />
      )}
    </>
  );
}
