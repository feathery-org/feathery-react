// Source document handed in by the host. `buffer` when the host has already
// fetched the bytes (e.g. an authenticated download); `url` for the component
// to fetch directly (unauthenticated / pre-signed).
export type DocxSource = { url: string } | { buffer: ArrayBuffer };
