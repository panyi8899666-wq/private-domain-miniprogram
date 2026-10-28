#!/usr/bin/env python3
"""Muse 对接桥：小程序订单 <-> Muse，省掉 pan 手动转发。

只用 Python 标准库。密钥一律从环境变量读，绝不写进代码、仓库或聊天：
  MUSE_APPID / MUSE_APPSECRET     小程序 AppID 与 AppSecret（微信公众平台取）
  MUSE_ENV_ID                     云开发环境 ID
  MUSE_BRIDGE_SECRET              云函数环境变量 MUSE_BRIDGE_SECRET 的同一值
  MUSE_WATERMARK                  水位文件路径（默认与本脚本同目录 watermark.json）

用法：
  python3 bridge.py poll      # 拉取新订单与客户未读留言，输出 JSON 到 stdout
  python3 bridge.py ack <orderId> "<按单写的人话确认>"
                              # 对一单发确认：文案由 Muse 按该单实际内容现写，
                              # 必须像人说话（见 README“给客户的回复”一节），
                              # 仍不含价格、方案与制作周期承诺
  python3 bridge.py reply <orderId> "<经 pan 确认后的回复>"
                              # 发实质回复；调用前必须已获 pan 确认，本脚本不判断

注意：
- access_token 有效期约 2 小时，本脚本每次调用现取现用，不缓存密钥。
- 微信 HTTP API 触发的云函数调用超时约 5 秒，musePoll 只取最近 20 单。
- 输出里不含客户手机号与 openid；musePoll 本来就不回传这两项。
"""
import json
import os
import sys
import urllib.parse
import urllib.request

def _env(name):
    v = os.environ.get(name, '')
    if not v:
        raise SystemExit('缺少环境变量 %s' % name)
    return v


def _post_json(url, body):
    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))


def access_token():
    appid = _env('MUSE_APPID')
    secret = _env('MUSE_APPSECRET')
    url = ('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential'
           '&appid=%s&secret=%s' % (urllib.parse.quote(appid), urllib.parse.quote(secret)))
    with urllib.request.urlopen(url, timeout=10) as resp:
        out = json.loads(resp.read().decode('utf-8'))
    if not out.get('access_token'):
        raise SystemExit('取 access_token 失败：%s' % out)
    return out['access_token']


def invoke(token, name, payload):
    env_id = _env('MUSE_ENV_ID')
    url = ('https://api.weixin.qq.com/tcb/invokecloudfunction'
           '?access_token=%s&env=%s&name=%s' % (
               urllib.parse.quote(token), urllib.parse.quote(env_id),
               urllib.parse.quote(name)))
    out = _post_json(url, payload)
    if out.get('errcode') != 0:
        raise SystemExit('调用 %s 失败：%s' % (name, out))
    return json.loads(out.get('resp_data') or '{}')


def watermark_path():
    return os.environ.get(
        'MUSE_WATERMARK',
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'watermark.json'))


def read_watermark():
    try:
        with open(watermark_path(), encoding='utf-8') as f:
            return int(json.load(f).get('since', 0))
    except (OSError, ValueError, TypeError):
        return 0


def write_watermark(since):
    with open(watermark_path(), 'w', encoding='utf-8') as f:
        json.dump({'since': since}, f)


def cmd_poll():
    token = access_token()
    out = invoke(token, 'musePoll', {
        'secret': _env('MUSE_BRIDGE_SECRET'),
        'since': read_watermark(),
    })
    orders = (out.get('data') or {}).get('orders') or []
    if orders:
        write_watermark(max(int(o.get('updatedAt') or 0) for o in orders))
    print(json.dumps({'orders': orders}, ensure_ascii=False, indent=2))


def cmd_reply(kind, order_id, text):
    token = access_token()
    out = invoke(token, 'museReply', {
        'secret': _env('MUSE_BRIDGE_SECRET'),
        'orderId': order_id,
        'kind': kind,
        'text': text,
    })
    print(json.dumps(out, ensure_ascii=False))


def main(argv):
    if len(argv) < 2:
        raise SystemExit('用法：bridge.py poll | ack <orderId> "<人话确认>" | reply <orderId> "<回复>"')
    if argv[1] == 'poll':
        cmd_poll()
    elif argv[1] == 'ack' and len(argv) == 4:
        cmd_reply('ack', argv[2], argv[3])
    elif argv[1] == 'reply' and len(argv) == 4:
        cmd_reply('reply', argv[2], argv[3])
    else:
        raise SystemExit('参数不对：bridge.py poll | ack <orderId> "<人话确认>" | reply <orderId> "<回复>"')


if __name__ == '__main__':
    main(sys.argv)
