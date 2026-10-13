import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BinaryReader, UnknownFieldHandler } from '@protobuf-ts/runtime';
import { DmSegMobileReq, DmSegMobileReply } from '../src/proto/bilibili/community/service/dm/v1/dm';
import { MainListReply } from '../src/proto/bilibili/main/community/reply/v1/reply';
import { PopularReply } from '../src/proto/bilibili/app/show/popular/v1/popular';
import { Chronos, ViewReply, ViewProgressReply, RelatesFeedReply } from '../src/proto/bilibili/app/view/v1/view';
import { ViewProgressReply as UniteViewProgressReply } from '../src/proto/bilibili/app/viewunite/v1/view';
import { categories, parseSettings, parseSegments, segmentMode } from '../src/script/bilibili/sponsor/policy';

const endpoint = 'https://grpc.biliapi.net/bilibili.community.service.dm.v1.DM/DmSegMobile';
const source = (name: string) => readFileSync(new URL(`../dist/${name}.js`, import.meta.url), 'utf8');
function frame(body: Uint8Array, compressed = false): Uint8Array {
    const payload = compressed ? gzipSync(body) : body;
    const out = new Uint8Array(payload.length + 5);
    out[0] = Number(compressed);
    new DataView(out.buffer).setUint32(1, payload.length);
    out.set(payload, 5);
    return out;
}
const requestBody = (cid = '279786', index = '1') =>
    frame(DmSegMobileReq.toBinary(DmSegMobileReq.create({ pid: '170001', oid: cid, type: 1, segmentIndex: index })));
const originalReply = () => {
    const value = DmSegMobileReply.create({
        elems: [{ id: '123', idStr: '123', progress: 1000, content: '原始弹幕🙂', oid: '279786' }],
    });
    UnknownFieldHandler.onRead(DmSegMobileReply.typeName, value, 100, 0, new Uint8Array([42]));
    return frame(DmSegMobileReply.toBinary(value));
};

type Fetch = (options: Record<string, unknown>, callback: Function) => void;
async function execute(
    name: string,
    request: object,
    response?: object,
    store = new Map<string, string>(),
    fetch?: Fetch,
    argument = '{}',
    extraGlobals: object = {}
) {
    let calls = 0;
    let doneCalls = 0;
    const logs: string[] = [];
    const result = await new Promise<any>((resolve, reject) => {
        const context = vm.createContext({
            Uint8Array,
            DataView,
            BigInt,
            // Deliberately absent: the native JSC build must not use WebView APIs.
            URL: undefined,
            TextEncoder: undefined,
            TextDecoder: undefined,
            $request: request,
            $response: response,
            $argument: argument,
            $environment: { 'device-model': 'iPhone', system: 'iOS' },
            $persistentStore: {
                read: (key: string) => store.get(key) ?? null,
                write: (data: string, key: string) => {
                    store.set(key, data);
                    return true;
                },
            },
            $utils: { ungzip: (body: Uint8Array) => new Uint8Array(gunzipSync(body)) },
            $httpClient: {
                get: (options: Record<string, unknown>, callback: Function) => {
                    calls++;
                    assert.ok(String(options.url).includes('/api/skipSegments?'), 'must never refetch Bilibili');
                    assert.equal(options.timeout, name === 'bilibili.protobuf.request' ? 3 : 1.5);
                    if (fetch) fetch(options, callback);
                    else callback(null, { status: 404 }, '');
                },
            },
            console: { log: (...values: unknown[]) => logs.push(values.join(' ')) },
            $done: (value: unknown) => {
                doneCalls++;
                resolve(value);
            },
            ...extraGlobals,
        });
        try {
            vm.runInContext(source(name), context, { timeout: 500 });
        } catch (error) {
            reject(error);
        }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(doneCalls, 1);
    return { result, calls, store, logs };
}

async function prepare(store: Map<string, string>, id = 'request-1', cid = '279786', index = '1') {
    const out = await execute(
        'bilibili.sponsor.request',
        { id, url: endpoint, method: 'POST', headers: {}, body: requestBody(cid, index) },
        undefined,
        store
    );
    assert.equal(out.calls, 0);
    assert.equal(Object.keys(out.result).length, 0);
}

test('new helper keeps the original request native, correlates concurrent CIDs and caches per video', async () => {
    const store = new Map<string, string>();
    await prepare(store, 'a');
    await prepare(store, 'b', '999');
    const segments = [{ UUID: 'sponsor-1', cid: '279786', category: 'sponsor', actionType: 'skip', segment: [5, 7] }];
    const out = await execute(
        'bilibili.sponsor.response',
        { id: 'a' },
        { status: 200, headers: {}, body: originalReply() },
        store,
        (options, cb) => {
            assert.ok(String(options.url).includes('BV17x411w7KC'));
            cb(null, { status: 200 }, JSON.stringify(segments));
        }
    );
    assert.equal(out.calls, 1);
    const decoded = DmSegMobileReply.fromBinary(out.result.body.subarray(5));
    assert.equal(decoded.elems[0].content, '原始弹幕🙂');
    assert.equal(UnknownFieldHandler.list(decoded).length, 1);
    assert.ok(decoded.elems.some(item => item.content === '空指部已就位' && item.action === 'airborne:7000'));
    assert.ok(decoded.elems.some(item => item.content.includes('赞助/恰饭')));
    assert.ok(JSON.parse(store.get('sparkle.sponsor.v1')!).pending.b);
    await prepare(store, 'c');
    const cached = await execute(
        'bilibili.sponsor.response',
        { id: 'c' },
        { status: 200, headers: {}, body: originalReply() },
        store
    );
    assert.equal(cached.calls, 0);
    assert.ok(cached.result.body);
});

test('legacy detail/recommendation purification and the old-only Chronos toggle remain available in JSC', async () => {
    const scenarios = [
        {
            route: 'View',
            codec: ViewReply,
            value: ViewReply.create({
                cms: [new Uint8Array([1])],
                relates: [{ cm: new Uint8Array() }, { cm: new Uint8Array([1]) }],
            }),
        },
        {
            route: 'RelatesFeed',
            codec: RelatesFeedReply,
            value: RelatesFeedReply.create({ list: [{ cm: new Uint8Array() }, { cm: new Uint8Array([1]) }] }),
        },
    ];
    for (const item of scenarios) {
        const output = await execute(
            'bilibili.protobuf.response',
            { url: `https://grpc.biliapi.net/bilibili.app.view.v1.View/${item.route}`, method: 'POST', headers: {} },
            { status: 200, headers: {}, body: frame((item.codec as any).toBinary(item.value)) }
        );
        const decoded = (item.codec as any).fromBinary(output.result.body.subarray(5));
        assert.equal((decoded.relates ?? decoded.list).length, 1);
        if (decoded.cms) assert.equal(decoded.cms.length, 0);
    }
    const progress = ViewProgressReply.create({
        chronos: { md5: '3a14beddd23328eaddfe9f0eb048d713', file: 'original', sign: 'original' },
    });
    const output = await execute(
        'bilibili.protobuf.response',
        {
            url: 'https://grpc.biliapi.net/bilibili.app.view.v1.View/ViewProgress',
            method: 'POST',
            headers: { 'user-agent': 'bili-inter' },
        },
        { status: 200, headers: {}, body: frame(ViewProgressReply.toBinary(progress)) },
        new Map(),
        undefined,
        '{"sponsorBlock":"#","sponsorBlockLegacy":"bilibili.airborne"}'
    );
    assert.ok(
        ViewProgressReply.fromBinary(output.result.body.subarray(5)).chronos?.file.includes(
            '8c3feda2e92bf60e8a7aeade1a231586.zip'
        )
    );
});

test('the preserved legacy helper still fetches its original Bilibili request and applies its eight-second minimum', async () => {
    let biliFetches = 0;
    const httpClient = {
        post(options: Record<string, unknown>, cb: Function) {
            biliFetches++;
            assert.ok(String(options.url).includes('grpc.biliapi.net'));
            cb(null, { status: 200, headers: {} }, originalReply());
        },
        get(options: Record<string, unknown>, cb: Function) {
            assert.ok(String(options.url).includes('category=sponsor'));
            cb(
                null,
                { status: 200, headers: {} },
                JSON.stringify([
                    { actionType: 'skip', segment: [5, 7] },
                    { actionType: 'skip', segment: [10, 30] },
                ])
            );
        },
    };
    const output = await execute(
        'bilibili.protobuf.request',
        { url: endpoint, method: 'POST', headers: {}, body: requestBody() },
        undefined,
        new Map(),
        undefined,
        '{}',
        { URL, TextEncoder, TextDecoder, $httpClient: httpClient }
    );
    assert.equal(biliFetches, 1);
    const decoded = DmSegMobileReply.fromBinary(output.result.response.body.subarray(5));
    assert.equal(decoded.elems.length, 2);
    assert.equal(decoded.elems[1].action, 'airborne:30000');
});

test('timeouts, invalid JSON, gRPC errors and missing correlation preserve the original response', async () => {
    for (const scenario of ['timeout', 'json', 'grpc', 'missing', 'framing']) {
        const store = new Map<string, string>();
        if (scenario !== 'missing') await prepare(store);
        const body = scenario === 'framing' ? new Uint8Array([0, 0, 0, 0, 5, 0]) : originalReply();
        const snapshot = body.slice();
        const out = await execute(
            'bilibili.sponsor.response',
            { id: 'request-1' },
            {
                status: 200,
                headers: {},
                h2_trailers: scenario === 'grpc' ? { 'grpc-status': '14' } : undefined,
                body,
            },
            store,
            (_, cb) => (scenario === 'timeout' ? cb('timeout', {}, '') : cb(null, { status: 200 }, 'not JSON'))
        );
        assert.equal(Object.keys(out.result).length, 0, scenario);
        assert.deepEqual(body, snapshot, scenario);
        if (['grpc', 'missing', 'framing'].includes(scenario)) assert.equal(out.calls, 0);
    }
});

test('diagnostics identify missing correlation and respect ERROR/OFF without changing pass-through', async () => {
    for (const [argument, count] of [
        ['{}', 1],
        ['{"logLevel":5}', 0],
    ]) {
        const output = await execute('bilibili.sponsor.response', {}, undefined, new Map(), undefined, argument);
        assert.equal(output.logs.length, count);
        assert.equal(Object.keys(output.result).length, 0);
        assert.equal(output.calls, 0);
        if (count) assert.match(output.logs[0], /Response request ID unavailable/);
    }
    const unpaired = await execute(
        'bilibili.sponsor.response',
        { id: 'unpaired' },
        { status: 200, headers: {}, body: originalReply() }
    );
    assert.match(unpaired.logs[0], /No paired request metadata/);
    assert.equal(unpaired.calls, 0);
});

test('compressed hints survive native ungzip null/throw and offset-sensitive bridges', async () => {
    for (const failure of ['null', 'throw', 'offset']) {
        const store = new Map<string, string>();
        await prepare(store);
        const body = frame(originalReply().subarray(5), true);
        const out = await execute(
            'bilibili.sponsor.response',
            { id: 'request-1' },
            { status: 200, headers: {}, body },
            store,
            (_, cb) =>
                cb(
                    null,
                    { status: 200 },
                    JSON.stringify([{ category: 'sponsor', actionType: 'skip', segment: [5, 7] }])
                ),
            '{"logLevel":2}',
            {
                $utils: {
                    ungzip: (payload: Uint8Array) => {
                        if (failure === 'throw') throw new Error('native gzip failure');
                        if (
                            failure === 'null' ||
                            payload.byteOffset !== 0 ||
                            payload.buffer.byteLength !== payload.length
                        )
                            return null;
                        return new Uint8Array(gunzipSync(payload));
                    },
                },
            }
        );
        const decoded = DmSegMobileReply.fromBinary(out.result.body.subarray(5));
        assert.equal(decoded.elems[0].content, '原始弹幕🙂', failure);
        assert.equal(UnknownFieldHandler.list(decoded).length, 1, failure);
        assert.ok(
            decoded.elems.some(item => item.content === '空指部已就位'),
            failure
        );
        assert.ok(
            out.logs.some(line => /Danmaku decoded.*compressed=1/.test(line)),
            failure
        );
    }
});

test('compressed Chronos metadata is replaced when native ungzip returns null', async () => {
    const progress = ViewProgressReply.create({
        chronos: { md5: '3a14beddd23328eaddfe9f0eb048d713', file: 'original', sign: 'original' },
    });
    const out = await execute(
        'bilibili.protobuf.response',
        {
            url: 'https://grpc.biliapi.net/bilibili.app.view.v1.View/ViewProgress',
            method: 'POST',
            headers: { 'user-agent': 'bili-inter' },
        },
        { status: 200, headers: {}, body: frame(ViewProgressReply.toBinary(progress), true) },
        new Map(),
        undefined,
        '{"sponsorBlock":"bilibili.sponsor","logLevel":2}',
        { $utils: { ungzip: () => null } }
    );
    const decoded = ViewProgressReply.fromBinary(out.result.body.subarray(5));
    assert.ok(decoded.chronos?.file.endsWith('8c3feda2e92bf60e8a7aeade1a231586.zip'));
    assert.ok(out.logs.some(line => line.includes('[Chronos] Replacement selected')));
});

test('Chronos replacement preserves original danmaku/video-guide data and unknown fields', async () => {
    for (const [codec, route, field] of [
        [ViewProgressReply, 'view', 'videoGuide'],
        [UniteViewProgressReply, 'viewunite', 'dm'],
    ] as const) {
        const value = (codec as any).create({
            [field]: new Uint8Array([0xab, 0, 0xfe]),
            chronos: { md5: '3a14beddd23328eaddfe9f0eb048d713', file: 'original', sign: 'original' },
        });
        UnknownFieldHandler.onRead(codec.typeName, value, 100, 0, new Uint8Array([42]));
        const out = await execute(
            'bilibili.protobuf.response',
            {
                url: `https://grpc.biliapi.net/bilibili.app.${route}.v1.View/ViewProgress`,
                method: 'POST',
                headers: { 'user-agent': 'bili-inter' },
            },
            { status: 200, headers: {}, body: frame((codec as any).toBinary(value), true) },
            new Map(),
            undefined,
            '{"sponsorBlock":"bilibili.sponsor","sponsorBlockLegacy":"#","logLevel":2}',
            { $utils: { ungzip: () => null } }
        );
        const decoded = (codec as any).fromBinary(out.result.body.subarray(5));
        assert.deepEqual(decoded[field], value[field], route);
        assert.equal(UnknownFieldHandler.list(decoded).length, 1, route);
        assert.ok(decoded.chronos.file.endsWith('8c3feda2e92bf60e8a7aeade1a231586.zip'), route);
        assert.ok(
            out.logs.some(line => line.includes('[Protobuf] Start')),
            route
        );
        assert.ok(
            out.logs.some(line => /Complete.*elapsed=\d+ms/.test(line)),
            route
        );
    }
});

test('disabled helpers bypass ViewProgress before decompression even with a stale script match', async () => {
    for (const route of ['view', 'viewunite']) {
        let calls = 0;
        const body = new Uint8Array([1, 0, 0, 0, 99]);
        const out = await execute(
            'bilibili.protobuf.response',
            {
                url: `https://grpc.biliapi.net/bilibili.app.${route}.v1.View/ViewProgress`,
                method: 'POST',
                headers: {},
            },
            { status: 200, headers: {}, body },
            new Map(),
            undefined,
            '{"sponsorBlock":"#","sponsorBlockLegacy":"#","logLevel":2}',
            {
                $utils: {
                    ungzip: () => {
                        calls++;
                        throw new Error('must not run');
                    },
                },
            }
        );
        assert.equal(calls, 0, route);
        assert.equal(Object.keys(out.result).length, 0, route);
        assert.ok(
            out.logs.some(line => line.includes('ViewProgress bypassed')),
            route
        );
    }
});

function nonChronosBytes(payload: Uint8Array): Uint8Array {
    const reader = new BinaryReader(payload);
    const parts: Uint8Array[] = [];
    while (reader.pos < reader.len) {
        const start = reader.pos;
        const [field, wire] = reader.tag();
        reader.skip(wire);
        if (field !== 2) parts.push(payload.subarray(start, reader.pos));
    }
    return new Uint8Array(Buffer.concat(parts));
}

test('dedicated WebView Chronos script preserves all unrelated wire bytes and nested unknown fields', async () => {
    for (const [codec, route, field] of [
        [ViewProgressReply, 'view', 'videoGuide'],
        [UniteViewProgressReply, 'viewunite', 'dm'],
    ] as const) {
        const value = (codec as any).create({
            [field]: new Uint8Array([0xab, 0, 0xfe]),
            chronos: { md5: '3a14beddd23328eaddfe9f0eb048d713', file: 'original', sign: 'original' },
        });
        UnknownFieldHandler.onRead(Chronos.typeName, value.chronos, 100, 0, new Uint8Array([42]));
        const encoded = (codec as any).toBinary(value);
        const payload = new Uint8Array(encoded.length + 3);
        payload.set([0xa0, 0x06, 42]); // unknown field before the known fields
        payload.set(encoded, 3);
        const out = await execute(
            'bilibili.chronos',
            {
                url: `https://grpc.biliapi.net/bilibili.app.${route}.v1.View/ViewProgress`,
                method: 'POST',
                headers: { 'user-agent': 'bili-inter', te: 'trailers' },
            },
            { status: 200, headers: { 'content-type': 'application/grpc' }, body: frame(payload, true) },
            new Map(),
            undefined,
            '{"sponsorBlock":"bilibili.sponsor","sponsorBlockLegacy":"#","logLevel":2}',
            { TextEncoder, TextDecoder, $utils: { ungzip: () => null } }
        );
        const result = out.result.body.subarray(5);
        assert.deepEqual(nonChronosBytes(result), nonChronosBytes(payload), route);
        const decoded = (codec as any).fromBinary(result);
        assert.deepEqual(decoded[field], value[field], route);
        assert.equal(UnknownFieldHandler.list(decoded).length, 1, route);
        assert.equal(UnknownFieldHandler.list(decoded.chronos).length, 1, route);
        assert.equal(decoded.chronos.md5, '8c3feda2e92bf60e8a7aeade1a231586');
        assert.equal(decoded.chronos.sign, undefined);
        assert.equal(out.result.headers['grpc-status'], '0');
        assert.equal(out.calls, 0);
        assert.ok(out.logs.some(line => line.includes('engine=webview')));
    }
});

test('dedicated Chronos preserves originals on disabled helpers, missing resource and corrupt framing', async () => {
    for (const scenario of ['disabled', 'missing', 'frame', 'crc', 'grpc']) {
        let body = frame(
            ViewProgressReply.toBinary(
                ViewProgressReply.create({
                    chronos: { md5: '3a14beddd23328eaddfe9f0eb048d713', file: 'original' },
                })
            ),
            true
        );
        if (scenario === 'frame') body = new Uint8Array([0, 0, 0, 0, 9]);
        if (scenario === 'crc') body[body.length - 8] ^= 1;
        if (scenario === 'missing') body = frame(ViewProgressReply.toBinary(ViewProgressReply.create()));
        const snapshot = body.slice();
        const out = await execute(
            'bilibili.chronos',
            {
                url: 'https://grpc.biliapi.net/bilibili.app.view.v1.View/ViewProgress',
                method: 'POST',
                headers: {},
            },
            { status: 200, headers: {}, body, h2_trailers: scenario === 'grpc' ? { 'grpc-status': '14' } : undefined },
            new Map(),
            undefined,
            scenario === 'disabled' ? '{"sponsorBlock":"#","sponsorBlockLegacy":"#"}' : '{}',
            { TextEncoder, TextDecoder }
        );
        assert.equal(Object.keys(out.result).length, 0, scenario);
        assert.deepEqual(body, snapshot, scenario);
        assert.equal(out.calls, 0, scenario);
    }
});

test('dedicated Chronos keeps upstream resource fallback and legacy-only enabling', async () => {
    for (const [ua, suffix] of [
        ['bili-inter', '8c3feda2e92bf60e8a7aeade1a231586'],
        ['bili-hd', 'e5a968f1a5055bbe5c12e67b100a6dcb'],
        ['other', '106d21a147f49e9d4ef86e2e8523474f'],
    ]) {
        const out = await execute(
            'bilibili.chronos',
            {
                url: 'https://grpc.biliapi.net/bilibili.app.view.v1.View/ViewProgress',
                method: 'POST',
                headers: { 'user-agent': ua },
            },
            {
                status: 200,
                headers: {},
                body: frame(
                    ViewProgressReply.toBinary(
                        ViewProgressReply.create({
                            chronos: { md5: 'unknown', file: 'original' },
                        })
                    )
                ),
            },
            new Map(),
            undefined,
            '{"sponsorBlock":"#","sponsorBlockLegacy":"bilibili.airborne"}',
            { TextEncoder, TextDecoder }
        );
        const decoded = ViewProgressReply.fromBinary(out.result.body.subarray(5));
        assert.equal(decoded.chronos?.md5, suffix);
    }
});

test('resource replacement can be bypassed without disabling the helper or changing response bytes/headers', async () => {
    for (const helper of ['sponsorBlock', 'sponsorBlockLegacy']) {
        const body = frame(
            ViewProgressReply.toBinary(ViewProgressReply.create({
                chronos: { md5: '3a14beddd23328eaddfe9f0eb048d713', file: 'original', sign: 'original' },
            })),
            true
        );
        const snapshot = body.slice();
        const headers = { 'content-type': 'application/grpc' };
        let decompressCalls = 0;
        const out = await execute(
            'bilibili.chronos',
            { headers: { te: 'trailers' } },
            { status: 200, headers, body },
            new Map(),
            undefined,
            JSON.stringify({ sponsorBlock: '#', sponsorBlockLegacy: '#', [helper]: 'enabled', chronosEnabled: '0', logLevel: 2 }),
            { TextEncoder, TextDecoder, $utils: { ungzip: () => { decompressCalls++; return null; } } }
        );
        assert.equal(Object.keys(out.result).length, 0);
        assert.deepEqual(body, snapshot);
        assert.deepEqual(headers, { 'content-type': 'application/grpc' });
        assert.equal(decompressCalls, 0);
        assert.equal(out.calls, 0);
        assert.ok(out.logs.some(line => line.includes('Resource replacement disabled')));
        assert.ok(!out.logs.some(line => line.includes('Replacement selected')));
    }
});

test('transport diagnostic retains the original resource while exercising the same frame/header rewrite', async () => {
    for (const [codec, route] of [[ViewProgressReply, 'view'], [UniteViewProgressReply, 'viewunite']] as const) {
        const original = codec.create({
            chronos: { md5: '3a14beddd23328eaddfe9f0eb048d713', file: 'https://original.example/resource.zip', sign: 'original-sign' },
        });
        UnknownFieldHandler.onRead(Chronos.typeName, original.chronos!, 100, 0, new Uint8Array([42]));
        const payload = codec.toBinary(original);
        for (const trailers of [undefined, { 'grpc-status': '0' }]) {
            const out = await execute(
                'bilibili.chronos',
                { url: `https://grpc.biliapi.net/bilibili.app.${route}.v1.View/ViewProgress`, headers: { te: 'trailers' } },
                { status: 200, headers: { 'content-type': 'application/grpc' }, h2_trailers: trailers, body: frame(payload, true) },
                new Map(),
                undefined,
                '{"sponsorBlock":"bilibili.sponsor","chronosEnabled":"2","logLevel":2}',
                { TextEncoder, TextDecoder, $utils: { ungzip: () => null } }
            );
            assert.equal(out.result.body[0], 0);
            assert.equal(new DataView(out.result.body.buffer).getUint32(1), out.result.body.length - 5);
            assert.deepEqual(codec.fromBinary(out.result.body.subarray(5)).chronos, original.chronos);
            assert.deepEqual(nonChronosBytes(out.result.body.subarray(5)), nonChronosBytes(payload));
            assert.equal(out.result.headers?.['grpc-status'], trailers ? undefined : '0');
            assert.equal(out.calls, 0);
            assert.ok(out.logs.some(line => line.includes('original resource retained')));
            assert.ok(!out.logs.some(line => line.includes('Replacement selected')));
        }
    }
});

test('Chronos module uses a dedicated WebView bundle without changing the ordinary JSC path', () => {
    const module = readFileSync(new URL('../release/surge/module/bilibili.sgmodule', import.meta.url), 'utf8');
    const lines = module.split('\n').filter(line => line.includes('.chronos = type=http-response'));
    assert.equal(lines.length, 2);
    for (const line of lines) {
        assert.ok(line.includes('engine=webview'));
        assert.ok(line.includes('dist/bilibili.chronos.js?v=9'));
        assert.ok(line.includes('"chronosEnabled":"{{{空降资源替换}}}"'));
        assert.ok(!line.includes('bilibili.protobuf.response.js'));
    }
    const ordinary = module.split('\n').find(line => line.startsWith('{{{资料净化}}} ='))!;
    assert.ok(ordinary.includes('engine=jsc'));
    assert.ok(ordinary.includes('dist/bilibili.protobuf.response.js?v=6'));
    const bundle = source('bilibili.chronos');
    assert.ok(!bundle.includes('bilibili.main.community.reply.v1.MainListReply'));
    assert.ok(!bundle.includes('bilibili.community.service.dm.v1.DanmakuElem'));
});

test('Protobuf diagnostics report processing errors without serializing the binary body', async () => {
    const out = await execute(
        'bilibili.protobuf.response',
        {
            url: 'https://grpc.biliapi.net/bilibili.app.show.v1.Popular/Index',
            method: 'POST',
            headers: {},
        },
        { status: 200, headers: {}, body: frame(new Uint8Array([0])) },
        new Map(),
        undefined,
        '{"logLevel":2}'
    );
    assert.equal(Object.keys(out.result).length, 0);
    assert.ok(out.logs.some(line => line.includes('[Protobuf] Failed')));
    assert.ok(out.logs.every(line => !line.includes('"body"')));
});

test('ordinary compressed RPCs bypass failed native gzip without invoking the JS fallback', async () => {
    for (const route of [
        'app.show.v1.Popular/Index',
        'app.dynamic.v2.Dynamic/DynAll',
        'main.community.reply.v1.Reply/MainList',
        'app.view.v1.View/View',
        'app.viewunite.v1.View/View',
        'app.playurl.v1.PlayURL/PlayView',
        'app.playerunite.v1.Player/PlayViewUnite',
    ]) {
        // Valid gzip holding invalid protobuf must be untouched: decoding it
        // via the fallback would fail, producing an error instead of a bypass.
        const body = frame(new Uint8Array([0]), true);
        const snapshot = body.slice();
        let nativeCalls = 0;
        const out = await execute(
            'bilibili.protobuf.response',
            {
                url: `https://grpc.biliapi.net/bilibili.${route}`,
                method: 'POST',
                headers: {},
            },
            { status: 200, headers: {}, body },
            new Map(),
            undefined,
            '{"logLevel":2}',
            {
                $utils: {
                    ungzip: (payload: Uint8Array) => {
                        nativeCalls++;
                        assert.equal(payload.byteOffset, 5, route);
                        return null;
                    },
                },
            }
        );
        assert.equal(nativeCalls, 1, route);
        assert.equal(Object.keys(out.result).length, 0, route);
        assert.deepEqual(body, snapshot, route);
        assert.equal(out.calls, 0, route);
        assert.ok(!out.logs.some(line => line.includes('[ERROR]')), route);
    }
});

test('ordinary compressed RPC purification remains available when native gzip succeeds', async () => {
    const value = MainListReply.create({
        topReplies: [{ content: { message: '保留中文🙂', urls: {} } }, { content: { message: '淘宝广告', urls: {} } }],
    });
    const out = await execute(
        'bilibili.protobuf.response',
        {
            url: 'https://grpc.biliapi.net/bilibili.main.community.reply.v1.Reply/MainList',
            method: 'POST',
            headers: {},
        },
        { status: 200, headers: {}, body: frame(MainListReply.toBinary(value), true) }
    );
    const decoded = MainListReply.fromBinary(out.result.body.subarray(5));
    assert.equal(decoded.topReplies.length, 1);
    assert.equal(decoded.topReplies[0].content?.message, '保留中文🙂');
});

test('corrupt gzip and oversized decoded bodies pass through before any segment lookup', async () => {
    for (const problem of ['crc', 'size', 'too-small', 'truncated']) {
        const store = new Map<string, string>();
        await prepare(store);
        let body = frame(originalReply().subarray(5), true);
        if (problem === 'crc') body[body.length - 8] ^= 1;
        if (problem === 'size') new DataView(body.buffer).setUint32(body.length - 4, 4 * 1024 * 1024 + 1, true);
        if (problem === 'too-small') new DataView(body.buffer).setUint32(body.length - 4, 1, true);
        if (problem === 'truncated') {
            body = body.slice(0, 10);
            new DataView(body.buffer).setUint32(1, body.length - 5);
        }
        const snapshot = body.slice();
        const out = await execute(
            'bilibili.sponsor.response',
            { id: 'request-1' },
            { status: 200, headers: {}, body },
            store,
            undefined,
            '{}',
            { $utils: { ungzip: () => null } }
        );
        assert.equal(out.calls, 0, problem);
        assert.equal(Object.keys(out.result).length, 0, problem);
        assert.deepEqual(body, snapshot, problem);
        assert.ok(
            out.logs.some(line => line.includes('Original response preserved')),
            problem
        );
    }
});

test('the reported video maps its large aid to the correct BV and injects the recorded sponsor in chunk two', async () => {
    // Public API snapshot taken during diagnosis; no live service dependency.
    const store = new Map<string, string>();
    const request = await execute(
        'bilibili.sponsor.request',
        {
            id: 'reported-video',
            body: frame(
                DmSegMobileReq.toBinary(
                    DmSegMobileReq.create({
                        pid: '117375802278173',
                        oid: '42421586533',
                        type: 1,
                        segmentIndex: '2',
                    })
                )
            ),
        },
        undefined,
        store,
        undefined,
        '{"logLevel":2}'
    );
    assert.match(request.logs[0], /BV14GHY6fExG cid=42421586533 chunk=2/);
    const output = await execute(
        'bilibili.sponsor.response',
        { id: 'reported-video' },
        { status: 200, headers: {}, body: originalReply() },
        store,
        (options, cb) => {
            assert.ok(String(options.url).includes('videoID=BV14GHY6fExG&cid=42421586533'));
            cb(
                null,
                { status: 200 },
                JSON.stringify([
                    {
                        UUID: 'reported-sponsor',
                        cid: '42421586533',
                        category: 'sponsor',
                        actionType: 'skip',
                        segment: [433.8, 501.098],
                    },
                ])
            );
        },
        '{"logLevel":2}'
    );
    const decoded = DmSegMobileReply.fromBinary(output.result.body.subarray(5));
    const marker = decoded.elems.find(item => item.content === '空指部已就位');
    assert.equal(marker?.progress, 433800);
    assert.equal(marker?.action, 'airborne:501098');
    assert.ok(output.logs.some(line => /Response matched/.test(line)));
    assert.ok(output.logs.some(line => /1 valid segments/.test(line)));
    assert.ok(output.logs.some(line => /Injecting 2 hints for chunk 2/.test(line)));
    assert.equal(request.calls, 0);
});

test('404 results are negatively cached; compressed frames work; later six-minute chunks do not duplicate hints', async () => {
    const store = new Map<string, string>();
    await prepare(store);
    const first = await execute(
        'bilibili.sponsor.response',
        { id: 'request-1' },
        { status: 200, headers: {}, body: originalReply() },
        store
    );
    assert.equal(first.calls, 1);
    await prepare(store, 'two');
    const second = await execute(
        'bilibili.sponsor.response',
        { id: 'two' },
        { status: 200, headers: {}, body: originalReply() },
        store
    );
    assert.equal(second.calls, 0);
    const other = new Map<string, string>();
    await prepare(other, 'chunk', '279786', '2');
    const body = frame(DmSegMobileReply.toBinary(DmSegMobileReply.create()), true);
    const out = await execute(
        'bilibili.sponsor.response',
        { id: 'chunk' },
        { status: 200, headers: {}, body },
        other,
        (_, cb) =>
            cb(
                null,
                { status: 200 },
                JSON.stringify([
                    { UUID: 'one', category: 'sponsor', actionType: 'skip', segment: [1, 5] },
                    { UUID: 'two', category: 'intro', actionType: 'skip', segment: [361, 370] },
                ])
            )
    );
    const decoded = DmSegMobileReply.fromBinary(out.result.body.subarray(5));
    assert.equal(decoded.elems.length, 1);
    assert.ok(decoded.elems[0].content.includes('开场动画'));
    assert.equal(decoded.elems[0].action, 'airborne:370000');
});

test('all 11 categories are configurable; invalid/CID-mismatched data cannot trigger a skip', () => {
    const settings = parseSettings(JSON.stringify({ minDuration: 3 }));
    const all = Object.keys(categories).map((category, i) => ({
        UUID: String(i),
        category,
        actionType: 'skip',
        segment: [5, 10],
    }));
    assert.equal(parseSegments(all, '1').length, 11);
    assert.equal(
        parseSegments(
            [
                { ...all[0], segment: [-1, 4] },
                { ...all[0], cid: '2' },
                { ...all[0], segment: [1, 1 / 0] },
            ],
            '1'
        ).length,
        0
    );
    assert.equal(segmentMode({ ...parseSegments(all, '1')[0], segment: [1, 2] }, settings), 'show');
    assert.equal(segmentMode({ ...parseSegments(all, '1')[0], actionType: 'mute' }, settings), 'show');
    assert.equal(segmentMode(parseSegments(all, '1')[0], parseSettings('{"sponsor":"off"}')), 'off');
    assert.throws(() => parseSettings('{"sponsor":"skipOnce"}'));
});

test('original popular and comment purification runs without URL/TextEncoder/TextDecoder', async () => {
    const popular = PopularReply.create({
        items: [
            {
                item: {
                    oneofKind: 'smallCoverV5',
                    smallCoverV5: { base: { fromType: 'recommend', adInfo: new Uint8Array() } },
                },
            },
            { item: { oneofKind: 'smallCoverV5Ad', smallCoverV5Ad: new Uint8Array([1]) } },
        ],
    });
    const output = await execute(
        'bilibili.protobuf.response',
        { url: 'https://grpc.biliapi.net/bilibili.app.show.v1.Popular/Index', method: 'POST', headers: {} },
        { status: 200, headers: {}, body: frame(PopularReply.toBinary(popular)) }
    );
    assert.equal(PopularReply.fromBinary(output.result.body.subarray(5)).items.length, 1);
    const comments = MainListReply.create({
        topReplies: [{ content: { message: '保留中文🙂', urls: {} } }, { content: { message: '淘宝广告', urls: {} } }],
    });
    const commentOutput = await execute(
        'bilibili.protobuf.response',
        {
            url: 'https://grpc.biliapi.net/bilibili.main.community.reply.v1.Reply/MainList',
            method: 'POST',
            headers: {},
        },
        { status: 200, headers: {}, body: frame(MainListReply.toBinary(comments)) }
    );
    assert.equal(
        MainListReply.fromBinary(commentOutput.result.body.subarray(5)).topReplies[0].content?.message,
        '保留中文🙂'
    );
    assert.equal(MainListReply.fromBinary(commentOutput.result.body.subarray(5)).topReplies.length, 1);
});

test('module defaults restore optional request handling; both helpers have independent switches and fork URLs', () => {
    const module = readFileSync(new URL('../release/surge/module/bilibili.sgmodule', import.meta.url), 'utf8');
    const argumentsLine = module.split('\n').find(line => line.startsWith('#!arguments='))!;
    assert.ok(argumentsLine.includes('优化评论区加载:#'));
    assert.ok(argumentsLine.includes('空降助手:bilibili.sponsor'));
    assert.ok(argumentsLine.includes('空降助手（旧）:#'));
    assert.ok(argumentsLine.includes('空降资源替换:1'));
    assert.ok(module.includes('{{{空降助手}}}.request'));
    assert.ok(module.includes('{{{空降助手}}}.response'));
    assert.ok(module.includes('{{{空降助手（旧）}}} = type=http-request'));
    assert.ok(module.includes('{{{资料净化}}} = type=http-response'));
    assert.ok(!module.includes('https://raw.githubusercontent.com/kokoryh/Sparkle/'));
    const names = new Set(
        argumentsLine
            .slice('#!arguments='.length)
            .split(',')
            .map(pair => pair.split(':')[0])
    );
    for (const variable of module.matchAll(/\{\{\{([^}]+)\}\}\}/g)) assert.ok(names.has(variable[1]), variable[1]);
});

test('legacy module leaves DmView untouched while retaining airborne and other purification routes', () => {
    const module = readFileSync(new URL('../release/surge/module/bilibili.sgmodule', import.meta.url), 'utf8');
    const defaults = Object.fromEntries(
        module
            .split('\n')
            .find(line => line.startsWith('#!arguments='))!
            .slice('#!arguments='.length)
            .split(',')
            .map(pair => [pair.slice(0, pair.indexOf(':')), pair.slice(pair.indexOf(':') + 1)])
    );
    const patternsFor = (overrides: Record<string, string> = {}) =>
        module
            .replace(/\{\{\{([^}]+)\}\}\}/g, (_, name) => overrides[name] ?? defaults[name])
            .split('\n')
            .filter(line => !line.startsWith('#') && line.includes('type=http-response'))
            .map(line => {
                const pattern = line.match(/pattern=([^,]+),/)!;
                return { name: line.slice(0, line.indexOf(' = ')), regex: new RegExp(pattern[1]) };
            });
    const patterns = patternsFor();
    for (const host of ['grpc.biliapi.net', 'app.bilibili.com']) {
        const matching = (route: string) =>
            patterns.filter(item => item.regex.test(`https://${host}/bilibili.${route}`));
        assert.equal(matching('community.service.dm.v1.DM/DmView').length, 0);
        assert.equal(matching('community.service.dm.v1.DM/DmSegMobile')[0]?.name, 'bilibili.sponsor.response');
        for (const route of ['app.view.v1.View/ViewProgress', 'app.viewunite.v1.View/ViewProgress']) {
            assert.equal(matching(route).length, 1);
            assert.equal(matching(route)[0].name, 'bilibili.sponsor.chronos');
            const url = `https://${host}/bilibili.${route}`;
            assert.equal(
                patternsFor({ 空降助手: '#', '空降助手（旧）': '#' }).filter(p => p.regex.test(url)).length,
                0
            );
            assert.equal(
                patternsFor({ 资料净化: '#' }).filter(p => p.regex.test(url))[0]?.name,
                'bilibili.sponsor.chronos'
            );
            assert.equal(
                patternsFor({ 空降助手: '#', '空降助手（旧）': 'bilibili.airborne' }).filter(p => p.regex.test(url))[0]
                    ?.name,
                'bilibili.airborne.chronos'
            );
        }
        for (const route of [
            'app.show.v1.Popular/Index',
            'app.dynamic.v2.Dynamic/DynAll',
            'main.community.reply.v1.Reply/MainList',
            'app.view.v1.View/View',
            'app.playurl.v1.PlayURL/PlayView',
        ]) {
            assert.equal(matching(route).length, 1, route);
            assert.equal(matching(route)[0].name, 'bilibili.protobuf.response', route);
        }
    }
});

test('overlapping automatic ranges seek beyond their union; manual highlights remain point jumps', async () => {
    const store = new Map<string, string>();
    await prepare(store);
    const output = await execute(
        'bilibili.sponsor.response',
        { id: 'request-1' },
        { status: 200, headers: {}, body: originalReply() },
        store,
        (_, cb) =>
            cb(
                null,
                { status: 200 },
                JSON.stringify([
                    { UUID: 'a', category: 'sponsor', actionType: 'skip', segment: [5, 15] },
                    { UUID: 'b', category: 'sponsor', actionType: 'skip', segment: [10, 20] },
                    { UUID: 'c', category: 'poi_highlight', actionType: 'poi', segment: [30, 30] },
                ])
            ),
        '{"poi_highlight":"manual"}'
    );
    const decoded = DmSegMobileReply.fromBinary(output.result.body.subarray(5));
    const firstAuto = decoded.elems.find(item => item.content === '空指部已就位' && item.progress === 5000);
    assert.equal(firstAuto?.action, 'airborne:20000');
    const highlight = decoded.elems.find(item => item.content.includes('精彩时刻'));
    assert.equal(highlight?.action, 'airborne:30000');
    assert.ok(highlight?.content.includes('点按跳转'));
});
