/**
 * 云函数：createCustomOrder —— 定制需求提交（生成「待报价」订单）
 * 需求锚点：REQ-027~029、REQ-043、REQ-053
 *
 * 入参：event.payload = {
 *   materialType, size?, quantity? | area?, installPosition?, requirement?,
 *   contactPhone?, referenceFileIds?: string[], clientRequestId, privacyAgreed?
 * }
 * 出参：{ code: 0, data: { orderId, orderNo }, message: 'ok' }
 * 失败：{ code: 6001, data: null, message: '请填写必填项' }
 *       { code: 6002, data: null, message: '提交失败，请重试' }
 *
 * 安全要点：openid 仅取云开发上下文；clientRequestId 幂等防重复提交。
 */
const cloud = require('wx-server-sdk');
const rules = require('./rules');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const orderLogs = db.collection('order_logs');
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

async function loadUser(openid) {
  const res = await users.where({ openid }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

/** 联系电话：客户端完整 11 位优先，否则回退用户资料里已授权的手机号（不接受脱敏串）。 */
function resolveContactPhone(input, stored) {
  const typed = safeString(input, 20);
  if (/^1[3-9]\d{9}$/.test(typed)) return typed;
  const saved = safeString(stored, 20);
  if (/^1[3-9]\d{9}$/.test(saved)) return saved;
  return '';
}

/** 参考图数量上限：与前端 UPLOAD_LIMITS.MAX_COUNT 保持一致（6，C-UPLOAD@1 / C-VALIDATE@1） */
const MAX_REFERENCE_FILES = 6;

/** 归一化参考图 fileID 列表（仅接受 cloud:// 前缀的云存储 fileID，最多 MAX_REFERENCE_FILES 张） */
function normalizeFileIds(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v) => typeof v === 'string' && v.indexOf('cloud://') === 0)
    .slice(0, MAX_REFERENCE_FILES);
}

function genOrderNo(prefix) {
  const d = new Date();
  const pad = (n, l) => String(n).padStart(l, '0');
  const ts =
    '' +
    d.getFullYear() +
    pad(d.getMonth() + 1, 2) +
    pad(d.getDate(), 2) +
    pad(d.getHours(), 2) +
    pad(d.getMinutes(), 2) +
    pad(d.getSeconds(), 2);
  return prefix + ts + pad(Math.floor(Math.random() * 1000), 3);
}

async function writeLog(orderNo, action, from, to, source, detail) {
  try {
    await orderLogs.add({
      data: {
        orderNo,
        action,
        from: from || '',
        to: to || '',
        source,
        detail: detail || {},
        createdAt: Date.now()
      }
    });
  } catch (err) {
    console.error('[order_logs] 写入失败', err);
  }
}

exports.main = async (event) => {
  const now = Date.now();
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) return fail(6002, '提交失败，请重试');

    const payload = (event && event.payload) || {};
    const materialType = safeString(payload.materialType, 40);
    const clientRequestId = safeString(payload.clientRequestId, 64);
    const measure = rules.resolveMeasure(payload.quantity, payload.area);

    // 必填：物料类型、幂等键，以及数量或面积至少一项合法（与定制页同一规则）
    if (!materialType || !clientRequestId) {
      return fail(6001, '请填写必填项');
    }
    if (!measure.ok) {
      return fail(6001, measure.message);
    }

    // 幂等：同一 clientRequestId 重复提交复用已有订单
    const dup = await orders.where({ openid, clientRequestId }).limit(1).get();
    if (dup.data && dup.data.length) {
      const exist = dup.data[0];
      return ok({ orderId: exist._id, orderNo: exist.orderNo, duplicated: true });
    }

    const user = await loadUser(openid);
    if (!rules.hasActiveConsent(user)) {
      return fail(6003, '请先同意隐私政策');
    }

    // 结构化材质配置（来自物料配置器），兼容旧的自由文本模式
    const spec = payload.spec && typeof payload.spec === 'object' ? {
      thickness: safeString(payload.spec.thickness, 40),
      size: safeString(payload.spec.size, 80),
      color: safeString(payload.spec.color, 40)
    } : null;

    const requirement = {
      materialType,
      category: safeString(payload.category, 40),
      categoryName: safeString(payload.categoryName, 40),
      materialName: safeString(payload.materialName, 60),
      materialCode: safeString(payload.materialCode, 60),
      spec,
      crafts: Array.isArray(payload.crafts)
        ? payload.crafts.slice(0, 20).map((c) => safeString(c, 40)).filter(Boolean)
        : [],
      size: safeString(payload.size, 100),
      sizeDesc: safeString(payload.sizeDesc, 100),
      area: measure.area,
      quantity: measure.quantity,
      installPosition: safeString(payload.installPosition, 100),
      requirement: safeString(payload.requirement || payload.remark, 500),
      referenceFileIds: normalizeFileIds(payload.referenceFileIds)
    };

    const contactPhone = resolveContactPhone(payload.contactPhone, user && user.phone);
    const orderNo = genOrderNo('D');

    const orderDoc = {
      orderNo,
      type: 'custom',
      openid,
      amount: 0,
      status: 'pending_quote',
      items: [],
      customRequirement: requirement,
      // 联系方式统一采用中国大陆 11 位手机号口径（与地址保存/标准品下单一致）
      contactPhone: /^1[3-9]\d{9}$/.test(contactPhone) ? contactPhone : '',
      clientRequestId,
      privacyAgreed: true,
      privacyConsentVersion: user.privacyConsentVersion || rules.PRIVACY_POLICY_VERSION,
      privacyAgreedAt: user.privacyAgreedAt || 0,
      // 对接设计师：新订单默认由 Muse 对接；留言与回复走 musePoll / museReply 桥
      designer: { name: 'Muse', role: '对接设计师' },
      designerReplies: [],
      clientMessages: [],
      designerAckAt: null,
      payments: [],
      timeline: [{ status: 'pending_quote', at: now, source: 'customer' }],
      createdAt: now,
      updatedAt: now
    };

    const added = await orders.add({ data: orderDoc });
    await writeLog(orderNo, 'create', '', 'pending_quote', 'customer', {
      type: 'custom',
      materialType,
      quantity: measure.quantity,
      area: measure.area
    });

    // 幂等并发兜底（C-VALIDATE@1）：写入后回查一次，若并发首次提交产生了重复
    // 订单，则以「该 (openid, clientRequestId) 下最小 _id」为权威记录返回，并
    // 清理多余重复记录。建议为 orders 建 (openid, clientRequestId) 复合唯一索引
    // 作最终兜底（计划 O5）。
    const recheck = await orders
      .where({ openid, clientRequestId })
      .orderBy('_id', 'asc')
      .limit(20)
      .get();
    const rows = (recheck && recheck.data) || [];
    if (rows.length) {
      const canonical = rows[0];
      if (rows.length > 1) {
        const dupOrderNos = rows.slice(1).map((r) => r.orderNo).filter(Boolean);
        try {
          await orders
            .where({ openid, clientRequestId, _id: _.gt(canonical._id) })
            .remove();
        } catch (cleanupErr) {
          console.warn('[createCustomOrder] 清理并发重复订单失败', cleanupErr);
        }
        for (let i = 0; i < dupOrderNos.length; i++) {
          try {
            await orderLogs.where({ orderNo: dupOrderNos[i], action: 'create' }).remove();
          } catch (logErr) {
            console.warn('[createCustomOrder] 清理重复订单日志失败', logErr);
          }
        }
        console.log('[createCustomOrder] 命中幂等复用 orderNo=%s', canonical.orderNo);
        return ok({ orderId: canonical._id, orderNo: canonical.orderNo, duplicated: true });
      }
    }

    console.log('[createCustomOrder] ok orderNo=%s materialType=%s', orderNo, materialType);
    return ok({ orderId: added._id, orderNo });
  } catch (err) {
    console.error('[createCustomOrder] error', err);
    return fail(6002, '提交失败，请重试');
  }
};