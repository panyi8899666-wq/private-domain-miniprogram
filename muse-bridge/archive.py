#!/usr/bin/env python3
"""订单存档：只把下单的设计文件与源文件存到百度网盘，并备注客户信息。

存档位置（bypy 沙盒视角，即百度网盘 /apps/bypy 下）：
  正鑫越订单存档/<orderNo>_<客户名称>-<下单日期>-<设计名称>/设计文件/
  正鑫越订单存档/<orderNo>_<客户名称>-<下单日期>-<设计名称>/源文件/
  正鑫越订单存档/<orderNo>_.../存档备注.txt
    首行即备注：客户名称-下单日期-设计名称；次行为订单号，便于追溯。

只存这两类文件加一份备注，别的不存：不存客户手机号、地址、付款信息、
聊天记录、报价单、中间废弃稿。调用方只须把“最终确认版”的设计文件目录
与源文件目录传进来；标准品无设计文件的订单不建存档目录。
备注里的客户名称只写名称，不写电话地址。

认证：用本机已授权的 bypy（~/workspace/.venv-bypy/bin/bypy），
其 OAuth 凭证已在 ~/.bypy，不需要、也不向脚本里写任何 API 密钥。
如将来需要走百度开放平台 API（例如超出 /apps/bypy 沙盒的全盘操作、
分享链接等），本脚本到那一步停下，由 Muse 找 pan 要 API 凭证，
绝不现编、绝不发聊天。

用法：
  python3 archive.py <orderNo> <客户名称> <下单日期> <设计名称> <设计文件目录> <源文件目录>
  下单日期写 YYYY-MM-DD（传 YYYYMMDD 会自动转成 YYYY-MM-DD）；
  目录可为空串表示该类没有。
  python3 archive.py --check   # 只验 bypy 与根目录，不上传
"""
import os
import re
import subprocess
import sys
import tempfile

BYPY = os.environ.get('BYPY_BIN', os.path.expanduser('~/workspace/.venv-bypy/bin/bypy'))
BASE = '正鑫越订单存档'


def sanitize(text, max_len=60):
    """备注字段清洗：去掉路径分隔与网盘非法字符，截断防文件夹名过长。"""
    s = re.sub(r'[/\\:*?"<>|]', '-', (text or '').strip())
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:max_len] if s else '未填'


def normalize_date(text):
    s = (text or '').strip()
    m = re.fullmatch(r'(\d{4})(\d{2})(\d{2})', s)
    if m:
        return '%s-%s-%s' % m.groups()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
        return s
    raise SystemExit('下单日期须为 YYYY-MM-DD（或 YYYYMMDD），实际：%s' % text)


def run(args):
    out = subprocess.run([BYPY] + args, capture_output=True, text=True, timeout=600)
    if out.returncode != 0:
        raise SystemExit('bypy %s 失败：%s' % (' '.join(args), (out.stderr or out.stdout).strip()))
    return out.stdout


def upload_dir(local_dir, remote_dir):
    if not local_dir:
        return []
    if not os.path.isdir(local_dir):
        raise SystemExit('目录不存在：%s' % local_dir)
    files = sorted(
        f for f in os.listdir(local_dir)
        if os.path.isfile(os.path.join(local_dir, f)))
    if not files:
        return []
    print('上传 %s -> %s（%d 个文件）' % (local_dir, remote_dir, len(files)))
    run(['upload', local_dir, remote_dir])
    listed = run(['list', remote_dir])
    print(listed.strip())
    return files


def main(argv):
    if len(argv) == 2 and argv[1] == '--check':
        print(run(['--version']).strip())
        print(run(['list']).strip())
        return
    if len(argv) != 7:
        raise SystemExit('用法：archive.py <orderNo> <客户名称> <下单日期> <设计名称> <设计文件目录> <源文件目录>')
    order_no = argv[1].strip()
    if not order_no or '/' in order_no:
        raise SystemExit('订单号不合法')
    customer = sanitize(argv[2])
    date = normalize_date(argv[3])
    design_name = sanitize(argv[4])
    remark = '%s-%s-%s' % (customer, date, design_name)
    folder = '%s/%s_%s' % (BASE, order_no, remark)
    print('存档备注：%s' % remark)
    design = upload_dir(argv[5].strip(), folder + '/设计文件')
    source = upload_dir(argv[6].strip(), folder + '/源文件')
    if not design and not source:
        print('两类目录均为空，未建存档。')
        return
    # 备注文件放订单文件夹根目录，不放进设计文件 / 源文件两类目录里
    with tempfile.TemporaryDirectory() as tmp:
        remark_file = os.path.join(tmp, '存档备注.txt')
        with open(remark_file, 'w', encoding='utf-8') as f:
            f.write(remark + '\n')
            f.write('订单号：%s\n' % order_no)
        run(['upload', remark_file, folder])
    print(run(['list', folder]).strip())
    print('存档完成：%s，设计文件 %d 个，源文件 %d 个。'
          % (folder, len(design), len(source)))


if __name__ == '__main__':
    main(sys.argv)
