import { publicRequest } from './public-app';
import type { PublicEnv } from './public-auth';

export default {
  fetch(request: Request, env: PublicEnv & { ASSETS: Fetcher }): Promise<Response> {
    return new URL(request.url).pathname.startsWith('/api/')
      ? publicRequest(request, env)
      : env.ASSETS.fetch(request);
  },
};
