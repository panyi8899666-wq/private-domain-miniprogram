/**
 * 定制需求的数量 / 面积校验。
 * 与 cloudfunctions/createCustomOrder 使用的 shared/orderRules.resolveMeasure 保持同一规则。
 */
const MAX_QUANTITY = 9999;
const MAX_AREA = 100000;

function parseQuantity(value) {
  if (value === '' || value === null || value === undefined) {
    return { present: false, valid: false, value: 0 };
  }
  const s = String(value).trim();
  if (!s) return { present: false, valid: false, value: 0 };
  if (!/^\d+$/.test(s)) return { present: true, valid: false, value: 0 };
  const n = parseInt(s, 10);
  // 0 视为没填数量，好让「只填面积」通过；超过上限才算填写了但不合法
  if (n === 0) return { present: false, valid: false, value: 0 };
  if (n > MAX_QUANTITY) return { present: true, valid: false, value: 0 };
  return { present: true, valid: true, value: n };
}

function parseArea(value) {
  if (value === '' || value === null || value === undefined) {
    return { present: false, valid: false, value: null };
  }
  const s = String(value).trim();
  if (!s) return { present: false, valid: false, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { present: true, valid: false, value: null };
  const n = Number(s);
  if (!isFinite(n)) return { present: true, valid: false, value: null };
  if (n === 0) return { present: false, valid: false, value: null };
  if (n > MAX_AREA) return { present: true, valid: false, value: null };
  return { present: true, valid: true, value: Math.round(n * 100) / 100 };
}

function resolveMeasure(quantity, area) {
  const q = parseQuantity(quantity);
  const a = parseArea(area);
  if ((q.present && !q.valid) || (a.present && !a.valid)) {
    return { ok: false, message: '数量或面积超出范围', quantity: 0, area: null };
  }
  if (!q.valid && !a.valid) {
    return { ok: false, message: '请填写数量或面积', quantity: 0, area: null };
  }
  return {
    ok: true,
    message: '',
    quantity: q.valid ? q.value : 0,
    area: a.valid ? a.value : null
  };
}

module.exports = {
  MAX_QUANTITY,
  MAX_AREA,
  parseQuantity,
  parseArea,
  resolveMeasure
};
