import { DanmakuElem, DmColorfulType } from '@proto/bilibili/community/service/dm/v1/dm';
import { Segment, Settings, categories, segmentMode } from './policy';

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

export function readStore(): Store {
    const raw = $persistentStore.read(STORE_KEY);
    let store: Store;
    try {
        store = raw ? JSON.parse(raw) : { pending: {}, cache: {} };
    } catch {
        store = { pending: {}, cache: {} };
    }
    if (!store.pending || !store.cache) store = { pending: {}, cache: {} };
    for (const [key, value] of Object.entries(store.pending))
        if (Date.now() - value.time > 120_000) delete store.pending[key];
    for (const [key, value] of Object.entries(store.cache)) if (value.expires < Date.now()) delete store.cache[key];
    return store;
}

export function writeStore(store: Store): void {
    for (const key of Object.keys(store.pending).slice(0, -64)) delete store.pending[key];
    for (const key of Object.keys(store.cache).slice(0, -32)) delete store.cache[key];
    $persistentStore.write(JSON.stringify(store), STORE_KEY);
}

export function unpackFrame(body: Uint8Array): Uint8Array {
    if (!(body instanceof Uint8Array) || body.length < 5) throw new Error('Missing gRPC frame');
    const length = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1);
    if (length !== body.length - 5 || body[0] > 1) throw new Error('Unsupported gRPC framing');
    return body[0] === 1 ? $utils.ungzip(body.subarray(5)) : body.subarray(5);
}

export function packFrame(body: Uint8Array): Uint8Array {
    const frame = new Uint8Array(body.length + 5);
    new DataView(frame.buffer).setUint32(1, body.length);
    frame.set(body, 5);
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
            for (const other of segments.slice(index + 1)) {
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
