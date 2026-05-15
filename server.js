"use strict";
// Hostinger entry point - LiteSpeed (lsnode.js) requires server.js at app root.
// Next.js standalone output places its server inside .next/standalone/.
const path = require("path");
const standaloneDir = path.join(__dirname, ".next", "standalone");
process.chdir(standaloneDir);
require(path.join(standaloneDir, "server.js"));
