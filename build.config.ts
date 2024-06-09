import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  // Change outDir, default is 'dist'
  outDir: "dist",

  // Generates .d.ts declaration file
  declaration: true,
});
