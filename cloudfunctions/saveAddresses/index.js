/**
 * 云函数：saveAddresses —— 全量保存收货地址列表（第一批注册入口）
 * 需求锚点：地址管理完善（新增/编辑/删除/设默认、微信导入补全）
 *
 * 入参：event.payload = { addresses: [{
 *   addressId?: string, name: string (≤30), phone: string (11 位),
 *   province?: string, city?: string, county?: string,
 *   detailInfo?: string (≤200), detail?: string (≤200，省市区+详细地址拼接),
 *   isDefault?: boolean
 * }] }（最多 10 条）
 * 出参：{ code: 0, data: { addresses }, message: 'ok' }
 * 失败：1001 未登录 / 2002 参数非法
 *
 * 安全要点：
 *   1) openid 仅取 cloud.getWXContext().OPENID，忽略前端传入；
 *   2) 只写 addresses 字段，其余用户资料一律不动；
 *   3) 默认地址归一：多条默认取第一条，无默认时第一条自动为默认；
 *   4) detail 字段与 createOrder / createCustomOrder 服务端读取口径一致。
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

function safeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) {
      console.error('[saveAddresses] 无法获取 OPENID');
      return fail(1001, '请先登录');
    }

    const input = (event && event.payload && event.payload.addresses) || [];
    if (!Array.isArray(input) || input.length > 10) {
      return fail(2002, '地址数量不正确（最多 10 条）');
    }

    const now = Date.now();
    const list = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i] || {};
      const name = safeString(a.name, 30);
      const phone = safeString(a.phone, 20);
      if (!name) return fail(2002, '请填写收货人姓名');
      if (!/^1[3-9]\d{9}$/.test(phone)) return fail(2002, '请填写正确的 11 位手机号');
      const province = safeString(a.province, 20);
      const city = safeString(a.city, 20);
      const county = safeString(a.county, 20);
      const detailInfo = safeString(a.detailInfo, 200);
      const joined = [province, city, county, detailInfo].filter(Boolean).join('');
      const detail = safeString(a.detail, 200) || joined;
      if (!detail) return fail(2002, '请填写详细地址');
      list.push({
        addressId: safeString(a.addressId, 60) || 'addr_' + now + '_' + i,
        name: name,
        phone: phone,
        province: province,
        city: city,
        county: county,
        detailInfo: detailInfo,
        detail: detail,
        isDefault: a.isDefault === true
      });
    }
    // 默认归一：多条默认取第一条；无默认时第一条自动为默认
    let hasDefault = false;
    list.forEach((a) => {
      if (a.isDefault) {
        if (hasDefault) a.isDefault = false;
        else hasDefault = true;
      }
    });
    if (list.length && !hasDefault) list[0].isDefault = true;

    const existing = await users.where({ openid }).limit(1).get();
    if (!existing.data || !existing.data.length) {
      return fail(1001, '请先登录');
    }
    const user = existing.data[0];
    await users.doc(user._id).update({ data: { addresses: list, updatedAt: now } });
    return ok({ addresses: list });
  } catch (err) {
    console.error('[saveAddresses] 保存失败', err);
    return fail(2002, '保存失败，请重试');
  }
};
