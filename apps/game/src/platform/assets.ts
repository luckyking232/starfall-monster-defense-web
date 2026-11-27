declare const __STARFALL_ASSET_DIRECTORY__: string;

const directory = typeof __STARFALL_ASSET_DIRECTORY__ === 'string' ? __STARFALL_ASSET_DIRECTORY__ : 'assets/';

export function assetUrl(path: string): URL {
  return new URL(directory + path, document.baseURI);
}
