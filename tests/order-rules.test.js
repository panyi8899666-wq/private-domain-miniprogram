/**
 * 纯函数单测：报价/支付复用、取消与支付回调决策、计量、隐私同意、手机号与地址展示、订单列表请求守卫。
 * 运行：node tests/order-rules.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rules = require('../shared/orderRules');
const measure = require('../miniprogram/utils/measure');
const phone = require('../miniprogram/utils/phone');
const consent = require('../miniprogram/utils/consent');
const listGuard = require('../miniprogram/utils/listGuard');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}

test('rules copies match shared/orderRules.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../shared/orderRules.js'), 'utf8');
  const dirs = [
    'submitQuote', 'createPayment', 'payCallback', 'cancelOrder',
    'createCustomOrder', 'createOrder', 'musePoll', 'login', 'saveProfile', 'savePrivacyConsent'
  ];
  dirs.forEach((dir) => {
    const copy = fs.readFileSync(path.join(__dirname, '../cloudfunctions', dir, 'rules.js'), 'utf8');
    assert.strictEqual(copy, src, dir);
  });
});

test('quote only in pending_quote and price change invalidates cache', () => {
  assert.strictEqual(rules.canSubmitQuote('pending_quote'), true);
  assert.strictEqual(rules.canSubmitQuote('pending_payment'), false);
  assert.strictEqual(rules.canSubmitQuote('making'), false);
  const fields = rules.buildQuoteFields(
    { orderNo: 'D20261106010101001', quoteVersion: 1, amountFen: 1000 },
    88.5,
    '改价',
    0
  );
  assert.strictEqual(fields.amountFen, 8850);
  assert.strictEqual(fields.amount, 88.5);
  assert.strictEqual(fields.quoteVersion, 2);
  assert.strictEqual(fields.payOutTradeNo, 'D20261106010101001Q2');
  assert.deepStrictEqual(fields.payments, []);
  assert.strictEqual(fields.status, 'pending_payment');
  assert.strictEqual(fields.quote.version, 2);
});

test('createPayment reuses cache only when amount and quote version match', () => {
  const now = 1_000_000;
  const history = [
    {
      outTradeNo: 'S1',
      status: 'created',
      payment: { timeStamp: '1' },
      attemptAt: now - 1000,
      totalFee: 1000,
      quoteVersion: 1
    }
  ];
  assert.ok(rules.findReusablePayment(history, 'S1', 1000, 1, now));
  assert.strictEqual(rules.findReusablePayment(history, 'S1', 2000, 1, now), null);
  assert.strictEqual(rules.findReusablePayment(history, 'S1', 1000, 2, now), null);
  assert.strictEqual(
    rules.findReusablePayment(history, 'S1', 1000, 1, now + rules.PAYMENT_CACHE_TTL_MS),
    null
  );
});

test('cancel decision and paid-after-cancel callback', () => {
  const order = { openid: 'u1', status: 'pending_payment' };
  assert.strictEqual(rules.decideCancel(order, 'u1').ok, true);
  assert.strictEqual(rules.decideCancel(order, 'u2').code, 8001);
  assert.strictEqual(rules.decideCancel({ openid: 'u1', status: 'cancelled' }, 'u1').code, 8003);
  assert.strictEqual(rules.decideCancel({ openid: 'u1', status: 'making' }, 'u1').code, 8002);
  assert.strictEqual(rules.decideCancel({ openid: 'u1', status: 'paid_after_cancel' }, 'u1').code, 8002);

  assert.strictEqual(
    rules.decidePayCallback(
      { status: 'pending_payment', amountFen: 100 },
      { transactionId: 'T1', totalFee: 100, expectFen: 100 }
    ).action,
    'mark_paid'
  );
  assert.strictEqual(
    rules.decidePayCallback(
      { status: 'cancelled', amountFen: 100 },
      { transactionId: 'T1', totalFee: 100, expectFen: 100 }
    ).action,
    'paid_after_cancel'
  );
  assert.strictEqual(
    rules.decidePayCallback(
      { status: 'making', payment: { transactionId: 'T1' } },
      { transactionId: 'T1', totalFee: 100, expectFen: 100 }
    ).action,
    'idempotent'
  );
  assert.strictEqual(
    rules.decidePayCallback(
      { status: 'cancelled', amountFen: 100 },
      { transactionId: 'T2', totalFee: 50, expectFen: 100 }
    ).action,
    'amount_mismatch'
  );
  assert.strictEqual(
    rules.decidePayCallback(
      { status: 'making' },
      { transactionId: 'T3', totalFee: 100, expectFen: 100 }
    ).action,
    'anomaly'
  );
});

test('quantity or area rules match between client and server', () => {
  const cases = [
    [5, '', true, 5, null],
    ['', '6.5', true, 0, 6.5],
    [0, 3, true, 0, 3],
    ['', '', false],
    [10000, '', false],
    ['', 0, false],
    ['', 'Infinity', false],
    ['1.5', '', false],
    [2, 100000.01, false],
    ['', 100000, true, 0, 100000],
    [9999, '', true, 9999, null]
  ];
  cases.forEach((row) => {
    const server = rules.resolveMeasure(row[0], row[1]);
    const client = measure.resolveMeasure(row[0], row[1]);
    assert.deepStrictEqual(client, server, JSON.stringify(row));
    assert.strictEqual(server.ok, row[2], JSON.stringify(row));
    if (row[2]) {
      assert.strictEqual(server.quantity, row[3]);
      assert.strictEqual(server.area, row[4]);
    }
  });
});

test('consent version must match and withdrawal invalidates it', () => {
  assert.strictEqual(consent.PRIVACY_POLICY_VERSION, rules.PRIVACY_POLICY_VERSION);
  const user = {
    privacyAgreedAt: 10,
    privacyConsentVersion: rules.PRIVACY_POLICY_VERSION,
    privacyWithdrawnAt: 0
  };
  assert.strictEqual(rules.hasActiveConsent(user), true);
  assert.strictEqual(consent.hasActiveConsent(user), true);
  assert.strictEqual(rules.hasActiveConsent(Object.assign({}, user, { privacyConsentVersion: 'old' })), false);
  assert.strictEqual(rules.hasActiveConsent(Object.assign({}, user, { privacyWithdrawnAt: 11 })), false);
  assert.strictEqual(rules.hasActiveConsent(null), false);
});

test('masked phone is not a business phone; display address drops detail', () => {
  assert.strictEqual(phone.hasContactPhone({ phone: '173****3179' }), false);
  assert.strictEqual(phone.hasContactPhone({ hasPhone: true, phone: '' }), true);
  assert.strictEqual(phone.hasContactPhone({ phone: '17306983179' }), true);
  assert.strictEqual(rules.hasContactPhone({ phone: '173****3179' }), false);
  assert.strictEqual(rules.hasContactPhone({ hasPhone: true }), true);

  const normalized = phone.normalizeUserRecord({
    phone: '173****3179',
    addresses: [{
      addressId: 'a1',
      name: '潘',
      phone: '17306983179',
      province: '福建省',
      city: '厦门市',
      county: '思明区',
      detail: '软件园二期 88 号',
      detailInfo: '软件园二期 88 号',
      isDefault: true
    }]
  });
  assert.strictEqual(normalized.phone, '');
  assert.strictEqual(normalized.hasPhone, true);
  assert.strictEqual(normalized.phoneMasked, '173****3179');
  assert.strictEqual(normalized.addresses[0].detail, undefined);
  assert.strictEqual(normalized.addresses[0].phone, undefined);
  assert.strictEqual(normalized.addresses[0].phoneMasked, '173****3179');
  assert.strictEqual(normalized.addresses[0].regionText, '福建省 厦门市 思明区');

  const serverView = rules.toDisplayAddress({
    addressId: 'a1',
    name: '潘',
    phone: '17306983179',
    province: '福建省',
    city: '厦门市',
    county: '思明区',
    detail: '软件园二期 88 号',
    isDefault: true
  });
  assert.deepStrictEqual(serverView, normalized.addresses[0]);
  const pub = rules.toPublicUser({ openid: 'o', phone: '17306983179', addresses: [serverView] });
  assert.strictEqual(pub.phone, '');
  assert.strictEqual(pub.hasPhone, true);
  assert.strictEqual(pub.phoneMasked, '173****3179');
  assert.strictEqual(pub.addresses[0].detail, undefined);

  assert.deepStrictEqual(phone.missingOrderProfile({ realName: '', hasPhone: false, addresses: [] }), ['姓名', '手机号', '收货地址']);
  assert.deepStrictEqual(
    phone.missingOrderProfile({ realName: '潘', hasPhone: true, addresses: [{ addressId: 'a1', isDefault: true }] }),
    []
  );
});

test('orders list plans a fetch even while the first load flag is set', () => {
  const stuck = { loading: true, list: [], loadError: null, needLogin: false };
  assert.strictEqual(listGuard.planOrdersShow(true).action, 'reload');
  assert.strictEqual(rules.planOrdersShow(true).action, 'reload');
  assert.strictEqual(listGuard.planOrdersShow(false).action, 'login');
  assert.strictEqual(listGuard.planOrdersShow(false).patch.loading, false);
  assert.strictEqual(stuck.loading, true);
  const seq = listGuard.nextSeq(0);
  assert.strictEqual(listGuard.isCurrentResponse(seq, seq), true);
  assert.strictEqual(listGuard.isCurrentResponse(seq, listGuard.nextSeq(seq)), false);
});

test('poll cursor keeps orders that share a millisecond', () => {
  const cursor = rules.pollCursor(1000, 'b');
  assert.strictEqual(rules.isAfterCursor({ updatedAt: 1000, orderId: 'a' }, cursor), false);
  assert.strictEqual(rules.isAfterCursor({ updatedAt: 1000, orderId: 'b' }, cursor), false);
  assert.strictEqual(rules.isAfterCursor({ updatedAt: 1000, orderId: 'c' }, cursor), true);
  assert.strictEqual(rules.isAfterCursor({ updatedAt: 1001, orderId: 'a' }, cursor), true);
  assert.deepStrictEqual(rules.pollCursor(0, ''), { since: 0, sinceId: '' });
});

console.log(passed + ' tests passed');
