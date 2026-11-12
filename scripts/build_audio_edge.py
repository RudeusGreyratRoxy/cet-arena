#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
用微软神经网络语音（edge-tts）批量生成单词发音 MP3。

相比旧版 Windows SAPI（8kHz/24kbps，发闷），本脚本输出 24kHz/48kbps 的
神经网络语音，听感接近真实四级听力。

依赖：edge-tts（需联网访问微软语音服务）

用法：
  python scripts/build_audio_edge.py                      # 全量，默认 en-US-JennyNeural
  python scripts/build_audio_edge.py --limit 20           # 试点
  python scripts/build_audio_edge.py --voice en-US-AriaNeural
  python scripts/build_audio_edge.py --skip-existing      # 只补缺失
"""

import argparse
import asyncio
import json
import os
import sys
import time

try:
    import edge_tts
except ImportError:
    sys.stderr.write('缺少 edge-tts，请先安装\n')
    raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_JSON = os.path.join(ROOT, 'data', 'words.json')
AUDIO_OUT = os.path.join(ROOT, 'public', 'audio')

DEFAULT_VOICE = 'en-US-JennyNeural'
MIN_BYTES = 800


def load_words(limit=None):
    with open(WORDS_JSON, 'r', encoding='utf-8') as handle:
        entries = json.load(handle)
    words = []
    seen = set()
    for entry in entries:
        word = (entry.get('word') or '').strip().lower()
        if not word or word in seen:
            continue
        seen.add(word)
        words.append(word)
    if limit:
        words = words[:limit]
    return words


async def synth_one(semaphore, word, voice, out_path, retries=3):
    async with semaphore:
        last_error = None
        for attempt in range(1, retries + 1):
            try:
                communicate = edge_tts.Communicate(word, voice)
                await communicate.save(out_path)
                size = os.path.getsize(out_path)
                if size < MIN_BYTES:
                    raise RuntimeError('音频过小 (%d bytes)' % size)
                return True, None
            except Exception as error:  # noqa: BLE001
                last_error = error
                try:
                    os.remove(out_path)
                except OSError:
                    pass
                await asyncio.sleep(0.6 * attempt)
        return False, str(last_error)


async def run(words, voice, concurrency, skip_existing):
    os.makedirs(AUDIO_OUT, exist_ok=True)
    semaphore = asyncio.Semaphore(concurrency)

    todo = []
    for word in words:
        path = os.path.join(AUDIO_OUT, word + '.mp3')
        if skip_existing and os.path.exists(path) and os.path.getsize(path) >= MIN_BYTES:
            continue
        todo.append((word, path))

    print('待生成 %d 个（跳过已有 %d 个），音色 %s，并发 %d'
          % (len(todo), len(words) - len(todo), voice, concurrency))

    done = 0
    failed = []
    started = time.time()
    lock = asyncio.Lock()

    async def worker(word, path):
        nonlocal done
        ok, error = await synth_one(semaphore, word, voice, path)
        async with lock:
            if ok:
                done += 1
                if done % 100 == 0:
                    elapsed = time.time() - started
                    rate = done / elapsed if elapsed else 0
                    print('  进度 %d/%d  %.0f 个/秒' % (done, len(todo), rate))
            else:
                failed.append((word, error))

    await asyncio.gather(*(worker(word, path) for word, path in todo))
    return done, failed, time.time() - started


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--voice', default=DEFAULT_VOICE)
    parser.add_argument('--concurrency', type=int, default=6)
    parser.add_argument('--skip-existing', action='store_true')
    args = parser.parse_args()

    words = load_words(args.limit)
    done, failed, elapsed = asyncio.run(
        run(words, args.voice, args.concurrency, args.skip_existing)
    )

    total = 0
    count = 0
    for name in os.listdir(AUDIO_OUT):
        if not name.endswith('.mp3') or name == '_silent.mp3':
            continue
        total += os.path.getsize(os.path.join(AUDIO_OUT, name))
        count += 1

    print('')
    print('成功: %d，失败: %d，用时: %.1fs' % (done, len(failed), elapsed))
    print('目录统计: %d 个 MP3，共 %.2f MB，平均 %.1f KB'
          % (count, total / 1048576.0, total / max(count, 1) / 1024.0))
    if failed:
        print('失败样例: %s' % failed[:5])
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
