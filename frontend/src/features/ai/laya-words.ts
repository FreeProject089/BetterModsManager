// laya-words.ts — the words for Laya's fixed vocabularies (report kinds, app areas, crash
// causes, report categories, severities, the features a call comes from).
//
// Every key is written out so the i18n gates can see each one (a key built from a fragment is invisible
// to them and renders as its own key on a miss). An id this file does not know is shown as is.
import { t } from '../../core/i18n.js';

export function kindWord(id: string): string {
    switch (id) {
        case 'feedback': return t('fbm.kind.feedback');
        case 'bug': return t('fbm.kind.bug');
        case 'crash': return t('fbm.kind.crash');
        default: return id;
    }
}

export function areaWord(id: string): string {
    switch (id) {
        case 'mods': return t('laya.area.mods');
        case 'profiles': return t('laya.area.profiles');
        case 'load_order': return t('laya.area.load_order');
        case 'downloads': return t('laya.area.downloads');
        case 'launch': return t('laya.area.launch');
        case 'settings': return t('laya.area.settings');
        case 'interface': return t('laya.area.interface');
        case 'performance': return t('laya.area.performance');
        case 'ai': return t('laya.area.ai');
        case 'other': return t('laya.area.other');
        default: return id;
    }
}

export function causeWord(id: string): string {
    switch (id) {
        case 'panic': return t('laya.cause.panic');
        case 'out_of_memory': return t('laya.cause.out_of_memory');
        case 'file_access': return t('laya.cause.file_access');
        case 'network': return t('laya.cause.network');
        case 'mod_conflict': return t('laya.cause.mod_conflict');
        case 'game_launch': return t('laya.cause.game_launch');
        case 'graphics': return t('laya.cause.graphics');
        case 'data_corrupt': return t('laya.cause.data_corrupt');
        case 'other': return t('laya.cause.other');
        case 'unknown': return t('laya.cause.unknown');
        default: return id;
    }
}

export function categoryWord(id: string): string {
    switch (id) {
        case 'crash': return t('laya.cat.crash');
        case 'bug': return t('laya.cat.bug');
        case 'performance': return t('laya.cat.performance');
        case 'install': return t('laya.cat.install');
        case 'mod_conflict': return t('laya.cat.mod_conflict');
        case 'ui': return t('laya.cat.ui');
        case 'other': return t('laya.cat.other');
        default: return id;
    }
}

export function severityWord(id: string): string {
    switch (id) {
        case 'low': return t('laya.sev.low');
        case 'medium': return t('laya.sev.medium');
        case 'high': return t('laya.sev.high');
        case 'critical': return t('laya.sev.critical');
        default: return id;
    }
}

/** The feature a recorded call came from (`ai_core::laya_scope`). */
export function featureWord(id: string): string {
    switch (id) {
        case 'mod_suggest': return t('ai.lt.area.mod_suggest');
        case 'library': return t('ai.lt.area.library');
        case 'ask': return t('ai.lt.area.ask');
        case 'triage': return t('ai.lt.area.triage');
        case 'api': return t('ai.lt.area.api');
        case 'tasks': return t('ai.lt.area.tasks');
        case 'crashes': return t('ai.lt.area.crashes');
        case 'report_assist': return t('laya.dbg.fReportAssist');
        case 'debug': return t('laya.dbg.fDebug');
        case 'other': return t('laya.dbg.fOther');
        default: return id;
    }
}

/** An area of « Réponses de Laya » (`ai_tuning::Area`). */
export function tuningAreaWord(id: string): string {
    switch (id) {
        case 'mod_suggest': return t('ai.lt.area.mod_suggest');
        case 'ask': return t('ai.lt.area.ask');
        case 'triage': return t('ai.lt.area.triage');
        case 'library': return t('ai.lt.area.library');
        case 'tasks': return t('ai.lt.area.tasks');
        case 'api': return t('ai.lt.area.api');
        case 'crashes': return t('ai.lt.area.crashes');
        default: return id;
    }
}
