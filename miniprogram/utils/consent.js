/**
 * 隐私同意是否仍然有效。版本与云函数 savePrivacyConsent / orderRules 一致。
 */
const PRIVACY_POLICY_VERSION = '2026-11-06';

function hasActiveConsent(user, version) {
  const expected = version || PRIVACY_POLICY_VERSION;
  if (!user || typeof user !== 'object') return false;
  const agreedAt = Number(user.privacyAgreedAt) || 0;
  if (!(agreedAt > 0)) return false;
  if ((user.privacyConsentVersion || '') !== expected) return false;
  const withdrawnAt = Number(user.privacyWithdrawnAt) || 0;
  if (withdrawnAt && withdrawnAt >= agreedAt) return false;
  return true;
}

module.exports = {
  PRIVACY_POLICY_VERSION,
  hasActiveConsent
};
