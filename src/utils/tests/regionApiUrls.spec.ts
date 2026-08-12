import {
  getApiUrl,
  getCdnUrl,
  getS3Url,
  getStaticUrl,
  setEnvironment,
  URL_ENUM
} from '@feathery/client-utils';

/**
 * Every data-residency region the SDK routes traffic for, and the
 * client-utils environment that region must select. A region missing from
 * updateRegionApiUrls' map is not a cosmetic gap: it leaves the SDK on the US
 * URLs, which is the exact outcome the region exists to prevent.
 */
const REGION_ENVIRONMENTS: Record<string, URL_ENUM> = {
  au: 'productionAU',
  ca: 'productionCA',
  eu: 'productionEU',
  jp: 'productionJP'
};

const urlsFor = (environment: URL_ENUM) => {
  setEnvironment(environment);
  return {
    api: getApiUrl(),
    cdn: getCdnUrl(),
    static: getStaticUrl(),
    s3: getS3Url()
  };
};

/**
 * The URLs the module exports after a fresh load - which starts on the US
 * environment, as it does in the browser - followed by one region switch.
 * A load per case, because the exported URLs are module state that a previous
 * switch would otherwise leave behind.
 */
const urlsAfterRegionSwitch = (region: string) => {
  let urls = {};
  jest.isolateModules(() => {
    setEnvironment('production');
    // init and featheryClient import each other, and init is the side that
    // instantiates the client at module scope, so it has to be entered first -
    // exactly as the SDK entrypoint does it.
    require('../init');
    const featheryClient = require('../featheryClient');
    featheryClient.updateRegionApiUrls(region);
    urls = {
      api: featheryClient.API_URL,
      cdn: featheryClient.CDN_URL,
      static: featheryClient.STATIC_URL,
      s3: featheryClient.S3_URL
    };
  });
  return urls;
};

describe('updateRegionApiUrls', () => {
  it.each(Object.entries(REGION_ENVIRONMENTS))(
    'points every exported URL at the %s region',
    (region, environment) => {
      expect(urlsAfterRegionSwitch(region)).toEqual(urlsFor(environment));
    }
  );

  it('leaves no supported region talking to the US', () => {
    const us = urlsFor('production');

    Object.keys(REGION_ENVIRONMENTS).forEach((region) => {
      const urls = urlsAfterRegionSwitch(region);
      expect(urls).not.toEqual(expect.objectContaining({ api: us.api }));
      expect(urls).not.toEqual(expect.objectContaining({ cdn: us.cdn }));
      expect(urls).not.toEqual(expect.objectContaining({ static: us.static }));
      expect(urls).not.toEqual(expect.objectContaining({ s3: us.s3 }));
    });
  });

  it('is a no-op for a region it does not route separately', () => {
    const us = urlsFor('production');

    expect(urlsAfterRegionSwitch('')).toEqual(us);
    expect(urlsAfterRegionSwitch('us')).toEqual(us);
  });
});
