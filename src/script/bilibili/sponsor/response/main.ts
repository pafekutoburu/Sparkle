import * as Surge from '@/types/surge';
import { DmSegMobileReply } from '@proto/bilibili/community/service/dm/v1/dm';
import { protobufReadOptions, protobufWriteOptions } from '@/utils/protobuf';
import { parseSettings, parseSegments, Segment } from '../policy';
import { readStore, writeStore, unpackFrame, packFrame, makeDanmaku } from '../shared';

const request = $request as Surge.HttpRequest;
const response = $response as Surge.HttpResponse;

async function run(): Promise<{ body?: Uint8Array }> {
    if (!request.id) return {};
    const store = readStore();
    const metadata = store.pending[request.id];
    delete store.pending[request.id];
    writeStore(store);
    if (!metadata || response.status !== 200) return {};
    const status = Object.entries(response.h2_trailers ?? response.headers).find(
        ([key]) => key.toLowerCase() === 'grpc-status'
    )?.[1];
    if (status && status !== '0') return {};
    // Validate the original response before contacting any third-party service.
    const reply = DmSegMobileReply.fromBinary(unpackFrame(response.body as Uint8Array), protobufReadOptions);
    const settings = parseSettings(typeof $argument === 'string' ? $argument : undefined);
    if (Object.values(settings.modes).every(mode => mode === 'off')) return {};
    const key = `${settings.server}|${metadata.bvid}|${metadata.cid}`;
    let segments: Segment[];
    const cached = store.cache[key];
    if (cached) {
        segments = cached.segments;
    } else {
        const fetched = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            $httpClient.get(
                {
                    url: `${settings.server}/api/skipSegments?videoID=${encodeURIComponent(metadata.bvid)}&cid=${encodeURIComponent(metadata.cid)}`,
                    headers: { origin: 'Sparkle-Surge', 'x-ext-version': 'legacy-compat-1' },
                    policy: settings.policy,
                    timeout: 1.5,
                },
                (error, response, body) =>
                    error ? reject(error) : resolve({ status: response.status, body: String(body) })
            );
        });
        if (fetched.status === 404) segments = [];
        else if (fetched.status === 200) segments = parseSegments(JSON.parse(fetched.body), metadata.cid);
        else return {};
        // Re-read after the asynchronous fetch so concurrent requests are kept.
        const latest = readStore();
        latest.cache[key] = { segments, expires: Date.now() + (segments.length ? 300_000 : 60_000) };
        writeStore(latest);
    }
    const elems = makeDanmaku(segments, settings, metadata);
    if (!elems.length) return {};
    reply.elems.push(...elems);
    return { body: packFrame(DmSegMobileReply.toBinary(reply, protobufWriteOptions)) };
}

run()
    .catch(error => {
        console.log(`[SponsorBlock] Original response preserved: ${error}`);
        return {};
    })
    .then(result => ($done as Surge.Done)(result));
