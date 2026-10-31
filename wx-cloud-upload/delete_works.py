#!/usr/bin/env python3
"""Delete the old 10 works records (w001-w010) from the ordering mini-program.

Runs in GitHub Actions. Secret ONLY from env WX_APPSECRET (repo Secret).
AppID is a public identifier (already in project.config.json).
Prints NO secrets and NO tokens. Report goes to wx-cloud-upload-report.md.

Safety: only deletes docs whose `code` is exactly in the DELETE list below.
Verifies before/after counts and that none of the 10 codes remain.
"""
import sys, os, json, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta

APPID = 'wxa7c12126aa192d2a'
ENV = 'cloud1-d0get66qf4fc7987f'
DELETE = ['w001', 'w002', 'w003', 'w004', 'w005',
          'w006', 'w007', 'w008', 'w009', 'w010']
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT = os.path.join(ROOT, 'wx-cloud-upload-report.md')


def call(url, payload=None, timeout=60):
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={'Content-Type': 'application/json'},
                                 method='POST' if data else 'GET')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def get(url, params):
    return call(url + '?' + urllib.parse.urlencode(params))


def token(secret):
    t = get('https://api.weixin.qq.com/cgi-bin/token',
            {'grant_type': 'client_credential', 'appid': APPID, 'secret': secret})
    at = t.get('access_token')
    if not at:
        raise SystemExit('TOKEN_FAIL errcode=%s' % t.get('errcode'))
    return at


def query_all(at):
    q = call('https://api.weixin.qq.com/tcb/databasequery?access_token=' + at,
             {'env': ENV, 'query': 'db.collection("works").limit(100).get()'})
    if q.get('errcode') != 0:
        raise SystemExit('QUERY_FAIL errcode=%s errmsg=%s'
                         % (q.get('errcode'), q.get('errmsg')))
    docs = []
    for s in q.get('data', []):
        try:
            docs.append(json.loads(s))
        except Exception:
            pass
    return docs


def main():
    secret = os.environ.get('WX_APPSECRET', '')
    if not secret:
        raise SystemExit('WX_APPSECRET missing from environment')
    at = token(secret)
    before = query_all(at)
    before_codes = sorted(d.get('code') for d in before)
    print('BEFORE total=%d codes=%s' % (len(before), before_codes))
    deleted, failed = [], []
    for code in DELETE:
        targets = [d for d in before if d.get('code') == code]
        if not targets:
            print('SKIP %s (not found)' % code)
            continue
        _id = targets[0].get('_id')
        r = call('https://api.weixin.qq.com/tcb/databasedelete?access_token=' + at,
                 {'env': ENV,
                  'query': 'db.collection("works").doc("%s").remove()' % _id})
        if r.get('errcode') == 0:
            deleted.append((code, r.get('deleted')))
            print('DELETED %s deleted=%s' % (code, r.get('deleted')))
        else:
            failed.append((code, r.get('errcode'), r.get('errmsg')))
            print('DELETE_FAIL %s errcode=%s' % (code, r.get('errcode')))
    after = query_all(at)
    after_codes = sorted(d.get('code') for d in after)
    remaining_bad = [c for c in DELETE if c in after_codes]
    ok = (not failed and not remaining_bad
          and len(after) == len(before) - len(deleted))
    now = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime('%Y-%m-%d %H:%M CST')
    lines = ['# wx-cloud-upload report', '',
             '- time: %s' % now,
             '- mode: delete-works',
             '- before total: %d' % len(before),
             '- deleted: %s' % (', '.join(c for c, _ in deleted) or 'none'),
             '- delete failures: %s' % (failed or 'none'),
             '- after total: %d' % len(after),
             '- remaining codes: %s' % (', '.join(after_codes)),
             '- old codes still present: %s' % (remaining_bad or 'none'),
             '- result: %s' % ('DELETE_OK' if ok else 'DELETE_FAIL')]
    with open(REPORT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('RESULT %s' % ('DELETE_OK' if ok else 'DELETE_FAIL'))
    if not ok:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
