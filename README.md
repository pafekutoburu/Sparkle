# Sparkle — legacy Bilibili compatibility fork

This GPL-3.0 fork of [kokoryh/Sparkle](https://github.com/kokoryh/Sparkle) targets selective loading delays in the white-icon iOS Bilibili international app v3.20.1 with Surge. The fork adds a SponsorBlock integration informed by [PiliPlus](https://github.com/bggRGjQaUbCoE/PiliPlus). Device behaviour has not yet been verified on an iPhone; local integration tests are not a substitute for that check.

## Install in Surge

Module: [bilibili.sgmodule](https://raw.githubusercontent.com/pafekutoburu/Sparkle/refs/heads/master/release/surge/module/bilibili.sgmodule)

Use Surge iOS 5.9.0 or later for the JSC engine. Disable the original Bilibili module before enabling this fork. Keep MITM and its trusted certificate enabled. Start with the supplied defaults; `优化评论区加载` is disabled (`#`), `资料净化` and the new `空降助手` are enabled, and `空降助手（旧）` is disabled. The two helpers are alternatives: if both are enabled, the first matching request script is the new helper.

The new helper depends on `资料净化` replacing the Chronos player resource, and on visible danmaku. It adds category-coloured timestamp hints and reuses that resource's existing automatic seek, clickable seek, and undo behaviour. This does not guarantee skipping when danmaku is turned off or hidden. The first uncached lookup can add up to the configured 1.5-second HTTP timeout; later chunks reuse the per-video/CID cache.

## Compatibility changes

- Restore the optional request-optimization switch, disabled by default. Ordinary video-detail/comment requests stay with the app instead of being fetched again by a script.
- Keep existing Protobuf purification, using JSC with a portable UTF-8 codec instead of requiring WebView's URL/TextEncoder/TextDecoder APIs on this path. Response bodies above 1 MiB bypass scripting rather than allocating an unbounded body in the network extension.
- Add a separate `资料净化` switch for isolating the remaining Protobuf processing if device latency persists. Switching it off also turns off the Chronos replacement required for automatic/clickable skipping; JSON processing and static rules remain available.
- Preserve the previous helper under `空降助手（旧）`. Its sponsor-only filtering, eight-second minimum and request-replay implementation remain available.
- New helper records request metadata without a network call, lets Bilibili complete its own danmaku request, then queries only the third-party segment API. It caches successes for five minutes, missing data for one minute, caps its cache, validates CID/timestamps, and preserves the original response on missing metadata, malformed data or service errors.
- The Surge module's Sparkle script URLs point to this fork. Existing third-party skin and Chronos resources remain upstream dependencies.

## New helper settings

All eleven PiliPlus category names and colours are supported: sponsor, selfpromo, exclusive_access, interaction, poi_highlight, intro, outro, preview, padding, filler and music_offtopic. Each has `auto` (automatic skip), `manual` (clickable skip), `show` (hint only) and `off` settings. The default automatically skips sponsor segments and leaves other skip categories manual; full-video labels and highlights default to hints. `最短片段时长` is measured in seconds; shorter ranges are displayed without skipping.

Point highlights can be set to `manual` for a clickable jump. `mute` and `full` actions are displayed only; they are not silently converted to skips. Overlapping automatic ranges seek to the end of their union. The server defaults to PiliPlus's `https://www.bsbsb.top`, and `空降助手策略` names an existing Surge policy for the lookup. No votes, viewed counters, submissions or other service writes are sent.

## Explicitly not ported

PiliPlus's Flutter player UI, coloured native progress bar, once-per-playback skipping, native skip controls independent of danmaku, volume muting, voting/category changes, segment submission, user statistics/identity management, tracking uploads, offline integration and YouTube port-video binding are not implemented. The module provides the agreed category/hint/skip subset, not the complete PiliPlus feature set.

## Build and verify

```bash
npm install
npm run generate
npm run check
npm run build
npm test
```

The tests execute the published bundles in a mocked Surge environment with URL/TextEncoder/TextDecoder absent. They cover native request pass-through, response preservation on errors, original comments/unknown protobuf fields, emoji, caching, category policies, compressed frames, chunk isolation, overlapping ranges and module defaults. They do not exercise the proprietary iOS player or live third-party API.

## Upstream synchronization

This fork starts at Sparkle `290bcbdd2f158cdd8f7db9c996e90fe63490e16f`. Fetch and review upstream changes before merging; publishing generated bundles is part of a source change. Do not replace fork script URLs with moving upstream URLs during synchronization. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and licensing.
