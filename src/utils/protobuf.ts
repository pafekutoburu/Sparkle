import { BinaryReader, BinaryWriter, BinaryReadOptions, BinaryWriteOptions } from '@protobuf-ts/runtime';
import utf8 from '@protobufjs/utf8';

function encode(text = ''): Uint8Array {
    const bytes = new Uint8Array(utf8.length(text));
    utf8.write(text, bytes, 0);
    return bytes;
}

function decode(bytes = new Uint8Array()): string {
    const text = utf8.read(bytes, 0, bytes.length);
    const encoded = encode(text);
    // Match the original fatal UTF-8 decoder: malformed text must cause the
    // script to pass through the original response, not silently rewrite it.
    if (encoded.length !== bytes.length || encoded.some((value, index) => value !== bytes[index])) {
        throw new Error('Invalid UTF-8 in protobuf string');
    }
    return text;
}

// Surge JSC has no WebView TextEncoder/TextDecoder globals. Keep the protobuf
// runtime's unknown-field handling while supplying portable UTF-8 codecs.
export const protobufReadOptions: Partial<BinaryReadOptions> = {
    readerFactory: bytes => new BinaryReader(bytes, { decode }),
};

export const protobufWriteOptions: Partial<BinaryWriteOptions> = {
    writerFactory: () => new BinaryWriter({ encode }),
};
