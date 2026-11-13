import { create } from 'zustand';

export const publicCloud =
  import.meta.env.VITE_PUBLIC_CLOUD === 'true' ||
  (typeof window !== 'undefined' && window.location.hostname === 'longview-planner.pages.dev');
export interface CloudUser {
  id: string;
  username: string;
}
export const useCloudAccount = create<{ user: CloudUser | null; loading: boolean; error: string }>(() => ({
  user: null,
  loading: publicCloud,
  error: '',
}));

export async function accountRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(data?.message ?? `Account request failed (${response.status}).`);
  return data;
}

export async function refreshAccount(): Promise<CloudUser | null> {
  if (!publicCloud) return null;
  useCloudAccount.setState({ loading: true, error: '' });
  try {
    const data = await accountRequest<{ user: CloudUser } | null>('auth/get-session');
    const user = data?.user ?? null;
    useCloudAccount.setState({ user, loading: false });
    return user;
  } catch {
    useCloudAccount.setState({
      user: null,
      loading: false,
      error: 'Cloud accounts are unavailable right now. You can keep using local plans.',
    });
    return null;
  }
}
