#!/usr/bin/env python3
"""Fix material_library image addresses (short -> long cloud file IDs).

Runs in GitHub Actions. Secret ONLY from env WX_APPSECRET (repo Secret).
AppID is a public identifier (already in project.config.json).
Prints NO secrets and NO tokens. Report goes to wx-cloud-upload-report.md.

Steps:
  1. Query all material_library docs, recursively replace the short
     materials/ prefix with the long-form prefix in every string.
  2. Check every resulting long file ID via batchdownloadfile (chunked).
  3. Upload any missing files from wx-cloud-upload/materials/*.png
     (correct cos_file_id mapping per official uploadFile doc).
  4. Write back docs that changed, re-query, re-check downloads.
  5. Report MATERIALS_OK only when data is fully long-form AND all
     files download OK; MATERIALS_PARTIAL when data is fixed but some
     files are still missing (exit 0 so the report still commits).
"""
import sys, os, json, urllib.request, urllib.parse, zipfile
from datetime import datetime, timezone, timedelta
import requests

APPID = 'wxa7c12126aa192d2a'
ENV = 'cloud1-d0get66qf4fc7987f'
SHORT = 'cloud://cloud1-d0get66qf4fc7987f/materials/'
LONG = 'cloud://cloud1-d0get66qf4fc7987f.636c-cloud1-d0get66qf4fc7987f-1520169267/materials/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAT_DIR = os.path.join(ROOT, 'wx-cloud-upload', 'materials')
MAT_ZIP = os.path.join(ROOT, 'wx-cloud-upload', 'materials.zip')
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


def query_all(at, coll):
    q = call('https://api.weixin.qq.com/tcb/databasequery?access_token=' + at,
             {'env': ENV, 'query': 'db.collection("%s").limit(100).get()' % coll})
    if q.get('errcode') != 0:
        raise SystemExit('QUERY_FAIL %s errcode=%s' % (coll, q.get('errcode')))
    docs = []
    for s in q.get('data', []):
        try:
            docs.append(json.loads(s))
        except Exception:
            pass
    return docs


def replace_short(o, counter):
    if isinstance(o, str):
        if o.startswith(SHORT):
            counter[0] += 1
            return LONG + o[len(SHORT):]
        return o
    if isinstance(o, dict):
        return {k: replace_short(v, counter) for k, v in o.items()}
    if isinstance(o, list):
        return [replace_short(v, counter) for v in o]
    return o


def collect_images(o, acc):
    if isinstance(o, str):
        if o.startswith(LONG):
            acc.append(o[len(LONG):])
    elif isinstance(o, dict):
        for v in o.values():
            collect_images(v, acc)
    elif isinstance(o, list):
        for v in o:
            collect_images(v, acc)


def downloads(at, fnames):
    out = {}
    for i in range(0, len(fnames), 50):
        chunk = fnames[i:i + 50]
        r = call('https://api.weixin.qq.com/tcb/batchdownloadfile?access_token=' + at,
                 {'env': ENV, 'file_list': [{'fileid': LONG + f, 'max_age': 7200}
                                            for f in chunk]})
        if r.get('errcode') == 0:
            for item in r.get('file_list', []):
                out[item.get('fileid', '').split('/')[-1]] = item.get('status')
    return out


def upload_one(at, fname, blob):
    up = call('https://api.weixin.qq.com/tcb/uploadfile?access_token=' + at,
              {'env': ENV, 'path': 'materials/' + fname})
    if up.get('errcode') != 0:
        return ('uploadfile_fail', up.get('errcode'))
    data = {'key': 'materials/' + fname, 'Signature': up['authorization'],
            'x-cos-security-token': up['token'],
            'x-cos-meta-fileid': up['cos_file_id']}
    files = {'file': (fname, blob, 'image/png')}
    try:
        r = requests.post(up['url'], data=data, files=files, timeout=120)
        return ('cos_status', r.status_code)
    except Exception as e:
        return ('cos_exc', str(e)[:120])


def main():
    secret = os.environ.get('WX_APPSECRET', '')
    if not secret:
        raise SystemExit('WX_APPSECRET missing from environment')
    at = token(secret)

    if os.path.exists(MAT_ZIP):
        with zipfile.ZipFile(MAT_ZIP) as z:
            z.extractall(MAT_DIR)
        print('UNZIPPED materials.zip')

    docs = query_all(at, 'material_library')
    print('DOCS total=%d' % len(docs))
    updated_docs, update_failed, changed_images = [], [], 0
    all_files = []
    for d in docs:
        counter = [0]
        new = replace_short(d, counter)
        if counter[0]:
            body = {k: v for k, v in new.items() if k != '_id'}
            r = call('https://api.weixin.qq.com/tcb/databaseupdate?access_token=' + at,
                     {'env': ENV,
                      'query': 'db.collection("material_library").doc("%s").update({data: %s})'
                               % (d['_id'], json.dumps(body, ensure_ascii=False))})
            if r.get('errcode') == 0:
                updated_docs.append(d.get('code'))
                changed_images += counter[0]
                print('UPDATED %s images=%d' % (d.get('code'), counter[0]))
            else:
                update_failed.append(d.get('code'))
                print('UPDATE_FAIL %s errcode=%s' % (d.get('code'), r.get('errcode')))
    after = query_all(at, 'material_library')
    short_left = [0]
    for d in after:
        def count_short(o):
            if isinstance(o, str):
                if o.startswith(SHORT):
                    short_left[0] += 1
            elif isinstance(o, dict):
                for v in o.values():
                    count_short(v)
            elif isinstance(o, list):
                for v in o:
                    count_short(v)
        count_short(d)
        collect_images(d, all_files)
    all_files = sorted(set(all_files))
    dl = downloads(at, all_files)
    missing = [f for f in all_files if dl.get(f) != 0]
    print('FILES total=%d missing_before_upload=%d' % (len(all_files), len(missing)))
    up_ok, up_fail = [], []
    if missing and os.path.isdir(MAT_DIR):
        for fname in missing:
            path = os.path.join(MAT_DIR, fname)
            if not os.path.exists(path):
                up_fail.append((fname, 'no_local_file'))
                continue
            with open(path, 'rb') as f:
                blob = f.read()
            r = upload_one(at, fname, blob)
            if r[0] == 'cos_status' and r[1] in (200, 204):
                up_ok.append(fname)
            else:
                up_fail.append((fname, r[0], r[1]))
    if up_ok:
        dl2 = downloads(at, up_ok)
        missing = [f for f in missing if dl2.get(f) != 0]
    data_ok = (short_left[0] == 0 and not update_failed)
    result = 'MATERIALS_OK' if (data_ok and not missing) else 'MATERIALS_PARTIAL'
    now = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime('%Y-%m-%d %H:%M CST')
    lines = ['# wx-cloud-upload report', '',
             '- time: %s' % now,
             '- mode: fix-materials',
             '- docs total: %d' % len(docs),
             '- docs updated: %s' % (', '.join(updated_docs) or 'none'),
             '- docs update failed: %s' % (update_failed or 'none'),
             '- images changed to long form: %d' % changed_images,
             '- short-form images left: %d' % short_left[0],
             '- files total: %d' % len(all_files),
             '- files uploaded this run: %d' % len(up_ok),
             '- upload failures: %s' % (up_fail or 'none'),
             '- files still missing: %s' % (missing or 'none'),
             '- result: %s' % result]
    with open(REPORT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('RESULT %s' % result)
    if not data_ok:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
