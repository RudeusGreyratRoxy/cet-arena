'use strict';

/**
 * 设备 Token 哈希化迁移脚本（离线、幂等、只处理 state 副本）。
 *
 * 背景：`vip_codes.state.json` 目前把 `boundDevice` 与 `revokedDevices` 里的
 * 设备 Token 以**明文**保存。本脚本把它们改成 `sha256:<64hex>`，并额外保留
 * `boundDevicePrefix`（原 token 前 8 位）供后台列表核对——与 `src/messages.js`
 * 里 `deviceHash` + `devicePrefix` 的既有做法保持一致。
 *
 * 用法：
 *   node scripts/migrate-device-hash.js <input.json> [output.json]
 *
 * 约定：
 * - 输入只读，永不覆盖；输出默认写到 `<input 所在目录>/state-migrated.json`
 * - 幂等：已带 `sha256:` 前缀的值原样保留，重复执行不会二次哈希
 * - `revokedDevices` 去重（同一设备被多次拉黑只留一条）
 * - **只输出计数与一条脱敏抽样**，绝不打印完整 token 或完整哈希
 *
 * 注意：本脚本只生成迁移结果，不会自己应用到线上；真正生效还需要
 * 同步修改 `src/vipCodes.js` 的写入/比较逻辑（否则旧代码会拿明文去比哈希）。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HASH_PREFIX = 'sha256:';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isHashed(value) {
  return typeof value === 'string' && value.startsWith(HASH_PREFIX);
}

/** 前4后4掩码：只在抽样行里用，避免把完整 token 打到终端。 */
function maskToken(token) {
  const s = String(token);
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('用法: node scripts/migrate-device-hash.js <input.json> [output.json]');
    process.exit(2);
  }
  const outputPath =
    process.argv[3] || path.join(path.dirname(path.resolve(inputPath)), 'state-migrated.json');

  const raw = fs.readFileSync(inputPath, 'utf8');
  const state = JSON.parse(raw);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    console.error('输入不是预期的 state 对象');
    process.exit(2);
  }

  const stats = {
    records: 0,
    boundNonEmpty: 0,
    boundConverted: 0,
    boundSkipped: 0,
    boundHashedWithoutPrefix: 0,
    revokedBefore: 0,
    revokedConverted: 0,
    revokedSkipped: 0,
    revokedAfter: 0,
    revokedDeduped: 0,
  };

  /** 抽样（第一条被转换的 boundDevice），只留脱敏信息。 */
  let sample = null;

  for (const [code, record] of Object.entries(state)) {
    if (!record || typeof record !== 'object') continue;
    stats.records += 1;

    // --- boundDevice ---
    const bound = record.boundDevice;
    if (bound != null && bound !== '') {
      stats.boundNonEmpty += 1;
      if (isHashed(bound)) {
        stats.boundSkipped += 1;
        if (typeof record.boundDevicePrefix !== 'string' || record.boundDevicePrefix.length === 0) {
          // 已经是哈希但没有 prefix：无法反推原值，只能计数提醒，不猜测。
          stats.boundHashedWithoutPrefix += 1;
        }
      } else {
        const original = String(bound);
        const hex = sha256Hex(original);
        const prefix = original.slice(0, 8);

        if (!sample) {
          sample = {
            masked: maskToken(original),
            hash8: hex.slice(0, 8),
            prefix,
            prefixMatches: prefix === original.slice(0, 8),
          };
        }

        record.boundDevice = HASH_PREFIX + hex;
        record.boundDevicePrefix = prefix;
        stats.boundConverted += 1;
      }
    }

    // --- revokedDevices ---
    if (Array.isArray(record.revokedDevices)) {
      const list = record.revokedDevices;
      stats.revokedBefore += list.length;

      const seen = new Set();
      const out = [];
      for (const entry of list) {
        if (entry == null || entry === '') continue;
        if (isHashed(entry)) {
          stats.revokedSkipped += 1;
          if (!seen.has(entry)) {
            seen.add(entry);
            out.push(entry);
          }
        } else {
          const hex = HASH_PREFIX + sha256Hex(String(entry));
          stats.revokedConverted += 1;
          if (!seen.has(hex)) {
            seen.add(hex);
            out.push(hex);
          }
        }
      }
      stats.revokedDeduped += list.length - out.length;
      stats.revokedAfter += out.length;
      record.revokedDevices = out;
    }
  }

  // 原子写：先写临时文件再 rename，避免中断留下半个文件。
  const dir = path.dirname(path.resolve(outputPath));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(outputPath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, outputPath);

  console.log(`输入: ${path.basename(inputPath)}  输出: ${path.basename(outputPath)}`);
  console.log(`记录数: ${stats.records}`);
  console.log('--- boundDevice ---');
  console.log(`  非空条数: ${stats.boundNonEmpty}`);
  console.log(`  转为哈希: ${stats.boundConverted}`);
  console.log(`  已跳过（本就是哈希）: ${stats.boundSkipped}`);
  console.log(`  哈希但缺 prefix: ${stats.boundHashedWithoutPrefix}`);
  console.log('--- revokedDevices ---');
  console.log(`  原始 token 总数: ${stats.revokedBefore}`);
  console.log(`  转为哈希: ${stats.revokedConverted}`);
  console.log(`  已跳过（本就是哈希）: ${stats.revokedSkipped}`);
  console.log(`  去重后总数: ${stats.revokedAfter}（去重移除 ${stats.revokedDeduped}）`);
  if (sample) {
    console.log('--- 抽样（脱敏） ---');
    console.log(
      `  orig=${sample.masked}  hash=${sample.hash8}…  prefix=${sample.prefix}  prefixMatch=${sample.prefixMatches}`
    );
  } else {
    console.log('--- 抽样 --- 本次没有可转换的 boundDevice');
  }
}

main();
