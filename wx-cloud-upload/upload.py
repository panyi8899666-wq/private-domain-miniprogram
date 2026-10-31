#!/usr/bin/env python3
"""WeChat cloud storage upload/verify for the ordering mini-program.

Runs in GitHub Actions. Secret ONLY from env WX_APPSECRET (repo Secret).
AppID is a public identifier (already in project.config.json).
Prints NO secrets and NO tokens. Report goes to wx-cloud-upload-report.md.

Upload field mapping per official uploadFile doc:
  key = path, Signature = authorization,
  x-cos-security-token = token, x-cos-meta-fileid = cos_file_id (NOT file_id),
  file field last.
"""
import sys, os, json, argparse, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta
import requests

APPID = 'wxa7c12126aa192d2a'
ENV = 'cloud1-d0get66qf4fc7987f'
LONG = 'cloud://cloud1-d0get66qf4fc7987f.636c-cloud1-d0get66qf4fc7987f-1520169267/works/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, 'wx-cloud-upload', 'images')
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


def upload_one(at, fname, blob):
    up = call('https://api.weixin.qq.com/tcb/uploadfile?access_token=' + at,
              {'env': ENV, 'path': 'works/' + fname})
    if up.get('errcode') != 0:
        return ('uploadfile_fail', up.get('errcode'))
    data = {'key': 'works/' + fname, 'Signature': up['authorization'],
            'x-cos-security-token': up['token'],
            'x-cos-meta-fileid': up['cos_file_id']}
    files = {'file': (fname, blob, 'image/jpeg')}
    try:
        r = requests.post(up['url'], data=data, files=files, timeout=120)
        return ('cos_status', r.status_code)
    except Exception as e:
        return ('cos_exc', str(e)[:120])


def downloads(at, fnames):
    out = {}
    if not fnames:
        return out
    r = call('https://api.weixin.qq.com/tcb/batchdownloadfile?access_token=' + at,
             {'env': ENV, 'file_list': [{'fileid': LONG + f, 'max_age': 7200}
                                        for f in fnames]})
    if r.get('errcode') == 0:
        for item in r.get('file_list', []):
            out[item.get('fileid', '').split('/')[-1]] = (
                item.get('status'), item.get('errmsg', ''))
    return out


def db_long_check(at):
    q = call('https://api.weixin.qq.com/tcb/databasequery?access_token=' + at,
             {'env': ENV, 'query': 'db.collection("works").limit(100).get()'})
    good, bad = [], []
    if q.get('errcode') == 0:
        for s in q.get('data', []):
            try:
                d = json.loads(s)
                img = (d.get('images') or [''])[0]
                (good if img.startswith(LONG) else bad).append(d.get('code'))
            except Exception:
                pass
    return len(good) + len(bad), len(good), bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', choices=['upload', 'verify'], default='verify')
    args = ap.parse_args()
    secret = os.environ.get('WX_APPSECRET', '')
    if not secret:
        raise SystemExit('WX_APPSECRET missing from environment')
    at = token(secret)
    fnames = sorted(f for f in os.listdir(IMG_DIR)
                    if f.lower().endswith('.jpg'))
    up_ok, up_fail = [], []
    if args.mode == 'upload':
        for fname in fnames:
            with open(os.path.join(IMG_DIR, fname), 'rb') as f:
                blob = f.read()
            r = upload_one(at, fname, blob)
            if r[0] == 'cos_status' and r[1] in (200, 204):
                up_ok.append(fname)
            else:
                up_fail.append((fname, r[0], r[1]))
    dl = downloads(at, fnames)
    dl_ok = [f for f in fnames if dl.get(f, (None, ''))[0] == 0]
    dl_bad = [(f, dl.get(f, (None, ''))[0], dl.get(f, (None, ''))[1])
              for f in fnames if f not in dl_ok]
    total, nlong, bad_codes = db_long_check(at)
    now = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime('%Y-%m-%d %H:%M CST')
    lines = ['# wx-cloud-upload report', '', '- time: %s' % now,
             '- mode: %s' % args.mode,
             '- images in repo: %d' % len(fnames)]
    if args.mode == 'upload':
        lines.append('- uploaded ok: %d %s' % (len(up_ok), up_ok))
        lines.append('- upload fail: %s' % (up_fail,))
    lines.append('- download ok: %d %s' % (len(dl_ok), dl_ok))
    lines.append('- download bad: %s' % (dl_bad,))
    lines.append('- works db: %d docs, %d long-form, bad codes: %s'
                 % (total, nlong, bad_codes))
    ok = (not up_fail) and (not dl_bad)
    lines.append('- result: %s' % ('ALL_OK' if ok else 'HAS_FAILURES'))
    with open(REPORT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
