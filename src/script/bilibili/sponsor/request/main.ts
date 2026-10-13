import * as Surge from '@/types/surge';
import { DmSegMobileReq } from '@proto/bilibili/community/service/dm/v1/dm';
import { protobufReadOptions } from '@/utils/protobuf';
import { toBvid } from '@/utils/bilibili';
import { readStore, writeStore, unpackFrame, log } from '../shared';

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
            log(
                2,
                `Request metadata recorded: ${store.pending[request.id].bvid} cid=${message.oid} chunk=${message.segmentIndex}`
            );
        } else {
            log(
                4,
                `Unsupported request metadata: type=${message.type} pid=${message.pid} cid=${message.oid} chunk=${message.segmentIndex}`
            );
        }
    } else {
        log(4, 'Request ID unavailable; cannot correlate the response.');
    }
} catch (error) {
    log(4, `Request metadata skipped: ${error}`);
} finally {
    // Only record correlation metadata. The original request continues normally.
    $done({});
}
