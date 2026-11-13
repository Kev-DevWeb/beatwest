import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works both at a domain root and under
  // a sub-path such as https://<user>.github.io/beatwest/.
  base: './',
});
