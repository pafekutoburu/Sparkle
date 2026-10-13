# Third-party notices

This fork retains Sparkle's GPL-3.0 license in `LICENSE`.

1. **Sparkle**, by kokoryh: https://github.com/kokoryh/Sparkle, base commit `290bcbdd2f158cdd8f7db9c996e90fe63490e16f`. Existing purification and the legacy SponsorBlock implementation remain derived from this project. Modified files and generated bundles are recorded in Git history.
2. **PiliPlus**, by its contributors: https://github.com/bggRGjQaUbCoE/PiliPlus, inspected commit `bd5e04e5de5a523e85a8eeba30da748dcd68925a`, GPL-3.0. Category identifiers, labels, colours and minimum-duration behaviour in `src/script/bilibili/sponsor/policy.ts` are adapted from `lib/models/common/sponsor_block/segment_type.dart`, `segment_model.dart` and `lib/pages/sponsor_block/block_mixin.dart`. The new implementation is TypeScript; Flutter widgets and the player controller were not copied.
3. **@protobufjs/utf8 1.1.2**, Copyright (c) 2016, Daniel Wirtz, BSD-3-Clause. Its full notice is reproduced in `licenses/protobufjs-utf8.txt`; the bundled codec is used for JSC compatibility.
4. **@protobuf-ts/runtime**, MIT, provided through the upstream dependency graph; generated message codecs retain the runtime's unknown-field handling. Its full notice is reproduced in `licenses/protobuf-ts-runtime.txt`.
5. **fflate 0.8.3**, Copyright (c) 2026 Arjun Barrett, MIT. The existing dependency provides bounded gzip fallback decoding; its full notice is reproduced in `licenses/fflate.txt`. It is not used for UTF-8 conversion.

The pre-existing module still references external `kokoryh/Script` skin code and `kokoryh/chronos` player archives. This fork does not assert ownership of those resources or guarantee their compatibility with every app/player version.
