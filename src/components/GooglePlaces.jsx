import React, { useEffect, useState } from 'react';
import Script from 'react-load-script';

export default function GooglePlaces({
    googleKey,
    activeStep,
    steps,
    setFieldValues,
    onChange
}) {
    const [googleLoad, setGoogleLoad] = useState(false);
    const [searchFieldKey, setSearchFieldKey] = useState('');

    useEffect(() => {
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.type === 'gmap_line_1') setSearchFieldKey(servar.key);
        });
    }, [activeStep, setSearchFieldKey]);

    useEffect(() => {
        if (!googleLoad || !searchFieldKey) return;

        // Initialize Google Autocomplete
        /* global google */
        const autocomplete = new google.maps.places.Autocomplete(
            document.getElementById(searchFieldKey),
            {
                componentRestrictions: { country: 'us' },
                fields: ['address_components'],
                types: ['address']
            }
        );

        const handlePlaceSelect = () => {
            // Extract City From Address Object
            const addressObject = autocomplete.getPlace();
            const address = addressObject.address_components;

            // Check if address is valid
            if (address) {
                const addressMap = {};
                address.forEach((component) => {
                    const componentType = component.types[0];

                    switch (componentType) {
                        case 'street_number': {
                            const line1 = addressMap.gmap_line_1 || '';
                            addressMap.gmap_line_1 = `${component.long_name} ${line1}`;
                            break;
                        }
                        case 'route': {
                            const line1 = addressMap.gmap_line_1 || '';
                            addressMap.gmap_line_1 = `${line1}${component.long_name}`;
                            break;
                        }
                        case 'locality': {
                            addressMap.gmap_city = component.long_name;
                            break;
                        }
                        case 'administrative_area_level_1': {
                            addressMap.gmap_state = component.long_name;
                            break;
                        }
                        case 'postal_code': {
                            addressMap.gmap_zip = component.long_name;
                            break;
                        }
                    }
                });

                const addrFieldValues = {};
                Object.values(steps).forEach((step) => {
                    step.servar_fields.forEach((field) => {
                        const servar = field.servar;
                        if (servar.type in addressMap) {
                            addrFieldValues[servar.key] =
                                addressMap[servar.type];
                        }
                    });
                });

                if (Object.keys(addrFieldValues).length > 0) {
                    let newValues;
                    setFieldValues((fieldValues) => {
                        newValues = { ...fieldValues, ...addrFieldValues };
                        return newValues;
                    });
                    Object.keys(addrFieldValues).forEach((fieldKey) => {
                        onChange(fieldKey, newValues);
                    });
                }
            }
        };

        // Fire Event when a suggested name is selected
        autocomplete.addListener('place_changed', handlePlaceSelect);
    }, [googleLoad, activeStep, searchFieldKey, setFieldValues]);

    return searchFieldKey && googleKey ? (
        <Script
            url={`https://maps.googleapis.com/maps/api/js?key=${googleKey}&libraries=places`}
            onLoad={() => setGoogleLoad(true)}
        />
    ) : null;
}
