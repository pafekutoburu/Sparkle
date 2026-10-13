import { gzipSync } from 'fflate';

// Loaded only when a compressed ViewProgress frame needs rewriting. Keep the
// same gRPC gzip encoding without initializing compression on bypass paths.
export function gzip(data: Uint8Array): Uint8Array {
    return gzipSync(data, { level: 1, mtime: 0 });
}
