/// <reference lib="webworker" />
/**
 * Stretches a password off the main thread. Argon2id with 64 MiB takes most of a second, which would freeze the
 * screen; here it runs in the background and only the two resulting keys come back (a CryptoKey survives the trip).
 */
import { deriveAccountKeys } from '@fisim/crypto';
import * as Comlink from 'comlink';

const api = { deriveAccountKeys };
export type AccountWorkerApi = typeof api;
Comlink.expose(api);
