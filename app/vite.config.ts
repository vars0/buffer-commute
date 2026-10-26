import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages target: vars0/buffer-commute. Override with --base=./ for root hosting.
export default defineConfig({ plugins: [react()], base: '/buffer-commute/' });
