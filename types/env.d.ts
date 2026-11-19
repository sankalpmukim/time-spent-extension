interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  readonly VITE_AUTH_PAGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
