import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');
  
  // Robustly check for the key under different names to catch common configuration habits
  const apiKey = env.API_KEY || env.VITE_API_KEY;

  return {
    plugins: [react()],
    define: {
      // This embeds the API key from the build environment into the client code
      'process.env.API_KEY': JSON.stringify(apiKey),
    },
  }
})