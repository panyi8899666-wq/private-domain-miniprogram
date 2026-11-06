/**
 * 订单列表请求序号与 onShow 计划。
 * 首次进入时 loading 为 true 也必须发起请求；返回详情后再进 onShow 重新加载。
 * 过期响应（筛选已切换）不得覆盖新结果。
 */

function nextSeq(seq) {
  const n = Number(seq) || 0;
  return n + 1;
}

function isCurrentResponse(seq, current) {
  return seq === current;
}

function planOrdersShow(loggedIn) {
  if (!loggedIn) {
    return {
      action: 'login',
      patch: { needLogin: true, loading: false, list: [], empty: false, loadError: null }
    };
  }
  return { action: 'reload', patch: { needLogin: false } };
}

module.exports = {
  nextSeq,
  isCurrentResponse,
  planOrdersShow
};
