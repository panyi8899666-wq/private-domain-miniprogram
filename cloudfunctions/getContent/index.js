/**
 * 云函数：getContent —— 内容聚合查询（首页 / 物料百科 / 作品集）
 * 需求锚点：REQ-006~018、REQ-003
 *
 * 入参：event.payload = {
 *   scope: 'home' | 'material' | 'works',
 *   section?: string,            // material 可选，按 type 过滤
 *   category?: string,           // works 可选，'all' 或分类 id
 *   page?, pageSize?
 * }
 * 出参：{ code: 0, data: {...}, message: 'ok' }
 *   scope=home     → { site, featuredWorks, materials }
 *   scope=material → { list }
 *   scope=works    → { list, total, page, pageSize, hasMore }
 * 失败：{ code: 3001, data: null, message: '内容加载失败，请重试' }
 *
 * 说明：浏览类功能无需登录；空数据返回空数组而非报错（REQ-002 异常场景）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function ok(data) {
  return { code: 0, data: data === undefined ? null : data, message: 'ok' };
}

function fail(code, message) {
  return { code, data: null, message };
}

/** 安全取整 */
function toInt(value, def) {
  const n = parseInt(value, 10);
  return isNaN(n) ? def : n;
}

/** 归一化分页参数 */
function normalizePage(payload) {
  const page = Math.max(1, toInt(payload.page, 1));
  let pageSize = toInt(payload.pageSize, 10);
  pageSize = Math.min(50, Math.max(1, pageSize));
  return { page, pageSize };
}

exports.main = async (event) => {
  try {
    const payload = (event && event.payload) || {};
    const scope = payload.scope || 'home';
    const { page, pageSize } = normalizePage(payload);

    if (scope === 'home') {
      // 首页：一次聚合站点配置 + 精选作品（≤6）+ 百科数据（REQ-006~011）
      const [siteRes, worksRes, matsRes] = await Promise.all([
        db.collection('site_config').where({ key: 'main' }).limit(1).get(),
        db.collection('works').where({ featured: true }).orderBy('sort', 'asc').limit(6).get(),
        db.collection('materials').orderBy('sort', 'asc').get()
      ]);
      return ok({
        scope,
        site: (siteRes.data && siteRes.data[0]) || null,
        featuredWorks: worksRes.data || [],
        materials: matsRes.data || []
      });
    }

    if (scope === 'material') {
      // 物料百科：按 type 过滤（section=illuminated/lightbox/inkjet/print）
      const where = {};
      if (payload.section) where.type = payload.section;
      const res = await db.collection('materials').where(where).orderBy('sort', 'asc').get();
      return ok({ scope, list: res.data || [] });
    }

    if (scope === 'works') {
      // 作品集：分类过滤 + 分页
      const where = {};
      if (payload.category && payload.category !== 'all') where.category = payload.category;
      const countRes = await db.collection('works').where(where).count();
      const total = (countRes && countRes.total) || 0;
      const res = await db
        .collection('works')
        .where(where)
        .orderBy('sort', 'asc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
      const list = res.data || [];
      return ok({ scope, list, total, page, pageSize, hasMore: page * pageSize < total });
    }

    if (scope === 'material_library') {
      // 材质库（广告物料下单系统）：按大类 code 过滤（spray/print/acrylic/pvc/light）+ 分页
      const where = {};
      if (payload.category && payload.category !== 'all') where.code = payload.category;
      const countRes = await db.collection('material_library').where(where).count();
      const total = (countRes && countRes.total) || 0;
      const res = await db
        .collection('material_library')
        .where(where)
        .orderBy('sort', 'asc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
      return ok({ scope, list: res.data || [], total, page, pageSize, hasMore: page * pageSize < total });
    }

    console.warn('[getContent] 非法 scope=%s', scope);
    return fail(3001, '内容加载失败，请重试');
  } catch (err) {
    console.error('[getContent] error', err);
    return fail(3001, '内容加载失败，请重试');
  }
};