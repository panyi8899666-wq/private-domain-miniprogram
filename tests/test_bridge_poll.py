"""桥轮询：翻页、同毫秒游标、失败不前移水位。运行：python3 tests/test_bridge_poll.py"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'muse-bridge'))
import bridge  # noqa: E402


class PollTests(unittest.TestCase):
    def test_pages_and_same_millisecond(self):
        orders = [
            {'orderId': 'a', 'updatedAt': 1000},
            {'orderId': 'b', 'updatedAt': 1000},
            {'orderId': 'c', 'updatedAt': 1000},
        ]
        calls = []

        def fetch(since, since_id):
            calls.append((since, since_id))
            batch = []
            for order in orders:
                updated_at, oid = bridge.order_cursor(order)
                if updated_at > since or (updated_at == since and oid > since_id):
                    batch.append(order)
            page = batch[:2]
            return {'orders': page, 'hasMore': len(batch) > 2}

        watermark = {'since': 0, 'sinceId': ''}

        def read_wm():
            return dict(watermark)

        def write_wm(since, since_id):
            watermark['since'] = since
            watermark['sinceId'] = since_id

        seen = []
        collected = bridge.poll_orders(fetch, read_wm, write_wm, seen.append)
        self.assertEqual([o['orderId'] for o in collected], ['a', 'b', 'c'])
        self.assertEqual(watermark, {'since': 1000, 'sinceId': 'c'})
        self.assertGreaterEqual(len(calls), 2)
        self.assertEqual(calls[0], (0, ''))
        self.assertIn((1000, 'b'), calls)

    def test_failure_does_not_advance_past_the_order(self):
        path = tempfile.mkdtemp()
        wm = os.path.join(path, 'watermark.json')

        def fetch(since, since_id):
            rows = [
                {'orderId': 'a', 'updatedAt': 5},
                {'orderId': 'b', 'updatedAt': 5},
            ]
            page = []
            for order in rows:
                updated_at, oid = bridge.order_cursor(order)
                if updated_at > since or (updated_at == since and oid > since_id):
                    page.append(order)
            return {'orders': page, 'hasMore': False}

        def on_order(order):
            if order['orderId'] == 'b':
                raise RuntimeError('process failed')

        with self.assertRaises(RuntimeError):
            bridge.poll_orders(
                fetch,
                lambda: bridge.read_watermark(wm),
                lambda since, since_id: bridge.write_watermark(since, since_id, wm),
                on_order,
            )
        self.assertEqual(bridge.read_watermark(wm), {'since': 5, 'sinceId': 'a'})


if __name__ == '__main__':
    unittest.main()
