/**
 * 云函数：savePrivacyConsent —— 记录或撤回隐私同意
 * 入参：event.payload = { action: 'agree' | 'withdraw', version? }
 * 同意：写入 privacyAgreedAt 与 privacyConsentVersion（须与当前版本一致）。
 * 撤回：清空同意，并清除用户资料中的联系方式与地址，记下删除申请时间。
 *       历史订单与支付记录不在此处删除，需商家在云开发控制台按申请人工处理。
 * 出参：{ code: 0, data: { user } } / 1001 未登录 / 2002 参数非法
 */
const cloud = require('wx-server-sdk');
const rules = require('./rules');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const users = db.collection('users');

function ok(data) {
  return { code: 0, data: data === undefined ? null : data, message: 'ok' };
}

function fail(code, message) {
  return { code, data: null, message };
}

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) return fail(1001, '请先登录');

    const payload = (event && event.payload) || {};
    const action = payload.action;
    if (action !== 'agree' && action !== 'withdraw') return fail(2002, '参数不正确');

    const existing = await users.where({ openid }).orderBy('_id', 'asc').limit(1).get();
    if (!existing.data || !existing.data.length) return fail(1001, '请先登录');
    const user = existing.data[0];
    const now = Date.now();

    let patch;
    if (action === 'agree') {
      const version = typeof payload.version === 'string' ? payload.version.trim() : '';
      if (version !== rules.PRIVACY_POLICY_VERSION) return fail(2002, '隐私政策已更新，请重新阅读');
      patch = {
        privacyAgreedAt: now,
        privacyConsentVersion: version,
        privacyWithdrawnAt: 0,
        updatedAt: now
      };
    } else {
      patch = {
        privacyAgreedAt: 0,
        privacyConsentVersion: '',
        privacyWithdrawnAt: now,
        privacyDeletionRequestedAt: now,
        phone: '',
        realName: '',
        company: '',
        industry: '',
        invoiceTitle: '',
        taxNo: '',
        nickName: '',
        avatarUrl: '',
        addresses: [],
        updatedAt: now
      };
    }

    await users.doc(user._id).update({ data: patch });
    const updated = Object.assign({}, user, patch);
    console.log('[savePrivacyConsent] %s openid=%s', action, openid);
    return ok({ user: rules.toPublicUser(updated) });
  } catch (err) {
    console.error('[savePrivacyConsent] error', err);
    return fail(2002, '保存失败，请重试');
  }
};
