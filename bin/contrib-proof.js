#!/usr/bin/env node

const { run } = require("../src/cli");

run(process.argv.slice(2)).catch((error) => {
  console.error(`contrib-proof: ${error.message}`);
  if (process.env.CONTRIB_PROOF_DEBUG === "1") {
    console.error(error.stack);
  }
  process.exitCode = 2;
});
