import * as Surge from '@/types/surge';
import { DmSegMobileReq } from '@proto/bilibili/community/service/dm/v1/dm';
import { protobufReadOptions } from '@/utils/protobuf';
import { toBvid } from '@/utils/bilibili';
import { readStore, writeStore, unpackFrame } from '../shared';

const request = $request as Surge.HttpRequest;

try {
    if (request.id) {
        const message = DmSegMobileReq.fromBinary(unpackFrame(request.body as Uint8Array), protobufReadOptions);
        if (
            message.type === 1 &&
            BigInt(message.pid) > 0n &&
            BigInt(message.oid) > 0n &&
            BigInt(message.segmentIndex) > 0n
        ) {
            const store = readStore();
            store.pending[request.id] = {
                bvid: toBvid(message.pid),
                cid: message.oid,
                index: Number(message.segmentIndex),
                time: Date.now(),
            };
            writeStore(store);
        }
    }
} catch (error) {
    console.log(`[SponsorBlock] Request metadata skipped: ${error}`);
} finally {
    // Only record correlation metadata. The original request continues normally.
    $done({});
}
