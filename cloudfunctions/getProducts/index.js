/**
 * 云函数：getProducts —— 标准品商品列表 / 详情
 * 需求锚点：REQ-020、REQ-021、REQ-022、REQ-026
 *
 * 入参：event.payload = { action: 'list'|'detail', productId?, page?, pageSize? }
 * 出参：{ code: 0, data, message: 'ok' }
 *   list   → { list, total, page, pageSize, hasMore }
 *   detail → { product }
 * 失败：{ code: 4001, data: null, message: '商品不存在或已下架' }
 *
 * 说明：只读、无副作用；列表仅返回在售（status=on）商品（REQ-020 异常场景）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function ok(data) {
  return { code: 0, data: data === undefined ? null : data, message: 'ok' };
}

function fail(code, message) {
  return { code, data: null, message };
}

function toInt(value, def) {
  const n = parseInt(value, 10);
  return isNaN(n) ? def : n;
}

exports.main = async (event) => {
  try {
    const payload = (event && event.payload) || {};
    const action = payload.action || 'list';

    if (action === 'detail') {
      const productId = payload.productId;
      if (!productId || typeof productId !== 'string') {
        return fail(4001, '商品不存在或已下架');
      }
      // 兼容传入 _id 或 code
      const res = await db
        .collection('products')
        .where(_.or([{ _id: productId }, { code: productId }]))
        .limit(1)
        .get();
      const product = res.data && res.data[0];
      if (!product || product.status !== 'on') {
        return fail(4001, '商品不存在或已下架');
      }
      return ok({ product });
    }

    if (action === 'list') {
      const page = Math.max(1, toInt(payload.page, 1));
      let pageSize = toInt(payload.pageSize, 10);
      pageSize = Math.min(50, Math.max(1, pageSize));

      const where = { status: 'on' };
      if (payload.category) where.category = payload.category;

      const countRes = await db.collection('products').where(where).count();
      const total = (countRes && countRes.total) || 0;
      const res = await db
        .collection('products')
        .where(where)
        .orderBy('sort', 'asc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();

      return ok({
        list: res.data || [],
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total
      });
    }

    console.warn('[getProducts] 非法 action=%s', action);
    return fail(4001, '商品不存在或已下架');
  } catch (err) {
    console.error('[getProducts] error', err);
    return fail(4001, '商品不存在或已下架');
  }
};