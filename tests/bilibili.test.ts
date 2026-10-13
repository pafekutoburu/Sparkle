import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { gunzipSync, gzipSync } from 'node:zlib';
import { UnknownFieldHandler } from '@protobuf-ts/runtime';
import { DmSegMobileReq, DmSegMobileReply } from '../src/proto/bilibili/community/service/dm/v1/dm';
import { MainListReply } from '../src/proto/bilibili/main/community/reply/v1/reply';
import { PopularReply } from '../src/proto/bilibili/app/show/popular/v1/popular';
import { ViewReply, ViewProgressReply, RelatesFeedReply } from '../src/proto/bilibili/app/view/v1/view';
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
            console: { log() {} },
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
    return { result, calls, store };
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
