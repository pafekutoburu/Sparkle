// Mac/Node allocation proxy, not an iOS RAM or Surge engine measurement.
// node --expose-gc --import tsx tests/sponsor.bench.ts [published-bundle-path]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DmSegMobileReply } from '../src/proto/bilibili/community/service/dm/v1/dm';

assert.ok(global.gc, 'Run with --expose-gc');
const bundle = process.argv[2] || new URL('../dist/bilibili.sponsor.response.js', import.meta.url);
const script = new vm.Script(readFileSync(bundle, 'utf8'));
const payload = DmSegMobileReply.toBinary(
    DmSegMobileReply.create({
        elems: Array.from({ length: 10_000 }, (_, index) => ({
            id: String(index + 1),
            idStr: String(index + 1),
            progress: index,
            content: `原始弹幕🙂 original comment ${index}`,
            oid: '279786',
        })),
    })
);
const zipped = gzipSync(payload);
const body = new Uint8Array(zipped.length + 5);
body[0] = 1;
new DataView(body.buffer).setUint32(1, zipped.length);
body.set(zipped, 5);
const median = (numbers: number[]) => numbers.sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

for (const hasHints of [false, true]) {
    const samples: { heap: number; buffers: number; cpu: number; nativeAtWait: number }[] = [];
    for (let iteration = 0; iteration < 7; iteration++) {
        let callback: Function | undefined;
        let nativeCalls = 0;
        let finish!: (value: any) => void;
        const done = new Promise<any>(resolve => {
            finish = resolve;
        });
        const store = new Map([
            [
                'sparkle.sponsor.v1',
                JSON.stringify({
                    pending: { bench: { bvid: 'BV17x411w7KC', cid: '279786', index: 1, time: Date.now() } },
                    cache: {},
                }),
            ],
        ]);
        const context = vm.createContext({
            Uint8Array,
            DataView,
            BigInt,
            TextEncoder: undefined,
            TextDecoder: undefined,
            URL: undefined,
            $argument: '{"logLevel":5}',
            $request: { id: 'bench' },
            $response: { status: 200, headers: {}, body },
            $persistentStore: {
                read: (key: string) => store.get(key),
                write: (data: string, key: string) => store.set(key, data),
            },
            $httpClient: {
                get: (_: unknown, cb: Function) => {
                    callback = cb;
                },
            },
            $utils: {
                ungzip: (data: Uint8Array) => {
                    nativeCalls++;
                    return new Uint8Array(gunzipSync(data));
                },
            },
            console: { log() {} },
            $done: finish,
        });
        global.gc!();
        const before = process.memoryUsage();
        const started = performance.now();
        script.runInContext(context, { timeout: 5000 });
        const preQuery = performance.now() - started;
        assert.ok(callback, 'A query should be pending');
        global.gc!();
        const waiting = process.memoryUsage();
        const nativeAtWait = nativeCalls;
        const resumed = performance.now();
        callback(
            null,
            { status: hasHints ? 200 : 404 },
            hasHints ? JSON.stringify([{ category: 'sponsor', actionType: 'skip', segment: [5, 7] }]) : ''
        );
        const result = await done;
        const cpu = preQuery + performance.now() - resumed;
        if (hasHints) {
            const reply = DmSegMobileReply.fromBinary(result.body.subarray(5));
            assert.equal(reply.elems.length, 10_002);
        } else assert.deepEqual(Object.keys(result), []);
        // Discard the first run's initialization noise.
        if (iteration)
            samples.push({
                heap: waiting.heapUsed - before.heapUsed,
                buffers: waiting.arrayBuffers - before.arrayBuffers,
                cpu,
                nativeAtWait,
            });
    }
    console.log(
        JSON.stringify({
            bundle: String(bundle),
            scenario: hasHints ? 'two-hints' : 'no-hints',
            entries: 10_000,
            decodedBytes: payload.length,
            compressedBytes: zipped.length,
            medianRetainedHeapAtQueryBytes: median(samples.map(s => s.heap)),
            medianRetainedArrayBuffersAtQueryBytes: median(samples.map(s => s.buffers)),
            medianScriptMsExcludingQueryAndMeasurement: Number(median(samples.map(s => s.cpu)).toFixed(2)),
            nativeUngzipCallsBeforeQuery: median(samples.map(s => s.nativeAtWait)),
        })
    );
}
