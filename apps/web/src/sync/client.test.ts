import { describe, expect, it } from 'vitest';
import { createSyncClient } from './client';

describe('cloud response versions', () => {
  it.each<Record<string, string>>([{ ETag: '"4"' }, { ETag: 'W/"4"' }, { 'X-Plan-Version': '4' }])(
    'reads compressed or explicit version headers: %j',
    async (headers) => {
      const client = createSyncClient({
        baseUrl: '/api',
        fetch: async () => new Response('{"wrapped":true}', { headers }),
      });
      expect(await client.getKeys()).toEqual({ version: 4, bundle: { wrapped: true } });
    },
  );
  it('rejects a missing or malformed version before decrypting', async () => {
    const client = createSyncClient({
      baseUrl: '/api',
      fetch: async () => new Response('{}', { headers: { ETag: 'W/"garbage"' } }),
    });
    await expect(client.getKeys()).rejects.toThrow('Missing version');
  });
});
