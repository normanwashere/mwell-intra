import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',testMatch:'sep09-feedback-local.spec.ts',workers:1,timeout:120000,
  reporter:'list',use:{baseURL:'http://localhost:3021',channel:'msedge',serviceWorkers:'block',reducedMotion:'reduce',trace:'off'},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
});
