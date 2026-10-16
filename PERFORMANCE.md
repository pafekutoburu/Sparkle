# Version 11 performance evidence

The user reported recurring Surge memory warnings on 2026-10-16 after several days of use. This supersedes the earlier short observation that warnings had stopped. The latest exact script name and iPhone process memory measurements were not supplied; these changes address verified allocation costs without claiming a confirmed cause for every warning.

## Changes

- Preserve original danmaku as opaque wire bytes and encode only added hints. No object/string decoding or re-encoding of the full reply.
- Check policies and chunk hints before decompression. Queries retain no decompressed danmaku buffer or full reply object. Empty/negative cache results and chunks without hints return the untouched response.
- Cap persistent JSON at 65,536 characters (up to 128 KiB of UTF-16 string data, excluding objects/engine overhead), in addition to 64 pending requests and 32 cache entries. Evict oldest cache entries first. Oversized/corrupt old stores reset; hints may be skipped for an in-flight response during that reset.
- Reject segment-service strings above 131,072 characters before JSON parsing, cap results at 500 segments and reject IDs longer than 128 characters. This does not prevent the HTTP client from buffering its received response before the callback.
- Limit every response script's Surge body buffer to 1 MiB. Check gRPC framing and gzip's advertised inflated size before native decompression; use a 1 MiB decoded-payload budget. Oversized bodies retain normal playback but may bypass purification or hints. Advertised sizes are not a guarantee against every malformed compressed stream or a cap on whole-process RAM.
- Validate gzip CRC using a lazily allocated 1 KiB lookup table instead of eight bit operations for every decoded byte.
- Keep Chronos in WebView with the original compression/completion behaviour. Use fflate `mem: 0`, retain contiguous unchanged fields in one view and skip recompression when the replacement resource already matches. Keep the existing player package and skip/undo protocol.
- Keep ordinary protobuf and the new helper in JSC to avoid changing the previously verified engine/latency behaviour at the same time. Native gzip failure still passes ordinary RPCs through without portable fallback.

Surge documents the [memory and process tradeoffs](https://manual.nssurge.com/scripting/overview.html) and [response buffering limits](https://manual.nssurge.com/scripting/http-response.html). Compression uses the already pinned fflate dependency; its installed types and implementation document `mem` and the compression hash workspace. No new dependency was added.

## Mac/Node comparison (2026-10-16)

Node v22.23.2; published response bundle from `a7eb32b` versus the version 11 source build. Each scenario uses 10,000 original comments, 587,527 decoded bytes and 87,309 gzip bytes. Seven isolated VM contexts per scenario, discard the first, report medians. The benchmark forces GC while the segment query is pending. Input buffers are allocated before measurement. Compile time, query wait and the deliberate measurement/GC pause are excluded from the script duration.

- Baseline, no hints: retained JS heap at query 3,606,688 bytes; script duration 64.89 ms; one native decompression before the query.
- Version 11, no hints: retained JS heap at query 79,864 bytes; script duration 0.81 ms; no decompression before the query.
- Baseline, two hints: retained JS heap at query 3,613,792 bytes; script duration 141.48 ms; one native decompression before the query.
- Version 11, two hints: retained JS heap at query 88,440 bytes; script duration 10.98 ms; no decompression before the query. Original comments and two appended hints are decoded after timing to verify correctness.

These are allocation/retention proxies on Mac V8, not peak memory measurements, iPhone RAM savings, Surge JSC/WebView timings or proof that a long-running engine cannot warn. Bundle size also does not measure runtime RAM.

Run the same comparison after rebuilding (save the baseline before changing the bundle):

```bash
node --expose-gc --import tsx tests/sponsor.bench.ts /path/to/baseline-response.js
node --expose-gc --import tsx tests/sponsor.bench.ts
```

The integration suite also covers compressed/uncompressed wire preservation, 10,000 comments, query-time/no-hint decompression avoidance, 40 videos of cache growth, oversized old stores, corrupt gzip, decoded-size checks, original Chronos fields, automatic/manual markers and category policies. The iPhone player and multi-day warning rate require device observation; the current acceptance checklist lives in the parent project's PROGRESS.md.
