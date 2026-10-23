/**
 * 云函数：getPhoneNumber —— 解密用户主动授权后的手机号
 * 需求锚点：REQ-043、REQ-050
 *
 * 入参：event.payload = { cloudID: string }
 *   cloudID 来自前端 <button open-type="getPhoneNumber"> 回调中 e.detail.cloudID。
 * 出参：{ code: 0, data: { phone, phoneMasked, hasPhone }, message: 'ok' }
 *   为满足 REQ-050（前端不展示明文），返回的 phone/phoneMasked 均为脱敏值。
 * 失败：{ code: 2001, data: null, message: '手机号授权失败，请重试' }
 *       { code: 2002, data: null, message: '手机号不可用，请手动填写' }
 *
 * 安全要点：仅当用户主动点击授权按钮后前端才能拿到 cloudID；本函数不做任何静默获取。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const users = db.collection('users');

function ok(data) {
  return { code: 0, data: data === undefined ? null : data, message: 'ok' };
}

function fail(code, message) {
  return { code, data: null, message };
}

/** 手机号脱敏：173****3179 */
function maskPhone(phone) {
  const s = String(phone || '');
  if (/^\d{11}$/.test(s)) return s.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  if (s.length >= 7) return s.slice(0, 3) + '****' + s.slice(-4);
  return s ? '****' : '';
}

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) {
      console.error('[getPhoneNumber] 无法获取 OPENID');
      return fail(2001, '手机号授权失败，请重试');
    }

    const payload = (event && event.payload) || {};
    const cloudID = payload.cloudID;
    if (!cloudID || typeof cloudID !== 'string') {
      console.warn('[getPhoneNumber] 缺少 cloudID');
      return fail(2002, '手机号不可用，请手动填写');
    }

    // 云调用解密：cloud.getOpenData 由云开发在服务端完成解密，前端无法伪造
    let phone = '';
    try {
      const result = await cloud.getOpenData({ list: [cloudID] });
      const item = result && result.list && result.list[0];
      const data = item && item.data;
      phone = (data && (data.purePhoneNumber || data.phoneNumber)) || '';
    } catch (err) {
      console.error('[getPhoneNumber] openData 解密失败', err);
      return fail(2002, '手机号不可用，请手动填写');
    }

    if (!/^\d{6,15}$/.test(String(phone))) {
      console.warn('[getPhoneNumber] 解密结果非法');
      return fail(2002, '手机号不可用，请手动填写');
    }

    const now = Date.now();
    const existing = await users.where({ openid }).limit(1).get();
    if (existing.data && existing.data.length) {
      await users.doc(existing.data[0]._id).update({ data: { phone, updatedAt: now } });
    } else {
      // 容错：登录记录缺失时补建，避免授权手机号丢失
      await users.add({
        data: {
          openid,
          nickName: '',
          avatarUrl: '',
          phone,
          addresses: [],
          role: 'customer',
          privacyAgreedAt: 0,
          createdAt: now,
          updatedAt: now
        }
      });
    }

    const masked = maskPhone(phone);
    console.log('[getPhoneNumber] ok openid=%s', openid);
    return ok({ phone: masked, phoneMasked: masked, hasPhone: true });
  } catch (err) {
    console.error('[getPhoneNumber] error', err);
    return fail(2001, '手机号授权失败，请重试');
  }
};