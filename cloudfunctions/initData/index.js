/**
 * 云函数：initData —— 内容初始化导入（实验态，商家/运维手动触发）
 * 需求锚点：REQ-047、REQ-048、REQ-052、REQ-053、DFX §4.4.1/§4.5.3
 *
 * 入参：event.payload = { dataset: 'all'|'site'|'works'|'materials'|'products', overwrite?: boolean }
 * 出参：{ code: 0, data: { dataset, overwrite, inserted, skipped, details }, message: 'ok' }
 * 失败：{ code: 'B001', data: null, message: '导入失败，请检查数据格式' }
 *
 * 合规（REQ-048/REQ-052）：所有文本字段导入前做违规关键词校验，命中则整体拒绝写入。
 * 幂等：overwrite=false 时按业务唯一键（site→key，其余→code）去重跳过。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// seeds 与目标集合映射（唯一键用于去重）
const SEEDS = {
  site: require('./seeds/site.json'),
  works: require('./seeds/works.json'),
  materials: require('./seeds/materials.json'),
  products: require('./seeds/products.json'),
  material_library: require('./seeds/material-library.json')
};

const TARGETS = {
  site: { collection: 'site_config', keyField: 'key' },
  works: { collection: 'works', keyField: 'code' },
  materials: { collection: 'materials', keyField: 'code' },
  products: { collection: 'products', keyField: 'code' },
  material_library: { collection: 'material_library', keyField: 'code' }
};

// 违规关键词（REQ-048/REQ-049/REQ-052）：命中即拒绝写入。
// 注意：不包含「微信」「微信支付」——官方微信支付是唯一合规收款方式，属允许内容。
const FORBIDDEN_KEYWORDS = [
  '加微信',
  '微信号',
  '私人微信',
  '加好友',
  '加我',
  '收款码',
  '付款码',
  '二维码',
  '扫码支付',
  '支付宝',
  '转账',
  '私聊',
  '扫我'
];

function ok(data) {
  return { code: 0, data: data === undefined ? null : data, message: 'ok' };
}

function fail(code, message) {
  return { code, data: null, message };
}

/** 剔除以下划线开头的元字段（如 _source/_说明），不写入数据库 */
function stripMeta(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const out = {};
  Object.keys(doc).forEach((k) => {
    if (k.charAt(0) !== '_') out[k] = doc[k];
  });
  return out;
}

/** 递归收集对象中的字符串文本（跳过下划线元字段） */
function collectTexts(value, out) {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collectTexts(v, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((k) => {
      if (k.charAt(0) === '_') return;
      collectTexts(value[k], out);
    });
  }
  return out;
}

/** 内容合规校验：命中违规关键词即抛错，阻止写入 */
function assertCompliant(docs, dataset) {
  for (let i = 0; i < docs.length; i++) {
    const texts = collectTexts(docs[i], []);
    for (let j = 0; j < texts.length; j++) {
      for (let k = 0; k < FORBIDDEN_KEYWORDS.length; k++) {
        if (texts[j].indexOf(FORBIDDEN_KEYWORDS[k]) !== -1) {
          throw new Error(
            '内容合规校验未通过：' +
              dataset +
              ' 第 ' +
              (i + 1) +
              ' 条命中违规关键词「' +
              FORBIDDEN_KEYWORDS[k] +
              '」，已拒绝写入'
          );
        }
      }
    }
  }
}

/** 清空集合（仅 overwrite=true 时执行） */
async function removeAll(collection) {
  let removed = 0;
  for (let i = 0; i < 50; i++) {
    const res = await db
      .collection(collection)
      .where({ _id: _.exists(true) })
      .remove();
    const n = res && res.stats ? res.stats.removed : 0;
    removed += n;
    if (!n) break;
  }
  return removed;
}

/** 导入单个数据集，返回 { inserted, skipped } */
async function importDataset(name, overwrite) {
  const target = TARGETS[name];
  const raw = SEEDS[name];
  if (raw === undefined) throw new Error('缺少 seeds 数据：' + name);

  let docs = Array.isArray(raw) ? raw.slice() : [raw];
  docs = docs.map(stripMeta);
  assertCompliant(docs, name);

  const collection = db.collection(target.collection);
  if (overwrite) {
    await removeAll(target.collection);
  }

  const existing = new Set();
  if (!overwrite) {
    const res = await collection
      .field({ [target.keyField]: true })
      .limit(1000)
      .get();
    (res.data || []).forEach((d) => {
      if (d && d[target.keyField] !== undefined) existing.add(d[target.keyField]);
    });
  }

  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const key = doc[target.keyField];
    if (key === undefined || key === null || key === '') {
      throw new Error('数据格式错误：' + name + ' 缺少唯一键 ' + target.keyField);
    }
    if (!overwrite && existing.has(key)) {
      skipped++;
      continue;
    }
    await collection.add({ data: doc });
    existing.add(key);
    inserted++;
  }
  return { inserted, skipped };
}

exports.main = async (event) => {
  try {
    const payload = (event && event.payload) || {};
    const dataset = payload.dataset || 'all';
    const overwrite = payload.overwrite === true;

    const allowed = ['all', 'site', 'works', 'materials', 'products', 'material_library'];
    if (allowed.indexOf(dataset) === -1) {
      console.warn('[initData] 非法 dataset=%s', dataset);
      return fail('B001', '导入失败，请检查数据格式：dataset 取值非法');
    }

    // 仅商家/运维手动触发（REQ-046）：校验调用者 role==='merchant'，防止越权覆写数据
    const wxContext = cloud.getWXContext();
    const operator = (wxContext && wxContext.OPENID) || 'unknown';
    if (operator === 'unknown') {
      return fail('B001', '无权限执行数据导入');
    }

    const operatorRes = await db.collection('users').where({ openid: operator }).limit(1).get();
    const operatorUser = operatorRes.data && operatorRes.data[0];
    if (!operatorUser || operatorUser.role !== 'merchant') {
      console.warn('[initData] 非商家越权调用 operator=%s', operator);
      return fail('B001', '无权限执行数据导入');
    }

    const names = dataset === 'all' ? ['site', 'works', 'materials', 'products', 'material_library'] : [dataset];
    const details = {};
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < names.length; i++) {
      const r = await importDataset(names[i], overwrite);
      details[names[i]] = r;
      inserted += r.inserted;
      skipped += r.skipped;
    }

    console.log(
      '[initData] ok operator=%s dataset=%s overwrite=%s inserted=%d skipped=%d',
      operator,
      dataset,
      overwrite,
      inserted,
      skipped
    );
    return ok({ dataset, overwrite, inserted, skipped, details });
  } catch (err) {
    console.error('[initData] error', err);
    return fail('B001', (err && err.message) || '导入失败，请检查数据格式');
  }
};