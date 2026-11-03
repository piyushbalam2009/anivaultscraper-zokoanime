import axios from 'axios';

export interface ZokoAnimeServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub';
}
export interface ZokoAnimeSubtitle {
  lang: string;
  label: string;
  default: boolean;
  src: string;
}
export interface ZokoAnimeStream {
  embedUrl: string;
  m3u8: string;
  subtitles: ZokoAnimeSubtitle[];
  downloadUrl: string | null;
  videoId: number | null;
  skip: { intro: unknown; outro: unknown } | null;
  playbackMode: 'hls';
  serverName: 'ZokoAnime';
}
const BASE_URL = 'https://zokoanime.video';
const OBFUSCATION_KEY = 'otaku-embed-v1';

export function getZokoAnimeServers(malId: string, episode: number): ZokoAnimeServer[] {
  if (!/^\d+$/.test(malId) || !Number.isSafeInteger(episode) || episode < 1) return [];
  return (['sub', 'dub'] as const).map(type => ({
    name: 'ZokoAnime',
    sourceId: [malId, String(episode), type].join('::'),
    type,
  }));
}

function decodePlayerConfig(blob: string): any {
  const bytes = Buffer.from(blob, 'base64');
  const decoded = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    decoded[i] = bytes[i] ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length);
  }
  return JSON.parse(decoded.toString('utf8'));
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, BASE_URL);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function getZokoAnimeStream(sourceId: string): Promise<ZokoAnimeStream | null> {
  const [malId, episodeText, type, ...extra] = sourceId.split('::');
  const episode = Number(episodeText);
  if (extra.length || !/^\d+$/.test(malId || '') || !Number.isSafeInteger(episode) ||
      episode < 1 || (type !== 'sub' && type !== 'dub')) return null;

  const embedUrl = 'https://zokoanime.video/stream/mal/' + malId + '/' + episode + '/' + type;
  const response = await axios.get(embedUrl, {
    timeout: 15000,
    responseType: 'text',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AniVaultScraper/1.0)' },
  });
  const match = response.data.match(/window\.__P\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('ZokoAnime player configuration was not found');

  const config = decodePlayerConfig(match[1]);
  const m3u8 = safeHttpUrl(config.src);
  if (!m3u8 || !/\.m3u8(?:$|[?#])/i.test(new URL(m3u8).pathname + new URL(m3u8).search)) {
    throw new Error('ZokoAnime did not provide a valid HLS playlist');
  }
  const subtitles: ZokoAnimeSubtitle[] = Array.isArray(config.subtitles)
    ? config.subtitles.flatMap((track: any) => {
        const src = safeHttpUrl(track?.src);
        return src ? [{
          lang: String(track.lang || ''),
          label: String(track.label || track.lang || 'Unknown'),
          default: Boolean(track.default),
          src,
        }] : [];
      })
    : [];

  return {
    embedUrl, m3u8, subtitles,
    downloadUrl: safeHttpUrl(config.download_url),
    videoId: Number.isSafeInteger(config.video_id) ? config.video_id : null,
    skip: config.skip && typeof config.skip === 'object'
      ? { intro: config.skip.intro ?? null, outro: config.skip.outro ?? null }
      : null,
    playbackMode: 'hls',
    serverName: 'ZokoAnime',
  };
}
