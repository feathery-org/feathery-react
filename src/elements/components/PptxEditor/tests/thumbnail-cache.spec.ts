import {
  cacheThumbnail,
  cachedThumbnail,
  clearThumbnailCache,
  releaseThumbnails
} from '../loading/thumbnailCache';
import { OPCPackage } from '../core/opc/package';
import { sampleBytes } from './harness';

afterEach(clearThumbnailCache);
it('bounds retained previews and separates documents and revisions', () => {
  const a = OPCPackage.open(sampleBytes());
  const b = OPCPackage.open(sampleBytes());
  for (let i = 0; i < 49; i++)
    cacheThumbnail(
      a,
      String(i),
      1,
      document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    );
  expect(cachedThumbnail(a, '0', 1)).toBeUndefined();
  expect(cachedThumbnail(a, '48', 1)).toBeDefined();
  expect(cachedThumbnail(a, '48', 2)).toBeUndefined();
  expect(cachedThumbnail(b, '48', 1)).toBeUndefined();
  releaseThumbnails(a);
  expect(cachedThumbnail(a, '48', 1)).toBeUndefined();
});
