import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import type { Request } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const FIRESTORE_DATABASE_ID = 'ai-studio-adviewearn-4a6d84ce-fab0-48b4-8d32-4f450c4d1278';

export const db = admin.firestore();
db.settings({ databaseId: FIRESTORE_DATABASE_ID, ignoreUndefinedProperties: true });

export const adminAuth = admin.auth();
export const FieldValue = admin.firestore.FieldValue;

export type AdminRole = 'super_admin' | 'admin' | 'support_admin';

export const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'jiki58220@gmail.com';
export const DEFAULT_GLOBAL_DAILY_AD_LIMIT = 20;
export const MIN_SECONDS_BETWEEN_COMPLETIONS = 10;

export const PAYMENT_FEES: Record<string, number> = {
  bkash: 2,
  nagad: 1.5,
  rocket: 1.8,
  bank: 3,
};

export const VALID_ACCOUNT_TYPES = ['personal', 'agent', 'merchant', 'bank_account'];

const ROLE_WEIGHT: Record<AdminRole, number> = {
  support_admin: 1,
  admin: 2,
  super_admin: 3,
};

export function hasMinimumRole(
  actual: AdminRole | null,
  required: AdminRole,
): boolean {
  if (!actual) return false;
  return ROLE_WEIGHT[actual] >= ROLE_WEIGHT[required];
}

export function getDhakaDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getDhakaMonthKey(date: Date = new Date()): string {
  return getDhakaDateKey(date).slice(0, 7);
}

export function maskAccountNumber(accountNumber: string, methodId: string): string {
  const clean = accountNumber.trim();
  if (!clean) return '****';
  if (methodId !== 'bank' && clean.length >= 11) {
    return `${clean.slice(0, 3)}****${clean.slice(-4)}`;
  }
  if (clean.length <= 6) {
    return `${clean.slice(0, 2)}****`;
  }
  return `${clean.slice(0, 2)}****${clean.slice(-4)}`;
}

export function validateMethodAccount(
  methodId: string,
  rawAccount: string,
): { valid: boolean; normalized: string } {
  const trimmed = rawAccount.trim();
  if (methodId === 'bkash' || methodId === 'nagad' || methodId === 'rocket') {
    const digits = trimmed.replace(/[\s-]/g, '');
    return { valid: /^01[3-9]\d{8}$/.test(digits), normalized: digits };
  }
  return { valid: trimmed.length >= 8 && trimmed.length <= 80, normalized: trimmed };
}

export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

export function calcBdtSnapshot(points: number, pointsPerBdt: number | null): number {
  if (!pointsPerBdt || pointsPerBdt <= 0) return 0;
  return Number((points / pointsPerBdt).toFixed(2));
}

export function maskPublicUsername(username: string): string {
  const clean = username.trim().replace(/^@+/, '');
  if (!clean) return 'mem***';
  if (clean.length <= 3) return `${clean.slice(0, 1)}***`;
  if (clean.length <= 5) return `${clean.slice(0, 2)}***${clean.slice(-1)}`;
  return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
}

export function verifyCallbackSecretOrHmac(
  providedSecret: string,
  providedSignature: string,
  payloadString: string,
  expectedSecret: string,
): boolean {
  if (!expectedSecret) {
    return false;
  }
  if (providedSecret) {
    const a = Buffer.from(providedSecret);
    const b = Buffer.from(expectedSecret);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  if (providedSignature) {
    const expectedHmac = crypto
      .createHmac('sha256', expectedSecret)
      .update(payloadString)
      .digest('hex');
    const a = Buffer.from(providedSignature.toLowerCase());
    const b = Buffer.from(expectedHmac.toLowerCase());
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}

export interface VerifiedRequestAuth {
  uid: string;
  email: string;
  emailVerified: boolean;
  adminRole: AdminRole | null;
}

export async function verifyAppCheckIfEnforced(req: Request): Promise<{ ok: boolean; error?: string }> {
  const enforced = process.env.ENFORCE_APP_CHECK === 'true';
  const rawToken = req.headers['x-firebase-appcheck'];
  const token = Array.isArray(rawToken) ? rawToken[0] : String(rawToken || '').trim();

  if (!token) {
    if (enforced) {
      await logSystemError('anonymous', 'app_check', 'verifyAppCheck', 'Missing X-Firebase-AppCheck header', 'high');
      return { ok: false, error: 'Missing Firebase App Check token' };
    }
    return { ok: true };
  }

  try {
    await admin.appCheck().verifyToken(token);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid App Check token';
    if (enforced) {
      await logSystemError('anonymous', 'app_check', 'verifyAppCheck', msg, 'high');
      return { ok: false, error: 'Invalid Firebase App Check token' };
    }
    return { ok: true };
  }
}

export async function verifyAuthAndRole(
  req: Request,
  options: {
    requireVerifiedEmail?: boolean;
    requiredAdminRole?: AdminRole;
  } = {},
): Promise<{ auth?: VerifiedRequestAuth; status?: number; error?: string }> {
  const appCheckResult = await verifyAppCheckIfEnforced(req);
  if (!appCheckResult.ok) {
    return { status: 401, error: appCheckResult.error || 'App Check verification failed' };
  }

  const authHeader = String(req.headers.authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { status: 401, error: 'Missing Authorization Bearer token' };
  }

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(match[1], true);
  } catch {
    return { status: 401, error: 'Invalid or expired auth token' };
  }

  const email = String(decoded.email || '');
  const emailVerified = Boolean(decoded.email_verified);

  if (options.requireVerifiedEmail && !emailVerified) {
    return { status: 403, error: 'Verified email required' };
  }

  let resolvedRole: AdminRole | null = null;
  if (email.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL && emailVerified) {
    resolvedRole = 'super_admin';
  }

  const claimRole = decoded.adminRole;
  if (
    !resolvedRole &&
    emailVerified &&
    (claimRole === 'super_admin' || claimRole === 'admin' || claimRole === 'support_admin')
  ) {
    resolvedRole = claimRole;
  }

  if (!resolvedRole) {
    const marker = await db.collection('admins').doc(decoded.uid).get();
    if (marker.exists) {
      const data = marker.data()!;
      const docRole = data.role;
      if (docRole === 'super_admin' || docRole === 'admin' || docRole === 'support_admin') {
        resolvedRole = docRole;
      } else {
        resolvedRole = 'admin';
      }
    }
  }

  if (options.requiredAdminRole && !hasMinimumRole(resolvedRole, options.requiredAdminRole)) {
    return {
      status: 403,
      error: `Requires ${options.requiredAdminRole} privileges`,
    };
  }

  return {
    auth: {
      uid: decoded.uid,
      email,
      emailVerified,
      adminRole: resolvedRole,
    },
  };
}

export interface ActiveAppSettings {
  pointsPerBdt: number | null;
  dailyBonusPoints: number | null;
  minimumWithdrawPoints: number | null;
  maximumWithdrawAmountBdt: number | null;
  dailyAdLimit: number;
  walletEnabled: boolean;
  earningEnabled: boolean;
}

export async function readActiveAppSettings(
  txn?: admin.firestore.Transaction,
): Promise<ActiveAppSettings> {
  const walletSettingsRef = db.collection('appSettings').doc('wallet');
  const economyRef = db.collection('appConfig').doc('economy');

  const [settingsSnap, economySnap] = txn
    ? await Promise.all([txn.get(walletSettingsRef), txn.get(economyRef)])
    : await Promise.all([walletSettingsRef.get(), economyRef.get()]);

  const s = settingsSnap.exists ? settingsSnap.data()! : {};
  const e = economySnap.exists ? economySnap.data()! : {};

  const rawRate = s.pointsPerBdt ?? e.pointsPerBdt;
  const rawBonus = s.dailyBonusPoints ?? e.dailyBonusPoints;
  const rawMinWd = s.minimumWithdrawPoints ?? e.minimumWithdrawPoints;
  const rawMaxWd = s.maximumWithdrawAmountBdt;
  const rawDailyLimit = s.dailyAdLimit ?? e.dailyAdLimit;

  return {
    pointsPerBdt: typeof rawRate === 'number' && rawRate > 0 ? rawRate : null,
    dailyBonusPoints: typeof rawBonus === 'number' && rawBonus >= 1 ? Math.floor(rawBonus) : null,
    minimumWithdrawPoints:
      typeof rawMinWd === 'number' && rawMinWd >= 1 ? Math.floor(rawMinWd) : null,
    maximumWithdrawAmountBdt:
      typeof rawMaxWd === 'number' && rawMaxWd >= 1 ? Number(rawMaxWd) : null,
    dailyAdLimit:
      typeof rawDailyLimit === 'number' && rawDailyLimit >= 1
        ? Math.floor(rawDailyLimit)
        : DEFAULT_GLOBAL_DAILY_AD_LIMIT,
    walletEnabled: typeof s.walletEnabled === 'boolean' ? s.walletEnabled : true,
    earningEnabled: typeof s.earningEnabled === 'boolean' ? s.earningEnabled : true,
  };
}

export async function logFraudAttempt(
  userId: string,
  reason: string,
  details: string,
  severity: 'low' | 'medium' | 'high',
): Promise<void> {
  await db
    .collection('fraudLogs')
    .add({
      userId: (userId || 'unknown').slice(0, 128),
      reason: reason.slice(0, 200),
      details: details.slice(0, 500),
      severity,
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});
}

export async function logFailedTransaction(params: {
  userId: string;
  operation: string;
  errorCode: string;
  transactionId?: string;
  details: string;
}): Promise<void> {
  const logId = sanitizeId(`ftx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  await db
    .collection('failedTransactionLogs')
    .doc(logId)
    .set({
      logId,
      userId: (params.userId || 'unknown').slice(0, 128),
      operation: params.operation.slice(0, 80),
      errorCode: params.errorCode.slice(0, 100),
      transactionId: (params.transactionId || '').slice(0, 128),
      details: params.details.slice(0, 500),
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});
}

export async function logSystemError(
  userId: string,
  source: 'client' | 'cloud_function' | 'app_check' | 'firestore',
  operation: string,
  message: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
): Promise<void> {
  const errorId = sanitizeId(`err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  await db
    .collection('systemErrors')
    .doc(errorId)
    .set({
      errorId,
      userId: (userId || 'system').slice(0, 128),
      source,
      operation: operation.slice(0, 100),
      message: message.slice(0, 500),
      severity,
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});
}

export function extractRequestMetadata(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.ip || 'unknown';
  const ua = String(req.headers['user-agent'] || 'unknown').slice(0, 180);
  return `ip=${ip}; ua=${ua}`.slice(0, 500);
}

export async function writeAdminAuditLog(params: {
  adminUid: string;
  adminEmail: string;
  adminRole?: AdminRole | null;
  action: string;
  targetId: string;
  previousValue?: string;
  newValue?: string;
  metadata?: string;
  details: string;
}): Promise<void> {
  const logId = sanitizeId(`adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  await db
    .collection('adminLogs')
    .doc(logId)
    .set({
      logId,
      adminUid: params.adminUid.slice(0, 128),
      adminEmail: (params.adminEmail || 'admin@adviewearn.com').slice(0, 120),
      ...(params.adminRole ? { adminRole: params.adminRole } : {}),
      action: params.action.slice(0, 80),
      targetId: params.targetId.slice(0, 128),
      ...(params.previousValue !== undefined
        ? { previousValue: params.previousValue.slice(0, 500) }
        : {}),
      ...(params.newValue !== undefined
        ? { newValue: params.newValue.slice(0, 500) }
        : {}),
      ...(params.metadata !== undefined
        ? { metadata: params.metadata.slice(0, 500) }
        : {}),
      details: params.details.slice(0, 500),
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});
}

export async function writeReferralSecurityLog(params: {
  referrerUid?: string;
  referredUid?: string;
  eventType: string;
  severity: 'low' | 'medium' | 'high';
  details: string;
}): Promise<void> {
  const logId = sanitizeId(`reflog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  await db
    .collection('referralLogs')
    .doc(logId)
    .set({
      logId,
      referrerUid: (params.referrerUid || '').slice(0, 128),
      referredUid: (params.referredUid || '').slice(0, 128),
      eventType: params.eventType.slice(0, 80),
      severity: params.severity,
      details: params.details.slice(0, 500),
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});
}
