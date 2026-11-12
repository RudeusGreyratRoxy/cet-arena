#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
批量生成单词发音 MP3（废弃 speechSynthesis 后的离线音频方案）。

流程：
  1. 从 data/words.json 取出全部单词，写临时清单；
  2. 调 Windows SAPI（scripts/synth_wav.ps1）把每个单词合成成 22.05kHz WAV；
  3. 逐条：裁掉首尾静音 → 归一化 → 降采样到 8kHz 单声道 → lameenc 编成 24kbps MP3；
  4. 输出到 public/audio/<word>.mp3，并删除临时 WAV。

用法：
  python scripts/build_audio.py                # 全量
  python scripts/build_audio.py --limit 20     # 先做 20 个试点
  python scripts/build_audio.py --skip-synth   # 复用已有 WAV，只做编码
"""

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import wave

try:
    import lameenc
except ImportError:
    sys.stderr.write("缺少 lameenc，请先安装到本地目录并设 PYTHONPATH\n")
    raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_JSON = os.path.join(ROOT, 'data', 'words.json')
AUDIO_OUT = os.path.join(ROOT, 'public', 'audio')
SYNTH_PS1 = os.path.join(ROOT, 'scripts', 'synth_wav.ps1')
POWERSHELL = os.path.join(
    os.environ.get('SystemRoot', r'C:\Windows'),
    r'System32\WindowsPowerShell\v1.0\powershell.exe',
)

TARGET_RATE = 8000
BITRATE = 24
SILENCE_RATIO = 0.02      # 低于峰值 2% 视为静音
PAD_MS = 25               # 裁切后补一点留白


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


def synth_wavs(words, wav_dir):
    os.makedirs(wav_dir, exist_ok=True)
    list_file = os.path.join(wav_dir, '_words.txt')
    with open(list_file, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(words))

    cmd = [
        POWERSHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', SYNTH_PS1,
        '-WordsFile', list_file,
        '-OutDir', wav_dir,
    ]
    print('开始 SAPI 合成 %d 个 WAV…' % len(words))
    started = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    elapsed = time.time() - started
    tail = [line for line in (proc.stdout or '').splitlines() if line.strip()][-6:]
    for line in tail:
        print('  [sapi] ' + line)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr[-2000:] if proc.stderr else '(无 stderr)')
        raise SystemExit('SAPI 合成失败，exit=%d' % proc.returncode)
    print('  WAV 合成完成，用时 %.1fs' % elapsed)


def read_wav(path):
    with wave.open(path, 'rb') as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        raise ValueError('只支持 16bit WAV: %s' % path)
    total = len(frames) // 2
    samples = struct.unpack('<%dh' % total, frames)
    if channels > 1:
        mono = []
        for i in range(0, len(samples), channels):
            chunk = samples[i:i + channels]
            mono.append(int(sum(chunk) / len(chunk)))
        samples = mono
    return list(samples), rate


def trim_silence(samples):
    if not samples:
        return samples
    peak = max(abs(s) for s in samples)
    if peak == 0:
        return []
    threshold = max(int(peak * SILENCE_RATIO), 120)
    start = 0
    while start < len(samples) and abs(samples[start]) < threshold:
        start += 1
    end = len(samples) - 1
    while end > start and abs(samples[end]) < threshold:
        end -= 1
    if end <= start:
        return samples
    return samples[start:end + 1]


def normalize(samples, target=0.85 * 32767):
    peak = max((abs(s) for s in samples), default=0)
    if peak == 0:
        return samples
    scale = target / peak
    if scale > 4:
        scale = 4
    return [max(-32768, min(32767, int(s * scale))) for s in samples]


def resample(samples, src_rate, dst_rate=TARGET_RATE):
    if src_rate == dst_rate or not samples:
        return samples
    ratio = src_rate / float(dst_rate)
    out_len = int(len(samples) / ratio)
    out = []
    for i in range(out_len):
        start = int(i * ratio)
        end = int((i + 1) * ratio)
        if end <= start:
            end = start + 1
        chunk = samples[start:end]
        out.append(int(sum(chunk) / len(chunk)))
    return out


def encode_mp3(samples):
    pcm = struct.pack('<%dh' % len(samples), *samples)
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(BITRATE)
    encoder.set_in_sample_rate(TARGET_RATE)
    encoder.set_channels(1)
    encoder.set_quality(5)
    return encoder.encode(pcm) + encoder.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--skip-synth', action='store_true')
    args = parser.parse_args()

    words = load_words(args.limit)
    print('待处理单词: %d' % len(words))
    os.makedirs(AUDIO_OUT, exist_ok=True)

    wav_dir = os.path.join(tempfile.gettempdir(), 'cet-audio-wav')
    if args.skip_synth:
        print('跳过合成，复用 %s' % wav_dir)
    else:
        synth_wavs(words, wav_dir)

    total_bytes = 0
    done = 0
    failed = []
    started = time.time()

    for word in words:
        wav_path = os.path.join(wav_dir, word + '.wav')
        if not os.path.exists(wav_path):
            failed.append(word)
            continue
        try:
            samples, rate = read_wav(wav_path)
            samples = trim_silence(samples)
            samples = normalize(samples)
            samples = resample(samples, rate)
            pad = int(TARGET_RATE * PAD_MS / 1000)
            samples = [0] * pad + samples + [0] * pad
            data = encode_mp3(samples)
            out_path = os.path.join(AUDIO_OUT, word + '.mp3')
            with open(out_path, 'wb') as handle:
                handle.write(data)
            total_bytes += len(data)
            done += 1
            if done % 200 == 0:
                print('  编码进度 %d/%d，累计 %.2f MB' % (done, len(words), total_bytes / 1048576.0))
        except Exception as error:  # noqa: BLE001
            failed.append(word)
            print('  [失败] %s: %s' % (word, error))

    elapsed = time.time() - started
    print('')
    print('完成: %d 个 MP3' % done)
    print('总体积: %.2f MB' % (total_bytes / 1048576.0))
    if done:
        print('平均大小: %.1f KB' % (total_bytes / done / 1024.0))
    print('编码用时: %.1f s' % elapsed)
    if failed:
        print('失败 %d 个: %s' % (len(failed), ', '.join(failed[:10])))

    if not args.skip_synth:
        shutil.rmtree(wav_dir, ignore_errors=True)


if __name__ == '__main__':
    main()
