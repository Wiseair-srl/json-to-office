/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_IMAGEKIT_PUBLIC_KEY: string;
  readonly VITE_IMAGEKIT_PRIVATE_KEY: string;
  readonly VITE_IMAGEKIT_URL_ENDPOINT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
