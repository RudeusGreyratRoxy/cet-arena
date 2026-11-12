#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 0.5 秒静音 MP3（public/audio/_silent.mp3），用于移动端「点击唤醒声音」。
采样率/码率与正式音频保持一致：24kHz / 48kbps。"""

import os
import struct
import sys

try:
    import lameenc
except ImportError:
    sys.stderr.write("缺少 lameenc\n")
    raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'audio', '_silent.mp3')
RATE = 24000
DURATION = 0.5

samples = [0] * int(RATE * DURATION)
pcm = struct.pack('<%dh' % len(samples), *samples)

encoder = lameenc.Encoder()
encoder.set_bit_rate(48)
encoder.set_in_sample_rate(RATE)
encoder.set_channels(1)
encoder.set_quality(2)
data = encoder.encode(pcm) + encoder.flush()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'wb') as handle:
    handle.write(data)

print('写出 %s (%d bytes)' % (OUT, len(data)))
