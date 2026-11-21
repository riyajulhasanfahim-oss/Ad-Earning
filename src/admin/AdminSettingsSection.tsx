import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Coins,
  Database,
  Download,
  Globe,
  KeyRound,
  Loader2,
  Save,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  AdminMarkerRecord,
  AdminRole,
  EconomyConfig,
  PaymentMethodConfig,
  PaymentMethodId,
  SiteSettingsConfig,
  UserProfile,
  WithdrawalSettingsConfig,
} from '../types';
import {
  saveEconomyConfig,
  savePaymentMethodConfig,
  saveWithdrawalSettingsConfig,
} from '../services/dashboardService';
import {
  assignAdminRoleViaCloudFunction,
  exportDatabaseBackupWithFallback,
  hasAdminPermission,
  recordAdminAuditLogClient,
  saveSiteSettingsConfig,
} from '../services/adminService';
import { useToast } from '../components/ui/ToastProvider';

interface AdminSettingsSectionProps {
  siteSettings: SiteSettingsConfig;
  economy: EconomyConfig;
  withdrawalSettings: WithdrawalSettingsConfig;
  paymentMethods: PaymentMethodConfig[];
  adminsList: AdminMarkerRecord[];
  users: UserProfile[];
  snapshotData: Record<string, unknown>;
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

type SettingsTab = 'website' | 'economy' | 'withdrawals' | 'roles';

const PERMISSION_MATRIX: Array<{
  capability: string;
  super_admin: boolean;
  admin: boolean;
  support_admin: boolean;
}> = [
  { capability: 'View Dashboard Analytics & KPIs', super_admin: true, admin: true, support_admin: true },
  { capability: 'View Users, Wallets, Withdrawals & Audit Logs', super_admin: true, admin: true, support_admin: true },
  { capability: 'Manage Users (Activate / Suspend / Ban / Unblock)', super_admin: true, admin: true, support_admin: false },
  { capability: 'Delete User Accounts', super_admin: true, admin: false, support_admin: false },
  { capability: 'Atomic Points Credit / Debit', super_admin: true, admin: true, support_admin: false },
  { capability: 'Approve, Reject & Mark Paid Withdrawals', super_admin: true, admin: true, support_admin: false },
  { capability: 'Advertisement CRUD & Policy Controls', super_admin: true, admin: true, support_admin: false },
  { capability: 'Economy, Withdrawal & Referral Settings', super_admin: true, admin: true, support_admin: false },
  { capability: 'Website Branding, Maintenance & Registration Toggle', super_admin: true, admin: false, support_admin: false },
  { capability: 'Assign / Revoke Admin Custom Claims & JSON Backup', super_admin: true, admin: false, support_admin: false },
];

export const AdminSettingsSection: React.FC<AdminSettingsSectionProps> = ({
  siteSettings,
  economy,
  withdrawalSettings,
  paymentMethods,
  adminsList,
  snapshotData,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const [tab, setTab] = useState<SettingsTab>('website');

  // Website & Maintenance state
  const [siteForm, setSiteForm] = useState<SiteSettingsConfig>(siteSettings);
  const [savingSite, setSavingSite] = useState(false);

  // Economy state
  const [pointsPerBdt, setPointsPerBdt] = useState(
    economy.pointsPerBdt !== null ? String(economy.pointsPerBdt) : '',
  );
  const [dailyBonusPoints, setDailyBonusPoints] = useState(
    economy.dailyBonusPoints !== null ? String(economy.dailyBonusPoints) : '',
  );
  const [dailyAdLimit, setDailyAdLimit] = useState(String(economy.dailyAdLimit || 20));
  const [earningEnabled, setEarningEnabled] = useState(economy.earningEnabled);
  const [savingEconomy, setSavingEconomy] = useState(false);

  // Withdrawal settings state
  const [wdEnabled, setWdEnabled] = useState(withdrawalSettings.withdrawalEnabled);
  const [minWdPts, setMinWdPts] = useState(
    withdrawalSettings.minimumWithdrawPoints !== null
      ? String(withdrawalSettings.minimumWithdrawPoints)
      : '',
  );
  const [maxWdBdt, setMaxWdBdt] = useState(
    withdrawalSettings.maximumWithdrawBdt !== null
      ? String(withdrawalSettings.maximumWithdrawBdt)
      : '',
  );
  const [dailyWdCount, setDailyWdCount] = useState(String(withdrawalSettings.dailyLimitCount || 3));
  const [dailyWdBdt, setDailyWdBdt] = useState(
    withdrawalSettings.dailyLimitBdt !== null ? String(withdrawalSettings.dailyLimitBdt) : '',
  );
  const [monthlyWdBdt, setMonthlyWdBdt] = useState(
    withdrawalSettings.monthlyLimitBdt !== null ? String(withdrawalSettings.monthlyLimitBdt) : '',
  );
  const [procLabel, setProcLabel] = useState(withdrawalSettings.processingTimeLabel);
  const [allowedMethods, setAllowedMethods] = useState<PaymentMethodId[]>(
    withdrawalSettings.allowedMethods,
  );
  const [savingWd, setSavingWd] = useState(false);
  const [busyMethodId, setBusyMethodId] = useState<string | null>(null);

  // Roles & Backup state
  const [roleIdentifier, setRoleIdentifier] = useState('');
  const [targetRole, setTargetRole] = useState<AdminRole | 'revoke'>('admin');
  const [assigningRole, setAssigningRole] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);

  useEffect(() => {
    setSiteForm(siteSettings);
  }, [siteSettings]);

  useEffect(() => {
    setPointsPerBdt(economy.pointsPerBdt !== null ? String(economy.pointsPerBdt) : '');
    setDailyBonusPoints(economy.dailyBonusPoints !== null ? String(economy.dailyBonusPoints) : '');
    setDailyAdLimit(String(economy.dailyAdLimit || 20));
    setEarningEnabled(economy.earningEnabled);
  }, [economy]);

  useEffect(() => {
    setWdEnabled(withdrawalSettings.withdrawalEnabled);
    setMinWdPts(
      withdrawalSettings.minimumWithdrawPoints !== null
        ? String(withdrawalSettings.minimumWithdrawPoints)
        : '',
    );
    setMaxWdBdt(
      withdrawalSettings.maximumWithdrawBdt !== null
        ? String(withdrawalSettings.maximumWithdrawBdt)
        : '',
    );
    setDailyWdCount(String(withdrawalSettings.dailyLimitCount || 3));
    setDailyWdBdt(
      withdrawalSettings.dailyLimitBdt !== null ? String(withdrawalSettings.dailyLimitBdt) : '',
    );
    setMonthlyWdBdt(
      withdrawalSettings.monthlyLimitBdt !== null
        ? String(withdrawalSettings.monthlyLimitBdt)
        : '',
    );
    setProcLabel(withdrawalSettings.processingTimeLabel);
    setAllowedMethods(withdrawalSettings.allowedMethods);
  }, [withdrawalSettings]);

  const canManageSite = hasAdminPermission(adminRole, 'manage_site_settings');
  const canManageEconomy = hasAdminPermission(adminRole, 'manage_economy_settings');
  const canManageWithdrawals = hasAdminPermission(adminRole, 'manage_withdrawals');
  const canManageRoles = hasAdminPermission(adminRole, 'manage_admin_roles');
  const canExportBackup = hasAdminPermission(adminRole, 'export_backup');

  const handleSaveSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSite) {
      showToast('Only Super Admin can update Website & Maintenance settings.', 'error');
      return;
    }
    setSavingSite(true);
    try {
      await saveSiteSettingsConfig({
        next: siteForm,
        previous: siteSettings,
        adminUser: { uid: adminUser.uid, email: adminUser.email, role: adminRole },
      });
      showToast('Website & maintenance settings saved.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save website settings.', 'error');
    } finally {
      setSavingSite(false);
    }
  };

  const handleSaveEconomy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageEconomy) return;
    setSavingEconomy(true);
    try {
      const nextRate = pointsPerBdt.trim() ? Number(pointsPerBdt) : null;
      const nextBonus = dailyBonusPoints.trim() ? Number(dailyBonusPoints) : null;
      const nextLimit = Math.max(1, Math.floor(Number(dailyAdLimit || 20)));

      await saveEconomyConfig({
        pointsPerBdt: nextRate,
        dailyBonusPoints: nextBonus,
        minimumWithdrawPoints: economy.minimumWithdrawPoints,
        maximumWithdrawAmountBdt: economy.maximumWithdrawAmountBdt,
        dailyAdLimit: nextLimit,
        walletEnabled: economy.walletEnabled,
        earningEnabled,
      });

      await recordAdminAuditLogClient({
        adminUser: { uid: adminUser.uid, email: adminUser.email, role: adminRole },
        action: 'economy_settings_updated',
        targetId: 'wallet',
        previousValue: `rate=${economy.pointsPerBdt ?? 'unset'}, limit=${economy.dailyAdLimit}, earning=${economy.earningEnabled}`,
        newValue: `rate=${nextRate ?? 'unset'}, limit=${nextLimit}, earning=${earningEnabled}`,
        details: `Updated Economy Config: pointsPerBdt=${nextRate ?? 'unset'}, dailyBonus=${nextBonus ?? 'unset'}, dailyAdLimit=${nextLimit}, earningEnabled=${earningEnabled}`,
      });

      showToast('Economy & earning configuration saved.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save economy settings.', 'error');
    } finally {
      setSavingEconomy(false);
    }
  };

  const handleSaveWithdrawSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageWithdrawals) return;
    setSavingWd(true);
    try {
      const minPts = minWdPts.trim() ? Math.floor(Number(minWdPts)) : null;
      const maxBdt = maxWdBdt.trim() ? Number(maxWdBdt) : null;

      await saveWithdrawalSettingsConfig(
        {
          withdrawalEnabled: wdEnabled,
          minimumWithdrawPoints: minPts,
          maximumWithdrawBdt: maxBdt,
          defaultFeePercent: withdrawalSettings.defaultFeePercent,
          dailyLimitCount: Math.max(1, Math.floor(Number(dailyWdCount || 3))),
          dailyLimitBdt: dailyWdBdt.trim() ? Number(dailyWdBdt) : null,
          monthlyLimitBdt: monthlyWdBdt.trim() ? Number(monthlyWdBdt) : null,
          processingTimeLabel: procLabel,
          allowedMethods: allowedMethods.length > 0 ? allowedMethods : ['bkash'],
        },
        adminUser,
      );
      showToast('Withdrawal limits and status updated.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save withdrawal settings.', 'error');
    } finally {
      setSavingWd(false);
    }
  };

  const handleToggleMethod = async (m: PaymentMethodConfig) => {
    if (!canManageWithdrawals) return;
    setBusyMethodId(m.id);
    try {
      await savePaymentMethodConfig({ ...m, enabled: !m.enabled }, adminUser);
      showToast(`${m.name} ${!m.enabled ? 'enabled' : 'disabled'}.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Payment method update failed.', 'error');
    } finally {
      setBusyMethodId(null);
    }
  };

  const handleFeeUpdate = async (m: PaymentMethodConfig, feeVal: string) => {
    if (!canManageWithdrawals) return;
    const fee = Math.max(0, Math.min(50, Number(feeVal || 0)));
    setBusyMethodId(m.id);
    try {
      await savePaymentMethodConfig({ ...m, feePercent: fee }, adminUser);
      showToast(`${m.name} fee set to ${fee}%.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Fee update failed.', 'error');
    } finally {
      setBusyMethodId(null);
    }
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageRoles) return;
    setAssigningRole(true);
    try {
      const res = await assignAdminRoleViaCloudFunction({
        targetIdentifier: roleIdentifier,
        role: targetRole === 'revoke' ? null : targetRole,
      });
      showToast(
        res.role
          ? `Assigned Custom Claim "${res.role}" to ${res.email}.`
          : `Revoked admin privileges for ${res.email}.`,
        'success',
      );
      setRoleIdentifier('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Role update failed.', 'error');
    } finally {
      setAssigningRole(false);
    }
  };

  const handleExportBackup = async () => {
    if (!canExportBackup) return;
    setExportingBackup(true);
    try {
      const res = await exportDatabaseBackupWithFallback({
        adminUser: { uid: adminUser.uid, email: adminUser.email, role: adminRole },
        snapshotFallback: snapshotData,
      });
      const blob = new Blob([res.json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `adview-earn-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(
        res.source === 'cloud_function'
          ? 'Full Admin SDK Firestore backup downloaded.'
          : 'Live Firestore collections JSON snapshot downloaded.',
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Backup export failed.', 'error');
    } finally {
      setExportingBackup(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'website' as SettingsTab, label: 'Website & Maintenance', icon: Globe },
          { key: 'economy' as SettingsTab, label: 'Economy & Ads', icon: Coins },
          { key: 'withdrawals' as SettingsTab, label: 'Withdrawals & Methods', icon: Wallet },
          { key: 'roles' as SettingsTab, label: 'Admin Roles & Backup', icon: KeyRound },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border inline-flex items-center gap-2 transition-colors ${
                tab === t.key
                  ? 'bg-gradient-to-r from-violet-600/30 to-blue-600/25 border-violet-400/45 text-white'
                  : 'bg-[#0D1330] border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Website & Maintenance */}
      {tab === 'website' && (
        <form
          onSubmit={handleSaveSite}
          className="rounded-2xl bg-[#0D1330] border border-white/10 p-5 space-y-4 text-xs"
        >
          {!canManageSite && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-3 flex items-start gap-2 text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Only <strong>Super Admin</strong> can update Website Identity, Maintenance Mode, and
                Registration Toggle (<span className="font-mono-num">appSettings/site</span>).
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Website Name</label>
              <input
                type="text"
                disabled={!canManageSite}
                value={siteForm.websiteName}
                onChange={(e) => setSiteForm({ ...siteForm, websiteName: e.target.value })}
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Support Email</label>
              <input
                type="email"
                disabled={!canManageSite}
                value={siteForm.supportEmail}
                onChange={(e) => setSiteForm({ ...siteForm, supportEmail: e.target.value })}
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Website Logo URL (Optional)</label>
              <input
                type="url"
                disabled={!canManageSite}
                value={siteForm.websiteLogoUrl}
                onChange={(e) => setSiteForm({ ...siteForm, websiteLogoUrl: e.target.value })}
                placeholder="https://..."
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Favicon URL (Optional)</label>
              <input
                type="url"
                disabled={!canManageSite}
                value={siteForm.websiteFaviconUrl}
                onChange={(e) => setSiteForm({ ...siteForm, websiteFaviconUrl: e.target.value })}
                placeholder="https://..."
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="font-semibold text-slate-300">Support Contact / Telegram / Phone</label>
              <input
                type="text"
                disabled={!canManageSite}
                value={siteForm.supportContact}
                onChange={(e) => setSiteForm({ ...siteForm, supportContact: e.target.value })}
                placeholder="e.g. +8801XXXXXXXXX or @AdViewSupport"
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="font-semibold text-slate-300">Website Description</label>
              <textarea
                rows={2}
                disabled={!canManageSite}
                value={siteForm.websiteDescription}
                onChange={(e) => setSiteForm({ ...siteForm, websiteDescription: e.target.value })}
                className="w-full p-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#070B22] border border-white/10 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManageSite}
                checked={siteForm.maintenanceMode}
                onChange={(e) => setSiteForm({ ...siteForm, maintenanceMode: e.target.checked })}
                className="w-4 h-4 mt-0.5 rounded accent-amber-500"
              />
              <div>
                <p className="font-bold text-white">Maintenance Mode</p>
                <p className="text-[11px] text-slate-400">
                  Pauses the public User Portal with a maintenance notice while keeping{' '}
                  <span className="font-mono-num">/admin</span> accessible.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#070B22] border border-white/10 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManageSite}
                checked={siteForm.registrationEnabled}
                onChange={(e) =>
                  setSiteForm({ ...siteForm, registrationEnabled: e.target.checked })
                }
                className="w-4 h-4 mt-0.5 rounded accent-violet-600"
              />
              <div>
                <p className="font-bold text-white">Allow New User Registration</p>
                <p className="text-[11px] text-slate-400">
                  Disabling stops new signups on the registration page immediately.
                </p>
              </div>
            </label>
          </div>

          <button
            type="submit"
            disabled={!canManageSite || savingSite}
            className="min-h-[42px] px-5 rounded-xl brand-button text-white font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {savingSite ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Save Website Settings</span>
          </button>
        </form>
      )}

      {/* Tab 2: Economy & Earning */}
      {tab === 'economy' && (
        <form
          onSubmit={handleSaveEconomy}
          className="rounded-2xl bg-[#0D1330] border border-white/10 p-5 space-y-4 text-xs"
        >
          {!canManageEconomy && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-3 text-amber-200">
              Read-only tier: Economy changes require Admin or Super Admin role.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">
                Points Conversion Rate (Points = 1 BDT)
              </label>
              <input
                type="number"
                min={1}
                disabled={!canManageEconomy}
                value={pointsPerBdt}
                onChange={(e) => setPointsPerBdt(e.target.value)}
                placeholder="e.g. 100"
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Daily Bonus Reward (Points)</label>
              <input
                type="number"
                min={1}
                disabled={!canManageEconomy}
                value={dailyBonusPoints}
                onChange={(e) => setDailyBonusPoints(e.target.value)}
                placeholder="e.g. 25"
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Daily Ad Limit / User</label>
              <input
                type="number"
                min={1}
                disabled={!canManageEconomy}
                value={dailyAdLimit}
                onChange={(e) => setDailyAdLimit(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 p-3.5 rounded-xl bg-[#070B22] border border-white/10 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canManageEconomy}
              checked={earningEnabled}
              onChange={(e) => setEarningEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-violet-600"
            />
            <span className="font-semibold text-white">
              Enable Watch Ads &amp; Reward Earning System
            </span>
          </label>

          <button
            type="submit"
            disabled={!canManageEconomy || savingEconomy}
            className="min-h-[42px] px-5 rounded-xl brand-button text-white font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {savingEconomy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Save Economy Settings</span>
          </button>
        </form>
      )}

      {/* Tab 3: Withdrawal Settings & Payment Methods */}
      {tab === 'withdrawals' && (
        <div className="space-y-5">
          <form
            onSubmit={handleSaveWithdrawSettings}
            className="rounded-2xl bg-[#0D1330] border border-white/10 p-5 space-y-4 text-xs"
          >
            <label className="flex items-center gap-2.5 font-semibold text-white cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManageWithdrawals}
                checked={wdEnabled}
                onChange={(e) => setWdEnabled(e.target.checked)}
                className="w-4 h-4 rounded accent-violet-600"
              />
              <span>Enable User Withdrawal Requests</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Minimum Withdraw (Points)</label>
                <input
                  type="number"
                  min={1}
                  disabled={!canManageWithdrawals}
                  value={minWdPts}
                  onChange={(e) => setMinWdPts(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Maximum Withdraw / Tx (BDT)</label>
                <input
                  type="number"
                  min={1}
                  disabled={!canManageWithdrawals}
                  value={maxWdBdt}
                  onChange={(e) => setMaxWdBdt(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Daily Withdraw Count Cap</label>
                <input
                  type="number"
                  min={1}
                  disabled={!canManageWithdrawals}
                  value={dailyWdCount}
                  onChange={(e) => setDailyWdCount(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Daily BDT Cap (Optional)</label>
                <input
                  type="number"
                  min={1}
                  disabled={!canManageWithdrawals}
                  value={dailyWdBdt}
                  onChange={(e) => setDailyWdBdt(e.target.value)}
                  placeholder="No daily BDT cap"
                  className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Monthly BDT Cap (Optional)</label>
                <input
                  type="number"
                  min={1}
                  disabled={!canManageWithdrawals}
                  value={monthlyWdBdt}
                  onChange={(e) => setMonthlyWdBdt(e.target.value)}
                  placeholder="No monthly BDT cap"
                  className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Processing Window Label</label>
                <input
                  type="text"
                  disabled={!canManageWithdrawals}
                  value={procLabel}
                  onChange={(e) => setProcLabel(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!canManageWithdrawals || savingWd}
              className="min-h-[42px] px-5 rounded-xl brand-button text-white font-bold inline-flex items-center gap-2 disabled:opacity-50"
            >
              {savingWd ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Save Withdrawal Rules</span>
            </button>
          </form>

          {/* Payment Methods Table */}
          <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/10">
              <h3 className="text-sm font-bold font-display text-white">
                Payment Methods (bKash, Nagad, Rocket, Bank Transfer)
              </h3>
            </div>
            <div className="divide-y divide-white/10 text-xs">
              {paymentMethods.map((m) => (
                <div
                  key={m.id}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-bold text-white">{m.name}</p>
                    <p className="text-[11px] text-slate-400">{m.processingWindow}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-slate-300">
                      <span>Fee %</span>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        step={0.5}
                        disabled={!canManageWithdrawals || busyMethodId === m.id}
                        defaultValue={m.feePercent}
                        onBlur={(e) => {
                          if (Number(e.target.value) !== m.feePercent) {
                            void handleFeeUpdate(m, e.target.value);
                          }
                        }}
                        className="w-16 h-8 px-2 rounded-lg bg-[#070B22] border border-white/15 text-white font-mono-num text-right"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!canManageWithdrawals || busyMethodId === m.id}
                      onClick={() => void handleToggleMethod(m)}
                      className={`min-h-[34px] px-3 rounded-lg font-bold border disabled:opacity-50 ${
                        m.enabled
                          ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                          : 'bg-rose-500/15 border-rose-400/35 text-rose-300'
                      }`}
                    >
                      {m.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: 3-Tier Admin Roles, Custom Claims & Database Backup */}
      {tab === 'roles' && (
        <div className="space-y-5 text-xs">
          {/* Role Assignment Form */}
          <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold font-display text-white">
                  Assign / Revoke Firebase Custom Claims Role
                </h3>
                <p className="text-slate-400 mt-0.5">
                  Verified server-side via <span className="font-mono-num">setAdminRoleClaim</span>{' '}
                  Cloud Function &amp; enforced in <span className="font-mono-num">firestore.rules</span>.
                </p>
              </div>
              <ShieldCheck className="w-5 h-5 text-violet-400 shrink-0" />
            </div>

            {!canManageRoles && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-3 text-amber-200">
                Only <strong>Super Admin</strong> can assign or revoke Admin Custom Claims.
              </div>
            )}

            <form onSubmit={handleAssignRole} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                type="text"
                disabled={!canManageRoles || assigningRole}
                value={roleIdentifier}
                onChange={(e) => setRoleIdentifier(e.target.value)}
                placeholder="Admin Email or Firebase UID"
                className="sm:col-span-6 h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
              />
              <select
                aria-label="Target admin role"
                disabled={!canManageRoles || assigningRole}
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value as AdminRole | 'revoke')}
                className="sm:col-span-3 h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
              >
                <option value="super_admin">Super Admin</option>
                <option value="admin">Admin</option>
                <option value="support_admin">Support Admin (Read-Only)</option>
                <option value="revoke">Revoke Admin Claim</option>
              </select>
              <button
                type="submit"
                disabled={!canManageRoles || assigningRole}
                className="sm:col-span-3 h-10 rounded-xl brand-button text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {assigningRole && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Update Role Claim</span>
              </button>
            </form>

            {adminsList.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#070B22]">
                <table className="w-full text-left">
                  <thead className="border-b border-white/10 text-[11px] uppercase text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 px-3">UID</th>
                      <th className="py-2.5 px-3">Role</th>
                      <th className="py-2.5 px-3 text-right">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {adminsList.map((adm) => (
                      <tr key={adm.uid}>
                        <td className="py-2.5 px-3 text-white font-semibold">{adm.email || '—'}</td>
                        <td className="py-2.5 px-3 font-mono-num text-slate-400">{adm.uid}</td>
                        <td className="py-2.5 px-3 font-mono-num text-violet-300">{adm.role}</td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-slate-400">
                          {adm.updatedAtLabel}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3-Tier Permissions Matrix */}
          <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/10">
              <h3 className="text-sm font-bold font-display text-white">
                3-Tier Admin Permissions Matrix
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase text-slate-400">
                  <tr>
                    <th className="py-3 px-4">Capability</th>
                    <th className="py-3 px-4 text-center">Super Admin</th>
                    <th className="py-3 px-4 text-center">Admin</th>
                    <th className="py-3 px-4 text-center">Support Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {PERMISSION_MATRIX.map((row) => (
                    <tr key={row.capability}>
                      <td className="py-2.5 px-4 text-slate-200">{row.capability}</td>
                      <td className="py-2.5 px-4 text-center">
                        {row.super_admin ? (
                          <span className="text-emerald-300 font-bold">Yes</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {row.admin ? (
                          <span className="text-emerald-300 font-bold">Yes</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {row.support_admin ? (
                          <span className="text-emerald-300 font-bold">Yes</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Database Backup JSON Export */}
          <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Database className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold font-display text-white">
                  Super Admin JSON Database Backup
                </h3>
                <p className="text-slate-400 mt-0.5">
                  Exports Firestore collections using{' '}
                  <span className="font-mono-num">exportDatabaseBackupSnapshot</span> (or live
                  Admin snapshot when Functions are not yet deployed).
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!canExportBackup || exportingBackup}
              onClick={() => void handleExportBackup()}
              className="min-h-[42px] px-4 rounded-xl border border-violet-400/35 bg-violet-500/15 hover:bg-violet-500/25 text-violet-100 font-bold inline-flex items-center gap-2 shrink-0 disabled:opacity-40"
            >
              {exportingBackup ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>Export JSON Backup</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
