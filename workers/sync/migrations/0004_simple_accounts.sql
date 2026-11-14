-- Simple accounts (November 13, 2026). One password now does what the account password and the separate vault
-- passphrase did: the browser derives a login key (stored here only as Better Auth's hash) and, separately, the key
-- that wraps the data key. Recovery checks are now a hash of a key derived from the recovery code, and key bundles
-- are format v2. Earlier rows cannot work with the new browser code. Production held none when this shipped.
DELETE FROM key_bundles;
DELETE FROM account_recovery;
