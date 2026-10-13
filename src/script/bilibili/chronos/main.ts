import * as Surge from '@/types/surge';
import { BinaryReader, BinaryWriter } from '@protobuf-ts/runtime';
import { Chronos } from '@proto/bilibili/app/view/v1/view';
import { ungzip } from '@/utils/gzip';
import { Logger } from '@core/logger';

// Both legacy and unified ViewProgress use field 2 for Chronos. Import only
// that message codec; preserve every other field as its original wire bytes.
const replacements: Record<string, string> = {
    universal: '106d21a147f49e9d4ef86e2e8523474f',
    hd: 'e5a968f1a5055bbe5c12e67b100a6dcb',
    inter: '8c3feda2e92bf60e8a7aeade1a231586',
    '5bca6725b04c018358e69be749f0ee11': '106d21a147f49e9d4ef86e2e8523474f',
    '45b564f5ba1fdd3746406937059addd8': 'e5a968f1a5055bbe5c12e67b100a6dcb',
    '325e7073ffc6fb5263682fecdcd1058f': '932002070dc1b51241198a074d2279fc',
    '3a14beddd23328eaddfe9f0eb048d713': '8c3feda2e92bf60e8a7aeade1a231586',
};
const request = $request as Surge.HttpRequest;
const response = $response as Surge.HttpResponse;
const started = Date.now();

function run(): Surge.HttpResponseDone {
    const argument = typeof $argument === 'string' ? JSON.parse($argument) : {};
    Logger.setLevel(String(argument.logLevel ?? 4));
    const enabled = (value: unknown) => Boolean(value && value !== '#');
    if (!enabled(argument.sponsorBlock ?? true) && !enabled(argument.sponsorBlockLegacy)) return {};
    const resourceMode = String(argument.chronosEnabled ?? 1);
    if (resourceMode === '0') {
        Logger.info('[Chronos] Resource replacement disabled; original response preserved.');
        return {};
    }
    if (response.status !== 200) return {};
    const status = Object.entries(response.h2_trailers ?? response.headers).find(
        ([key]) => key.toLowerCase() === 'grpc-status'
    )?.[1];
    if (status && status !== '0') return {};

    const frame = response.body;
    if (!(frame instanceof Uint8Array) || frame.length < 5) throw new Error('Missing gRPC frame');
    if (
        frame[0] > 1 ||
        new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1) !== frame.length - 5
    )
        throw new Error('Unsupported gRPC frame');
    const payload = frame[0] ? ungzip(frame.subarray(5)) : frame.subarray(5);
    const reader = new BinaryReader(payload);
    const parts: Uint8Array[] = [];
    let changed = false;
    Logger.info(`[Chronos] Start; frame_bytes=${frame.length}; engine=webview; resource_mode=${resourceMode}; compressed=${frame[0]}; trailers_present=${response.h2_trailers !== undefined}`);
    while (reader.pos < reader.len) {
        const start = reader.pos;
        const [field, wireType] = reader.tag();
        if (field !== 2 || wireType !== 2) {
            reader.skip(wireType);
            parts.push(payload.subarray(start, reader.pos));
            continue;
        }
        const chronos = Chronos.fromBinary(reader.bytes());
        if (resourceMode === '2') {
            // Exercise the same framing/header rewrite with the original player
            // resource, isolating transport changes from resource replacement.
            Logger.info(`[Chronos] Transport diagnostic: original resource retained; md5=${chronos.md5}`);
        } else {
            const ua = request.headers['user-agent'] || request.headers['User-Agent'] || '';
            const edition = ua.includes('bili-hd') ? 'hd' : ua.includes('bili-inter') ? 'inter' : 'universal';
            const md5 = replacements[chronos.md5] || replacements[edition];
            if (!replacements[chronos.md5]) Logger.warn(`[Chronos] Unknown source MD5 ${chronos.md5}; fallback=${edition}`);
            chronos.md5 = md5;
            chronos.file = `https://raw.githubusercontent.com/kokoryh/chronos/refs/heads/master/${md5}.zip`;
            chronos.sign = undefined;
            Logger.info(`[Chronos] Replacement selected: ${md5}; resource=${chronos.file}`);
        }
        parts.push(new BinaryWriter().tag(2, 2).bytes(Chronos.toBinary(chronos)).finish());
        changed = true;
    }
    if (!changed) return {};
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const body = new Uint8Array(length + 5);
    new DataView(body.buffer).setUint32(1, length);
    let offset = 5;
    for (const part of parts) {
        body.set(part, offset);
        offset += part.length;
    }
    // Preserve the existing response script's successful gRPC completion rule.
    if (
        response.h2_trailers === undefined &&
        request.headers.te === 'trailers' &&
        !Object.hasOwn(response.headers, 'grpc-status')
    ) {
        Logger.info('[Chronos] Transport output: identity frame; grpc-status header added.');
        return { body, headers: { ...response.headers, 'grpc-status': '0' } };
    }
    Logger.info('[Chronos] Transport output: identity frame; original headers retained.');
    return { body };
}

let result: Surge.HttpResponseDone = {};
try {
    result = run();
} catch (error) {
    Logger.error(`[Chronos] Original response preserved: ${String(error)}`);
} finally {
    Logger.info(`[Chronos] Complete after ${Date.now() - started}ms; modified=${Boolean(result.body)}`);
    ($done as Surge.Done)(result);
}
