import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  // Change outDir, default is 'dist'
  outDir: 'dist',
  failOnWarn: false,
  // Generates .d.ts declaration file
  declaration: true
});
