import { Router, Request, Response } from 'express';
import { getZokoAnimeServers, getZokoAnimeStream } from './zokoanime';
import { getSiteIds } from '../utils/mapper';
import { proxiedHlsUrl, proxiedSubtitleUrl } from '../routes';

const router = Router();

function safeError(error: any) {
  return error?.response?.status
    ? 'Upstream returned HTTP ' + error.response.status
    : error?.message || 'Provider request failed';
}

async function resolveZokoMalId(req: Request): Promise<string | null> {
  const malId = String(req.query.malId || '');
  if (/^\d+$/.test(malId)) return malId;
  const anilistId = Number(req.query.anilistId);
  if (!Number.isSafeInteger(anilistId) || anilistId < 1) return null;
  const ids = await getSiteIds(anilistId);
  return ids?.malId ? String(ids.malId) : null;
}

router.get('/zokoanime/servers', async (req: Request, res: Response) => {
  try {
    const malId = await resolveZokoMalId(req);
    const episode = Number(req.query.ep);
    if (!malId) return res.status(400).json({ error: 'Provide a valid ?malId= or a resolvable ?anilistId=' });
    if (!Number.isSafeInteger(episode) || episode < 1) {
      return res.status(400).json({ error: 'Required query param: ?ep={episodeNumber}' });
    }
    const servers = getZokoAnimeServers(malId, episode);
    return res.json({ source: 'zokoanime', malId: Number(malId), episode, count: servers.length, servers });
  } catch (error) {
    return res.status(502).json({ error: safeError(error) });
  }
});

router.get('/zokoanime/watch', async (req: Request, res: Response) => {
  const sourceId = String(req.query.serverId || '');
  if (!sourceId) return res.status(400).json({ error: 'Missing ?serverId=' });
  try {
    const stream = await getZokoAnimeStream(sourceId);
    if (!stream) return res.status(400).json({ error: 'Invalid ZokoAnime server ID' });
    const [malId, episode, type] = sourceId.split('::');
    return res.json({
      source: 'zokoanime',
      malId: Number(malId),
      episode: Number(episode),
      type,
      ...stream,
      // The shared HLS proxy rewrites every nested playlist/segment URI and
      // forwards ZokoAnime's required Referer and Origin headers.
      hlsProxyUrl: proxiedHlsUrl(req, stream.m3u8, stream.embedUrl),
      subtitles: stream.subtitles.map((track) => ({
        ...track,
        url: proxiedSubtitleUrl(req, track.src, stream.embedUrl),
      })),
      iframeOnly: false,
    });
  } catch (error) {
    return res.status(502).json({ source: 'zokoanime', error: safeError(error) });
  }
});

export default router;
