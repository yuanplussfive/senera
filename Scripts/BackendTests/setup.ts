import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Host-global state, including the secret keyring, resolves from SENERA_DATA_ROOT. Without this a
// test that seals a secret would mint the developer's real master key instead of a throwaway one.
process.env.SENERA_DATA_ROOT ??= fs.mkdtempSync(path.join(os.tmpdir(), "senera-test-host-"));
