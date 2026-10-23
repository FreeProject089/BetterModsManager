/**
 * The canvas component of the Creator key v5 fingerprint.
 *
 * Renders a fixed 2D-canvas scene and a fixed WebGL scene and hashes the pixels. The result
 * depends on the GPU, its driver, the font rasteriser and the OS, not on anything the user
 * typed, and it survives a wiped key store — which is the one thing it is for: telling staff
 * that a "new" Creator ID renders exactly like a banned one. The design, and what this costs in
 * privacy terms, is written at the top of src-tauri/src/commands/creator_v5.rs.
 *
 * What leaves this function is a SHA-256 digest, never pixels. Rust accepts nothing else
 * (`creator_v5::is_digest`) and re-hashes it with a per-server salt before it goes anywhere,
 * so no server ever sees this value either — only a salted hash of it.
 *
 * Computed once per session: the scene is fixed, so a second render would give the same answer
 * at the same cost. Returns '' when the webview can render neither scene (no canvas, WebGL
 * blocked, a hidden window that refuses to paint): the component is then simply absent.
 */

import { invoke } from './api.js';

let cached: Promise<string> | null = null;

async function sha256Hex(data: Uint8Array | string): Promise<string> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const d = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fixed 2D scene: text in two fonts, an emoji, a gradient, a blended arc. */
function render2d(): string {
    const c = document.createElement('canvas');
    c.width = 280; c.height = 60;
    const g = c.getContext('2d');
    if (!g) return '';
    g.textBaseline = 'top';
    g.fillStyle = '#f60';
    g.fillRect(100, 1, 62, 20);
    g.fillStyle = '#069';
    g.font = '15px Arial';
    g.fillText('BMM v5 éß中 \u{1F9E9}', 2, 15);
    g.fillStyle = 'rgba(102, 204, 0, 0.7)';
    g.font = '17px "Times New Roman"';
    g.fillText('Creator key', 4, 34);
    const grad = g.createLinearGradient(0, 0, 280, 0);
    grad.addColorStop(0, '#123456');
    grad.addColorStop(1, '#fedcba');
    g.fillStyle = grad;
    g.globalCompositeOperation = 'multiply';
    g.beginPath();
    g.arc(230, 30, 22, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL('image/png');
}

/** A fixed WebGL scene: one shaded triangle, read back as pixels, plus the renderer string. */
function renderGl(): Uint8Array | null {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: true }) as WebGLRenderingContext | null;
    if (!gl) return null;
    const sh = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src); gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}');
    const fs = sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;void main(){gl_FragColor=vec4(sin(v.x*7.1),cos(v.y*5.3),v.x*v.y,1.);}');
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return null;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.9, -0.8, 0.85, -0.6, 0.1, 0.95]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0.1, 0.2, 0.3, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // The renderer name is folded INTO the hash, never returned: on its own it names a GPU model.
    let renderer = '';
    try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch { /* not exposed */ }
    const tail = new TextEncoder().encode(`|${renderer}`);
    const out = new Uint8Array(px.length + tail.length);
    out.set(px); out.set(tail, px.length);
    return out;
}

/** The 64-hex canvas digest, or '' when nothing could be rendered. */
export function canvasDigest(): Promise<string> {
    if (!cached) {
        cached = (async () => {
            let a = '';
            let b: Uint8Array | null = null;
            try { a = render2d(); } catch { a = ''; }
            try { b = renderGl(); } catch { b = null; }
            if (!a && !b) return '';
            const h2d = a ? await sha256Hex(a) : '';
            const hgl = b ? await sha256Hex(b) : '';
            return sha256Hex(`bmm-canvas-v1|${h2d}|${hgl}`);
        })().catch(() => '');
    }
    return cached;
}

/**
 * A creator proof for `aud`: v5 when this build has it, v1 otherwise, '' when neither works.
 *
 * Every caller that attaches a proof goes through here, so "prefer v5, fall back to v1" is
 * written once. v1 stays for servers that predate v5; a BetterCommunity that has already seen
 * this id's v5 chain refuses v1 for it, which is the point.
 */
export async function creatorProofFor(aud: string): Promise<string> {
    try {
        const canvas = await canvasDigest();
        const p = await invoke('creator_proof_v5', { aud, canvas: canvas || null }, { quiet: true });
        if (typeof p === 'string' && p) return p;
    } catch { /* an older native side: fall through to v1 */ }
    try {
        const p = await invoke('creator_proof', { aud }, { quiet: true });
        return typeof p === 'string' ? p : '';
    } catch { return ''; }
}
