const MAX_OUTPUT = 4 * 1024 * 1024;

export function ungzip(data: Uint8Array): Uint8Array {
    if (data.length < 18 || data[0] !== 0x1f || data[1] !== 0x8b || data[2] !== 8)
        throw new Error('Invalid gzip payload');
    const trailer = new DataView(data.buffer, data.byteOffset + data.length - 8, 8);
    const expectedSize = trailer.getUint32(4, true);
    if (expectedSize > MAX_OUTPUT) throw new Error('Gzip output exceeds 4 MiB');

    // Pass an independent buffer: a gRPC payload is normally a subarray with a
    // five-byte offset. Native bridges must not see the enclosing frame bytes.
    let decoded: Uint8Array | null = null;
    try {
        decoded = $utils.ungzip(data.slice());
    } catch {
        // Native decompression can fail; the portable decoder remains bounded.
    }
    if (!(decoded instanceof Uint8Array)) {
        // esbuild bundles this local module into a lazy initializer. Do not
        // initialize fflate's tables on uncompressed or native-success paths.
        const { gunzipSync } = require('./gzip-fallback') as typeof import('./gzip-fallback');
        // One extra byte makes a forged too-small ISIZE detectable instead of
        // allowing fflate's fixed output buffer to silently truncate the data.
        decoded = gunzipSync(data, { out: new Uint8Array(expectedSize + 1) });
    }
    if (decoded.length !== expectedSize) throw new Error('Gzip output size mismatch');

    // fflate does not validate the gzip trailer CRC. Keep malformed input on
    // the pass-through path even when the native decoder has rejected it.
    let crc = 0xffffffff;
    for (const byte of decoded) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== trailer.getUint32(0, true)) throw new Error('Gzip checksum mismatch');
    return decoded;
}
