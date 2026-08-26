#!/usr/bin/env node

import { executeCli } from './program.js';

const exitCode = await executeCli(process.argv.slice(2), {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
  isTTY: process.stdout.isTTY,
});

process.exitCode = exitCode;
