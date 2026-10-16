// Category names and colours follow PiliPlus (GPL-3.0); see THIRD_PARTY_NOTICES.md.
export const categories = {
    sponsor: ['赞助/恰饭', 0x00d400],
    selfpromo: ['无偿/自我推广', 0xffff00],
    exclusive_access: ['独家访问/抢先体验', 0x008a5c],
    interaction: ['三连/互动提醒', 0xcc00ff],
    poi_highlight: ['精彩时刻/重点', 0xff1684],
    intro: ['过场/开场动画', 0x00ffff],
    outro: ['鸣谢/结束画面', 0x0202ed],
    preview: ['回顾/概要', 0x008fd6],
    padding: ['填充内容/前黑/后黑', 0x222222],
    filler: ['离题闲聊/玩笑', 0x7300ff],
    music_offtopic: ['音乐:非音乐部分', 0xff9900],
} as const;

export type Category = keyof typeof categories;
export type Mode = 'auto' | 'manual' | 'show' | 'off';
export interface Segment {
    UUID: string;
    category: Category;
    actionType: string;
    segment: [number, number];
}
export interface Settings {
    server: string;
    policy: string;
    minDuration: number;
    modes: Record<Category, Mode>;
}

export function parseSettings(argument: string | undefined): Settings {
    const raw = JSON.parse(argument || '{}');
    const server = String(raw.server || 'https://www.bsbsb.top').replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(server)) throw new Error('Invalid SponsorBlock server');
    const modes = {} as Record<Category, Mode>;
    for (const key of Object.keys(categories) as Category[]) {
        const mode = raw[key] ?? (key === 'sponsor' ? 'auto' : 'manual');
        if (!['auto', 'manual', 'show', 'off'].includes(mode)) throw new Error(`Invalid mode for ${key}`);
        modes[key] = mode;
    }
    const minDuration = Number(raw.minDuration ?? 0);
    if (!Number.isFinite(minDuration) || minDuration < 0) throw new Error('Invalid minimum duration');
    return { server, policy: String(raw.policy || 'DIRECT'), minDuration, modes };
}

export function parseSegments(input: unknown, cid: string): Segment[] {
    if (!Array.isArray(input)) throw new Error('Invalid SponsorBlock response');
    const result: Segment[] = [];
    const seen = new Set<string>();
    for (const item of input) {
        if (!item || !Object.hasOwn(categories, item.category)) continue;
        if (item.cid != null && String(item.cid) !== cid) continue;
        if (!Array.isArray(item.segment) || item.segment.length !== 2) continue;
        const [start, end] = item.segment;
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end))
            continue;
        if (start < 0 || end < start || end > 2_147_483) continue;
        if (
            item.actionType !== 'skip' &&
            item.actionType !== 'poi' &&
            item.actionType !== 'full' &&
            item.actionType !== 'mute'
        )
            continue;
        const id = String(item.UUID || `${item.category}:${start}:${end}`);
        if (id.length > 128) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({ UUID: id, category: item.category, actionType: item.actionType, segment: [start, end] });
        if (result.length === 500) break;
    }
    return result.sort((a, b) => a.segment[0] - b.segment[0]);
}

export function segmentMode(segment: Segment, settings: Settings): Mode {
    const mode = settings.modes[segment.category];
    if (mode === 'off') return mode;
    if (segment.actionType === 'poi') return mode === 'manual' && segment.segment[1] > 0 ? 'manual' : 'show';
    if (
        segment.actionType !== 'skip' ||
        segment.segment[1] - segment.segment[0] < settings.minDuration ||
        segment.segment[0] === segment.segment[1]
    )
        return 'show';
    return mode;
}
