import { DanmakuElem, DmColorfulType } from '@proto/bilibili/community/service/dm/v1/dm';
import { Segment, Settings, categories, segmentMode } from './policy';
import { ungzip, gzipSize } from '@/utils/gzip';
import { protobufReadOptions } from '@/utils/protobuf';

export interface Metadata {
    bvid: string;
    cid: string;
    index: number;
    time: number;
}
interface CacheEntry {
    segments: Segment[];
    expires: number;
}
interface Store {
    pending: Record<string, Metadata>;
    cache: Record<string, CacheEntry>;
}
const STORE_KEY = 'sparkle.sponsor.v1';
// UTF-16 storage uses at most 128 KiB of string data before JSON parsing.
const MAX_STORE_CHARS = 65_536;
const MAX_PAYLOAD = 1024 * 1024;

export function log(level: number, message: string): void {
    let threshold = 4;
    try {
        const argument = typeof $argument === 'string' ? JSON.parse($argument) : {};
        const configured = Number(argument.logLevel ?? 4);
        if (configured >= 1 && configured <= 5) threshold = configured;
    } catch {
        /* Keep errors visible when the argument itself is malformed. */
    }
    if (level >= threshold && threshold < 5) console.log(`[SponsorBlock] ${message}`);
}

export function readStore(): Store {
    const raw = $persistentStore.read(STORE_KEY);
    let store: Store;
    try {
        store = raw && raw.length <= MAX_STORE_CHARS ? JSON.parse(raw) : { pending: {}, cache: {} };
    } catch {
        store = { pending: {}, cache: {} };
    }
    if (
        !store ||
        typeof store.pending !== 'object' ||
        !store.pending ||
        Array.isArray(store.pending) ||
        typeof store.cache !== 'object' ||
        !store.cache ||
        Array.isArray(store.cache)
    )
        store = { pending: {}, cache: {} };
    for (const [key, value] of Object.entries(store.pending))
        if (
            !value ||
            !/^BV[0-9A-Za-z]{10}$/.test(value.bvid) ||
            !/^\d{1,20}$/.test(value.cid) ||
            !Number.isSafeInteger(value.index) ||
            value.index < 1 ||
            !Number.isFinite(value.time) ||
            Math.abs(Date.now() - value.time) > 120_000
        )
            delete store.pending[key];
    for (const [key, value] of Object.entries(store.cache)) {
        if (
            !value ||
            !Number.isFinite(value.expires) ||
            value.expires < Date.now() ||
            value.expires > Date.now() + 300_000 ||
            !Array.isArray(value.segments) ||
            value.segments.length > 500
        ) {
            delete store.cache[key];
        }
    }
    return store;
}

export function writeStore(store: Store): void {
    for (const key of Object.keys(store.pending).slice(0, -64)) delete store.pending[key];
    for (const key of Object.keys(store.cache).slice(0, -32)) delete store.cache[key];
    let encoded = JSON.stringify(store);
    // Count limits alone allow 32 videos * 500 segments and large UUIDs.
    for (const key of Object.keys(store.cache)) {
        if (encoded.length <= MAX_STORE_CHARS) break;
        delete store.cache[key];
        encoded = JSON.stringify(store);
    }
    for (const key of Object.keys(store.pending)) {
        if (encoded.length <= MAX_STORE_CHARS) break;
        delete store.pending[key];
        encoded = JSON.stringify(store);
    }
    $persistentStore.write(encoded, STORE_KEY);
}

export function validateFrame(body: Uint8Array): void {
    if (!(body instanceof Uint8Array) || body.length < 5) throw new Error('Missing gRPC frame');
    const length = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1);
    if (length !== body.length - 5 || body[0] > 1) throw new Error('Unsupported gRPC framing');
    if (length > MAX_PAYLOAD) throw new Error('gRPC body exceeds memory budget');
    if (body[0] === 1) gzipSize(body.subarray(5), MAX_PAYLOAD);
}

export function unpackFrame(body: Uint8Array): Uint8Array {
    validateFrame(body);
    return body[0] === 1 ? ungzip(body.subarray(5), MAX_PAYLOAD) : body.subarray(5);
}

export function countDanmaku(body: Uint8Array): number {
    const reader = protobufReadOptions.readerFactory!(body);
    let count = 0;
    while (reader.pos < reader.len) {
        const [field, wire] = reader.tag();
        if (field === 1 && wire === 2) count++;
        reader.skip(wire);
    }
    return count;
}

export function packFrame(body: Uint8Array, extra: Uint8Array = new Uint8Array(0)): Uint8Array {
    if (body.length + extra.length > MAX_PAYLOAD) throw new Error('Modified gRPC body exceeds memory budget');
    const frame = new Uint8Array(body.length + extra.length + 5);
    new DataView(frame.buffer).setUint32(1, body.length + extra.length);
    frame.set(body, 5);
    frame.set(extra, body.length + 5);
    return frame;
}

export function makeDanmaku(segments: Segment[], settings: Settings, metadata: Metadata): DanmakuElem[] {
    const elems: DanmakuElem[] = [];
    const windowStart = (metadata.index - 1) * 360_000;
    const windowEnd = windowStart + 360_000;
    for (const [index, segment] of segments.entries()) {
        const mode = segmentMode(segment, settings);
        const progress = Math.round(segment.segment[0] * 1000);
        if (mode === 'off' || progress < windowStart || progress >= windowEnd) continue;
        let target = Math.round(segment.segment[1] * 1000);
        if (mode === 'auto') {
            // Resolve overlapping automatic ranges so a seek cannot land inside
            // the next range after its trigger has already been passed.
            for (let next = index + 1; next < segments.length; next++) {
                const other = segments[next];
                if (Math.round(other.segment[0] * 1000) > target) break;
                if (segmentMode(other, settings) === 'auto')
                    target = Math.max(target, Math.round(other.segment[1] * 1000));
            }
        }
        const [label, color] = categories[segment.category];
        const action = mode === 'manual' ? `airborne:${target}` : '';
        const base = (content: string, action: string, offset: number): DanmakuElem => {
            const id = String(9_000_000_000_000_000n + BigInt(index * 2 + offset));
            return {
                id,
                idStr: id,
                progress,
                mode: 5,
                fontsize: 25,
                color,
                midHash: '1948dd5d',
                content,
                ctime: '1735660800',
                weight: 11,
                action,
                pool: 0,
                attr: 1310724,
                animation: '',
                extra: '',
                colorful: DmColorfulType.NONE_TYPE,
                type: 1,
                oid: metadata.cid,
                dmFrom: 1,
            };
        };
        elems.push(
            base(
                `空降助手：${label} ${segment.segment[0]}–${segment.segment[1]}秒${mode === 'manual' ? (segment.actionType === 'poi' ? '（点按跳转）' : '（点按跳过）') : mode === 'auto' ? '（自动跳过）' : '（仅提示）'}`,
                action,
                0
            )
        );
        if (mode === 'auto') {
            // The existing patched Chronos recognises this marker and provides
            // seek/undo controls. Keep its protocol; do not refetch Bilibili.
            elems.push(base('空指部已就位', `airborne:${target}`, 1));
        }
    }
    return elems;
}
