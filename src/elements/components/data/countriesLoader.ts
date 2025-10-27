// Dynamic loader for countries data to reduce initial bundle size

let countriesPromise: Promise<any> | null = null;

export function loadCountriesData() {
  if (!countriesPromise) {
    countriesPromise = import(/* webpackChunkName: "countries-data" */ './countries');
  }
  return countriesPromise;
}

export async function findCountryByID(id: string, idType = 'code') {
  const countriesModule = await loadCountriesData();
  return countriesModule.findCountryByID(id, idType);
}

export async function getCountryData() {
  const countriesModule = await loadCountriesData();
  return countriesModule.default;
}

export async function getFirebaseSMSCountries() {
  const countriesModule = await loadCountriesData();
  return countriesModule.firebaseSMSCountries;
}
