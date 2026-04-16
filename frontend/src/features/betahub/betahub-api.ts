/**
 * betahub-api.ts — BetaHub API Client
 * Handles all communication with the BetaHub REST API.
 * Project ID: pr-7482453116
 *
 * File Upload Strategy: Presigned URL flow (3 steps) for all binary media.
 * Ensures correct content-type metadata and public CDN access.
 *
 * Step 1: POST /presigned_upload → get direct_upload_url + blob_signed_id
 * Step 2: PUT direct_upload_url  → upload raw bytes with returned headers
 * Step 3: POST /confirm_upload   → finalize attachment
 */

import { BETAHUB_PROJECT_ID, BETAHUB_TOKEN } from './betahub-config.local.js';

const BASE_URL = 'https://app.betahub.io';
const PROJECT_ID = BETAHUB_PROJECT_ID;
const TOKEN = BETAHUB_TOKEN;

// =============================================================================
// Auth header builder
// =============================================================================

function getAuthHeader(email?: string, discordId?: string): string {
    if (email && email.trim()) {
        return `FormUser ${TOKEN},email:${email.trim()}`;
    }
    if (discordId && /^\d+$/.test(discordId.trim())) {
        return `FormUser ${TOKEN},discord_id:${discordId.trim()}`;
    }
    return `FormUser ${TOKEN}`;
}

// =============================================================================
// Pure-JS MD5 (needed for S3 presigned URL Content-MD5 validation)
// Based on RFC 1321 — no external dependencies
// =============================================================================

function md5Uint8(input: Uint8Array): Uint8Array {
    // RFC 1321 MD5 implementation
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];
    const K: number[] = [];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;

    const origLen = input.length;
    // Pad message: append 0x80, then zeros, then 64-bit length
    const paddedLen = ((origLen + 9 + 63) & ~63);
    const padded = new Uint8Array(paddedLen);
    padded.set(input);
    padded[origLen] = 0x80;
    const bitLen = origLen * 8;
    new DataView(padded.buffer).setUint32(paddedLen - 8, bitLen >>> 0, true);
    new DataView(padded.buffer).setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

    const view = new DataView(padded.buffer);
    for (let i = 0; i < paddedLen; i += 64) {
        const M: number[] = [];
        for (let j = 0; j < 16; j++) M[j] = view.getUint32(i + j * 4, true);

        let A = a0, B = b0, C = c0, D = d0;
        for (let j = 0; j < 64; j++) {
            let F: number, g: number;
            if (j < 16) {       F = (B & C) | (~B & D); g = j; }
            else if (j < 32) {  F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
            else if (j < 48) {  F = B ^ C ^ D;           g = (3 * j + 5) % 16; }
            else {               F = C ^ (B | ~D);        g = (7 * j) % 16; }
            F = (F + A + K[j] + M[g]) >>> 0;
            A = D; D = C; C = B;
            B = (B + ((F << S[j]) | (F >>> (32 - S[j])))) >>> 0;
        }
        a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }

    const result = new Uint8Array(16);
    const rv = new DataView(result.buffer);
    rv.setUint32(0, a0, true); rv.setUint32(4, b0, true);
    rv.setUint32(8, c0, true); rv.setUint32(12, d0, true);
    return result;
}

async function computeMd5Base64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hash = md5Uint8(new Uint8Array(buffer));
    return btoa(String.fromCharCode(...hash));
}

// =============================================================================
// MIME type detection with BetaHub-allowed types
// =============================================================================

const SCREENSHOT_ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const VIDEO_ALLOWED_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/avi', 'video/mov']);

function getMimeType(file: File): string {
    if (file.type && file.type !== 'application/octet-stream') return file.type;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
        png:  'image/png',
        jpg:  'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/png',   // webp not supported by BetaHub, map to png as fallback
        gif:  'image/png',
        mp4:  'video/mp4',
        webm: 'video/webm',
        mov:  'video/quicktime',
        avi:  'video/avi',
        zip:  'application/zip',
        txt:  'text/plain',
        log:  'text/plain',
    };
    return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Normalizes a file's MIME type for screenshot uploads.
 * BetaHub only accepts image/png, image/jpeg, image/jpg.
 */
function normalizeScreenshotType(file: File): string {
    const mime = getMimeType(file);
    if (SCREENSHOT_ALLOWED_TYPES.has(mime)) return mime;
    // Fallback: send as PNG (most common lossless)
    return 'image/png';
}

// =============================================================================
// Presigned Upload Core
// =============================================================================

interface PresignedUploadResponse {
    blob_signed_id: string;
    direct_upload_url: string;
    headers: Record<string, string>;
    blob_id: number;
}

async function getPresignedUrl(
    resourceType: 'issues' | 'feature_requests',
    id: string,
    jwtToken: string,
    endpoint: string,
    file: File,
    contentType: string,
    name?: string
): Promise<PresignedUploadResponse> {
    const checksum = await computeMd5Base64(file);

    const body: Record<string, unknown> = {
        filename: file.name,
        byte_size: file.size,
        checksum,
        content_type: contentType,
    };
    if (name) body['name'] = name;

    // Use g- prefix for issues as per BetaHub docs, standard ID for others unless specified
    const urlId = resourceType === 'issues' ? `g-${id}` : id;

    const res = await fetch(
        `${BASE_URL}/projects/${PROJECT_ID}/${resourceType}/${urlId}/${endpoint}/presigned_upload`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'BetaHub-Project-ID': PROJECT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({ errors: [res.statusText] }));
        throw new Error(`Presigned URL failed (${endpoint}): ${JSON.stringify(err.errors || err.error || err)}`);
    }

    return res.json();
}

async function directUpload(
    directUploadUrl: string,
    headers: Record<string, string>,
    file: File,
    contentType: string
): Promise<void> {
    // Build headers: use ALL headers returned by BetaHub (includes Content-MD5)
    // then override Content-Type to match exactly what we sent during presigned request
    const uploadHeaders: Record<string, string> = {
        'Content-Type': contentType,
        ...headers,
    };

    const res = await fetch(directUploadUrl, {
        method: 'PUT',
        headers: uploadHeaders,
        body: file,
    });

    if (!res.ok) {
        throw new Error(`Direct upload to CDN failed: HTTP ${res.status}`);
    }
}

async function confirmUpload(
    resourceType: 'issues' | 'feature_requests',
    id: string,
    jwtToken: string,
    endpoint: string,
    blobSignedId: string,
    name?: string
): Promise<void> {
    const body: Record<string, string> = { blob_signed_id: blobSignedId };
    if (name) body['name'] = name;

    const urlId = resourceType === 'issues' ? `g-${id}` : id;

    const res = await fetch(
        `${BASE_URL}/projects/${PROJECT_ID}/${resourceType}/${urlId}/${endpoint}/confirm_upload`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'BetaHub-Project-ID': PROJECT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({ errors: [res.statusText] }));
        throw new Error(`Confirm upload failed (${endpoint}): ${JSON.stringify(err.errors || err.error || err)}`);
    }
}

export async function uploadViaPresignedUrl(
    resourceType: 'issues' | 'feature_requests',
    id: string,
    jwtToken: string,
    endpoint: string,
    file: File,
    contentType: string,
    name?: string
): Promise<void> {
    const { blob_signed_id, direct_upload_url, headers } = await getPresignedUrl(
        resourceType, id, jwtToken, endpoint, file, contentType, name
    );
    await directUpload(direct_upload_url, headers, file, contentType);
    await confirmUpload(resourceType, id, jwtToken, endpoint, blob_signed_id, name);
}

// =============================================================================
// Issue (Bug Report) — Draft Flow
// =============================================================================

export interface CreateIssueResult {
    id: string;
    token: string;
}

export async function createDraftIssue(
    description: string,
    title?: string,
    stepsToReproduce?: string,
    email?: string,
    discordId?: string,
    dueDate?: string
): Promise<CreateIssueResult> {
    const form = new FormData();
    form.append('issue[description]', description);
    form.append('draft', 'true');
    form.append('issue[source]', 'bmm-app');
    if (dueDate) form.append('issue[due_date]', dueDate);
    if (title && title.trim()) form.append('issue[title]', title.trim());
    if (stepsToReproduce && stepsToReproduce.trim()) {
        form.append('issue[unformatted_steps_to_reproduce]', stepsToReproduce.trim());
    }

    const res = await fetch(`${BASE_URL}/projects/${PROJECT_ID}/issues.json`, {
        method: 'POST',
        headers: {
            'Authorization': getAuthHeader(email, discordId),
            'BetaHub-Project-ID': PROJECT_ID,
        },
        body: form,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return { id: data.id, token: data.token };
}

/**
 * Upload a screenshot using the presigned URL flow.
 * Only png/jpeg/jpg are accepted by BetaHub — webp/gif are normalized to png.
 */
export async function uploadScreenshot(
    issueId: string,
    jwtToken: string,
    file: File
): Promise<void> {
    const safeName = file.name.replace(/\.[^/.]+$/, (ext) => ext.toLowerCase());
    const contentType = normalizeScreenshotType(file);
    // Re-create the file with the normalized MIME type so headers match
    const safeFile = new File([file], safeName, { type: contentType });
    await uploadViaPresignedUrl('issues', issueId, jwtToken, 'screenshots', safeFile, contentType, safeName);
}

/**
 * Upload a video clip using the presigned URL flow.
 */
export async function uploadVideoClip(
    issueId: string,
    jwtToken: string,
    file: File
): Promise<void> {
    const safeName = file.name.replace(/\.[^/.]+$/, (ext) => ext.toLowerCase());
    const contentType = getMimeType(file);
    if (!VIDEO_ALLOWED_TYPES.has(contentType)) {
        throw new Error(`Unsupported video format: ${contentType}. Use MP4, WebM, or MOV.`);
    }
    const safeFile = new File([file], safeName, { type: contentType });
    await uploadViaPresignedUrl('issues', issueId, jwtToken, 'video_clips', safeFile, contentType, safeName);
}

/**
 * Upload log content as plain text (uses simple multipart — no presigned needed).
 */
export async function uploadLogContents(
    issueId: string,
    jwtToken: string,
    contents: string,
    name: string = 'bmm_log.txt'
): Promise<void> {
    const form = new FormData();
    form.append('log_file[contents]', contents);
    form.append('log_file[name]', name);

    const res = await fetch(
        `${BASE_URL}/projects/${PROJECT_ID}/issues/g-${issueId}/log_files`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'BetaHub-Project-ID': PROJECT_ID,
            },
            body: form,
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Log upload failed: ${err.error || res.status}`);
    }
}

/**
 * Upload a binary file (crash zip, etc.) using the presigned URL flow.
 */
export async function uploadBinaryFile(
    issueId: string,
    jwtToken: string,
    file: File
): Promise<void> {
    const contentType = getMimeType(file);
    await uploadViaPresignedUrl('issues', issueId, jwtToken, 'binary_files', file, contentType, file.name);
}

/**
 * Set contact info for the reporter.
 */
export async function setContactInfo(
    issueId: string,
    jwtToken: string,
    email?: string,
    discordId?: string
): Promise<void> {
    if (!email && !discordId) return;

    const body: Record<string, string> = {};
    if (email && email.trim()) body['email'] = email.trim();
    if (discordId && /^\d+$/.test(discordId.trim())) body['discord_id'] = discordId.trim();

    const res = await fetch(
        `${BASE_URL}/projects/${PROJECT_ID}/issues/g-${issueId}/set_contact_info`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'BetaHub-Project-ID': PROJECT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        }
    );

    if (!res.ok) {
        console.warn('[BetaHub] set_contact_info failed:', res.status);
    }
}

/**
 * Publish the draft issue (makes it visible).
 */
export async function publishIssue(
    issueId: string,
    jwtToken: string,
    emailMyReport: boolean = false
): Promise<void> {
    const res = await fetch(
        `${BASE_URL}/projects/${PROJECT_ID}/issues/g-${issueId}/publish`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'BetaHub-Project-ID': PROJECT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email_my_report: emailMyReport }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Publish failed: ${err.error || res.status}`);
    }
}

// =============================================================================
// Feature Request (Suggestion / Feedback)
// =============================================================================

export interface FeatureRequestResult {
    id: string;
    url: string;
}

export async function createFeatureRequest(
    description: string,
    email?: string,
    discordId?: string,
    title?: string,
    dueDate?: string,
    screenshots?: File[]
): Promise<FeatureRequestResult> {
    // Stage 1: Create Draft
    const res = await fetch(
        `${BASE_URL}/projects/${PROJECT_ID}/feature_requests.json`,
        {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(email, discordId),
                'BetaHub-Project-ID': PROJECT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                feature_request: {
                    description: description,
                    title: title?.trim() || undefined,
                    due_date: dueDate,
                },
                draft: true,
            }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const frId = data.id;
    const jwtToken = data.token; // Critical: BetaHub returns its temporary JWT token as 'token'

    // Stage 2: Upload Screenshots (Optional)
    if (screenshots && screenshots.length > 0) {
        for (const file of screenshots) {
            await uploadViaPresignedUrl('feature_requests', frId, jwtToken, 'images', file, 'image/png', file.name);
        }
    }

    // Stage 3: Set Contact Information
    // This links the virtual user if they provided an email/discord
    if (email?.trim() || discordId?.trim()) {
        await setFeatureRequestContactInfo(frId, jwtToken, email, discordId);
    }

    // Stage 4: Publish
    const publishRes = await publishFeatureRequest(frId, jwtToken);
    
    return { id: frId, url: data.url || '' };
}

export async function setFeatureRequestContactInfo(
    frId: string,
    jwtToken: string,
    email?: string,
    discordId?: string
): Promise<void> {
    const res = await fetch(
        `${BASE_URL}/projects/${PROJECT_ID}/feature_requests/${frId}/set_contact_info`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'BetaHub-Project-ID': PROJECT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email?.trim() || undefined,
                discord_id: discordId?.trim() || undefined,
            }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Set contact info failed: ${err.error || res.statusText}`);
    }
}

export async function publishFeatureRequest(
    frId: string,
    jwtToken: string
): Promise<boolean> {
    const res = await fetch(
        `${BASE_URL}/projects/${PROJECT_ID}/feature_requests/${frId}/publish`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'BetaHub-Project-ID': PROJECT_ID,
            },
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Publish failed: ${err.error || res.statusText}`);
    }

    return true;
}
