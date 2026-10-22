import json
import os
import statistics
import time
import urllib.request

base = os.environ.get('STRATA_URL', 'http://127.0.0.1:18081').rstrip('/')
def get(path):
    with urllib.request.urlopen(base + path, timeout=15) as response:
        return json.load(response)

status = get('/v1/status')
assert status['loaded'], '模型尚未加载'
assert status['activity']['in_flight'] == 0, '服务正在处理请求，请稍后重试'
print(json.dumps({'model': status['model'], 'engine': status['engine'],
                  'context': status['cache_max_tokens']}, ensure_ascii=False))
runs = []
for i in range(4):
    # 同一任务只改变运行编号；记录前缀复用量，不把它当冷启动测试。
    body = {'model': status['model'], 'temperature': 0, 'max_tokens': 128,
            'chat_template_kwargs': {'enable_thinking': False},
            'messages': [{'role': 'user', 'content':
                f'Run {i}. Write a 250-word explanation of memory bandwidth, '
                'expert caching, and CPU/GPU overlap in MoE inference.'}]}
    request = urllib.request.Request(base + '/v1/chat/completions',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    start = time.perf_counter()
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
    wall = time.perf_counter() - start
    timing = result.get('timings')
    assert timing is not None, '该版本没有返回 timings，不能混用墙钟时间代替'
    row = {k: timing.get(k) for k in ('cache_n', 'prompt_n', 'prompt_ms',
           'predicted_n', 'predicted_ms', 'predicted_per_second',
           'draft_n', 'draft_n_accepted')}
    row['wall_s'] = round(wall, 3)
    row['warmup'] = i == 0
    assert row['predicted_n'] > 0 and row['predicted_ms'] > 0
    runs.append(row)
    print(json.dumps(row), flush=True)
measured = runs[1:]
rate = sum(r['predicted_n'] for r in measured) / (sum(r['predicted_ms'] for r in measured) / 1000)
print('aggregate_decode_tok_s', round(rate, 2))
print('median_wall_s', round(statistics.median(r['wall_s'] for r in measured), 3))
