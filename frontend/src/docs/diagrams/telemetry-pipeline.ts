import type { DiagramSpec } from '../diagram-spec.js';

// Telemetry as it runs today: one opt-in consent with five categories under it (core/analytics.ts,
// core/telemetry-model.ts), events queued on disk by Rust (commands/analytics.rs analytics_track:
// consent, sampling and a 10 MB cap) and flushed every 90 s to the telemetry endpoint of
// links.json, gzipped, as one packet with an id the user can later ask to erase. Live errors are a
// separate transport (commands/live_issues.rs) riding on the same consent.
export const telemetryPipeline: DiagramSpec = {
    id: 'telemetry-pipeline',
    i18n: 'docs.diagram.telemetry-pipeline',
    category: 'internals',
    dir: 'TB',
    article: 'privacy-telemetry',
    related: ['crash-reporting', 'perf-monitoring', 'offline-mode'],
    groups: [
        { id: 'CONSENT_G', dir: 'LR' },
        { id: 'COLLECT', dir: 'LR' },
        { id: 'LOCAL' },
        { id: 'NET' },
    ],
    nodes: [
        { id: 'CONSENT', kind: 'ui', group: 'CONSENT_G', icon: 'icon-shield', refs: ['frontend/src/core/analytics.ts › maybeShowConsentModal', 'frontend/src/core/analytics.ts › setConsent', 'src-tauri/src/commands/analytics.rs › set_analytics_consent'] },
        { id: 'NOTHING', kind: 'outcome', group: 'CONSENT_G', icon: 'icon-lock', refs: ['frontend/src/core/analytics.ts › stopCollection', 'src-tauri/src/commands/analytics.rs › consent_granted'] },
        { id: 'CATEGORY', kind: 'decision', group: 'CONSENT_G', refs: ['frontend/src/core/analytics.ts › categoryAllowed', 'frontend/src/core/telemetry-model.ts › categoryOf', 'frontend/src/core/telemetry-model.ts › TELEMETRY_CATEGORIES'] },

        { id: 'USAGE', kind: 'front', group: 'COLLECT', icon: 'icon-activity', refs: ['frontend/src/core/analytics.ts › startCollection', 'frontend/src/core/analytics.ts › trackView', 'frontend/src/core/analytics.ts › startPerfSampling', 'frontend/src/core/analytics.ts › hookConsoleTelemetry'] },
        { id: 'LAYA_STATS', kind: 'front', group: 'COLLECT', icon: 'icon-brain', refs: ['frontend/src/core/laya-telemetry.ts › initLayaTelemetry', 'frontend/src/core/telemetry-model.ts › eventsForCommand'] },
        { id: 'REPLAY', kind: 'front', group: 'COLLECT', icon: 'icon-play', refs: ['frontend/src/core/analytics.ts › startSessionReplay', 'frontend/src/core/replay-recorder.ts › TelemetryReplay'] },

        { id: 'TRACK', kind: 'rust', group: 'LOCAL', icon: 'icon-list', refs: ['src-tauri/src/commands/analytics.rs › analytics_track', 'src-tauri/src/commands/analytics.rs › sampling_allows'] },
        { id: 'QUEUE', kind: 'data', group: 'LOCAL', icon: 'icon-file', refs: ['src-tauri/src/commands/analytics.rs › queue_path', 'src-tauri/src/commands/analytics.rs › analytics_export'] },
        { id: 'FLUSH', kind: 'front', group: 'LOCAL', icon: 'icon-time', refs: ['frontend/src/core/analytics.ts › flush', 'frontend/src/core/analytics.ts › beaconSessionEnd'] },

        { id: 'ENDPOINT', kind: 'decision', group: 'NET', refs: ['src-tauri/src/commands/analytics.rs › endpoint_allowed', 'frontend/src/core/links-config.ts › getLinks'] },
        { id: 'SEND', kind: 'rust', group: 'NET', icon: 'icon-export', refs: ['src-tauri/src/commands/analytics.rs › analytics_flush', 'src-tauri/src/commands/analytics.rs › gzip_bytes', 'src-tauri/src/commands/analytics.rs › write_sent'] },
        { id: 'SERVER', kind: 'ext', group: 'NET', icon: 'icon-server', refs: ['src-tauri/src/commands/analytics.rs › store_sampling', 'src-tauri/src/commands/analytics.rs › analytics_packet_status'] },
        { id: 'GDPR', kind: 'ui', group: 'NET', icon: 'icon-trash', refs: ['frontend/src/core/analytics.ts › initPrivacySettings', 'src-tauri/src/commands/analytics.rs › analytics_request_deletion', 'src-tauri/src/commands/analytics.rs › analytics_request_data', 'src-tauri/src/commands/analytics.rs › analytics_clear'] },
        { id: 'LIVE_ERRORS', kind: 'rust', group: 'NET', icon: 'icon-alert', refs: ['src-tauri/src/commands/live_issues.rs › record_panic', 'src-tauri/src/commands/live_issues.rs › live_issues_set_enabled'] },
    ],
    edges: [
        { from: 'CONSENT', to: 'NOTHING', label: 'declined', tone: 'ok' },
        { from: 'CONSENT', to: 'CATEGORY', label: 'accepted', tone: 'warn', thick: true },
        { from: 'CATEGORY', to: 'USAGE', label: 'usagePerf' },
        { from: 'CATEGORY', to: 'LAYA_STATS', label: 'laya' },
        { from: 'CATEGORY', to: 'REPLAY', label: 'replay' },
        { from: 'CATEGORY', to: 'LIVE_ERRORS', label: 'errors', tone: 'info', dashed: true },
        { from: 'USAGE', to: 'TRACK', thick: true },
        { from: 'LAYA_STATS', to: 'TRACK' },
        { from: 'REPLAY', to: 'TRACK' },
        { from: 'TRACK', to: 'QUEUE', label: '~writes', thick: true },
        { from: 'QUEUE', to: 'FLUSH', label: 'every90s', thick: true },
        { from: 'FLUSH', to: 'ENDPOINT', thick: true },
        { from: 'ENDPOINT', to: 'QUEUE', label: 'staysLocal', tone: 'ok', dashed: true },
        { from: 'ENDPOINT', to: 'SEND', label: 'httpsOk', tone: 'warn', thick: true },
        { from: 'SEND', to: 'SERVER', label: 'packet', thick: true },
        { from: 'SERVER', to: 'TRACK', label: 'sampling', tone: 'info', dashed: true },
        { from: 'GDPR', to: 'SERVER', label: 'erase', tone: 'danger' },
        { from: 'GDPR', to: 'QUEUE', label: 'exportClear' },
        { from: 'LIVE_ERRORS', to: 'SERVER', label: 'issues', dashed: true },
    ],
};
