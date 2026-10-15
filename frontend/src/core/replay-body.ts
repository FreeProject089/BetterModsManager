// Reads a .bmmreplay response body, plain JSON or gzip.
//
// Long recordings are stored gzipped under their .bmmreplay name (tools/release/shrink-replays.mjs
// compresses the ones still over the docs budget once their images and pointer noise are gone),
// and the server sends them as plain bytes, not with Content-Encoding: gzip. So the body is
// sniffed: the gzip magic (1f 8b) is inflated with DecompressionStream, anything else is JSON.
// The BMM Docs player (docs/assets/rrweb/bmm-replay.js) reads both forms the same way.

export async function readReplayBody(res: Response): Promise<any> {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}
